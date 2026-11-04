/**
 * Swift: the package built by its OSS-Fuzz build spec (src/build.ts) in the base-builder-swift image, its dependencies
 * resolved there. Fuzz targets are OSS-Fuzz's Swift files, `@_cdecl("LLVMFuzzerTestOneInput")`, each an executable target of a
 * generated package that depends on the project's package by path, run in-process by refuzz's driver or by libFuzzer.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { HARNESS_CWD, shq, type Container } from '../run.ts';
import type { LineDriver } from '../session.ts';
import type { Adapter, Built, FuzzRuntime, FuzzSession, Frame, InputReport, Report, Runtime, Target } from '../types.ts';

interface Manifest {
  targets: { name: string; type: string; path?: string | null; dependencies: any[] }[];
  products: { name: string; type: Record<string, unknown>; targets: string[] }[];
}

const SIGNALS: Record<number, string> = { 4: 'SIGILL', 5: 'SIGTRAP', 6: 'SIGABRT', 7: 'SIGBUS', 8: 'SIGFPE', 11: 'SIGSEGV' };

/**
 * The package's library products and the modules a target can import (their targets and the targets those depend on), read
 * from its manifest in the container, where its dependencies are resolved.
 */
async function packageOf(b: Built): Promise<{ libraries: string[]; modules: string[]; roots: { module: string; path: string }[] } | string> {
  const dumped = await b.box.exec('swift package --skip-update dump-package', { cwd: b.src, timeoutMs: 600_000 });
  if (dumped.code !== 0) return `swift package dump-package failed in ${b.src}: ${(dumped.stderr || dumped.stdout).trim().split('\n').slice(-6).join('\n')}`;
  let manifest: Manifest;
  try { manifest = JSON.parse(dumped.stdout); } catch { return `swift package dump-package printed no manifest: ${dumped.stdout.slice(0, 300)}`; }
  const byName = new Map(manifest.targets.map((t) => [t.name, t]));
  const modules = new Set<string>();
  const visit = (n: string) => {
    const t = byName.get(n);
    if (!t || modules.has(n) || !['regular', 'library'].includes(t.type)) return;
    modules.add(n);
    for (const d of t.dependencies) visit((d.byName ?? d.target)?.[0]);
  };
  const libraries = manifest.products.filter((p) => 'library' in p.type);
  for (const p of libraries) p.targets.forEach(visit);
  if (!modules.size) return 'the package has no library product to import';
  const roots = [...modules].map((m) => ({ module: m, path: (byName.get(m)!.path ?? `Sources/${m}`).replace(/^\.\//, '').replace(/\/$/, '') }));
  return { libraries: libraries.map((p) => p.name), modules: [...modules], roots };
}

/** The pins the build resolved, so a package depending on the project resolves the same versions from SwiftPM's cache. */
async function pinsOf(b: Built): Promise<Record<string, string>> {
  const r = await b.box.exec(`cat ${shq(`${b.src}/Package.resolved`)} 2>/dev/null`);
  return r.code === 0 && r.stdout.trim() ? { 'Package.resolved': r.stdout } : {};
}

export const swift: Adapter = {
  languages: ['swift'],
  // A package that depends on the project by path, as fuzz targets do, resolves with the container offline: the build fetched
  // every dependency.
  async ready(b) {
    const pkg = await packageOf(b);
    if (typeof pkg === 'string') return pkg;
    const place = containerPlace(b.box);
    const dir = await place.folder('swiftready');
    try {
      await place.put(dir, { ...(await pinsOf(b)), 'Package.swift': `// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "RefuzzReady", dependencies: [.package(path: "${b.src}")], targets: [.executableTarget(name: "RefuzzReady", dependencies: [${productsOf(pkg.libraries, basename(b.src))}])])\n`, 'Sources/RefuzzReady/main.swift': '' });
      const r = await b.box.exec('swift package --skip-update resolve 2>&1', { cwd: dir, timeoutMs: 600_000 });
      return r.code === 0 ? undefined : `a package depending on ${b.src} by path does not resolve offline (build.sh must resolve the package's dependencies, \`swift package resolve\`): ${r.stdout.trim().split('\n').slice(-6).join('\n')}`;
    } finally {
      await place.remove(dir);
    }
  },
  async prepare(b, log) {
    const pkg = await packageOf(b);
    if (typeof pkg === 'string') throw new Error(pkg);
    const { modules, roots } = pkg;
    const moduleOf = (path: string) => roots.find((r) => path.startsWith(`${r.path}/`))?.module;
    log(`  swift: ${basename(b.src)} (${modules.join(', ')})`);
    const fuzz = swiftFuzz({ place: containerPlace(b.box), box: b.box, pkg: b.src, libraries: pkg.libraries, modules, pins: await pinsOf(b) });
    await fuzz.prepare(log);

    const rt: Runtime = {
      language: b.language,
      guide: 'Swift statements inside an `async throws` function body, one per item: no type or function declarations. `@testable import Module` lines bring the project\'s modules into scope (internal API is visible). Use `try` before throwing calls and `await` before async ones; `var` for values you mutate. Build the arguments, then the last line calls the target and binds what it returns: `let result = try target(...)`.',
      importFor: (t: Target) => `@testable import ${moduleOf(t.path) ?? [...modules][0]}`,
      isImport: (l) => /^\s*(@testable\s+)?import\s+[\w.]+\s*$/.test(l),
      bindsResult: (l) => /^\s*(let|var)\s+result\b\s*(:[^=]+)?=(?!=)/.test(l),
      parseWrap: (code) => ({ source: code, offset: 0 }),
      isPublic(t, source) {
        if (!moduleOf(t.path) || /\b(private|fileprivate)\b/.test(t.header)) return false;
        // The declaration the target sits in (the nearest unindented line above it) must not be private either.
        const lines = source.split('\n');
        for (let i = t.line - 2; i >= 0; i--) if (/^\S/.test(lines[i]) && !/^(\/\/|\/\*|\*|#|@|\})/.test(lines[i])) return !/^(private|fileprivate)\b/.test(lines[i]);
        return true;
      },
      // A trap (index out of range, nil unwrapped, overflow) is never the contract; a thrown error is, and carries no frames.
      errorsAreValues: true,
      rejections: ['DecodingError', 'EncodingError', 'CocoaError', 'POSIXError', 'URLError'],
      environmental: (r) => r.type === 'BuildError' || /NSURLErrorDomain|Could not connect|network/i.test(r.message ?? ''),
      fuzz: fuzz.runtime,
    };
    return rt;
  },
};

/** The library products a target package depends on, from the package identity `id` (its folder's name). */
const productsOf = (names: string[], id: string) => names.map((p) => `.product(name: "${p}", package: "${id}")`).join(', ');

/** A line of a fuzz target that states a property: a trap it raises there is its assertion failing. */
const ASSERTS = /\b(?:precondition|preconditionFailure|assert|assertionFailure|fatalError)\s*\(/;

/**
 * A crash, read from what the process printed: Swift's backtracer gives the fatal error's message, then a JSON crash report,
 * innermost frame first; AddressSanitizer (fuzz session builds) its own report. Frames under `pkg` are the project's; the
 * innermost frame that is the project's or the harness's (under `own`) says whose code failed. `target` is a fuzz target's
 * source, at `own`/target.swift: a trap on one of its lines that asserts (precondition, assert, fatalError) is its assertion.
 */
function crash(raw: string, code: number, pkg: string, own: string, harnessLine: (line: number) => number | undefined, target?: string): Report {
  // ASan's warnings about the backtracer's stack switch land in the middle of the JSON report.
  const err = raw.replace(/==\d+==WARNING[^\n]*\n(False positive[^\n]*\n)?(For details[^\n]*\n)?/g, '');
  let frames: { file: string; line: number; name: string }[] = [];
  let description = '';
  const at = err.indexOf('{ "timestamp"');
  if (at >= 0) {
    try {
      const report = JSON.parse(err.slice(at, err.lastIndexOf('}') + 1));
      description = report.description ?? '';
      const thread = (report.threads ?? []).find((t: any) => t.crashed) ?? report.threads?.[0];
      frames = (thread?.frames ?? []).map((f: any) => ({ file: f.sourceLocation?.file ?? '', line: f.sourceLocation?.line ?? 0, name: String(f.description ?? f.symbol ?? '').replace(/ \+ \d+$/, '') }));
    } catch {}
  }
  const asan = /ERROR: AddressSanitizer: ([\w-]+)/.exec(err);
  if (!frames.length) frames = [...err.matchAll(/^\s*#\d+ 0x[0-9a-f]+ in (.+?) (\/[^\s:]+):(\d+)/gm)].map((m) => ({ file: m[2], line: Number(m[3]), name: m[1] }));
  const fatal = /^(?:.*?:\d+: )?(Fatal error|Precondition failed|Assertion failed)(?::\s*(.*))?$/m.exec(err);
  const runtime = frames.find((f) => /^Swift runtime failure: /.test(f.name))?.name.replace(/^Swift runtime failure: /, '');
  const project: Frame[] = frames.filter((f) => f.file.startsWith(`${pkg}/`) && !f.file.includes('/.build/')).map((f) => ({ path: f.file.slice(pkg.length + 1), line: f.line, name: f.name }));
  const mine = frames.find((f) => f.file.startsWith(`${pkg}/`) || f.file.startsWith(`${own}/`));
  const origin = mine && mine.file.startsWith(`${pkg}/`) ? 'library' : 'setup';
  const signal = SIGNALS[code > 128 ? code - 128 : code] ?? `exit ${code}`;
  const where = origin === 'setup' && mine ? ` (harness line ${harnessLine(mine.line) || '?'})` : '';
  const said = target !== undefined && origin === 'setup' && mine?.file === `${own}/target.swift` ? target.split('\n')[mine.line - 1]?.trim() : undefined;
  if (said && ASSERTS.test(said.split('//')[0])) return { status: 'error', origin: 'assertion', type: 'assertion', message: (fatal?.[2] || said).slice(0, 400), frames: project.reverse().slice(-12), native: true };
  return {
    status: 'error',
    origin,
    type: fatal ? fatal[1] : runtime ? 'Swift runtime failure' : asan ? `AddressSanitizer: ${asan[1]}` : signal,
    message: `${fatal ? fatal[2] ?? fatal[1] : runtime ?? (asan?.[0] || description || signal)}${where}`.slice(0, 400),
    frames: project.reverse().slice(-12),
    native: true,
  };
}

const PROBES = resolve(import.meta.dirname, '..', 'probes');
/** Dependencies come from SwiftPM's cache, as the build resolved them: the container has no network. */
const SESSION_BUILD = 'swift build --skip-update -Xswiftc -sanitize=address -Xswiftc -sanitize-coverage=edge,trace-pc-guard -Xswiftc -enable-testing -Xswiftc -suppress-warnings';
/** OSS-Fuzz's Swift flags: the target is a library-style file (no top-level code), libFuzzer supplies the entry. */
const NATIVE_FLAGS = '--skip-update -Xswiftc -sanitize=fuzzer,address -Xswiftc -parse-as-library -Xswiftc -enable-testing -Xswiftc -suppress-warnings';
/** Leak checking needs ptrace; the Swift backtracer, not ASan, reads traps and faults, so its report has Swift's frames. */
const ASAN = 'detect_leaks=0:handle_segv=0:handle_abort=0:handle_sigill=0:handle_sigbus=0:handle_sigfpe=0:allocator_may_return_null=1';
/** For a replay: the backtracer copies the crashed thread's stack, which ASan's memcpy check would take for an overflow. */
const REPLAY_ASAN = `${ASAN}:replace_intrin=0:intercept_memcpy=0`;
const BACKTRACE = 'enable=yes,interactive=no,color=no,format=json,threads=crashed,registers=none,images=none';
const HEADER = '#include <stddef.h>\n#include <stdint.h>\nsize_t refuzz_cov_take(uint32_t *ids, uintptr_t *pcs, size_t max);\nvoid refuzz_watch_start(int64_t ms, int fd);\nvoid refuzz_input_begin(void);\nvoid refuzz_input_end(void);\nint refuzz_test_one(const uint8_t *data, size_t size);\n';

/** A generated package: session targets use the session's C module (RefuzzCov), native ones libFuzzer's main (RefuzzMain). */
const manifest = (pkg: string, products: string, targets: { name: string; cov: boolean }[]) => `// swift-tools-version:5.9
import PackageDescription
let package = Package(name: "Refuzz", dependencies: [.package(path: "${pkg}")], targets: [
${targets.some((t) => t.cov) ? '    .target(name: "RefuzzCov"),\n' : '    .target(name: "RefuzzMain"),\n'}${targets.map((t) => `    .executableTarget(name: "${t.name}", dependencies: [${t.cov ? '"RefuzzCov"' : '"RefuzzMain"'}, ${products}]),`).join('\n')}
])
`;

/**
 * SwiftPM links an executable with `main` aliased to `<Target>_main`, which a `-parse-as-library` module does not define:
 * this one does, and hands libFuzzer's driver the target's entry point.
 */
const nativeMain = (target: string) => `#include <stddef.h>
#include <stdint.h>
int LLVMFuzzerRunDriver(int *argc, char ***argv, int (*cb)(const uint8_t *, size_t));
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);
int ${target}_main(int argc, char **argv) { return LLVMFuzzerRunDriver(&argc, &argv, LLVMFuzzerTestOneInput); }
`;

/**
 * Fuzz targets for Swift: each an executable target of a generated package (in refuzz's folder in the container) holding the
 * target file unchanged (target.swift) and src/probes/swift_serve.swift as its main, built with AddressSanitizer and
 * SanitizerCoverage guards (src/probes/swift_cov.c) and kept running, one process per target. A crash ends the process:
 * LineDriver restarts it, and the input is replayed alone with the Swift backtracer on for its frames. `native` builds the same
 * file again with `-sanitize=fuzzer` in a second package and runs libFuzzer on it. `pkg` is the project's package, `pins` its
 * Package.resolved.
 */
function swiftFuzz(o: { place: Place; box: Container; pkg: string; libraries: string[]; modules: string[]; pins: Record<string, string> }) {
  const { place, box, pkg } = o;
  const products = productsOf(o.libraries, basename(pkg));
  let sessions = 0;
  /** The session package and the native one, made by prepare(). */
  let g = '', n = '';

  /** Writes a package's sources into the container, dropping the old sources and the stale build of its targets. */
  const stage = async (dir: string, files: Record<string, string>) => {
    await box.exec(`mkdir -p ${dir} && rm -rf ${dir}/Sources ${dir}/.build/*/debug/G_*.build ${dir}/.build/*/debug/N_*.build`);
    await place.put(dir, { ...o.pins, ...files });
  };
  const covFiles = () => ({
    'Sources/RefuzzCov/cov.c': readFileSync(join(PROBES, 'swift_cov.c'), 'utf8'),
    'Sources/RefuzzCov/include/refuzzcov.h': HEADER,
  });
  const serve = readFileSync(join(PROBES, 'swift_serve.swift'), 'utf8');
  const warm = `import ${o.modules[0]}\n\n@_cdecl("LLVMFuzzerTestOneInput")\npublic func test(_ start: UnsafeRawPointer, _ count: Int) -> CInt {\n    return 0\n}\n`;

  /** Builds the targets, dropping each one the compiler blames, until the rest build. Returns the errors by target. */
  const build = async (dir: string, cmd: string, names: string[]) => {
    const errors: Record<string, string> = {};
    let live = [...names];
    for (let attempt = 0; attempt < 8 && live.length; attempt++) {
      const b = await box.exec(`cd ${dir} && touch Package.swift && ${cmd} 2>&1`, { timeoutMs: 3_600_000 });
      if (b.code === 0) return { errors, live };
      const blamed = new Map<string, string[]>();
      for (const m of b.stdout.matchAll(new RegExp(`^${dir}/Sources/(\\w+)/(\\w+)\\.swift:(\\d+):\\d+: error: (.+)$`, 'gm'))) {
        if (!live.includes(m[1])) continue;
        const msgs = blamed.get(m[1]) ?? blamed.set(m[1], []).get(m[1])!;
        if (msgs.length < 4) msgs.push(`${m[2] === 'target' ? `line ${m[3]}` : `${m[2]}.swift`}: ${m[4]}`);
      }
      if (!blamed.size) {
        const why = b.stdout.split('\n').filter((l) => /error:/.test(l)).slice(0, 6).join('\n') || b.stdout.slice(-600);
        for (const n of live) errors[n] = why;
        return { errors, live: [] };
      }
      for (const [n, msgs] of blamed) errors[n] = msgs.join('\n');
      live = live.filter((n) => !blamed.has(n));
      const kept = await box.exec(`cd ${dir} && sed -i '/name: "\\(${[...blamed.keys()].join('\\|')}\\)"/d' Package.swift && rm -rf ${[...blamed.keys()].map((n) => `Sources/${n}`).join(' ')}`);
      if (kept.code !== 0) break;
    }
    return { errors, live };
  };

  const prepare = async (log: (s: string) => void) => {
    // Built once, so later builds change only the fuzz targets.
    g = await place.folder('swiftg');
    n = await place.folder('swiftn');
    log('  swift: building the fuzz session package (AddressSanitizer, coverage guards)');
    await stage(g, { 'Package.swift': manifest(pkg, products, [{ name: 'G_warm', cov: true }]), ...covFiles(), 'Sources/G_warm/main.swift': serve, 'Sources/G_warm/target.swift': warm });
    const built = await box.exec(`cd ${g} && ${SESSION_BUILD} 2>&1 | tail -5`, { timeoutMs: 3_600_000 });
    if (!/Build complete/.test(built.stdout)) log(`  swift: the fuzz session package did not build: ${built.stdout.slice(-400)}`);
    await stage(n, { 'Package.swift': manifest(pkg, products, [{ name: 'N_warm', cov: false }]), 'Sources/RefuzzMain/driver.c': nativeMain('N_warm'), 'Sources/RefuzzMain/include/refuzzmain.h': '', 'Sources/N_warm/target.swift': warm });
  };

  /** File and line of each address in a binary, by llvm-symbolizer; the project's only. Cached per binary. */
  const symbols = new Map<string, Map<number, [string, number] | null>>();
  const symbolize = async (bin: string, pcs: number[]) => {
    const known = symbols.get(bin) ?? symbols.set(bin, new Map()).get(bin)!;
    const ask = [...new Set(pcs.filter((pc) => !known.has(pc)))];
    if (ask.length) {
      const r = await box.exec(`llvm-symbolizer --obj=${bin} --inlining=false`, { input: ask.map((pc) => `0x${pc.toString(16)}`).join('\n') + '\n', timeoutMs: 300_000 });
      const blocks = r.stdout.split(/\n\n/);
      ask.forEach((pc, i) => {
        const where = /^(\/[^\n]+):(\d+):\d+$/m.exec(blocks[i] ?? '');
        known.set(pc, where && where[1].startsWith(`${pkg}/`) && Number(where[2]) > 0 ? [where[1].slice(pkg.length + 1), Number(where[2])] : null);
      });
    }
    return known;
  };

  /** One input run alone with the backtracer on: the crash's message and frames. Undefined when it does not crash again. */
  const replay = async (bin: string, own: string, input: Buffer, source: string): Promise<Report | undefined> => {
    const dir = await place.folder('swiftreplay');
    await place.put(dir, { 'input.bin': input });
    const r = await box.exec(`ASAN_OPTIONS=${REPLAY_ASAN} SWIFT_BACKTRACE=${BACKTRACE} timeout -s KILL 30 ${bin} --once ${dir}/input.bin`, { timeoutMs: 60_000 });
    await place.remove(dir);
    if (r.code === null) return undefined;
    if (r.code === 137) return { status: 'timeout', origin: 'library', type: 'Timeout' };
    if (r.code === 0) return { status: 'ok' };
    return crash(r.stderr, r.code, pkg, own, (l) => l, source);
  };

  const runtime: FuzzRuntime = {
    guide: [
      'A Swift fuzz target as OSS-Fuzz writes one: `import Module` lines for the project (`@testable import Module` to reach its internal API) and Foundation if it needs it, then `@_cdecl("LLVMFuzzerTestOneInput") public func test(_ start: UnsafeRawPointer, _ count: Int) -> CInt { ...; return 0 }`, called once per input with the raw bytes (any bytes, any count, 0 too). No top-level statements: helper functions and types may follow it.',
      'Read the bytes with `let bytes = UnsafeRawBufferPointer(start: start, count: count)`; split them into arguments with explicit count checks (`guard bytes.count >= 2 else { return 0 }`, `let mode = bytes[0] % 3`, `let rest = Array(bytes.dropFirst())`), text as `String(decoding: rest, as: UTF8.self)`; convert numbers with clamping or truncating initializers (UInt16(truncatingIfNeeded: x)).',
      'Call an instance method on a value of its type, built the way the project\'s own tests build one (`MarkdownParser().html(from: text)`); only a `static` or `class` function is called on the type itself.',
      'A documented error is the project\'s answer: `try?` or `do { … } catch { return 0 }` around a throwing call, a nil checked with guard; never `try!` or `!` on the target\'s result. No printing.',
      'State what the project promises for every input it accepts with `precondition(cond, "what it promises")` after the call, where the promise holds: a round trip (parse what it printed), a bound on a result\'s size or range, agreement with another function of the project that must agree. A failed precondition is reported as a finding with its message; a trap in the project as the project\'s; any other trap on the target\'s lines (an index, a force unwrap) as the target\'s mistake.',
    ].join(' '),
    async session(targets) {
      const sid = `s${++sessions}${Date.now().toString(36)}`;
      const names = new Map(Object.keys(targets).map((h) => [h, `G_${h.replace(/\W/g, '_')}`]));
      const files: Record<string, string> = { 'Package.swift': manifest(pkg, products, [...names.values()].map((x) => ({ name: x, cov: true }))), ...covFiles() };
      for (const [h, x] of names) { files[`Sources/${x}/main.swift`] = serve; files[`Sources/${x}/target.swift`] = targets[h]; }
      await stage(g, files);
      const built = await build(g, SESSION_BUILD, [...names.values()]);
      // Each session runs its own copies, so a later build does not change what an earlier session's processes run.
      const bins = await place.folder(`swiftbin-${sid}`);
      if (built.live.length) await box.exec(`for t in ${built.live.join(' ')}; do cp ${g}/.build/debug/$t ${bins}/; done`);
      const errors: Record<string, string> = {};
      for (const [h, x] of names) if (built.errors[x] || !built.live.includes(x)) errors[h] = built.errors[x] ?? 'did not build';
      const drivers = new Map<string, { d: LineDriver; timeout: number }>();
      const binOf = (h: string) => `${bins}/${names.get(h)}`;
      const ownOf = (h: string) => `${g}/Sources/${names.get(h)}`;
      const make = (h: string, timeoutMs: number) => place.driver([binOf(h), String(timeoutMs)], { cwd: HARNESS_CWD, env: { ASAN_OPTIONS: ASAN, SWIFT_BACKTRACE: 'enable=no' } });
      const natives = new Map<string, string>();
      const session: FuzzSession = {
        async run(h, inputs, timeoutMs, deadline) {
          if (errors[h] || !names.has(h)) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: errors[h] ?? 'no such target' }));
          let x = drivers.get(h);
          if (!x || x.timeout !== timeoutMs) { x?.d.stop(); x = { d: make(h, timeoutMs), timeout: timeoutMs }; drivers.set(h, x); }
          const reports = await x.d.run(inputs, timeoutMs, deadline) as (InputReport & { pcs?: number[] })[];
          const known = await symbolize(binOf(h), reports.flatMap((r) => r.pcs ?? []));
          // Crashes are replayed alone for their frames, a few per batch; the rest take the report of a replayed crash that
          // printed the same thing, since a target that keeps crashing would otherwise spend its time in replays.
          const replayed = new Map<string, Report>();
          for (const [i, r] of reports.entries()) {
            const lines = new Map<string, [string, number]>();
            for (const pc of r.pcs ?? []) { const at = known.get(pc); if (at) lines.set(at.join(':'), at); }
            r.lines = [...lines.values()];
            delete r.pcs;
            if (!r.native || r.frames?.length) continue;
            const key = /refuzz: trap at \w+/.exec(r.message ?? '')?.[0] ?? (r.message ?? '').replace(/0x[0-9a-f]+|\b\d+\b/gi, '#');
            const again = replayed.size < 6 && !replayed.has(key) ? await replay(binOf(h), ownOf(h), inputs[i], targets[h]) : replayed.get(key);
            if (!again) continue;
            replayed.set(key, again);
            // A crash that does not happen again alone keeps its report, unless the process left no message at all: then
            // it died between inputs (a restart after a timeout), and the replay is what this input does.
            if (again.status === 'error' || !r.message) Object.assign(r, { ...again, native: again.native, features: r.features, lines: r.lines });
          }
          return reports;
        },
        async native(h, corpus, dict, seconds) {
          const x = `N_${h.replace(/\W/g, '_')}`;
          if (errors[h] || !names.has(h)) return { crashes: [], corpus, execs: 0 };
          if (!natives.has(h)) {
            await stage(n, { 'Package.swift': manifest(pkg, products, [{ name: x, cov: false }]), 'Sources/RefuzzMain/driver.c': nativeMain(x), 'Sources/RefuzzMain/include/refuzzmain.h': '', [`Sources/${x}/target.swift`]: targets[h] });
            const b = await build(n, `swift build ${NATIVE_FLAGS} --product ${x}`, [x]);
            if (!b.live.length) return { crashes: [], corpus, execs: 0 };
            await box.exec(`cp ${n}/.build/debug/${x} ${bins}/`);
            natives.set(h, `${bins}/${x}`);
          }
          const d = await place.folder(`swiftrun-${sid}`);
          // Named by SHA-1 as libFuzzer names its files: a seed that crashes is found by its crash file's name and dropped.
          await place.put(d, {
            ...Object.fromEntries((corpus.length ? corpus : [Buffer.from([0])]).map((c) => [`corpus/${createHash('sha1').update(c).digest('hex')}`, c])),
            'crashes/.keep': '',
            dict: dict.map((t) => `"${[...Buffer.from(t, 'latin1')].map((c) => (c >= 0x20 && c < 0x7f && c !== 0x22 && c !== 0x5c ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, '0')}`)).join('')}"`).join('\n') + '\n',
          });
          // libFuzzer stops at a crash: it is started again on the grown corpus until the time is spent, each crashing input
          // kept. (Fork mode would keep going by itself, but does not count executions.)
          const script = [
            `cd ${d} || exit 1`,
            `end=$(( $(date +%s) + ${seconds} )); total=0; i=0`,
            'while [ $(date +%s) -lt $end ] && [ $i -lt 30 ]; do',
            '  left=$(( end - $(date +%s) )); [ $left -lt 1 ] && break',
            `  ASAN_OPTIONS=${ASAN} SWIFT_BACKTRACE=enable=no timeout -s KILL $((left + 30)) ${natives.get(h)} -max_total_time=$left -timeout=5 -rss_limit_mb=2048 -print_final_stats=1 -dict=${d}/dict -artifact_prefix=${d}/crashes/ ${d}/corpus > ${d}/log 2>&1`,
            `  k=$(grep -o 'number_of_executed_units: [0-9]*' ${d}/log | grep -o '[0-9]*$'); total=$((total + \${k:-0})); i=$((i + 1))`,
            `  grep -q 'Test unit written' ${d}/log || break`,
            `  for f in ${d}/crashes/crash-*; do rm -f ${d}/corpus/\${f##*crash-}; done`,
            'done',
            `tail -5 ${d}/log; echo "EXECS $total"`,
          ].join('\n');
          const r = await box.exec(script, { timeoutMs: (seconds + 180) * 1000 });
          if (process.env.REFUZZ_DEBUG) console.log(`[native ${h}] ${r.stdout.slice(-1500)}`);
          const execs = Number(/EXECS (\d+)/.exec(r.stdout)?.[1] ?? 0);
          const found = await place.get(d);
          await place.remove(d);
          const crashes: { input: Buffer; report: Report }[] = [];
          // One input per cause: where the failure is, or which assertion.
          const seen = new Set<string>();
          for (const input of Object.entries(found).filter(([f]) => /^crashes\/(crash|timeout|oom)-/.test(f)).slice(0, 20).map(([, b]) => b)) {
            const report = await replay(binOf(h), ownOf(h), input, targets[h]);
            const key = `${report?.type}|${report?.frames?.at(-1)?.path}:${report?.frames?.at(-1)?.line}|${report?.origin === 'assertion' ? report.message : ''}`;
            if (report && report.status !== 'ok' && !seen.has(key)) { seen.add(key); crashes.push({ input, report }); }
          }
          const grown = Object.entries(found).filter(([f]) => f.startsWith('corpus/')).slice(0, 2000).map(([, b]) => b);
          return { crashes, corpus: grown, execs };
        },
        release(h) {
          drivers.get(h)?.d.stop();
          drivers.delete(h);
        },
        async close() {
          for (const x of drivers.values()) x.d.stop();
          await place.remove(bins);
        },
      };
      return { session, errors };
    },
    /**
     * The target as <name>.swift, and build lines that generate a package for it under $SRC/refuzz/<name>, depending on
     * the project's package by path, with the target as an executable target and the C main SwiftPM's `-parse-as-library`
     * executables need, built with OSS-Fuzz's $SWIFTFLAGS (precompile_swift) into $OUT/<name>.
     */
    oss(name, source) {
      const file = `${name}.swift`;
      const at = `$SRC/refuzz/${name}`;
      const project = pkg.replace(/^\/src(?=\/|$)/, '$SRC');
      return {
        file,
        source: source.endsWith('\n') ? source : `${source}\n`,
        compile: [
          '. precompile_swift',
          `mkdir -p ${at}/Sources/RefuzzMain/include ${at}/Sources/${name}`,
          `cat > ${at}/Package.swift <<REFUZZ_MANIFEST`,
          manifest(project, products, [{ name, cov: false }]).trimEnd(),
          'REFUZZ_MANIFEST',
          `cat > ${at}/Sources/RefuzzMain/driver.c <<'REFUZZ_MAIN'`,
          nativeMain(name).trimEnd(),
          'REFUZZ_MAIN',
          `: > ${at}/Sources/RefuzzMain/include/refuzzmain.h`,
          `cp $SRC/refuzz/${file} ${at}/Sources/${name}/${file}`,
          `[ -f ${project}/Package.resolved ] && cp ${project}/Package.resolved ${at}/`,
          `(cd ${at} && swift build -c debug $SWIFTFLAGS --product ${name})`,
          `cp ${at}/.build/debug/${name} $OUT/${name}`,
        ],
      };
    },
  };
  return { runtime, prepare };
}
