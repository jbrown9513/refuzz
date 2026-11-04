/**
 * Which project lines a test of a finding ran, in every language whose test runner can report them without rebuilding the
 * project: the verifier (src/verify.ts) asks whether the failing line was among them before it believes a reproducer.
 *
 * Each language's coverage is switched on by environment variables the project's test environment does not set, or by a
 * wrapper first on PATH where it would (test.sh's one-file runner loads /src/refuzz-test.env itself, which may set GOFLAGS or
 * clear PYTEST_ADDOPTS). Whatever a runner writes is read as the set of `path:line` it ran, by path from the source folder;
 * nothing written, or nothing readable, is no measurement, never "ran nothing".
 *
 * Python: refuzz's pytest plugin, coverage.py. Go: `go test -coverpkg`. Rust: `-C instrument-coverage` and llvm-cov. JavaScript and TypeScript:
 * Node's own V8 coverage, mapped through source maps by c8. Ruby: the Coverage module. PHP: pcov. Languages whose line
 * coverage needs an instrumented build (C, C++, Swift, Zig) or a class-file analysis (the JVM, .NET) are not measured here.
 */
import { createHash } from 'node:crypto';
import type { Place } from './place.ts';
import { shq } from './run.ts';
import type { Project } from './syntax.ts';

/** How a test run says which project lines it ran: the environment that turns its runner's coverage on, and the file it writes. */
export interface Coverage {
  env: Record<string, string>;
  file: string;
  /** Undefined when what was written cannot be read. */
  read: (text: string) => Set<string> | undefined;
  /** A folder put first on PATH. */
  bin?: string;
  /** A command run after the test, in the source folder, that turns what the runner left into `file`. */
  collect?: string;
}

/**
 * One language's way. `setup` installs its tools while the image is built (src/build.ts), the one time the network is up:
 * the containers tests run in have none. `install` runs once in the test container, offline, and is false when the tools are
 * not there. Then a Coverage per test.
 */
interface Provider {
  setup?: string;
  install: (place: Place, src: string) => Promise<boolean>;
  cover: (p: Project, paths: string[], file: string, src: string) => Coverage | undefined;
}

const DIR = '/tmp/refuzz-cov';
const ok = (place: Place, script: string, timeoutMs = 600_000) => place.run(['bash', '-c', script], { timeoutMs }).then((r) => r.code === 0, () => false);

/**
 * LCOV (`SF:` a file, `DA:line,count`) as the lines with a count above zero, by path from `src`. A report naming no file at
 * all, not even the `TN:` refuzz's own writers start with, is no measurement.
 */
export function lcovLines(text: string, src: string): Set<string> | undefined {
  const out = new Set<string>(), root = `${src.replace(/\/$/, '')}/`;
  let file: string | undefined, seen = false;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (l.startsWith('TN:')) seen = true;
    else if (l.startsWith('SF:')) { seen = true; const f = l.slice(3); file = f.startsWith(root) ? f.slice(root.length) : f.startsWith('/') ? undefined : f; }
    else if (l.startsWith('DA:') && file) { const [line, count] = l.slice(3).split(','); if (Number(count) > 0) out.add(`${file}:${line}`); }
    else if (l === 'end_of_record') file = undefined;
  }
  return seen ? out : undefined;
}

/**
 * A pytest plugin that measures the run with coverage.py when REFUZZ_COV_FILE names where to write the JSON report. It starts
 * before the project's conftest files load, as pytest-cov does: a thread started then (prefect's event loop thread, which runs
 * its CLI's code) is traced only if coverage was already on. It covers threads, not subprocesses.
 */
const PYTEST_PLUGIN = `import os

import pytest

_held = []


@pytest.hookimpl(tryfirst=True)
def pytest_load_initial_conftests(early_config, parser, args):
    out = os.environ.get("REFUZZ_COV_FILE")
    if not out or _held:
        return
    import coverage
    cov = coverage.Coverage(data_file=None, source=[os.environ.get("REFUZZ_COV_SOURCE", os.getcwd())], config_file=False)
    cov.start()
    _held.append((cov, out))


def pytest_unconfigure(config):
    if not _held:
        return
    cov, out = _held.pop()
    cov.stop()
    # The lines run in the files asked about (REFUZZ_COV_FILES), by path from the source folder: a whole project's report is
    # megabytes, more than is read back whole.
    import json
    root = os.environ.get("REFUZZ_COV_SOURCE", os.getcwd()).rstrip("/") + "/"
    wanted = [x for x in os.environ.get("REFUZZ_COV_FILES", "").split(",") if x]
    data = cov.get_data()
    lines = {}
    for f in data.measured_files():
        rel = f[len(root):] if f.startswith(root) else f
        if not wanted or rel in wanted:
            lines[rel] = sorted(data.lines(f) or [])
    with open(out, "w") as fh:
        json.dump(lines, fh)
`;

