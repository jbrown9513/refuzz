/**
 * Ruby: the project built and installed by its OSS-Fuzz build spec (src/build.ts) in the base-builder-ruby image (its gems
 * in $GEM_HOME, Ruzzy beside them), fuzz targets as Ruzzy files run in that container by src/probes/ruby_fuzz.rb
 * (rubyFuzz below), and by Ruzzy itself for the native engine.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { shq } from '../run.ts';
import { signalOf, type LineDriver } from '../session.ts';
import type { Adapter, Built, FuzzRuntime, FuzzSession, Report, Runtime, Target } from '../types.ts';

/** Where the driver goes in the container. */
const DRIVER = '/tmp/refuzz/ruby_fuzz.rb';
/**
 * The ASan options Ruzzy runs Ruby with, and ODR checking off: each native extension is its own shared object, and two of a
 * gem's extensions defining the same global (`VALUE mOpenC3`) is how Ruby extensions are written, not a violation.
 */
const ASAN_OPTIONS = 'allocator_may_return_null=1:detect_leaks=0:use_sigaltstack=0:detect_odr_violation=0';

/** The class and module names around a line, outermost first, from indentation: Ruby's `end` closes at the opener's depth. */
function enclosing(lines: string[], line: number): { names: string[]; singleton: boolean } {
  const names: string[] = [];
  let singleton = false;
  let indent = (lines[line - 1] ?? '').search(/\S/);
  for (let i = line - 2; i >= 0 && indent > 0; i--) {
    const m = /^(\s*)(class|module)\s+(<<\s*self|[\w:]+)/.exec(lines[i]);
    if (!m || m[1].length >= indent) continue;
    indent = m[1].length;
    if (m[3].startsWith('<<')) singleton = true;
    else names.unshift(m[3]);
  }
  return { names, singleton };
}

