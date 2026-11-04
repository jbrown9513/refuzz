# Runs one Ruzzy fuzz target in-process for many inputs, the way libFuzzer runs it: the target file defines
# `test_one_input = lambda { |data| ... }` and ends with `Ruzzy.fuzz(test_one_input)`. It is loaded here with a stand-in Ruzzy
# whose `fuzz` keeps the lambda instead of starting libFuzzer (and Ruzzy's own FuzzedDataProvider), so the same file runs
# unchanged under real Ruzzy. Each input arrives on stdin as a u32 LE length and its raw bytes and is handed to the lambda as
# a binary String. For each input it writes one JSON line: what happened, whose code failed (the project's, a `raise` the
# target makes to state a property, or a bug in the target's own lines), the project's frames, and the coverage edges and
# lines this process had not seen before. Usage: ruby ruby_fuzz.rb <target.rb> <root> <timeout ms>
# json is required after the target has loaded the project: requiring a gem activates its newest installed version, and the
# project's gemspec may pin an older one (json ~> 2.14 beside an installed 3.x), which then cannot be activated.
require 'timeout'
require 'zlib'

HARNESS = File.expand_path(ARGV[0])
ROOT = File.expand_path(ARGV[1])
TIMEOUT = ARGV[2].to_f / 1000
OUT = STDOUT.dup
OUT.sync = true
# What the target and the project print must not land in the report stream.
STDOUT.reopen(STDERR)
Regexp.timeout = TIMEOUT if Regexp.respond_to?(:timeout=)

# Ruzzy as a target sees it: `require 'ruzzy'` loads nothing more, `fuzz` hands over the lambda.
module Ruzzy
  class << self
    attr_reader :target

    def fuzz(test_one_input, _args = ARGV)
      @target = test_one_input
      0
    end

    def trace(_file) = nil
  end
end
require 'ruzzy/fuzzed_data_provider'

module Kernel
  alias refuzz_require require
  private def require(name) = name == 'ruzzy' ? false : refuzz_require(name)
end

# The exceptions the target raised itself, a new one from one of its own lines: a property it states that broke. A bare
# `raise` passing on what the project threw is not one. The lambda's `self` is the top-level object, so its `raise` is this.
ASSERTIONS = {}.compare_by_identity
module RefuzzAssertions
  %i[raise fail].each do |m|
    define_method(m) do |*args, **kw|
      fresh = !args.empty? && !(args[0].is_a?(Exception) && args[0].backtrace)
      mine = caller_locations(1, 1).first&.absolute_path == HARNESS
      begin
        super(*args, **kw)
      rescue Exception => e # rubocop:disable Lint/RescueException
        ASSERTIONS[e] = true if fresh && mine
        ::Kernel.instance_method(:raise).bind_call(self, e)
      end
    end
  end
end
TOPLEVEL_BINDING.receiver.singleton_class.prepend(RefuzzAssertions)

MAPPED = {}

# The project's Ruby files, relative to ROOT, for mapping installed copies back to them: read the first time one is needed.
def sources
  @sources ||= Dir.glob('**/*.rb', base: ROOT).reject { |f| f.match?(%r{(\A|/)(\.|node_modules/|vendor/)}) }
end

# The project file a running file is, relative to the project's folder, or nil. The project's build installs it the way its
# users get it (`gem install` copies a gem's files into $GEM_HOME/gems/<name>-<version>/), so a file there is mapped back to
# the checkout's file with the same path below the gem's folder.
def source_of(path)
  return MAPPED[path] if MAPPED.key?(path)
  rel = if path == HARNESS then nil
        elsif path.start_with?("#{ROOT}/") then path.delete_prefix("#{ROOT}/")
        elsif (m = %r{/gems/[^/]+/(.+)\z}.match(path))
          found = sources.select { |s| s == m[1] || s.end_with?("/#{m[1]}") }
          found.size == 1 ? found[0] : nil
        end
  rel = nil if rel&.match?(%r{(\A|/)(spec|test|tests|vendor|\.bundle)/})
  MAPPED[path] = rel