/** The Go package a project file is in, as an import path: the innermost go.mod above it names the module. */
export function goPackage(p: Project, path: string): string | undefined {
  const parts = path.split('/').slice(0, -1);
  for (let n = parts.length; n >= 0; n--) {
    const mod = /^module\s+(\S+)/m.exec(p.read([...parts.slice(0, n), 'go.mod'].join('/')))?.[1];
    if (mod) return [mod, ...parts.slice(n)].join('/');
  }
  return undefined;
}

/** Each Go package's import path → its directory in the repository, worked out once per project. */
const goDirs = new WeakMap<Project, Map<string, string>>();
/**
 * Go's cover profile (`pkg/file.go:12.3,14.9 2 1`) as the project lines with a count above zero, by repository path. A
 * profile with no blocks at all is no measurement: a test binary that panics writes only its `mode:` line.
 */
function goLinesRun(p: Project, text: string): Set<string> | undefined {
  let dirs = goDirs.get(p);
  if (!dirs) {
    dirs = new Map();
    for (const f of p.files.keys()) {
      const pkg = f.endsWith('.go') ? goPackage(p, f) : undefined;
      if (pkg && !dirs.has(pkg)) dirs.set(pkg, f.split('/').slice(0, -1).join('/'));
    }
    goDirs.set(p, dirs);
  }
  const out = new Set<string>();
  let blocks = 0;
  for (const line of text.split('\n')) {
    const m = /^(.+)\/([^/]+\.go):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/.exec(line.trim());
    if (m) blocks++;
    const dir = m && m[5] !== '0' ? dirs.get(m[1]) : undefined;
    if (dir === undefined) continue;
    for (let l = Number(m![3]); l <= Number(m![4]); l++) out.add(`${dir ? `${dir}/` : ''}${m![2]}:${l}`);
  }
  return blocks ? out : undefined;
}

/** A wrapper in front of a tool: `when` (shell test on "$@") runs `instead`, anything else the real tool. */
const wrapper = (tool: string, when: string, instead: string) =>
  `real=$(command -v ${tool}) && mkdir -p ${DIR}/bin && printf '%s\\n' '#!/bin/bash' "real=$real" ${shq(`if ${when}; then ${instead}; fi`)} 'exec "$real" "$@"' > ${DIR}/bin/${tool} && chmod +x ${DIR}/bin/${tool}`;

/** Ruby's Coverage module from the first require, LCOV appended at exit by each process that loaded a file asked about. */
const RUBY = `require "coverage"
begin
  Coverage.start(lines: true)
rescue StandardError
end
at_exit do
  out = ENV["REFUZZ_COV_FILE"]
  if out
    root = ENV.fetch("REFUZZ_COV_SOURCE", Dir.pwd).chomp("/") + "/"
    wanted = ENV.fetch("REFUZZ_COV_FILES", "").split(",")
    result = (Coverage.peek_result rescue {})
    File.open(out, "a") do |f|
      f.puts "TN:"
      result.each do |path, cov|
        next unless path.start_with?(root)
        next unless wanted.empty? || wanted.include?(path[root.size..])
        lines = cov.is_a?(Hash) ? cov[:lines] : cov
        next unless lines
        f.puts "SF:#{path}"
        lines.each_with_index { |c, i| f.puts "DA:#{i + 1},#{c}" if c }
        f.puts "end_of_record"
      end
    end
  end
end
`;

/**
 * A `cargo` whose `cargo test` builds with `-C instrument-coverage` into refuzz's own target folder, each test's profiles in
 * a folder of its own (tests run side by side), then writes their LCOV over the test binaries it built. It exits as the test
 * did: a reproducer is a failing test.
 */
const RUST_CARGO = `#!/bin/bash
real=@REAL@
if [ "$1" = test ] && [ -n "$REFUZZ_RUST_COVER" ]; then
  shift
  pre=(); for a in "$@"; do [ "$a" = -- ] && break; pre+=("$a"); done
  export RUSTFLAGS="\${RUSTFLAGS:-} -C instrument-coverage" CARGO_TARGET_DIR=${DIR}/rust-target LLVM_PROFILE_FILE="$REFUZZ_RUST_COVER.prof/%p-%m.profraw"
  "$real" test "$@"; s=$?
  tools=$(dirname "$(ls "$(rustc --print sysroot)"/lib/rustlib/*/bin/llvm-profdata | head -1)")
  objs=($("$real" test --no-run --message-format=json "\${pre[@]}" 2>/dev/null | grep -o '"executable":"[^"]*"' | cut -d'"' -f4))
  more=(); for o in "\${objs[@]:1}"; do more+=("-object=$o"); done
  if [ \${#objs[@]} -gt 0 ] && "$tools/llvm-profdata" merge -sparse "$REFUZZ_RUST_COVER".prof/*.profraw -o "$REFUZZ_RUST_COVER.profdata" 2>/dev/null; then
    "$tools/llvm-cov" export -format=lcov -instr-profile="$REFUZZ_RUST_COVER.profdata" "\${objs[0]}" "\${more[@]}" > "$REFUZZ_RUST_COVER" 2>/dev/null
  fi
  rm -rf "$REFUZZ_RUST_COVER.prof" "$REFUZZ_RUST_COVER.profdata"
  exit $s
fi
exec "$real" "$@"
`;