/** A method under `private` or `protected` in its class body, or named by `private :name`. */
function hidden(t: Target, source: string): boolean {
  const lines = source.split('\n');
  const def = lines[t.line - 1] ?? '';
  if (/^\s*(private|protected)\s+def\b/.test(def)) return true;
  const name = t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^\\s*(private|protected|private_class_method)\\b[^#\\n]*[:'"]${name}(?![\\w?!=])`, 'm').test(source)) return true;
  // `private` with no arguments applies to instance methods defined after it, not to `def self.x`.
  if (/^\s*def\s+self\./.test(def)) return false;
  const indent = def.search(/\S/);
  for (let i = t.line - 2; i >= 0; i--) {
    const l = lines[i];
    const at = l.search(/\S/);
    if (at < 0) continue;
    if (at < indent && /^\s*(class|module)\b/.test(l)) return false;
    if (at === indent && /^\s*(private|protected)\s*(#.*)?$/.test(l)) return true;
    if (at === indent && /^\s*public\s*(#.*)?$/.test(l)) return false;
  }
  return false;
}

/** The gemspecs in the checkout, with how many Ruby files each gem's lib folder holds. */
function gemspecs(dir: string): { path: string; files: number }[] {
  const out: { path: string; files: number }[] = [];
  const count = (d: string) => { try { return readdirSync(d, { recursive: true }).filter((f) => String(f).endsWith('.rb')).length; } catch { return 0; } };
  const walk = (rel: string, depth: number) => {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = readdirSync(join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'vendor') continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isFile() && e.name.endsWith('.gemspec')) out.push({ path, files: count(join(dir, rel, 'lib')) });
      else if (e.isDirectory() && depth < 4) walk(path, depth + 1);
    }
  };
  walk('', 1);
  return out;
}

/**
 * A target's file as Ruby requires it: a file below a gem's `lib/` folder (one beside a gemspec) by its feature name, with the
 * gem's top file first, which loads what the rest expects; any other file by its path in the project.
 */
function requires(t: Target, b: Built): string[] {
  const m = /^(?:(.*)\/)?lib\/(.+)\.rb$/.exec(t.path);
  const gem = m?.[1] ? `${m[1]}/` : '';
  const isGem = (() => { try { return readdirSync(join(b.dir, gem)).some((f) => f.endsWith('.gemspec')); } catch { return false; } })();
  if (!m || !isGem) return [`require "${b.src}/${t.path.replace(/\.rb$/, '')}"`];
  const top = m[2].split('/')[0];
  return [...(m[2].includes('/') && existsSync(join(b.dir, gem, 'lib', `${top}.rb`)) ? [`require "${top}"`] : []), `require "${m[2]}"`];
}

/** Checks the project's main gem, the one whose lib folder holds the most Ruby, is installed and loads. */
const READY = `
path = ARGV[0]
spec = Dir.chdir(File.dirname(path)) { Gem::Specification.load(path) } or abort("#{path} does not load")
gem spec.name
main = spec.name.tr('-', '/')
require main if File.exist?(File.join(File.dirname(path), 'lib', "#{main}.rb"))
`;

export const ruby: Adapter = {
  languages: ['ruby'],
  async ready(b) {
    const main = gemspecs(b.dir).sort((x, y) => y.files - x.files)[0];
    if (main) {
      // Loaded the way targets load it: with Ruzzy's sanitizer runtime preloaded, which an instrumented extension needs.
      const r = await b.box.exec(`LD_PRELOAD=$(ruby -e 'require "ruzzy"; print Ruzzy::ASAN_PATH') ASAN_OPTIONS=${ASAN_OPTIONS} ruby -e ${shq(READY)} ${shq(`${b.src}/${main.path}`)}`, { cwd: '/tmp', timeoutMs: 300_000 });
      // A sanitizer's report ends in stack frames: the lines around them say what went wrong.
      return r.code === 0 ? undefined : `the gem ${main.path} is not installed or does not load: ${(r.stderr || r.stdout).trim().split('\n').filter((l) => !/^\s+#\d+ /.test(l)).slice(-8).join('\n')}`;
    }
    if (!existsSync(join(b.dir, 'Gemfile'))) return undefined;
    const r = await b.box.exec('bundle check', { cwd: b.src, timeoutMs: 300_000 });
    return r.code === 0 ? undefined : `the Gemfile's gems are not installed: ${(r.stdout + r.stderr).trim().split('\n').slice(-6).join('\n')}`;
  },
  async prepare(b, log) {
    const place = containerPlace(b.box);
    await place.put('/tmp/refuzz', { 'ruby_fuzz.rb': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'ruby_fuzz.rb')) });
    const asan = await b.box.exec(`ruby -e 'require "ruzzy"; print Ruzzy::ASAN_PATH'`, { timeoutMs: 60_000 });
    if (asan.code !== 0 || !asan.stdout.trim()) throw new Error(`Ruzzy does not load in the built image: ${(asan.stderr || asan.stdout).trim().slice(-400)}`);
    const read = (path: string) => (existsSync(join(b.dir, path)) ? readFileSync(join(b.dir, path), 'utf8') : '');
    const rt: Runtime = {
      language: b.language,
      guide: `Ruby statements at top level, one per item. \`require "name"\` lines load the project, which is installed as a gem: a file at <gem>/lib/a/b.rb is \`require "a/b"\`; a file outside a gem's lib folder is loaded by its path in the project, \`require "${b.src}/<path>"\`. Build the arguments, then the last line calls the target and binds what it returns: \`result = Klass.new(...).method(...)\` for an instance method, \`result = Klass.method(...)\` for a class method. Private methods cannot be called.`,
      importFor(t: Target) {
        const out = requires(t, b);
        const { names, singleton } = enclosing(read(t.path).split('\n'), t.line);
        const self = singleton || /^def\s+self\./.test(t.header);
        if (names.length) out.push(`# defines ${names.join('::')}${self ? '.' : '#'}${t.name}`);
        return out.join('\n');
      },
      isImport: (l) => /^\s*(require|require_relative)\b/.test(l),
      bindsResult: (l) => /^result\s*=(?!=)/.test(l),
      parseWrap: (code) => ({ source: code, offset: 0 }),
      isPublic: (t, source) => !t.name.startsWith('_') && t.name !== 'initialize' && !hidden(t, source),
      errorsAreValues: false,
      rejections: ['ArgumentError', 'TypeError', 'RangeError', 'KeyError', 'IndexError', 'NotImplementedError'],
      fuzz: rubyFuzz(place, b, asan.stdout.trim(), log),
      environmental: (r) => /^(LoadError|Gem::\w+|SystemExit|Interrupt|SignalException|SocketError|Errno::(ENETUNREACH|ECONNREFUSED|EHOSTUNREACH|EADDRNOTAVAIL))$/.test(r.type ?? ''),
    };
    return rt;
  },
};

/** A dictionary entry in libFuzzer's format: a quoted string, `\\`, `\"` and bytes outside printable ASCII as `\xNN`. */
export const dictLine = (s: string) => `"${[...Buffer.from(s, 'utf8')].map((b) => (b === 0x5c ? '\\\\' : b === 0x22 ? '\\"' : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('')}"`;

/**
 * A libFuzzer engine (Ruzzy, luzer) running one target in a place for `seconds`, seeded with `corpus` and `dict`. libFuzzer
 * stops at its first crash, so it is started again on the corpus it grew until the time is up. Each crash is run back through
 * the session for its report, one per kind and place; one the session does not reproduce (a leak, an out-of-memory) is
 * reported from libFuzzer's own account. `argv` is the engine's command line, to which libFuzzer's flags and the corpus
 * folder are added; `env` is set for it. `log` gets one line on how the run went.
 */
export async function libFuzzerNative(place: Place, argv: string[], env: Record<string, string>, corpus: Buffer[], dict: string[], seconds: number, rerun: (input: Buffer) => Promise<Report | undefined>, log: (s: string) => void): Promise<{ crashes: { input: Buffer; report: Report }[]; corpus: Buffer[]; execs: number }> {
  const dir = await place.folder('native');
  const crashes: { input: Buffer; report: Report }[] = [];
  let execs = 0;
  try {
    await place.put(dir, {
      ...Object.fromEntries(corpus.map((b) => [`corpus/${createHash('sha1').update(b).digest('hex')}`, b])),
      'dict.txt': dict.map(dictLine).join('\n') + '\n',
    });
    const command = ['env', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...argv].map(shq).join(' ');
    const end = Date.now() + seconds * 1000;
    const logs: string[] = [];
    // First libFuzzer in fork mode, ignoring crashes, timeouts and out-of-memory: it keeps fuzzing past every failure for
    // the whole slot. An engine whose fork mode does not run here (it re-executes the command line) runs no input; then
    // libFuzzer runs plainly, started again after each crash.
    {
      const left = Math.max(1, Math.floor((end - Date.now()) / 1000));
      const r = await place.run(['sh', '-c', `mkdir -p corpus crashes && ${command} -fork=1 -ignore_crashes=1 -ignore_timeouts=1 -ignore_ooms=1 -max_total_time=${left} -print_final_stats=1 -timeout=10 -rss_limit_mb=4096 -artifact_prefix=${dir}/crashes/ ${dict.length ? '-dict=dict.txt ' : ''}corpus </dev/null 2>&1 | tail -c 20000`], { cwd: dir, timeoutMs: (left + 120) * 1000 });
      execs += Number(/stat::number_of_executed_units:\s*(\d+)/.exec(r.stdout)?.[1] ?? [...r.stdout.matchAll(/^#(\d+)/gm)].at(-1)?.[1] ?? 0);
      logs.push(r.stdout);
    }
    const forked = execs > 0;
    for (let round = 0; !forked && round < 20 && Date.now() < end - 2_000; round++) {
      const left = Math.max(1, Math.floor((end - Date.now()) / 1000));
      const r = await place.run(['sh', '-c', `mkdir -p corpus crashes && n=$(ls crashes | wc -l) && ${command} -max_total_time=${left} -print_final_stats=1 -timeout=10 -rss_limit_mb=4096 -artifact_prefix=${dir}/crashes/ ${dict.length ? '-dict=dict.txt ' : ''}corpus </dev/null 2>&1 | tail -c 20000; [ $(ls crashes | wc -l) -gt $n ]`], { cwd: dir, timeoutMs: (left + 60) * 1000 });
      // A run that ended on a crash prints no final stats: its last status line has the count.
      execs += Number(/stat::number_of_executed_units:\s*(\d+)/.exec(r.stdout)?.[1] ?? [...r.stdout.matchAll(/^#(\d+)/gm)].at(-1)?.[1] ?? 0);
      logs.push(r.stdout);
      // No new crash: the time ran out, or libFuzzer could not start.
      if (r.code !== 0) break;
    }
    const files = await place.get(dir);
    const kinds = new Set<string>();
    for (const [f, input] of Object.entries(files)) {
      if (!f.startsWith('crashes/')) continue;
      const kind = /(crash|timeout|oom|leak|slow-unit)-[0-9a-f]+$/.exec(f)?.[1] ?? 'crash';
      const again = await rerun(input);
      const log = logs.find((l) => l.includes(f.replace(/^.*\//, ''))) ?? logs.at(-1) ?? '';
      const report: Report = again && again.status !== 'ok' ? again : kind === 'timeout' || kind === 'slow-unit' ? { status: 'timeout', origin: 'library', type: 'Timeout', native: true } : { status: 'error', origin: 'library', native: true, type: kind === 'oom' ? 'OutOfMemory' : kind === 'leak' ? 'LeakSanitizer' : signalOf(log), message: log.trim().split('\n').slice(-12).join('\n').slice(-1500) };
      const key = `${report.origin}|${report.type}|${report.frames?.at(-1)?.path}:${report.frames?.at(-1)?.line}`;
      if (kinds.has(key)) continue;
      kinds.add(key);
      crashes.push({ input, report });
    }
    if (!execs) log(`did not run: ${logs.at(-1)?.trim().split('\n').slice(-4).join(' | ').slice(0, 400) ?? 'no output'}`);
    else log(`${execs} execs, ${crashes.length} crashes`);
    return { crashes, corpus: Object.entries(files).filter(([f]) => f.startsWith('corpus/')).map(([, b]) => b), execs };
  } finally {
    await place.remove(dir);
  }
}

/**
 * Ruzzy targets: a file defining `test_one_input = lambda { |data| … }` and calling `Ruzzy.fuzz(test_one_input)`, loaded once
 * by src/probes/ruby_fuzz.rb (with a stand-in Ruzzy that keeps the lambda) in a long-running process in the container, with
 * line edges from a TracePoint as coverage. One process per target, kept running between batches. Both it and the native
 * engine, Ruzzy itself through the image's `ruzzy` command (as OSS-Fuzz runs pure-Ruby targets), run with Ruzzy's sanitizer
 * runtime preloaded, so a native extension the build instrumented loads.
 */
function rubyFuzz(place: Place, b: Built, asan: string, log: (s: string) => void): FuzzRuntime {
  const env = { LD_PRELOAD: asan, ASAN_OPTIONS };
  return {
    guide: [
      `A Ruzzy fuzz target, the form OSS-Fuzz runs Ruby code in: \`require "ruzzy"\`, then \`require "name"\` lines for the project (it is installed as a gem, so a file at <gem>/lib/a/b.rb is \`require "a/b"\`; a file outside a gem's lib folder is loaded by its path in the project, \`require "${b.src}/<path>"\`; require_relative does not reach it), before any other gem the target requires, so the versions the project depends on are the ones activated, then \`test_one_input = lambda do |data|\`, a body, \`return 0\`, \`end\`, and last \`Ruzzy.fuzz(test_one_input)\`.`,
      'data is the input\'s raw bytes as a binary String. Hand it on as it is to a target that takes bytes or a string it parses (`s = data.dup.force_encoding("UTF-8")` and `return 0 unless s.valid_encoding?` when it must be text). To build several arguments, read them off one provider: `fdp = Ruzzy::FuzzedDataProvider.new(data)`, then fdp.consume_random_length_string(max), consume_bytes(n), consume_int_in_range(min, max), consume_bool, consume_float_in_range(min, max), pick_value_in_list(list), consume_remaining_bytes.',
      'Call the target. Rescue only the exceptions the project documents or raises on purpose for invalid input (its own error classes, ArgumentError where it says so), each with `return 0`; anything else the project raises is the finding, so let it through.',
      'State what the result must satisfy on a line of the lambda: `raise "what broke: #{detail}" unless condition` (a round trip, a range, an invariant the method promises). That raise is reported as the target\'s assertion; any other error in the target\'s own lines is a bug in the target. Do not print.',
    ].join(' '),
    async session(targets) {
      const dir = await place.folder('rb');
      const errors: Record<string, string> = {};
      const files: Record<string, string> = {};
      for (const [n, code] of Object.entries(targets)) {
        if (/^\w+$/.test(n)) files[`${n}.rb`] = code;
        else errors[n] = `${n} is not a name a file can take`;
      }
      await place.put(dir, files);
      const file = (n: string) => `${dir}/${n}.rb`;
      const make = (n: string, timeoutMs: number) => place.driver(['env', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), 'ruby', DRIVER, file(n), b.src, String(timeoutMs)], { cwd: dir });
      const drivers = new Map<string, { d: LineDriver; timeout: number }>();
      await Promise.all(Object.keys(targets).filter((n) => !errors[n]).map(async (n) => {
        const d = make(n, 1_000);
        if (await d.start()) drivers.set(n, { d, timeout: 1_000 });
        else errors[n] = (d.fatal ?? 'did not load').replaceAll(file(n), '(target)');
      }));
      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          let h = drivers.get(name);
          if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'TargetLoad', message: errors[name] ?? 'no such target' }));
          // The driver's own timer is set when it starts; a different allowance needs a new process.
          if (h.timeout !== timeoutMs) { h.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
          return h.d.run(inputs, timeoutMs, deadline);
        },
        async native(name, corpus, dict, seconds) {
          if (!drivers.has(name)) return { crashes: [], corpus: [], execs: 0 };
          return libFuzzerNative(place, ['ruzzy', file(name)], {}, corpus, dict, seconds, async (input) => (await session.run(name, [input], 5_000))[0], (s) => log(`  ruzzy ${name}: ${s}`));
        },
        release(name) {
          drivers.get(name)?.d.stop();
          drivers.delete(name);
        },
        async close() {
          for (const h of drivers.values()) h.d.stop();
          await place.remove(dir);
        },
      };
      return { errors, session };
    },
    // The target is already the file OSS-Fuzz runs; the image's ruzzy-build turns it into $OUT/<name>.
    oss(name, source) {
      const file = `${name}.rb`;
      return { file, source, compile: [`ruzzy-build $SRC/refuzz/${file}`] };
    },
  };
}