end

def project?(path) = !source_of(path).nil?

def frame(line)
  m = /\A(.+?):(\d+)(?::in [`'](.*)')?\z/.match(line)
  m && { 'path' => m[1], 'line' => m[2].to_i, 'name' => m[3].to_s }
end

# Coverage: edges between consecutive project lines, hashed, from a line TracePoint on while the target runs.
ids = {}
paths = {}
seen = {}
current = {}
lines_now = {}
prev = 0
trace = TracePoint.new(:line) do |tp|
  path = tp.path
  id = ids[path]
  if id.nil?
    full = File.expand_path(path)
    id = ids[path] = project?(full) ? Zlib.crc32(full) & 0xFFFF : -1
    paths[id] = source_of(full) if id >= 0
  end
  next if id.negative?
  here = (id << 20) | (tp.lineno & 0xFFFFF)
  current[(prev * 31 + here) & 0xFFFFFFFF] = true
  lines_now[here] = true
  prev = here
end

# The project's own lib/ (and ext/) on the load path, as its tests run with `ruby -Ilib`: a checkout the build did not install
# as a gem still loads by name (`require "jwt"`, `require "onelogin/ruby-saml"`), and an installed gem of the same name
# yields to the checkout being fuzzed.
%w[ext lib].each do |d|
  dir = File.join(ROOT, d)
  $LOAD_PATH.unshift(dir) if File.directory?(dir) && !$LOAD_PATH.include?(dir)
end

begin
  load HARNESS
  Kernel.raise NameError, 'the target never calls Ruzzy.fuzz(test_one_input) with a lambda' unless Ruzzy.target.respond_to?(:call)
rescue Exception => e # rubocop:disable Lint/RescueException
  require 'json'
  OUT.puts JSON.generate({ fatal: "#{e.class}: #{e.message}"[0, 1500], trace: (e.backtrace || []).first(8).join("\n") })
  exit!(0)
end
require 'json'
OUT.puts JSON.generate({ ready: true })
target = Ruzzy.target

$stdin.binmode
loop do
  head = $stdin.read(4)
  break if head.nil? || head.bytesize < 4
  n = head.unpack1('L<')
  data = (n.positive? && $stdin.read(n)) || ''.b
  srand(0)
  current = {}
  lines_now = {}
  prev = 0
  report = { 'status' => 'ok' }
  begin
    result = Timeout.timeout(TIMEOUT) do
      trace.enable
      begin
        target.call(data)
      ensure
        trace.disable
      end
    end
    report['result'] = (result.inspect[0, 300] rescue '<unrepresentable>')
  rescue Timeout::Error, (defined?(Regexp::TimeoutError) ? Regexp::TimeoutError : Timeout::Error)
    report = { 'status' => 'timeout', 'origin' => 'library', 'type' => 'Timeout' }
  rescue Exception => e # rubocop:disable Lint/RescueException
    frames = (e.backtrace || []).filter_map { |l| frame(l) }
    # Whose code failed: the target's own `raise`, else the innermost frame that is the target's or the project's.
    first = frames.find { |f| f['path'] == HARNESS || project?(f['path']) }
    origin = if ASSERTIONS.key?(e) then 'assertion'
             elsif first && first['path'] != HARNESS then 'library'
             else 'setup'
             end
    message = e.message.to_s
    message = "target line #{first['line']}: #{message}" if first && origin == 'setup'
    report = { 'status' => 'error', 'origin' => origin, 'type' => origin == 'assertion' ? 'assertion' : e.class.name, 'message' => message.scrub[0, 400],
               'frames' => frames.select { |f| project?(f['path']) }.first(12).reverse.map { |f| f.merge('path' => source_of(f['path'])) } }
  end
  ASSERTIONS.clear
  fresh = current.keys.reject { |k| seen[k] }
  fresh.each { |k| seen[k] = true }
  report['features'] = fresh
  report['lines'] = lines_now.keys.filter_map { |h| (p = paths[h >> 20]) && [p, h & 0xFFFFF] }
  OUT.puts JSON.generate(report)
end