/** pcov from the first line of every PHP process the test starts, LCOV appended at shutdown for the files asked about. */
const PHP = `<?php
if (function_exists('pcov\\\\start') && getenv('REFUZZ_COV_FILE')) {
    \\pcov\\start();
    register_shutdown_function(function () {
        \\pcov\\stop();
        $root = rtrim((string) getenv('REFUZZ_COV_SOURCE'), '/') . '/';
        $files = array_map(fn ($w) => $root . $w, array_filter(explode(',', (string) getenv('REFUZZ_COV_FILES'))));
        $out = "TN:\\n";
        foreach (\\pcov\\collect(\\pcov\\inclusive, $files) as $path => $lines) {
            $out .= "SF:$path\\n";
            foreach ($lines as $l => $c) $out .= "DA:$l," . ($c > 0 ? 1 : 0) . "\\n";
            $out .= "end_of_record\\n";
        }
        file_put_contents((string) getenv('REFUZZ_COV_FILE'), $out, FILE_APPEND);
    });
}
`;

/** The Python test runs use: the project's own environment when it has one. */
const PY = 'py=python3; [ -x .venv/bin/python ] && py=.venv/bin/python';

const PROVIDERS: Record<string, Provider> = {
  python: {
    setup: `${PY}; $py -c 'import coverage' 2>/dev/null || $py -m pip install -q coverage 2>/dev/null || uv pip install -q --python "$py" coverage`,
    // Installed beside the project's packages, so whichever way the runner starts pytest, the plugin imports.
    install: (place, src) => ok(place, `cd ${shq(src)} && ${PY}; $py -c 'import coverage' && dir=$($py -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])') && printf %s ${shq(PYTEST_PLUGIN)} > "$dir/refuzz_cov.py"`),
    cover: (_p, paths, file, src) => ({
      env: { PYTEST_PLUGINS: 'refuzz_cov', REFUZZ_COV_FILE: `${file}.json`, REFUZZ_COV_SOURCE: src, REFUZZ_COV_FILES: paths.join(',') }, file: `${file}.json`,
      read: (text) => {
        try {
          const out = new Set<string>();
          for (const [path, lines] of Object.entries<number[]>(JSON.parse(text))) for (const l of lines) out.add(`${path}:${l}`);
          return out;
        } catch { return undefined; }
      },
    }),
  },
  go: {
    // GOFLAGS would do, but the test environment commonly sets it, so a `go` in front of the real one adds the flags.
    install: (place) => ok(place, wrapper('go', '[ "$1" = test ] && [ -n "$REFUZZ_GO_COVER" ]', 'shift; exec "$real" test -coverprofile="$REFUZZ_GO_COVER" -coverpkg="$REFUZZ_GO_COVERPKG" "$@"')),
    cover: (p, paths, file) => {
      const pkgs = [...new Set(paths.map((path) => goPackage(p, path)).filter((x): x is string => !!x))];
      return pkgs.length ? { env: { REFUZZ_GO_COVER: `${file}.out`, REFUZZ_GO_COVERPKG: pkgs.join(',') }, bin: `${DIR}/bin`, file: `${file}.out`, read: (text) => goLinesRun(p, text) } : undefined;
    },
  },
  rust: {
    // The toolchain's own llvm-tools. The instrumented build has its own target folder, so the fuzzing build is not rebuilt
    // under it, and is built with the image for the workspace's tests (past crates that fail to build) rather than inside
    // the first test's time limit.
    setup: `rustup component add llvm-tools-preview && { [ -f /src/refuzz-test.env ] && { set -a; . /src/refuzz-test.env; set +a; }; RUSTFLAGS="\${RUSTFLAGS:-} -C instrument-coverage" CARGO_TARGET_DIR=${DIR}/rust-target LLVM_PROFILE_FILE=/dev/null timeout 2400 cargo build --tests --workspace --keep-going >/dev/null 2>&1; true; }`,
    install: (place) => ok(place, `ls "$(rustc --print sysroot)"/lib/rustlib/*/bin/llvm-profdata >/dev/null && real=$(command -v cargo) && mkdir -p ${DIR}/bin && printf %s ${shq(RUST_CARGO)} | sed "s|@REAL@|$real|" > ${DIR}/bin/cargo && chmod +x ${DIR}/bin/cargo`),
    cover: (_p, _paths, file, src) => ({ env: { REFUZZ_RUST_COVER: `${file}.lcov` }, bin: `${DIR}/bin`, file: `${file}.lcov`, read: (text) => lcovLines(text, src) }),
  },
  javascript: {
    // Node writes V8's coverage for every process and worker when NODE_V8_COVERAGE names a folder, with the source maps a
    // transpiler left; c8 maps it back to the project's own lines.
    setup: 'command -v node >/dev/null && { c8 --version >/dev/null 2>&1 || npm install -g c8@10.1.3; }',
    install: (place) => ok(place, 'c8 --version >/dev/null'),
    cover: (_p, _paths, file, src) => ({
      env: { NODE_V8_COVERAGE: `${file}.v8` }, file: `${file}.lcov`, read: (text) => lcovLines(text, src),
      collect: `c8 report --temp-directory ${shq(`${file}.v8`)} --reporter lcovonly --reports-dir ${shq(`${file}.c8`)} --exclude-node-modules >/dev/null 2>&1 && { echo TN:; cat ${shq(`${file}.c8`)}/lcov.info; } > ${shq(`${file}.lcov`)}; rm -rf ${shq(`${file}.v8`)} ${shq(`${file}.c8`)}`,
    }),
  },
  ruby: {
    install: (place) => ok(place, `command -v ruby >/dev/null && mkdir -p ${DIR} && printf %s ${shq(RUBY)} > ${DIR}/refuzz_cov.rb`),
    cover: (_p, paths, file, src) => ({ env: { RUBYOPT: `-r${DIR}/refuzz_cov.rb`, REFUZZ_COV_FILE: `${file}.lcov`, REFUZZ_COV_SOURCE: src, REFUZZ_COV_FILES: paths.join(',') }, file: `${file}.lcov`, read: (text) => lcovLines(text, src) }),
  },
  php: {
    // A leading colon adds the folder to PHP's own scan folders rather than replacing them, which enable its extensions.
    install: (place, src) => ok(place, `php -m 2>/dev/null | grep -qi '^pcov$' && mkdir -p ${DIR}/php && printf %s ${shq(PHP)} > ${DIR}/refuzz_cov.php && printf 'pcov.enabled=1\\npcov.directory=%s\\nauto_prepend_file=${DIR}/refuzz_cov.php\\n' ${shq(src)} > ${DIR}/php/refuzz-cov.ini`),
    cover: (_p, paths, file, src) => ({ env: { PHP_INI_SCAN_DIR: `:${DIR}/php`, REFUZZ_COV_FILE: `${file}.lcov`, REFUZZ_COV_SOURCE: src, REFUZZ_COV_FILES: paths.join(',') }, file: `${file}.lcov`, read: (text) => lcovLines(text, src) }),
  },
};
PROVIDERS.typescript = PROVIDERS.tsx = PROVIDERS.javascript;

