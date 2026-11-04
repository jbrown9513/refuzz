/**
 * Zig: the project built by its OSS-Fuzz build spec (src/build.ts) in refuzz's base-builder-zig image, with the Zig its
 * build.zig.zon asks for on PATH. Fuzz targets are files at the project's root (so they can `@import` any of its files) with
 * `pub fn fuzz(input: []const u8) !void`, run in-process by refuzz's driver or by libFuzzer.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { HARNESS_CWD, PARALLEL, pool, type Container } from '../run.ts';
import type { LineDriver } from '../session.ts';
import type { Adapter, FuzzRuntime, FuzzSession, Frame, InputReport, Report, Runtime, Target } from '../types.ts';

const KEYWORDS = new Set(['std', 'error', 'type', 'test', 'fn', 'const', 'var', 'struct', 'enum', 'union', 'opaque', 'anytype', 'void', 'bool', 'builtin', 'result']);
/** Zig's cache for refuzz's builds in the container; the global cache (the dependencies build.sh fetched) is the image's. */
const LOCAL_CACHE = '/tmp/refuzz/zig-cache';

/** The Zig version build.zig.zon asks for, at least: its minimum_zig_version. */
const wantedZig = (dir: string) => {
  const zon = join(dir, 'build.zig.zon');
  return existsSync(zon) ? /minimum_zig_version\s*=\s*"([^"]+)"/.exec(readFileSync(zon, 'utf8'))?.[1] : undefined;
};
const versionParts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);

export const zig: Adapter = {
  languages: ['zig'],
  // Zig is on PATH, and is the release build.zig.zon asks for: the same minor version, at least the patch it names.
  async ready(b) {
    const r = await b.box.exec('zig version');
    if (r.code !== 0) return `zig is not on PATH: ${(r.stderr || r.stdout).trim().slice(0, 300)}`;
    const have = r.stdout.trim();
    const want = wantedZig(b.dir);
    if (!want) return undefined;
    const [hm, hn, hp] = versionParts(have), [wm, wn, wp] = versionParts(want);
    if (hm === wm && hn === wn && (hp >= wp || /-dev/.test(want))) return undefined;
    return `Zig ${have} is installed and build.zig.zon's minimum_zig_version is ${want}: add \`RUN install_zig ${wm}.${wn}\` to the Dockerfile`;
  },
  async prepare(b, log) {
    const dir = b.dir;
    const root = b.src;
    const version = (await b.box.exec('zig version')).stdout.trim();
    const want = wantedZig(dir);
    log(`  zig: Zig ${version}${want ? ` (build.zig.zon asks for ${want})` : ''}`);
    const fuzz = zigFuzz({ place: containerPlace(b.box), box: b.box, root, version, env: { ZIG_LOCAL_CACHE_DIR: LOCAL_CACHE } });
    await fuzz.prepare(log);

    const alias = (path: string) => {
      const stem = path.split('/').pop()!.replace(/\.zig$/, '').replace(/\W/g, '_');
      return KEYWORDS.has(stem) || /^\d/.test(stem) ? `${stem}_mod` : stem;
    };
    const rt: Runtime = {
      language: b.language,
      guide: `Zig statements inside a test function body, one per item, in Zig ${version}. \`const Name = @import("path/from/project/root.zig").Container;\` lines bring the project's files and types into scope (\`const std = @import("std");\` for the standard library). Use std.heap.page_allocator where an allocator is needed and \`try\` on setup calls that can fail. Declare each name once; \`var\` only for values you mutate. Build the arguments, then the last line calls the target, without \`try\` (a returned error is part of the result), and binds what it returns: \`const result = Name.function(...);\``,
      importFor: (t: Target) => {
        // refuzz names a Zig function without its container: the import names the struct it is declared in.
        const chain = containers(readFileSync(join(dir, t.path), 'utf8'), t.line).map((c) => c.name);
        return `const ${chain.at(-1) ?? alias(t.path)} = @import("${t.path}")${chain.map((c) => `.${c}`).join('')};`;
      },
      isImport: (l) => /^\s*(pub\s+)?const\s+\w+\s*=\s*@import\(\s*"[^"]+"\s*\)\s*(\.[\w.]+)?\s*;\s*$/.test(l),
      bindsResult: (l) => /^\s*(const|var)\s+result\b[^=]*=(?!=)/.test(l),
      parseWrap: (code) => ({ source: `test "h" {\n${code}\n}\n`, offset: 1 }),
      isPublic(t, source) {
        // refuzz's header starts at `fn`; `pub` is on the definition's line before it.
        const lines = source.split('\n');
        if (!/^\s*pub\s/.test(lines[t.line - 1] ?? '') || /(^|\/)build\.zig$/.test(t.path) || t.name === 'main') return false;
        // Every container the function is nested in must be pub too.
        if (containers(source, t.line).some((c) => !c.pub)) return false;
        return true;
      },
      // A panic is never the contract; errors are returned values.
      errorsAreValues: true,
      rejections: [],
      environmental: (r) => r.type === 'BuildError' || /no module named|unable to find module|ConnectionRefused|NetworkUnreachable|UnknownHostName/.test(r.message ?? ''),
      fuzz: fuzz.runtime,
    };
    return rt;
  },
};