/** Changes when what an image build installs changes, so images built before are built again with it (src/build.ts). */
export const COVERAGE_TOOLS = createHash('sha1').update(Object.values(PROVIDERS).map((x) => x.setup ?? '').join('\0')).digest('hex').slice(0, 8);

/**
 * Installs a language's coverage tools in an image being built, in the project's source folder, with the network. Whether
 * that language needs nothing or its tools are now there; the image is kept either way, its findings then unmeasured.
 */
export async function setUpCoverage(place: Place, language: string, src: string): Promise<boolean> {
  const setup = PROVIDERS[language]?.setup;
  return !setup || ok(place, `cd ${shq(src)} && ${setup}`, 2_700_000);
}

/** Set up once per test image and language: whether that language's coverage works there. */
const installed = new WeakMap<Place, Map<string, Promise<boolean>>>();

/** How a test of code in `paths` reports the lines it ran, or undefined where this language's runner cannot here. */
export async function coverageFor(place: Place, p: Project, language: string, src: string, paths: string[], file: string): Promise<Coverage | undefined> {
  const provider = PROVIDERS[language];
  if (!provider) return undefined;
  let byLanguage = installed.get(place);
  if (!byLanguage) installed.set(place, (byLanguage = new Map()));
  if (!byLanguage.has(language)) byLanguage.set(language, provider.install(place, src));
  if (!(await byLanguage.get(language))) return undefined;
  return provider.cover(p, [...new Set(paths)], file, src);
}