/** The containers (`const Name = struct {`) a line is nested in, outermost first. */
function containers(source: string, line: number): { name: string; pub: boolean }[] {
  const lines = source.split('\n');
  const out: { name: string; pub: boolean }[] = [];
  let indent = /^\s*/.exec(lines[line - 1] ?? '')![0].length;
  for (let i = line - 2; i >= 0 && indent > 0; i--) {
    const l = lines[i];
    const n = /^\s*/.exec(l)![0].length;
    if (!l.trim() || n >= indent) continue;
    indent = n;
    const m = /^\s*(pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+|extern\s+)?(?:struct|union|enum|opaque)\b/.exec(l);
    if (m) out.unshift({ name: m[2], pub: !!m[1] });
  }
  return out;
}

/** A line of a fuzz target that states a property: a failed assert, expect, `unreachable` or @panic there is its assertion. */
const ASSERTS = /\b(?:assert|expect\w*)\s*\(|@panic\s*\(|\bunreachable\b/;

/**
 * A panic or a fault, from what the process printed: the message, then the stack trace, innermost frame first. Frames of
 * files named `__refuzz_*` are the harness's; the innermost frame that is the harness's or the project's says whose code
 * failed; `root` is the project's folder. `harnessLine` maps a line of the harness file to the model's. `target` is a fuzz target's source: a panic on one
 * of its lines that asserts is its assertion failing, the line's text the message (a @panic's own message).
 */
function panicReport(err: string, code: number, root: string, harnessLine: (line: number) => number, target?: string): Report {
  const panic = /panic: (.+)$/m.exec(err)?.[1];
  const fault = /(Segmentation fault|Illegal instruction|Bus error)[^\n]*/.exec(err)?.[0];
  const frames: Frame[] = [];
  let mine: 'library' | 'setup' | undefined;
  let line = 0;
  for (const m of err.matchAll(/^(\S[^\n]*?\.zig):(\d+):\d+: 0x[0-9a-f]+ in ([^\s(]+)/gm)) {
    const path = m[1].startsWith(`${root}/`) ? m[1].slice(root.length + 1) : m[1];
    if (m[1].startsWith('/') && !m[1].startsWith(`${root}/`)) continue; // std and the compiler's own files
    const harness = /^__refuzz_/.test(path);
    if (!mine) { mine = harness ? 'setup' : 'library'; if (harness) line = harnessLine(Number(m[2])); }
    if (!harness) frames.push({ path, line: Number(m[2]), name: m[3] });
  }
  // kcov exits with the signal's number; a process run alone, with 128 plus it.
  const signal = ({ 4: 'SIGILL', 5: 'SIGTRAP', 6: 'SIGABRT', 7: 'SIGBUS', 8: 'SIGFPE', 11: 'SIGSEGV' } as Record<number, string>)[code > 128 ? code - 128 : code];
  const message = panic ?? fault ?? (signal ? `killed by ${signal}` : `exit ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`);
  const said = target !== undefined && mine === 'setup' && panic ? target.split('\n')[line - 1]?.trim() : undefined;
  if (said && ASSERTS.test(said.split('//')[0])) return { status: 'error', origin: 'assertion', type: 'assertion', message: (/@panic\s*\(/.test(said) ? panic! : said).slice(0, 400), frames: frames.reverse().slice(-12), native: true };
  return {
    status: 'error',
    origin: mine ?? (frames.length ? 'library' : 'setup'),
    type: panic ? 'panic' : fault ? (signal ?? 'SIGSEGV') : signal ?? 'exit',
    message: `${message}${mine === 'setup' && line ? ` (harness line ${line})` : ''}`.slice(0, 400),
    frames: frames.reverse().slice(-12),
    native: true,
  };
}

/** A fuzz target's last line of the target in a trace (an error's return trace, a panic's stack): the line's text. */
const targetLine = (err: string, source: string) => {
  const m = /^\S*__refuzz_g_[^\n]*?\.zig:(\d+):\d+: 0x[0-9a-f]+ in /m.exec(err);
  return m ? source.split('\n')[Number(m[1]) - 1]?.trim() : undefined;
};

/** Generated roots: the in-process driver, and libFuzzer's entry point. Debug logging off, or a parser's logs flood stderr. */
const driverRoot = (target: string, stubs: string[]) => `const std = @import("std");
pub const std_options: std.Options = .{ .log_level = .err };
pub const panic = if (@hasDecl(std.debug, "FullPanic")) std.debug.FullPanic(@import("__refuzz_value.zig").panicFn) else std.builtin.default_panic;
pub fn main() void {
    @import("__refuzz_value.zig").serve(@import("${target}"));
}
${stubs.map((s) => `export fn ${s}() void {}`).join('\n')}
`;
/** An error from std.testing's expect functions (named Test…) is the target's assertion: libFuzzer keeps the input. */
const nativeRoot = (target: string) => `pub const std_options: @import("std").Options = .{ .log_level = .err };
const std = @import("std");
export fn LLVMFuzzerTestOneInput(data: [*]const u8, size: usize) callconv(.c) c_int {
    @import("${target}").fuzz(data[0..size]) catch |err| if (std.mem.startsWith(u8, @errorName(err), "Test")) {
        std.debug.print("assertion failed: error.{s}\\n", .{@errorName(err)});
        std.process.abort();
    };
    return 0;
}
`;

/**
 * Fuzz targets for Zig: a file at the project's root (so it can `@import` any of its files) with `pub fn fuzz(input:
 * []const u8) !void`, built into its own Debug executable with -ffuzz, whose inline 8-bit counters src/probes/zig_value.zig
 * reads after each input (Zig's own fuzzer runtime is linked in but never started: the runner symbols it wants are stubbed).
 * Safety checks stay on, so an overflow or an index out of bounds panics; the process dies, LineDriver restarts it, and the
 * input is replayed alone for the panic's stack trace. `native` builds the target as an object with the same instrumentation
 * and links it with clang's libFuzzer. Binaries go in refuzz's folder in the container.
 */
function zigFuzz(o: { place: Place; box: Container; root: string; version: string; env: Record<string, string> }) {
  const { place, box, root, env } = o;
  const value = readFileSync(resolve(import.meta.dirname, '..', 'probes', 'zig_value.zig'), 'utf8');
  let stubs: string[] = [];
  let sessions = 0;
  const envFlags = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');

  /** Puts files at the project's root, where a target's `@import`s of the project's files resolve. */
  const stage = (files: Record<string, string>) => place.put(root, files);
  const buildExe = (main: string, out: string) => box.exec(`${envFlags} zig build-exe ${main} -ffuzz -femit-bin=${out} 2>&1`, { cwd: root, timeoutMs: 1_800_000 });

  const prepare = async (log: (s: string) => void) => {
    log('  zig: building the fuzz driver (-ffuzz counters)');
    const warm = await place.folder('zigwarm');
    await stage({ '__refuzz_value.zig': value, '__refuzz_g_warm.zig': 'pub fn fuzz(input: []const u8) !void {\n    _ = input;\n}\n', '__refuzz_gmain_warm.zig': driverRoot('__refuzz_g_warm.zig', []) });
    let b = await buildExe('__refuzz_gmain_warm.zig', `${warm}/g`);
    // The fuzzer runtime -ffuzz links expects the build system's test runner; whatever it names is stubbed.
    stubs = [...new Set([...b.stdout.matchAll(/undefined symbol: (\w+)/g)].map((m) => m[1]))];
    if (stubs.length) {
      await stage({ '__refuzz_gmain_warm.zig': driverRoot('__refuzz_g_warm.zig', stubs) });
      b = await buildExe('__refuzz_gmain_warm.zig', `${warm}/g`);
    }
    if (b.code !== 0) log(`  zig: the fuzz driver did not build: ${b.stdout.slice(-400)}`);
    await box.exec(`rm -rf ${warm} ${root}/__refuzz_g_warm.zig ${root}/__refuzz_gmain_warm.zig`);
  };

  /** File and line of each counter's address, by addr2line; the project's only. Cached per binary. */
  const symbols = new Map<string, Map<number, [string, number] | null>>();
  const symbolize = async (bin: string, pcs: number[]) => {
    const known = symbols.get(bin) ?? symbols.set(bin, new Map()).get(bin)!;
    const ask = [...new Set(pcs.filter((pc) => pc && !known.has(pc)))];
    if (ask.length) {
      const r = await box.exec(`addr2line -e ${bin}`, { input: ask.map((pc) => `0x${pc.toString(16)}`).join('\n') + '\n', timeoutMs: 300_000 });
      const lines = r.stdout.split('\n');
      ask.forEach((pc, i) => {
        const m = /^(\/[^:]+):(\d+)/.exec(lines[i] ?? '');
        const path = m && m[1].startsWith(`${root}/`) ? m[1].slice(root.length + 1) : '';
        known.set(pc, path && !/^__refuzz_/.test(path) && Number(m![2]) > 0 ? [path, Number(m![2])] : null);
      });
    }
    return known;
  };

  /**
   * One input run alone, with traces: a panic's message and stack, or a failed expect's report with the line of the target
   * its error returned from. Undefined when it does not fail again.
   */
  const replay = async (bin: string, input: Buffer, source: string): Promise<Report | undefined> => {
    const head = Buffer.alloc(4);
    head.writeUInt32LE(input.length);
    const dir = await place.folder('zigreplay');
    await place.put(dir, { 'input.bin': Buffer.concat([head, input]) });
    const r = await box.exec(`timeout -s KILL 30 ${bin} 30000 trace < ${dir}/input.bin`, { timeoutMs: 60_000 });
    await place.remove(dir);
    if (r.code === null) return undefined;
    if (r.code === 137) return { status: 'timeout', origin: 'library', type: 'Timeout' };
    if (r.code === 0) {
      let report: Report;
      try { report = JSON.parse(r.stdout.split('\n')[1] ?? ''); } catch { return undefined; }
      const at = report.origin === 'assertion' ? targetLine(r.stderr, source) : undefined;
      return at ? { ...report, message: /^error\.Test/.test(report.message ?? '') ? at : `${at}: ${report.message}` } : report;
    }
    return panicReport(r.stderr, r.code, root, (l) => l, source);
  };

  const runtime: FuzzRuntime = {
    guide: [
      `A Zig ${o.version} fuzz target: a file at the project's root with \`const std = @import("std");\` and \`const X = @import("path/from/project/root.zig");\` lines for what it uses, then \`pub fn fuzz(input: []const u8) !void { ... }\`, called once per input with the raw bytes (any bytes, any length, empty too). Zig ${o.version}'s std.testing.fuzz hands its test a std.testing.Smith rather than the bytes, so the target is this plain function, which refuzz's driver and libFuzzer both call.`,
      'Split the bytes into arguments by slicing with explicit length checks: `if (input.len < 2) return; const mode = input[0] % 3; const text = input[1..];`, an integer with std.mem.readInt(u32, input[0..4], .little) after checking the length.',
      'Build values the way the project\'s own tests do (a method is called on a value of its container type). Use std.heap.page_allocator, or an ArenaAllocator over it freed with defer, and free what the target allocates: it runs millions of times in one process. No printing.',
      'A documented error is the project\'s answer: `Yaml.load(...) catch return;` or a switch on the errors it documents, never `try` on the target\'s own call; `try` only setup that cannot fail on these bytes.',
      'State what the project promises for every input it accepts with `try std.testing.expect(cond);` or `try std.testing.expectEqual(expected, actual);` (or std.debug.assert(cond)) after the call, where the promise holds, with a comment above saying the promise: a round trip (parse what it printed), a bound on a result\'s size or range, agreement with another function of the project that must agree. A failed expect or assert is reported as a finding with that line as its message; a panic in the project as the project\'s; any other panic on the target\'s lines as the target\'s mistake.',
    ].join(' '),
    async session(targets) {
      const sid = `s${++sessions}${Date.now().toString(36)}`;
      const bins = await place.folder(`zigbin-${sid}`);
      const names = new Map(Object.keys(targets).map((h) => [h, `${sid}_${h.replace(/\W/g, '_')}`]));
      const files: Record<string, string> = { '__refuzz_value.zig': value };
      for (const [h, n] of names) {
        files[`__refuzz_g_${n}.zig`] = targets[h];
        files[`__refuzz_gmain_${n}.zig`] = driverRoot(`__refuzz_g_${n}.zig`, stubs);
      }
      await stage(files);
      const errors: Record<string, string> = {};
      // One build per target, so one that does not compile takes nothing else with it.
      await pool([...names], Math.max(1, Math.min(4, PARALLEL)), async ([h, n]) => {
        const b = await buildExe(`__refuzz_gmain_${n}.zig`, `${bins}/${n}`);
        if (b.code === 0) return;
        const msgs = [...b.stdout.matchAll(/^(\S[^\n]*?):(\d+):\d+: error: ([^\n]+)/gm)].slice(0, 4).map((m) => /__refuzz_g_/.test(m[1]) ? `line ${m[2]}: ${m[3]}` : `${m[1].replace(`${root}/`, '')}:${m[2]}: ${m[3]}`);
        errors[h] = msgs.join('\n') || b.stdout.slice(-600);
      });
      const binOf = (h: string) => `${bins}/${names.get(h)}`;
      const drivers = new Map<string, { d: LineDriver; timeout: number }>();
      const make = (h: string, timeoutMs: number) => place.driver([binOf(h), String(timeoutMs)], { cwd: HARNESS_CWD });
      const natives = new Map<string, string>();
      const session: FuzzSession = {
        async run(h, inputs, timeoutMs, deadline) {
          if (errors[h] || !names.has(h)) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: errors[h] ?? 'no such target' }));
          let x = drivers.get(h);
          if (!x || x.timeout !== timeoutMs) { x?.d.stop(); x = { d: make(h, timeoutMs), timeout: timeoutMs }; drivers.set(h, x); }
          const reports = await x.d.run(inputs, timeoutMs, deadline) as (InputReport & { pcs?: number[] })[];
          const known = await symbolize(binOf(h), reports.flatMap((r) => r.pcs ?? []));
          // Panics, and failed expects that printed nothing, are replayed alone for their traces, a few per batch; the rest
          // take the report of a replay that said the same thing.
          const replayed = new Map<string, Report>();
          for (const [i, r] of reports.entries()) {
            const lines = new Map<string, [string, number]>();
            for (const pc of r.pcs ?? []) { const at = known.get(pc); if (at) lines.set(at.join(':'), at); }
            r.lines = [...lines.values()];
            delete r.pcs;
            const silent = r.origin === 'assertion' && /^error\.Test/.test(r.message ?? '');
            if (!silent && (!r.native || r.frames?.length)) continue;
            const key = `${silent ? r.features?.join(',') : ''}|${(/panic: [^\n]*/.exec(r.message ?? '')?.[0] ?? r.message ?? '').replace(/0x[0-9a-f]+|\b\d+\b/gi, '#')}`;
            const again = replayed.size < 6 && !replayed.has(key) ? await replay(binOf(h), inputs[i], targets[h]) : replayed.get(key);
            if (!again) continue;
            replayed.set(key, again);
            // A crash that does not happen again alone keeps its report, unless the process left no message at all: then
            // it died between inputs (a restart after a timeout), and the replay is what this input does.
            if (again.status === 'error' || !r.message) Object.assign(r, { ...again, native: again.native, features: r.features, lines: r.lines, pcs: undefined });
          }
          return reports;
        },
        async native(h, corpus, dict, seconds) {
          const n = names.get(h)!;
          if (errors[h] || !n) return { crashes: [], corpus, execs: 0 };
          if (!natives.has(h)) {
            await stage({ [`__refuzz_nmain_${n}.zig`]: nativeRoot(`__refuzz_g_${n}.zig`) });
            const b = await box.exec(`${envFlags} zig build-obj __refuzz_nmain_${n}.zig -ffuzz -fcompiler-rt -femit-bin=${bins}/${n}.o 2>&1 && $CC $LIB_FUZZING_ENGINE ${bins}/${n}.o -o ${bins}/${n}.fuzz 2>&1`, { cwd: root, timeoutMs: 1_800_000 });
            if (b.code !== 0) { natives.set(h, ''); if (process.env.REFUZZ_DEBUG) console.log(`[native ${h}] ${b.stdout.slice(-800)}`); }
            else natives.set(h, `${bins}/${n}.fuzz`);
          }
          const bin = natives.get(h);
          if (!bin) return { crashes: [], corpus, execs: 0 };
          return libFuzzer(place, box, bin, corpus, dict, seconds, (input) => replay(binOf(h), input, targets[h]));
        },
        release(h) {
          drivers.get(h)?.d.stop();
          drivers.delete(h);
        },
        async close() {
          for (const x of drivers.values()) x.d.stop();
          await box.exec(`rm -rf ${bins} ${root}/__refuzz_*${sid}*.zig`);
        },
      };
      return { session, errors };
    },
    /**
     * The target as <name>.zig, and build lines that put it and a libFuzzer entry point at the project's root and build them
     * as native() does: `zig build-obj -ffuzz`, linked by $CC with $LIB_FUZZING_ENGINE into $OUT/<name>.
     */
    oss(name, source) {
      const file = `${name}.zig`;
      const project = root.replace(/^\/src(?=\/|$)/, '$SRC');
      return {
        file,
        source: source.endsWith('\n') ? source : `${source}\n`,
        compile: [
          `cp $SRC/refuzz/${file} ${project}/__refuzz_g_${name}.zig`,
          `cat > ${project}/__refuzz_nmain_${name}.zig <<'REFUZZ_ROOT'`,
          nativeRoot(`__refuzz_g_${name}.zig`).trimEnd(),
          'REFUZZ_ROOT',
          `(cd ${project} && zig build-obj __refuzz_nmain_${name}.zig -ffuzz -fcompiler-rt -femit-bin=$WORK/${name}.o)`,
          `$CC $LIB_FUZZING_ENGINE $WORK/${name}.o -o $OUT/${name}`,
        ],
      };
    },
  };
  return { runtime, prepare };
}

/**
 * libFuzzer on a target for `seconds`, seeded with `corpus` and `dict`, in a folder of its own in the place. libFuzzer stops at
 * a crash; it is started again on the grown corpus until the time is spent, the crashing input dropped from the seeds. Each
 * crash is replayed in the session's driver for a Report.
 */
async function libFuzzer(place: Place, box: Container, bin: string, corpus: Buffer[], dict: string[], seconds: number, replay: (input: Buffer) => Promise<Report | undefined>) {
  const d = await place.folder('zignative');
  // Named by SHA-1 as libFuzzer names its files: a seed that crashes is found by its crash file's name.
  await place.put(d, {
    ...Object.fromEntries((corpus.length ? corpus : [Buffer.from([0])]).map((c) => [`corpus/${createHash('sha1').update(c).digest('hex')}`, c])),
    'crashes/.keep': '',
    dict: dict.map((t) => `"${[...Buffer.from(t, 'latin1')].map((b) => (b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('')}"`).join('\n') + '\n',
  });
  const script = [
    `cd ${d} || exit 1`,
    `end=$(( $(date +%s) + ${seconds} )); total=0; i=0`,
    'while [ $(date +%s) -lt $end ] && [ $i -lt 30 ]; do',
    '  left=$(( end - $(date +%s) )); [ $left -lt 1 ] && break',
    `  timeout -s KILL $((left + 30)) ${bin} -max_total_time=$left -timeout=5 -rss_limit_mb=2048 -print_final_stats=1 -dict=${d}/dict -artifact_prefix=${d}/crashes/ ${d}/corpus > ${d}/log 2>&1`,
    `  n=$(grep -o 'number_of_executed_units: [0-9]*' ${d}/log | grep -o '[0-9]*$'); total=$((total + \${n:-0})); i=$((i + 1))`,
    `  grep -q 'Test unit written' ${d}/log || break`,
    `  for f in ${d}/crashes/crash-*; do rm -f ${d}/corpus/\${f##*crash-}; done`,
    'done',
    `tail -3 ${d}/log; echo "EXECS $total"`,
  ].join('\n');
  const r = await box.exec(script, { timeoutMs: (seconds + 180) * 1000 });
  if (process.env.REFUZZ_DEBUG) console.log(`[native ${bin}] ${r.stdout.slice(-800)}`);
  const found = await place.get(d);
  await place.remove(d);
  const crashes: { input: Buffer; report: Report }[] = [];
  // One input per cause: where the failure is, or which assertion.
  const seen = new Set<string>();
  for (const input of Object.entries(found).filter(([f]) => /^crashes\/(crash|timeout|oom)-/.test(f)).slice(0, 20).map(([, b]) => b)) {
    const report = await replay(input);
    const key = `${report?.type}|${report?.frames?.at(-1)?.path}:${report?.frames?.at(-1)?.line}|${report?.origin === 'assertion' ? report.message : ''}`;
    if (report && report.status !== 'ok' && !seen.has(key)) { seen.add(key); crashes.push({ input, report }); }
  }
  const grown = Object.entries(found).filter(([f]) => f.startsWith('corpus/')).slice(0, 2000).map(([, b]) => b);
  return { crashes, corpus: grown, execs: Number(/EXECS (\d+)/.exec(r.stdout)?.[1] ?? 0) };
}
