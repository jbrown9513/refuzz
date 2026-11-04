/**
 * C and C++: the project built and its static libraries made by its OSS-Fuzz build spec (src/build.ts) in the base-builder
 * image (src/images/base-c.Dockerfile), with clang, AddressSanitizer and libFuzzer's coverage counters. Fuzz targets are
 * libFuzzer files, LLVMFuzzerTestOneInput, compiled unchanged and linked against those libraries with refuzz's in-process
 * driver (src/probes/c_fuzz.h) for a session, or with libFuzzer itself.
 */
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { HARNESS_CWD, PARALLEL, pool, shq, type Container } from '../run.ts';
import type { LineDriver } from '../session.ts';
import type { Adapter, Built, Frame, FuzzRuntime, InputReport, Report, Runtime, Target } from '../types.ts';

const SOURCE = /\.(c|cc|cpp|cxx|c\+\+)$/;
const HEADER = /\.(h|hh|hpp|hxx|h\+\+|inl)$/;
/** Not the library: tests, examples, tools and vendored code. */
const SKIP = /(^|\/)(\.\w[^/]*|tests?|testing|examples?|samples?|docs?|benchmarks?|benches|fuzz(ing|ers?)?|third[_-]?party|vendor|external|extern|deps|build|cmake-build[^/]*|out|contrib|tools?|programs?|demos?)\//i;

/** Every fatal signal is the sanitizer's to report with a stack, the trap a target's __builtin_trap() raises on arm64 too. */
const SAN_ENV = {
  ASAN_OPTIONS: 'detect_leaks=0:abort_on_error=0:symbolize=1:handle_abort=1:handle_segv=1:handle_sigfpe=1:handle_sigbus=1:handle_sigill=1:handle_sigtrap=1:allow_user_segv_handler=0:detect_stack_use_after_return=0',
  UBSAN_OPTIONS: 'print_stacktrace=1:halt_on_error=1:report_error_type=1',
};

/** refuzz's folder in the container: the session driver, and each session's targets in a folder of their own under it. */
const REFUZZ = '/tmp/refuzz';
/** The prefix of a session's folder: frames in files under one are the target's own. */
const TARGETS = `${REFUZZ}/cfuzz-`;
/** Below this much free space (in the container or on the machine), less the next target's expected size, no target is linked. */
const MIN_FREE_GB = 40;
/** Where the build leaves static libraries and generated headers, beside the project's folder. */
const WORK = '/work';
const INSTALLED = '/usr/local/lib';

function walk(dir: string, rel = '', out: string[] = []): string[] {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!/^(\.git|node_modules|\.fuzz|\.refuzz)$/.test(e.name)) walk(dir, p, out); }
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** A source that defines main(): a program, not the library. */
const MAINS = /^\s*(?:int|void)\s+(?:\w+\s+)*main\s*\(/m;
/** A source of the library: not a test, tool or vendored file, not huge, no main(). */
const librarySource = (dir: string, f: string) => SOURCE.test(f) && !SKIP.test(f) && !/(^|\/)test[^/]*$|_test\.\w+$/i.test(f) && statSync(join(dir, f)).size < 4_000_000 && !MAINS.test(readFileSync(join(dir, f), 'utf8'));

/** Comments, strings and character literals blanked (newlines kept), so braces and labels can be counted. */
const blank = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => m.replace(/[^\n]/g, ' '));

interface Scope { kind: 'class' | 'namespace' | 'block'; name: string; access: string }

/** The scopes open at `offset`: classes with the access in force there, namespaces (an anonymous one named ''), other blocks. */
function scopesAt(clean: string, offset: number): Scope[] {
  const stack: Scope[] = [];
  let last = 0;
  const labels = (to: number) => {
    const top = stack.at(-1);
    if (top?.kind !== 'class') return;
    for (const m of clean.slice(last, to).matchAll(/\b(public|private|protected)\s*:(?!:)/g)) top.access = m[1];
  };
  for (let i = 0; i < offset && i < clean.length; i++) {
    const ch = clean[i];
    if (ch !== '{' && ch !== '}' && ch !== ';') continue;
    labels(i);
    if (ch === '{') {
      const head = clean.slice(last, i).replace(/\b(public|private|protected)\s*:(?!:)/g, '');
      const cls = /\b(class|struct|union)\s+(?:\[\[[^\]]*\]\]\s*)?(?:[A-Z][A-Z0-9_]+\s+)?(\w+)\s*(?:final\s*)?(?::[^(){}]*)?$/.exec(head);
      const ns = /\bnamespace\s*([\w:]*)\s*$/.exec(head);
      if (cls && !/\benum\s/.test(head)) stack.push({ kind: 'class', name: cls[2], access: cls[1] === 'class' ? 'private' : 'public' });
      else if (ns) stack.push({ kind: 'namespace', name: ns[1], access: 'public' });
      else if (/\bextern\s*$/.test(head)) stack.push({ kind: 'namespace', name: 'extern', access: 'public' });
      else stack.push({ kind: 'block', name: '', access: 'public' });
    } else if (ch === '}') stack.pop();
    last = i + 1;
  }
  labels(Math.min(offset, clean.length));
  return stack;
}

const offsetOfLine = (text: string, line: number) => {
  let at = 0;
  for (let l = 1; l < line && at >= 0; l++) at = text.indexOf('\n', at) + 1;
  return Math.max(0, at);
};

/** `Class::method(` in a definition's header: a method defined outside its class. */
const outOfClass = (header: string) => /(\w+)\s*(?:<[^<>]*>)?\s*::\s*(~?\w+|operator\s*[^\s(]+)\s*\(/.exec(header);

/** How a header is included: relative to its `include/` directory when it has one, else to the project root. */
const includePath = (h: string) => {
  const i = h.lastIndexOf('include/');
  return i >= 0 && (i === 0 || h[i - 1] === '/') ? h.slice(i + 'include/'.length) : h;
};

const exitSignal: Record<number, string> = { 4: 'SIGILL', 5: 'SIGTRAP', 6: 'SIGABRT', 7: 'SIGBUS', 8: 'SIGFPE', 9: 'SIGKILL', 11: 'SIGSEGV', 13: 'SIGPIPE', 15: 'SIGTERM' };

/** Paths as the writer knows them: the project's relative to its folder, a target's or the driver's by its file name alone. */
const local = (text: string, src: string) => text.replaceAll(`${src}/`, '').replace(/\/tmp\/refuzz\/(?:[^/\s]+\/)?/g, '');

/** The static libraries the build left: in the project's folder, in $WORK, or installed in /usr/local/lib. */
async function librariesOf(box: Container, src: string, dir: string): Promise<string[]> {
  // Those the build made: archives that came with the checkout are test inputs and prebuilt files for other systems (LLVM's
  // fake libgcc.a in ClickHouse's contrib/), which break every link.
  return (await box.exec(`find ${shq(src)} ${WORK} ${INSTALLED} -name '*.a' -size +0 2>/dev/null | sort`)).stdout.trim().split('\n')
    .filter((f) => f && !(f.startsWith(`${src}/`) && existsSync(join(dir, f.slice(src.length + 1)))));
}

/**
 * The system libraries the project says it links against: the `-l` flags of its pkg-config files (Libs, Libs.private) and
 * libtool archives (dependency_libs), as libpng's libpng16.pc names `-lz`. The project's own libraries, linked from their
 * archives, are left out.
 */
async function systemLibsOf(box: Container, src: string, libs: string[]): Promise<string[]> {
  const text = (await box.exec(`find ${shq(src)} ${WORK} ${INSTALLED} \\( -name '*.pc' -o -name '*.la' \\) -size +0 2>/dev/null | head -50 | xargs -r grep -hE '^(Libs(\\.private)?:|dependency_libs=)' 2>/dev/null`)).stdout;
  const own = new Set(libs.map((l) => l.split('/').pop()!.replace(/^lib/, '').replace(/\.a$/, '')));
  const flags = [...text.matchAll(/(?:^|\s|')-l([\w+.-]+)/g)].map((m) => m[1]).filter((n) => !own.has(n));
  if (!flags.length) return [];
  // Only those the image has: a name in a .pc that no installed library provides would fail every link.
  const have = (await box.exec(`for n in ${[...new Set(flags)].map(shq).join(' ')}; do ls /usr/lib/*/lib$n.so /usr/lib/*/lib$n.a /usr/lib/lib$n.so /usr/local/lib/lib$n.so /usr/local/lib/lib$n.a 2>/dev/null | head -1 | grep -q . && echo $n; done`)).stdout.trim().split('\n').filter(Boolean);
  return [...new Set(have)].map((n) => `-l${n}`);
}

/**
 * The include folders of the libraries the project builds against, from its pkg-config files and those they require
 * (libxslt.pc requires libxml-2.0, installed by build.sh under $WORK/install): `#include <libxml/xmlstring.h>` needs
 * `$WORK/install/include/libxml2`, the folder above the headers, which no header's own folder gives.
 */
async function pkgIncludesOf(box: Container, src: string, dir: string): Promise<string[]> {
  // Those the build wrote or installed: a checkout's own .pc files describe other systems (ClickHouse's sysroots for FreeBSD
  // and illumos in contrib/), whose headers break every compile here.
  const pcs = (await box.exec(`find ${shq(src)} ${WORK} ${INSTALLED} -name '*.pc' -size +0 2>/dev/null`)).stdout.trim().split('\n')
    .filter((f) => f && !(f.startsWith(`${src}/`) && existsSync(join(dir, f.slice(src.length + 1))))).slice(0, 50);
  if (!pcs.length) return [];
  const path = [...new Set(pcs.map((f) => f.replace(/\/[^/]+$/, '')))].join(':');
  const out = (await box.exec(`bash -c ${shq(`export PKG_CONFIG_PATH=${shq(path)}\${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}; for f in ${pcs.map(shq).join(' ')}; do pkg-config --cflags-only-I "$(basename "$f" .pc)" 2>/dev/null; done`)}`)).stdout;
  return [...new Set([...out.matchAll(/-I(\S+)/g)].map((m) => m[1]))].flatMap((d) => ['-I', d]);
}

/** The global functions the static libraries define (C names): what a target can link to. */
async function definedSymbols(box: Container, libs: string[]): Promise<Set<string>> {
  if (!libs.length) return new Set();
  const out = (await box.exec(`for l in ${libs.map(shq).join(' ')}; do nm -g --defined-only "$l" 2>/dev/null; done | awk 'NF>=3 && ($2=="T"||$2=="W"){print $3}' | sort -u`, { timeoutMs: 120_000 })).stdout;
  return new Set(out.split('\n').filter(Boolean));
}

/** Whether an archive's member list holds a compile of source `f`: an object named like it. */
const holds = (members: string, f: string) => new RegExp(`(^|[/_-])${f.replace(/^.*\//, '').replace(/\.\w+$/, '').replace(/[^\w]/g, '\\$&')}\\.`, 'm').test(members);

export const c: Adapter = {
  languages: ['c', 'cpp'],
  // The build left static libraries that hold the project's library sources, compiled with libFuzzer's counters ($CFLAGS).
  async ready(b) {
    const libs = await librariesOf(b.box, b.src, b.dir);
    if (!libs.length) return `no static library (lib*.a) under ${b.src}, ${WORK} or ${INSTALLED}: build.sh must build the library static, with $CC/$CXX and $CFLAGS/$CXXFLAGS`;
    const members = (await b.box.exec(`for l in ${libs.map(shq).join(' ')}; do ar t "$l"; done 2>/dev/null`)).stdout;
    const sources = walk(b.dir).filter((f) => librarySource(b.dir, f));
    if (sources.length && !sources.some((f) => holds(members, f))) return `the static libraries (${libs.slice(0, 6).join(', ')}) hold none of the project's sources (${sources.slice(0, 6).join(', ')})`;
    const counters = await b.box.exec(`for l in ${libs.map(shq).join(' ')}; do nm -A "$l" 2>/dev/null; done | grep -c __sanitizer_cov_8bit_counters_init`);
    if (!Number(counters.stdout.trim())) return `the static libraries (${libs.slice(0, 6).join(', ')}) were not compiled with $CFLAGS/$CXXFLAGS (no -fsanitize=fuzzer-no-link counters): pass them to the build`;
    // The PC table maps each counter to its source line: without it (ClickHouse builds with -fno-sanitize-coverage=pc-table) no
    // input is ever seen to reach the code, and every target is rejected as reaching nothing.
    const tables = await b.box.exec(`for l in ${libs.map(shq).join(' ')}; do nm -A "$l" 2>/dev/null; done | grep -c __sanitizer_cov_pcs_init`);
    if (!Number(tables.stdout.trim())) return `the static libraries (${libs.slice(0, 6).join(', ')}) were compiled without the coverage PC table (-fno-sanitize-coverage=pc-table, or a flag that implies it): coverage cannot be mapped to source lines; build them with -fsanitize=fuzzer-no-link and nothing that removes the table`;
    return undefined;
  },
  async prepare(b, log) {
    const { box, src } = b;
    const dir = b.dir;
    const cpp = b.language === 'cpp';
    const language = b.language;
    const files = walk(dir);
    const headers = new Map<string, string>();
    for (const f of files) if (HEADER.test(f) && !SKIP.test(f) && statSync(join(dir, f)).size < 2_000_000) headers.set(f, readFileSync(join(dir, f), 'utf8'));
    const cleaned = new Map<string, string>();
    const clean = (path: string, text: string) => cleaned.get(path) ?? cleaned.set(path, blank(text)).get(path)!;

    const place = containerPlace(box);
    await place.put(REFUZZ, { 'c_fuzz.h': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'c_fuzz.h'), 'utf8'), 'refuzz_assert.h': ALWAYS_ASSERT });
    // Archives that redefine the C library's own process functions (ClickHouse's libharmful makes system() and fork() trap,
    // to keep them out of ClickHouse) replace them for the fuzzing engine too: libFuzzer's fork mode calls system(). Left out.
    const allLibs = await librariesOf(box, src, dir);
    const interposers = new Set((await box.exec(`for l in ${allLibs.map(shq).join(' ')}; do nm -g --defined-only "$l" 2>/dev/null | grep -qE ' T (system|fork|popen|execve)$' && echo "$l"; done | sort -u`, { timeoutMs: 120_000 })).stdout.split('\n').filter(Boolean));
    const libs = allLibs.filter((l) => !interposers.has(l));
    if (interposers.size) log(`  ${language}: left out of target links, as they redefine the C library's process functions: ${[...interposers].map((l) => l.split('/').pop()).join(', ')}`);
    // compile_commands.json the build wrote (CMake does in this image): its include folders and the configuration it shares.
    const databases = (await box.exec(`find ${shq(src)} ${WORK} -name compile_commands.json -not -path '*/CMakeFiles/*' 2>/dev/null`)).stdout.trim().split('\n').filter(Boolean);
    // Read in the container and cut down there: ClickHouse's is 100 MB, past what one exec returns. A sample of the project's own
    // entries (outside vendored folders first), with only the flags targets compile with.
    const compileCommands = databases.length ? (await box.exec(`python3 -c ${shq(SAMPLE_DATABASE)} ${databases.map(shq).join(' ')}`, { timeoutMs: 300_000 })).stdout : '';
    // Headers the build generated or installed (a config.h, an export header): folders of headers that are not in the checkout.
    const checkout = new Set(files);
    const built = (await box.exec(`find ${shq(src)} ${WORK} \\( -name '*.h' -o -name '*.hpp' \\) 2>/dev/null`)).stdout.trim().split('\n').filter((h) => h && !(h.startsWith(`${src}/`) && (checkout.has(h.slice(src.length + 1)) || existsSync(join(dir, h.slice(src.length + 1))))));
    const generated = [...new Set(built.map((h) => h.replace(/\/[^/]+$/, '')))];
    // No compile database (a make build: PHP): the defines and include folders the build's Makefile gives every compile
    // (CPPFLAGS = -D_GNU_SOURCE …, DEFS, INCLUDES), so a target sees the project's headers as the project's sources do.
    const makeFlags = compileCommands.trim() ? [] : await makefileFlags(box, src);
    const incs = [...makeFlags, ...languageFlags(compileCommands, cpp), ...includes(compileCommands, [...headers.keys()], src, generated), ...(await pkgIncludesOf(box, src, dir))];
    const sys = await systemLibsOf(box, src, libs);
    // Which sources the build compiled: an object named for the file in one of the archives.
    const members = (await box.exec(`for l in ${libs.map(shq).join(' ')}; do ar t "$l"; done 2>/dev/null`, { timeoutMs: 120_000 })).stdout;
    const symbols = cpp ? new Set<string>() : await definedSymbols(box, libs);
    log(`  ${language}: ${libs.length} static librar${libs.length === 1 ? 'y' : 'ies'} (${libs.map((l) => l.split('/').pop()).slice(0, 6).join(', ')})${sys.length ? `, linked with ${sys.join(' ')}` : ''}`);

    /** The header that declares `name` (a function, or for a method its class), preferring the one named like its source. */
    const declaring = (t: Target) => {
      if (HEADER.test(t.path)) return t.path;
      const m = outOfClass(t.header);
      const want = cpp && m ? new RegExp(`\\b(class|struct)\\s+(?:\\w+\\s+)?${m[1]}\\b(?!\\s*;)`) : new RegExp(`\\b${t.name.replace(/\W/g, '')}\\s*\\(`);
      const stem = t.path.replace(/^.*\//, '').replace(/\.\w+$/, '');
      const found = [...headers].filter(([, text]) => want.test(text)).map(([h]) => h);
      return found.find((h) => h.replace(/^.*\//, '').replace(/\.\w+$/, '') === stem) ?? found[0];
    };

    const rt: Runtime = {
      language,
      guide: cpp
        ? 'C++ statements (the standard the project builds with, C++17 at least) in the body of `int main()`, one per item. `#include "…"` and `using namespace …;` lines are moved above main; the standard library headers (string, vector, map, memory, sstream, cstring, cstdint) are already included. Construct objects the way the project\'s tests do. The last line calls the target and declares `result` with what it returns: `auto result = parse(text);` or `auto result = doc.Method(arg);`. For a target that returns void, write `int result = (obj.Method(arg), 0);`. Do not write `return`.'
        : 'C statements in the body of `int main(void)`, one per item. `#include "…"` lines are moved above main; stdio, stdlib, string, stdint, stddef, stdbool, limits, math, ctype and errno are already included. Declare each variable with its type. Create objects through the project\'s own functions (`name_new`/`name_join`/`name_init`, in memory sized by `name_footprint` and `name_align`) as its tests do, never a zero-filled struct or a buffer cast to the type, and pass a pointer the target reads a whole record from a buffer of that full size. The last line calls the target and declares `result` with the type it returns: `size_t result = target(buf, len);` or `const char *result = target(s);`. For a target that returns void, write `int result = (target(args), 0);`. Do not write `return`.',
      importFor(t) {
        const h = declaring(t);
        const out = h ? [`#include "${includePath(h)}"`] : [];
        if (cpp) {
          const text = readFileSync(join(dir, t.path), 'utf8');
          const ns = scopesAt(clean(t.path, text), offsetOfLine(text, t.line)).filter((s) => s.kind === 'namespace' && s.name && s.name !== 'extern').map((s) => s.name);
          if (ns.length) out.push(`using namespace ${ns.join('::')};`);
        }
        // No header declares it: the definition's own signature, declared where the harness calls it.
        return out.join('\n') || `${t.header.trim()};`;
      },
      compiled: (t) => HEADER.test(t.path) || holds(members, t.path),
      isImport: (l) => /^\s*#\s*include\b|^\s*using\s+namespace\s+[\w:]+\s*;\s*$/.test(l),
      bindsResult: (l) => /^[^"'=(]*\bresult\s*=(?!=)/.test(l),
      parseWrap: (code) => ({ source: `int main(void) {\n${code}\n}\n`, offset: 1 }),
      isPublic(t, source) {
        const m = outOfClass(t.header);
        const name = m ? m[2] : t.name;
        if (name.startsWith('_') || /^main$/.test(name)) return false;
        // A prototype has no lines to run: the function is fuzzed at its definition.
        if (!clean(t.path, source).split('\n').slice(t.line - 1, t.endLine).join('\n').includes('{')) return false;
        const isHeader = HEADER.test(t.path);
        const scopes = scopesAt(clean(t.path, source), offsetOfLine(source, t.line));
        if (scopes.some((s) => s.kind === 'block' || (s.kind === 'namespace' && s.name === ''))) return false;
        const cls = scopes.filter((s) => s.kind === 'class').at(-1);
        if (cls) return cls.access === 'public';
        if (/^\s*(?:template\s*<[^>]*>\s*)?static\b/.test(t.header)) return isHeader;
        if (m) {
          // A method defined outside its class: public when its class declares it in a public section.
          for (const [h, text] of headers) {
            const ct = clean(h, text);
            for (const d of ct.matchAll(new RegExp(`\\b${name.replace(/[^\w~]/g, '')}\\s*\\(`, 'g'))) {
              const owner = scopesAt(ct, d.index!).filter((s) => s.kind === 'class').at(-1);
              if (owner?.name === m[1]) return owner.access === 'public';
            }
          }
          return true;
        }
        // A C function in a source file is public when a project header declares it, and the built libraries define it: one
        // a configuration turns into a macro over the system's own (c-ares's ares_inet_net_pton) has no symbol to link.
        if (!isHeader && symbols.size && !symbols.has(name)) return false;
        return isHeader || [...headers.values()].some((text) => new RegExp(`\\b${name.replace(/\W/g, '')}\\s*\\(`).test(text));
      },
      fuzz: cFuzz({ place, box, cpp, src, incs, libs, sys }),
      errorsAreValues: !cpp,
      rejections: cpp ? ['std::invalid_argument', 'std::out_of_range', 'std::length_error', 'std::domain_error', 'std::range_error', 'std::overflow_error', 'std::underflow_error', 'std::logic_error', 'std::runtime_error', 'std::system_error', 'std::ios_base::failure'] : [],
      environmental: (r) => /^(out-of-memory|rss-limit-exceeded|LinkError)$/.test(r.type ?? ''),
    };
    return rt;
  },
};

/**
 * Include flags, one argument each: the build's own -I folders and the -D/-U/-include configuration most of its compiles
 * share, every `include/` folder, the project's folder, its header folders for quoted includes, and the folders of headers
 * the build generated.
 */
function includes(compileCommands: string, headerFiles: string[], src: string, generated: string[]): string[] {
  const dirs: string[] = [];
  const shared = new Map<string, number>();
  let entries = 0;
  // Several databases, each a JSON array, one after another.
  for (const text of compileCommands.split(/\n(?=\[)/)) {
    try {
      for (const e of JSON.parse(text) as { directory: string; command?: string; arguments?: string[] }[]) {
        const args = e.arguments ?? (e.command ?? '').split(/\s+/);
        entries++;
        const config = new Set<string>();
        args.forEach((a, i) => {
          const v = a === '-I' || a === '-isystem' ? args[i + 1] : /^-I(.+)/.exec(a)?.[1];
          if (v) dirs.push(v.startsWith('/') ? v : `${e.directory}/${v}`);
          if (a === '-D' || a === '-U') config.add(`${a}${args[i + 1]}`);
          else if (/^-[DU]./.test(a)) config.add(a);
          else if (a === '-include') { const h = args[i + 1] ?? ''; config.add(`-include\0${h.startsWith('/') ? h : `${e.directory}/${h}`}`); }
        });
        for (const c of config) shared.set(c, (shared.get(c) ?? 0) + 1);
      }
    } catch {}
  }
  // OSS-Fuzz's own define is in $CFLAGS already. A release build's NDEBUG is kept: headers differ with it (ClickHouse's PODArray
  // calls a debug-only function), and the target's own assert()s are compiled to always check (ALWAYS_ASSERT).
  const config = [...shared].filter(([c, n]) => n * 2 >= entries && !/^-DFUZZING_BUILD_MODE/.test(c)).flatMap(([c]) => c.split('\0'));
  const hdirs = [...new Set(headerFiles.map((h) => h.replace(/\/?[^/]+$/, '')))];
  // Without a compile database, every `include/` folder; with one, its folders are the build's own, and a checkout with its
  // submodules (ClickHouse's contrib/) holds include folders of other systems (FreeBSD's sysroot) no compile uses.
  if (!entries) for (const h of headerFiles) { const m = /^(.*\/)?include\//.exec(h); if (m) dirs.push(`${src}/${m[0].slice(0, -1)}`); }
  // Quoted includes only for the rest: a project file named like a standard header must not shadow it.
  const quoted = [src, ...hdirs.map((h) => (h ? `${src}/${h}` : src))];
  return [
    ...config,
    ...[...new Set(dirs.map((d) => posix.normalize(d)))].flatMap((d) => ['-I', d]),
    '-I', src,
    ...[...new Set(quoted)].flatMap((d) => ['-iquote', d]),
    ...generated.flatMap((d) => ['-iquote', d, '-I', d]),
  ];
}

/**
 * The language flags the build compiles the project's own sources with, for targets to compile alike: the standard
 * (ClickHouse is C++23) and, for a project that brings its own C++ standard library (ClickHouse's libc++ in contrib),
 * `-nostdinc++`, whose headers then come from the build's include folders and whose archives link with the rest.
 */
function languageFlags(compileCommands: string, cpp: boolean): string[] {
  const std = new Map<string, number>();
  const system = new Map<string, number>();
  let own = 0, entries = 0;
  for (const text of compileCommands.split(/\n(?=\[)/)) {
    try {
      for (const e of JSON.parse(text) as { file: string; directory: string; command?: string; arguments?: string[] }[]) {
        if (/\.(cc|cpp|cxx|c\+\+)$/i.test(e.file) !== cpp) continue;
        const args = e.arguments ?? (e.command ?? '').split(/\s+/);
        entries++;
        const v = args.find((a) => a.startsWith('-std='));
        if (v) std.set(v, (std.get(v) ?? 0) + 1);
        // The target and system root a cross-compiling build names (ClickHouse's --sysroot=contrib/sysroot/linux-aarch64…).
        for (const a of args) {
          if (!/^--(target|sysroot)=/.test(a)) continue;
          const k = a.startsWith('--sysroot=') && !a.slice(10).startsWith('/') ? `--sysroot=${posix.normalize(`${e.directory}/${a.slice(10)}`)}` : a;
          system.set(k, (system.get(k) ?? 0) + 1);
        }
        if (args.includes('-nostdinc++')) own++;
      }
    } catch {}
  }
  const top = [...std].sort((a, b) => b[1] - a[1])[0];
  const shared = [...system].filter(([, n]) => n * 2 > entries).map(([a]) => a);
  return [...(top && top[1] * 2 >= entries ? [top[0]] : []), ...(cpp && own * 2 > entries ? ['-nostdinc++'] : []), ...shared];
}

/** Prints a sample of compile databases as one database: up to 300 entries, the project's own sources before vendored ones, each
 * with only its include, define, standard, target and system-root flags. */
const SAMPLE_DATABASE = String.raw`
import json, random, re, sys, shlex
keep = re.compile(r'^(-I|-isystem|-iquote|-D|-U|-include|-std=|--target=|--sysroot=|-nostdinc\+\+$|-nostdlib\+\+$)')
takes = {'-I', '-isystem', '-iquote', '-D', '-U', '-include'}
entries = []
for f in sys.argv[1:]:
    try: entries += json.load(open(f))
    except Exception: pass
vendored = re.compile(r'/(contrib|third[_-]?party|vendor|external|deps|_deps)/')
own = [e for e in entries if not vendored.search(e.get('file', ''))]
random.seed(0)
pick = random.sample(own, min(300, len(own))) or random.sample(entries, min(300, len(entries)))
out = []
for e in pick:
    a = e.get('arguments') or shlex.split(e.get('command', ''))
    r, i = [a[0]] if a else [], 1
    while i < len(a):
        x = a[i]
        if x in takes and i + 1 < len(a): r += [x, a[i + 1]]; i += 2; continue
        if keep.match(x): r.append(x)
        i += 1
    out.append({'directory': e.get('directory', ''), 'file': e.get('file', ''), 'arguments': r})
print(json.dumps(out))
`;

/** An assert() that checks under NDEBUG, failing the way glibc's does, so a target's assertion reads as one either way. */
const ALWAYS_ASSERT = `/* No system header here: this is included before the target's own lines, and one included now would fix the feature macros
 * before a target's #define _GNU_SOURCE (PHP's headers need memrchr). glibc declares __assert_fail only without NDEBUG. */
#ifdef __cplusplus
extern "C" void __assert_fail(const char *, const char *, unsigned int, const char *) noexcept __attribute__((__noreturn__));
#else
extern void __assert_fail(const char *, const char *, unsigned int, const char *) __attribute__((__noreturn__));
#endif
#define REFUZZ_ASSERT(c) ((c) ? (void)0 : __assert_fail(#c, __FILE__, __LINE__, __func__))
`;

/** The -D, -U and -I flags a make build's top Makefile gives every compile (CPPFLAGS, DEFS, INCLUDES, EXTRA_INCLUDES). */
async function makefileFlags(box: Container, src: string): Promise<string[]> {
  const text = (await box.exec(`grep -hE '^(CPPFLAGS|DEFS|INCLUDES|EXTRA_INCLUDES|AM_CPPFLAGS)[[:space:]]*=' ${shq(src)}/Makefile 2>/dev/null`)).stdout;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const value = line.replace(/^[^=]*=/, '');
    for (const m of value.matchAll(/(?:^|\s)(-[DU]\S+|-I\s*\S+)/g)) {
      const flag = m[1].replace(/^-I\s*/, '-I');
      if (flag.startsWith('-I')) { const dir = flag.slice(2).replace(/^\$\((?:top_)?(?:src|build)dir\)\/?/, ''); if (!dir.includes('$(')) out.push('-I', dir.startsWith('/') ? dir : `${src}/${dir}`); }
      else if (!flag.includes('$(')) out.push(flag);
    }
  }
  return [...new Set(out.filter((x) => x !== '-I'))].flatMap((x) => (x.startsWith('/') ? ['-I', x] : [x]));
}

/** Splits the probe script's output into its sections. */
function sections(stdout: string): Map<string, string> {
  const out = new Map<string, string>();
  let key = '';
  for (const line of stdout.split('\n')) {
    const m = /^@@REFUZZ_(COMPILE|LINK|EXIT|OUT|ERR|COV)\b ?(.*)$/.exec(line);
    if (m) { key = m[1]; out.set(key, m[2] ?? ''); continue; }
    if (key) out.set(key, `${out.get(key)}\n${line}`);
  }
  return out;
}


/** A compiler's or linker's complaint, short: each error with the source line it points at. */
function diagnostics(text: string, src: string): string {
  const lines = local(text, src).split('\n');
  const keep: string[] = [];
  lines.forEach((l, i) => {
    if (/error|undefined reference|fatal|ld: /.test(l)) keep.push(l, ...lines.slice(i + 1, i + 3).filter((x) => !/error|warning|note:/.test(x)));
  });
  return (keep.length ? keep : lines).join('\n').trim().slice(0, 1500);
}

/** Sanitizer stack lines: `#3 0x55d0 in parse_value /src/cjson/cJSON.c:812:9`. Only the first stack, the failure's own. */
function firstStack(err: string): { name: string; file?: string; line?: number }[] {
  const out: { name: string; file?: string; line?: number }[] = [];
  let started = false;
  for (const l of err.split('\n')) {
    const m = /^\s*#(\d+)\s+0x[0-9a-f]+\s+in\s+(.+?)\s*$/.exec(l);
    if (!m) { if (started && l.trim() === '') break; continue; }
    if (m[1] === '0' && started) break;
    started = true;
    const loc = /^(.*?)\s+(\/\S+?|harness):(\d+)(?::\d+)?$/.exec(m[2]);
    out.push(loc ? { name: loc[1], file: loc[2], line: Number(loc[3]) } : { name: m[2].replace(/\s+\(.*\)$/, '') });
  }
  return out;
}

/**
 * Where a frame's file is: the project's sources, the code the writer wrote (a fuzz target, in a session's folder), or the
 * rest of what refuzz put in its folder (the session driver).
 */
const fileOf = (file: string | undefined, src: string): 'project' | 'harness' | 'driver' | undefined =>
  !file ? undefined : file.startsWith(`${src}/`) ? 'project' : file === 'harness' || file.endsWith('/harness') || file.startsWith(TARGETS) ? 'harness' : file.startsWith(`${REFUZZ}/`) ? 'driver' : undefined;

/**
 * Whether the memory a sanitizer report's bad access hit is the harness's, and which object it is. ASan names the owner after
 * the stack: a local of a stack frame (`is located in stack of thread T0 … in frame #0 … fuzz harness:4` and the frame's
 * objects, the overflowed one marked `<==`), a global and the file defining it, or a heap block and the stack that allocated
 * (and, after a use after free, freed) it. A local or global of the harness or of refuzz's driver, a block the harness's own
 * lines allocated, or one they freed before the project used it, is memory the harness built: the project was handed a
 * buffer smaller than the one it reads (a header struct for a whole packet, a length read from one value and the bytes from
 * another), which is the harness's mistake.
 * Two exceptions keep real overflows findings. The driver's heap copies of the input are allocated at exactly the input's
 * size so that a read past them is the project's to answer for. And a harness object whose size the harness tells the project
 * (`sizeof(name)`, the size as a number, or a variable the allocation was sized by and the harness passes on) has bounds
 * the project knew: reading past them is the project's bug.
 */
export function harnessMemory(err: string, src: string, source?: string): string | undefined {
  const code = (source ?? '').split('\n');
  const told = (name: string | undefined, size: number | undefined, allocLine?: number) => {
    if (!source) return false;
    // The object's own declaration (`char satn[5]`) tells the target nothing about its size: only the other lines count.
    const declares = name && size ? new RegExp(`\\b${name.replace(/\W/g, '')}\\s*\\[\\s*${size}\\s*\\]`) : null;
    const rest = declares ? code.filter((l) => !declares.test(l)) : code;
    // `sizeof(name)` handed on, not only used to clear or copy the object itself (memset(&h, 0, sizeof(h))).
    const sized = name && new RegExp(`\\bsizeof\\s*\\(?\\s*${name.replace(/\W/g, '')}\\b`);
    if (sized && rest.some((l) => sized.test(l.replace(/\b\w*(?:mem(?:set|cpy|move|cmp)|bzero)\w*\s*\([^;]*/g, '')))) return true;
    if (size && size > 1 && rest.some((l) => new RegExp(`(?<![\\w.])${size}(?:[uUlL]{0,3})(?![\\w.])`).test(l))) return true;
    // A block sized by a variable that the harness uses again (passes as the length, stores as a capacity): the bounds were told.
    const at = allocLine ? code[allocLine - 1] ?? '' : '';
    const sizedBy = /\b\w*(?:alloc|new)\w*\s*\(([^;]*)\)/.exec(at)?.[1] ?? '';
    const vars = (sizedBy.match(/[A-Za-z_]\w*/g) ?? []).filter((v) => !/^(sizeof|const|struct|unsigned|signed|char|int|long|short)$|_t$/.test(v));
    return vars.some((v) => code.some((l, i) => i !== allocLine! - 1 && new RegExp(`\\b${v}\\b`).test(l)));
  };
  const where = (f: { name: string; file?: string; line?: number }) => `${f.name} at ${f.file!.replace(/^.*\//, '')}:${f.line}`;

  const stack = /Address 0x[0-9a-f]+ is located in stack of thread \w+(?: at offset \d+)? in frame\s*\n/.exec(err);
  if (stack) {
    const frame = firstStack(err.slice(stack.index + stack[0].length))[0];
    const owner = fileOf(frame?.file, src);
    if (!frame || (owner !== 'harness' && owner !== 'driver')) return undefined;
    const objects = [...err.slice(stack.index).matchAll(/^\s*\[(\d+), (\d+)\) '([^']+)'(?: \(line (\d+)\))?([^\n]*)$/gm)];
    const hit = objects.find((o) => /<==/.test(o[5])) ?? (objects.length === 1 ? objects[0] : undefined);
    // The compiler's suffixes on a local it inlined or split (`buf.i`, `b.sroa.0`) are not in the harness's source.
    const name = hit?.[3].split('.')[0], size = hit ? Number(hit[2]) - Number(hit[1]) : undefined;
    // A probe's harness lines are the body of the driver's main(), whose frame is named by main's own line: told either way.
    if (told(name, size)) return undefined;
    return `${name ? `'${name}', ${size} bytes${hit![4] ? ` declared on line ${hit![4]}` : ''}, a local` : 'a local'} of ${where(frame)}`;
  }
  const global = /is located \d+ bytes (?:after|before|inside of|to the left of|to the right of) global variable '([^']+)' defined in '([^':]+):(\d+)(?::\d+)?'(?: \(0x[0-9a-f]+\))? of size (\d+)/.exec(err);
  if (global) {
    const owner = fileOf(global[2], src);
    if (owner === 'driver') return `the driver's ${global[4]}-byte '${global[1]}' (${global[2].replace(/^.*\//, '')}:${global[3]}), passed as a buffer`;
    // A static local is named for its function (`fuzz.buf`).
    if (owner !== 'harness' || told(global[1].split('.').at(-1), Number(global[4]))) return undefined;
    return `the harness's global '${global[1]}', ${global[4]} bytes, on line ${global[3]}`;
  }
  const region = /is located \d+ bytes (?:after|before|inside of|to the left of|to the right of) (\d+)-byte region/.exec(err);
  if (!region) return undefined;
  // The first frame that is the project's, the target's or refuzz's: the allocator and libc frames above it are not anyone's decision.
  const firstOwn = (label: RegExp) => {
    const m = label.exec(err);
    return m ? firstStack(err.slice(m.index + m[0].length)).find((f) => fileOf(f.file, src)) : undefined;
  };
  const freed = firstOwn(/\nfreed by thread \w+ here:\s*\n/);
  if (freed) return fileOf(freed.file, src) === 'harness' ? `a ${region[1]}-byte block the harness freed in ${where(freed)} before the project used it` : undefined;
  const made = firstOwn(/\nallocated by thread \w+ here:\s*\n/);
  if (!made || fileOf(made.file, src) !== 'harness' || told(undefined, Number(region[1]), made.line)) return undefined;
  return `a ${region[1]}-byte block allocated in ${where(made)}`;
}

/**
 * A failed run from what it printed: a sanitizer report, an assertion, an uncaught C++ exception, a signal or an exit status.
 * `source` is the probe or fuzz target that ran, `target` says it is a fuzz target: then a failed assert() of the target's own,
 * or an abort() or __builtin_trap() it calls itself, is a property it states that the project broke, an assertion. Anything
 * else failing in the target's lines is the target's mistake.
 */
export function crashOf(err: string, code: number, src: string, source?: string, target = false): Report {
  const stack = firstStack(err);
  // The failure is the harness's when the innermost frame that is either the project's or the harness's is the harness's
  // (its file, a fuzz target's, or anything else refuzz put in its folder: the session driver).
  const first = stack.find((f) => fileOf(f.file, src));
  const frames: Frame[] = stack.filter((f) => fileOf(f.file, src) === 'project').map((f) => ({ path: posix.normalize(f.file!.slice(src.length + 1)), line: f.line!, name: f.name.replace(/\(.*\)(\s*const)?$/, '') })).reverse();
  const origin: Report['origin'] = first ? (fileOf(first.file, src) === 'project' ? 'library' : 'setup') : frames.length ? 'library' : 'setup';
  const tidy = (x: string) => local(x.replace(/^==\d+==\s*/gm, '').replace(/\s*\(BuildId: [0-9a-f]+\)/g, ''), src).trim();

  const thrown = /terminate called after throwing an instance of '([^']+)'(?:\s*\n\s*what\(\):\s*(.*))?/.exec(err);
  if (thrown) return { status: 'error', origin, type: thrown[1], message: tidy(thrown[2] ?? ''), frames, native: false };
  const asan = /ERROR: AddressSanitizer: (?:attempting )?([\w-]+)[^\n]*/.exec(err);
  const ubsan = /runtime error: ([^\n]*)/.exec(err);
  const ubKind = /SUMMARY: UndefinedBehaviorSanitizer: ([\w-]+)/.exec(err);
  // glibc's `prog: file:line: function: Assertion `cond' failed.`
  const assertion = /(?:^|\s)(\S+?):(\d+): [^\n]*?Assertion `([\s\S]*?)' failed[^\n]*/.exec(err);
  const fuzzer = /ERROR: libFuzzer: ([\w-]+)[^\n]*/.exec(err);
  if (assertion && target && fileOf(assertion[1], src) === 'harness') return { status: 'error', origin: 'assertion', type: 'assertion', message: assertion[3].trim(), frames, native: true };
  if (assertion) return { status: 'error', origin, type: 'assertion', message: tidy(assertion[0]), frames, native: true };
  // exit() in the middle of an input, reported by the driver with what the process printed before it: the project's own way
  // of giving up (PHP's fatal error outside a request), or the target's. Not memory unsafety; the target must not get there.
  const exited = /refuzz: the process called exit\((-?\d+)\)/.exec(err);
  if (exited && !asan && !ubsan) return { status: 'error', origin: 'setup', type: 'Exit', message: `the process called exit(${exited[1]}) during the input: set the project up so it reports errors the way its callers expect (inside its request, transaction or error-recovery scope, as its own SAPI or tests do) instead of exiting\n${tidy(err.slice(0, exited.index)).slice(-600)}`, frames };
  // An exception that escaped the target: std::terminate aborts, through __cxa_throw, with no message when the C++ library
  // terminates silently (ClickHouse's libc++abi). The project threw what it documents; the target did not catch it.
  if (!thrown && /\b(?:__cxa_throw|__cxa_rethrow|std::__terminate|std::terminate|__clang_call_terminate|__cxa_call_terminate)\b/.test(err) && (asan?.[1] === 'ABRT' || code - 128 === 6))
    return { status: 'error', origin: 'setup', type: 'UncaughtException', message: 'an exception the project threw escaped the target uncaught and terminated the process: catch the exceptions the called function documents for invalid input (the project\'s own exception type) and return 0', frames };
  // The target stops the process itself on a line of its own: what that line says is the property.
  const stopped = (asan && /^(ABRT|ILL|TRAP)$/.test(asan[1])) || [4, 5, 6].includes(code - 128) || /deadly signal/.test(fuzzer?.[0] ?? '');
  const said = target && stopped && first && fileOf(first.file, src) === 'harness' ? (source ?? '').split('\n')[first.line! - 1]?.trim() : undefined;
  if (said && /\b(?:abort|__builtin_trap|__builtin_unreachable)\s*\(/.test(said)) return { status: 'error', origin: 'assertion', type: 'assertion', message: said, frames, native: true };
  // Memory the harness built, overflowed: the harness's mistake, sent back to the writer and never judged.
  const owned = asan || ubsan ? harnessMemory(err, src, source) : undefined;
  if (owned) return { status: 'error', origin: 'setup', type: asan?.[1] ?? 'undefined-behavior', message: `the crash is in memory your code owns (${owned}): build that argument the way the project does, at the full size the target reads\n${tidy(asan?.[0] ?? ubsan![0])}`, frames, native: true };
  if (asan) return { status: 'error', origin, type: asan[1], message: tidy(`${asan[0]}\n${/SUMMARY: [^\n]*/.exec(err)?.[0] ?? ''}`), frames, native: true };
  if (ubsan) return { status: 'error', origin, type: ubKind && ubKind[1] !== 'undefined-behavior' ? ubKind[1] : 'undefined-behavior', message: tidy(ubsan[1]), frames, native: true };
  // libFuzzer's own account of an exit() during the input, in its native runs.
  if (fuzzer && /fuzz target exited/.test(fuzzer[0])) return { status: 'error', origin: 'setup', type: 'Exit', message: `the process called exit() during the input: set the project up so it reports errors the way its callers expect (inside its request, transaction or error-recovery scope, as its own SAPI or tests do) instead of exiting\n${tidy(err).slice(-600)}`, frames };
  if (fuzzer?.[1] === 'timeout') return { status: 'timeout', origin: 'library', type: 'Timeout', message: tidy(fuzzer[0]), frames };
  if (fuzzer) return { status: 'error', origin: frames.length ? 'library' : origin, type: fuzzer[1], message: tidy(fuzzer[0]), frames, native: true };
  if (code > 128) return { status: 'error', origin: frames.length ? 'library' : origin, type: exitSignal[code - 128] ?? `signal ${code - 128}`, message: tidy(err.slice(-400)), frames, native: true };
  // The program called exit() with a failure status: no crash, and nothing to blame on a line. A program's own main rejecting
  // its input does this (ClickHouse's obfuscator); it is the target's choice of what to call, sent back to the writer.
  return { status: 'error', origin: 'setup', type: 'Exit', message: `the process called exit(${code}), which a fuzz target never reaches the code through: call the library functions the program runs, not a program's main or anything that exits${err.trim() ? `\n${tidy(err).slice(-300)}` : ''}`, frames };
}

/**
 * Fuzz targets: libFuzzer files, LLVMFuzzerTestOneInput, compiled as they are in a session's folder under /tmp/refuzz. A session
 * links each with refuzz's line-protocol driver (src/probes/c_fuzz.h, compiled once as C) and keeps it running; native() links
 * the same file with libFuzzer instead. Both link the build's static libraries, `libs`, with the include flags `incs`.
 */
function cFuzz(o: { place: Place; box: Container; cpp: boolean; src: string; incs: string[]; libs: string[]; sys: string[] }): FuzzRuntime {
  const { place, box, cpp, src } = o;
  const ext = cpp ? 'cpp' : 'c';
  const compiler = cpp ? 'clang++ -std=gnu++17' : 'clang';
  const incs = o.incs.map(shq).join(' ');
  const link = o.libs.length ? `-Wl,--start-group ${o.libs.map(shq).join(' ')} -Wl,--end-group` : '';
  // Coverage in the target too: a decomposition's part #includes the source of a static function it calls, which is then
  // compiled here, not in the project's instrumented libraries; without counters no input is seen to reach it.
  const sanitizers = (native: boolean) => (native ? '-fsanitize=fuzzer,address,undefined' : '-fsanitize=fuzzer-no-link,address,undefined');
  /** A target's compile flags (before the include flags) and its link flags (after the libraries). */
  const compileFlags = (native: boolean) => `-g -O1 -fno-omit-frame-pointer ${sanitizers(native)} -fno-sanitize-recover=all -w -ferror-limit=4 -fno-color-diagnostics`;
  // lld: a project of a few hundred archives (ClickHouse) links in seconds rather than minutes. A project with its own C++
  // standard library (libc++ in std::__1) links beside the system's, which libFuzzer itself uses: the names do not meet.
  // Debug sections compressed: a target linked with ClickHouse's libraries is 4 GB, most of it debug information it keeps for
  // its stack lines; compressed, a quarter of that.
  const linkFlags = (native: boolean) => `-fuse-ld=lld ${sanitizers(native)} ${o.sys.join(' ')} -lm -lpthread -ldl`;
  /** The driver's object, compiled on first use. */
  let driver: Promise<string | undefined> | undefined;
  const driverObject = () => (driver ??= box.exec(`clang -x c -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined -w -c ${REFUZZ}/c_fuzz.h -o ${REFUZZ}/c_fuzz.o 2>&1 && clang -x c -DREFUZZ_MULTI -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined -w -c ${REFUZZ}/c_fuzz.h -o ${REFUZZ}/c_fuzz_multi.o 2>&1`).then((r) => (r.code === 0 ? undefined : `the session driver did not compile: ${r.stdout.slice(-600)}`)));
  /** Compiles and links one target in `dir` as `out`, by absolute path so its frames are known as the target's; the compiler's complaint when it does not build. */
  /**
   * Compiles one target to `<name>.o` in `dir`. `renamed`: its entry points become refuzz_run_<name> and refuzz_init_<name>, and
   * every other strong global it defines is made local, so several targets link into one binary (a helper two targets both
   * define does not clash; the inline and template code they share from the project's headers stays shared).
   */
  const compile = async (dir: string, name: string, code: string, native: boolean, renamed: boolean): Promise<string | undefined> => {
    // Under the build's NDEBUG the target's assert()s still check, reported as glibc's assert reports them.
    const release = o.incs.includes('-DNDEBUG');
    await place.put(dir, { [`${name}.${ext}`]: release ? code.replace(/(?<![\w$])assert\s*\(/g, 'REFUZZ_ASSERT(') : code });
    const rename = renamed ? ` -DLLVMFuzzerTestOneInput=refuzz_run_${name} -DLLVMFuzzerInitialize=refuzz_init_${name}` : '';
    const c = await box.exec(`cd ${dir}
if ! ${compiler} ${compileFlags(native)} ${incs}${release ? ` -include ${REFUZZ}/refuzz_assert.h` : ''}${rename} -c ${dir}/${name}.${ext} -o ${name}.o 2> ${name}.cc; then echo @@REFUZZ_COMPILE; head -c 6000 ${name}.cc; exit 0; fi
${renamed ? `nm --defined-only -g ${name}.o 2>/dev/null | awk '$2 ~ /^[TDBRS]$/ {print $3}' | grep -vE '^refuzz_(run|init)_' > ${name}.loc; [ -s ${name}.loc ] && llvm-objcopy --localize-symbols=${name}.loc ${name}.o` : ''}
echo @@REFUZZ_OUT`, { timeoutMs: 300_000 });
    const compiled = sections(c.stdout);
    if (compiled.has('COMPILE')) return diagnostics(compiled.get('COMPILE')!, src);
    if (!compiled.has('OUT')) return `the compile did not finish: ${c.stderr.slice(-400)}`;
  };
  /**
   * Links objects in `dir` with the project's libraries as `out`, one link at a time, each after checking there is room for
   * it: a target of a big project is gigabytes, and twenty linked at once each saw the space the others were about to take.
   */
  const linkObjects = (dir: string, objects: string[], native: boolean, out: string): Promise<string | undefined> =>
    (linking = linking.catch(() => undefined).then(async () => {
      const free = await freeGB(dir);
      if (free - lastLinkGB < MIN_FREE_GB) return `${free} GB free, and a target here is about ${lastLinkGB} GB: under the ${MIN_FREE_GB} GB kept free, no more targets are linked this run`;
      const r = await box.exec(`cd ${dir}
if ! clang++ ${objects.map(shq).join(' ')} ${link} ${linkFlags(native)} -o ${out} 2> ${out}.ld; then rm -f ${out}; echo @@REFUZZ_LINK; head -c 6000 ${out}.ld; exit 0; fi
echo @@REFUZZ_OUT $(stat -c %s ${out} 2>/dev/null || echo 0)`, { timeoutMs: 600_000 });
      const s = sections(r.stdout);
      if (s.has('LINK')) return diagnostics(s.get('LINK')!, src);
      if (!s.has('OUT')) return `the build did not finish: ${r.stderr.slice(-400)}`;
      lastLinkGB = Math.max(lastLinkGB, Math.ceil(Number(s.get('OUT')!.trim().split(/\s/)[0] || 0) / 2 ** 30));
      return undefined;
    }));
  /** One target, compiled and linked on its own as `out`: a native (libFuzzer) binary. */
  const build = async (dir: string, name: string, code: string, native: boolean, out: string): Promise<string | undefined> => {
    const failed = await compile(dir, name, code, native, false);
    if (failed) return failed;
    const linked = await linkObjects(dir, [`${name}.o`, ...(native ? [] : [`${REFUZZ}/c_fuzz.o`])], native, out);
    await box.exec(`rm -f ${dir}/${name}.o`);
    return linked;
  };
  /**
   * In-process targets linked into one binary with the session driver, which runs the one its third argument names: one link
   * of the project's libraries for the batch, not one per target (each is seconds and gigabytes for a big project). When the
   * batch does not link, each target is linked alone, so one target's link error does not cost the others theirs.
   */
  const linkBatch = async (dir: string, names: string[]): Promise<Map<string, string>> => {
    const table = (list: string[]) => [
      '#include <stddef.h>', '#include <stdint.h>',
      ...list.flatMap((n) => [`int refuzz_run_${n}(const uint8_t *, size_t);`, `__attribute__((weak)) int refuzz_init_${n}(int *, char ***);`]),
      'struct refuzz_target { const char *name; int (*run)(const uint8_t *, size_t); int (*init)(int *, char ***); };',
      `const struct refuzz_target refuzz_targets[] = { ${list.map((n) => `{ "${n}", refuzz_run_${n}, refuzz_init_${n} }`).join(', ')}, { 0, 0, 0 } };`,
    ].join('\n');
    const at = new Map<string, string>();
    const attempt = async (list: string[], tag: string) => {
      await place.put(dir, { [`${tag}_table.c`]: `${table(list)}\n` });
      const t = await box.exec(`cd ${dir} && clang -c ${tag}_table.c -o ${tag}_table.o 2>&1`);
      if (t.code !== 0) return `the target table did not compile: ${t.stdout.slice(-300)}`;
      const failed = await linkObjects(dir, [...list.map((n) => `${n}.o`), `${tag}_table.o`, `${REFUZZ}/c_fuzz_multi.o`], false, `${tag}.bin`);
      if (!failed) for (const n of list) at.set(n, `${dir}/${tag}.bin`);
      return failed;
    };
    const failedAll = names.length > 1 ? await attempt(names, 'batch') : 'one target';
    if (failedAll) for (const n of names) { const e = await attempt([n], n); if (e) at.set(n, `\0${e}`); }
    await box.exec(`cd ${dir} && rm -f ${names.map((n) => `${n}.o`).join(' ')} *_table.o`);
    return at;
  };
  /** Links in order, one at a time; and the size of the largest target linked so far, in GB. */
  let linking: Promise<string | undefined> = Promise.resolve(undefined);
  let lastLinkGB = 0;
  /** Free space where the binaries go: the disk under box.scratch, mounted at /tmp/refuzz, else the container's own. */
  const freeGB = async (dir: string) => {
    const at = box.scratch ?? '/';
    const host = (() => { try { const f = statfsSync(at); return Math.floor((f.bavail * f.bsize) / 2 ** 30); } catch { return Infinity; } })();
    if (box.scratch) return host;
    // Docker Desktop's virtual disk can claim more than the machine under it has left: the smaller of the two.
    const inside = Number((await box.exec(`df -P -B1G ${shq(dir)} | awk 'NR==2{print $4}'`)).stdout.trim());
    return Math.min(Number.isFinite(inside) ? inside : Infinity, host);
  };
  /** A path the driver reported, relative to the project's folder, without the `..` a build folder's compile leaves in it. */
  const tidyLines = (r: InputReport): InputReport => (r.lines ? { ...r, lines: r.lines.map(([p, l]) => [posix.normalize(p), l] as [string, number]).filter(([p]) => !p.startsWith('../')) } : r);

  return {
    guide: [
      cpp
        ? 'A C++ libFuzzer target (the standard the project builds with, C++17 at least), the file a project adds to OSS-Fuzz: `#include` lines for the standard headers it uses and the project\'s headers by the paths shown for the target (`using namespace …;` if wanted), then `extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) { …; return 0; }`, called once per input with the raw bytes. No main; `extern "C" int LLVMFuzzerInitialize(int *argc, char ***argv)` may do one-time setup. Helper functions, types and globals of its own go in an anonymous namespace.'
        : 'A C libFuzzer target, the file a project adds to OSS-Fuzz: `#include` lines for the standard headers it uses (stdint.h, stddef.h, stdlib.h, string.h, assert.h) and the project\'s headers by the paths shown for the target, then `int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) { …; return 0; }`, called once per input with the raw bytes. No main; `int LLVMFuzzerInitialize(int *argc, char ***argv)` may do one-time setup.',
      'A function its file declares static (not importable) is reached by #including that source file in the target, so the function is defined in it; only for such a function: a source file whose functions the target can call (public, linked from the build) is never #included, since a second copy of its globals (a module\'s registry, a hash table it set up) is not the one the project initialised. It is called with any bytes and any size, 0 included, and data is not NUL-terminated. A buffer handed to the project with its length is copied into one byte more, zero-terminated, as the project\'s own strings are (a PHP zend_string, a std::string), so the project may read the terminator as it does from every real caller. Whatever the project keeps a pointer to (an argv array, a string stored in a global or a request) lives as long as the project uses it: static or heap storage, never a local of LLVMFuzzerInitialize or of the call. A function that runs inside a request, session or transaction is called inside one, started and ended the way the project\'s own callers do (its SAPI, its tests). Each input starts from the state the project starts such a call in: whatever an input leaves behind (a pending exception or error, a global or option it set, an open handle) is cleared or undone before the target returns, as the project does between requests.',
      cpp
        ? 'Split the bytes into the target\'s arguments with `#include <fuzzer/FuzzedDataProvider.h>`: `FuzzedDataProvider fdp(data, size);` then `fdp.ConsumeIntegralInRange<int>(0, 3)`, `fdp.ConsumeBool()`, `fdp.ConsumeRandomLengthString(4096)`, `fdp.ConsumeBytes<uint8_t>(n)`, `fdp.PickValueInArray(kinds)`, and the text or bytes the target parses last with `fdp.ConsumeRemainingBytesAsString()` or `ConsumeRemainingBytes<uint8_t>()`.'
        : 'Split the bytes into the target\'s arguments by hand, checking the length before every read: `if (size < 1) return 0; int mode = data[0] % 3; data++; size--;`, an integer with memcpy from data after the same check, and the text the target parses last as the rest of the bytes. A function that takes a C string gets a malloc\'d copy of size + 1 bytes, terminated, freed after.',
      'Build objects the way the project\'s own tests do, through its functions (`name_new`, `name_init`, `name_create`, with `name_footprint` and `name_align` for their memory) in the order the tests call them, never a zero-filled struct or a buffer cast to the type. A pointer the target reads a fixed amount from points at that whole amount (a full packet or record of its documented size, never a bare header struct), and a length passed with a buffer describes that buffer. Arguments only the program sets (an enum naming a mode or kind, a capacity, a size the caller computes) take values the project\'s callers pass; fuzz the data that arrives from outside.',
      'Check what each allocation and constructor returns and `return 0;` when one fails. Free or delete everything the target allocates on every path: it runs millions of times in one process. No printing, no exit.',
      cpp
        ? 'A documented error is the project\'s answer, not a failure: a returned error code or null is checked and the target returns 0, and only the exceptions the project documents for invalid input are caught (`catch (const std::invalid_argument &) { return 0; }`), never `catch (...)`. A project that reports bad input by throwing its own exception type (ClickHouse\'s DB::Exception, Poco::Exception) throws it from every reader on truncated or malformed bytes, reading past the end included: every call on fuzzed bytes is inside a try that catches that type and returns 0, and an assert in the catch says nothing about the exception\'s text (a Poco exception\'s what() is its class name; its message is message()). Assert only what the project\'s code or tests show it does, read from the function and its default settings, never what a name suggests.'
        : 'A documented error return (NULL, -1, an error code) is the project\'s answer, not a failure: check it and `return 0;`, never abort on it.',
      'State what the project promises for every input it accepts with assert() from <assert.h>, after the call, inside the branch where the promise holds, the promise in the condition\'s string: `assert(again != NULL && "what cJSON_Print printed parses again");`. A round trip (parse what it printed, decode what it encoded), a bound on a result\'s size or range, agreement with another function of the project that must agree. A failed assert is reported as a finding with its condition as the message; a crash in the project as the project\'s; a crash in the target\'s own lines or in memory it built as the target\'s mistake.',
    ].join(' '),
    async session(targets) {
      const dir = await place.folder('cfuzz');
      const errors: Record<string, string> = {};
      const drivers = new Map<string, { d: LineDriver; timeout: number }>();
      const binaries = new Map<string, string>();
      const make = (name: string, timeoutMs: number) => place.driver([binaries.get(name)!, String(timeoutMs), `${src}/`, name], { cwd: HARNESS_CWD, env: SAN_ENV });
      const broken = await driverObject();
      const compiled: string[] = [];
      await pool(Object.entries(targets), PARALLEL, async ([name, code]) => {
        if (!/^\w+$/.test(name)) { errors[name] = `${name} is not a name a file can take`; return; }
        const failed = broken ?? await compile(dir, name, code, false, true);
        if (failed) errors[name] = failed; else compiled.push(name);
      });
      for (const [name, bin] of await linkBatch(dir, compiled)) {
        if (bin.startsWith('\0')) errors[name] = bin.slice(1); else binaries.set(name, bin);
      }
      await pool([...binaries.keys()], PARALLEL, async (name) => {
        const d = make(name, 5_000);
        if (await d.start()) drivers.set(name, { d, timeout: 5_000 });
        else errors[name] = d.fatal ?? 'did not start';
      });
      return {
        errors,
        session: {
          async run(name, inputs, timeoutMs, deadline) {
            let h = drivers.get(name);
            if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: errors[name] ?? 'no such target' }));
            // The driver's timer is set when it starts; a different allowance needs a new process.
            if (h.timeout !== timeoutMs) { h.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
            return (await h.d.run(inputs, timeoutMs, deadline)).map((r) => tidyLines(died(r, src, targets[name])));
          },
          async native(name, corpus, dict, seconds) {
            const at = `${dir}.${name}`;
            const failed = errors[name] ?? (name in targets ? await build(at, name, targets[name], true, 'fuzzer') : 'no such target');
            if (failed) return { crashes: [], corpus, execs: 0, error: `the libFuzzer build failed: ${failed}` };
            await place.put(at, {
              ...Object.fromEntries((corpus.length ? corpus : [Buffer.from([0])]).map((b, i) => [`corpus/s${i}`, b])),
              'art/.keep': '',
              dict: dict.map((t) => `"${[...Buffer.from(t, 'utf8')].map((c) => (c === 34 || c === 92 ? `\\${String.fromCharCode(c)}` : c >= 32 && c < 127 ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, '0')}`)).join('')}"`).join('\n') + '\n',
            });
            const crashes: { input: Buffer; report: Report }[] = [];
            const seen = new Set<string>();
            let execs = 0;
            const end = Date.now() + seconds * 1000;
            // libFuzzer in fork mode, ignoring crashes, timeouts and out-of-memory: it keeps fuzzing past every failure it has
            // found, for the whole slot, and leaves each failing input in art/. Run plainly, it stops at its first crash, and a
            // shallow one found again at once after every restart ends native fuzzing for the slot.
            const left = Math.max(1, Math.round((end - Date.now()) / 1000));
            const r = await box.exec(`cd ${at} && rm -f art/crash-* art/leak-* art/timeout-* art/oom-* art/slow-unit-* && ./fuzzer -fork=1 -ignore_crashes=1 -ignore_timeouts=1 -ignore_ooms=1 -max_total_time=${left} -timeout=10 -rss_limit_mb=4096 -detect_leaks=0 -print_final_stats=1 -close_fd_mask=1 -dict=dict -artifact_prefix=art/ corpus 2>&1 | tail -c 80000`, { timeoutMs: (left + 120) * 1000, env: SAN_ENV });
            execs += Number(/stat::number_of_executed_units:\s*(\d+)/.exec(r.stdout)?.[1] ?? [...r.stdout.matchAll(/^#(\d+)[:\s]/gm)].at(-1)?.[1] ?? 0);
            // Each failing input run once more on its own, for the sanitizer's report of it.
            const arts = Object.entries(await place.get(`${at}/art`)).filter(([f, b]) => /(crash|timeout|oom|slow-unit)-/.test(f) && b.length).slice(0, 40);
            for (const [f, input] of arts) {
              const one = await box.exec(`cd ${at} && ./fuzzer -runs=1 -timeout=10 -rss_limit_mb=4096 -detect_leaks=0 -close_fd_mask=1 ${shq(`art/${f.replace(/^.*\//, '')}`)} 2>&1 | tail -c 40000`, { timeoutMs: 120_000, env: SAN_ENV });
              const report = crashOf(one.stdout, 1, src, targets[name], true);
              const key = `${report.type}|${report.frames?.at(-1)?.path}:${report.frames?.at(-1)?.line}`;
              if (!seen.has(key)) { seen.add(key); crashes.push({ input, report }); }
            }
            const grown = Object.entries(await place.get(`${at}/corpus`)).map(([, b]) => b);
            await place.remove(at);
            return { crashes, corpus: grown.length ? grown : corpus, execs, ...(execs || crashes.length ? {} : { error: r.stdout.split('\n').filter((l) => /ERROR|SUMMARY|error:|INFO: -fork|ABORT/.test(l)).slice(-6).join('\n') || r.stdout.slice(-600) }) };
          },
          release(name) {
            drivers.get(name)?.d.stop();
            drivers.delete(name);
            // A target out of the rotation is not run again: its binary, gigabytes for a big project, goes with it once no other
            // target of the batch runs from it.
            const bin = binaries.get(name);
            binaries.delete(name);
            if (bin && ![...binaries.values()].includes(bin)) void box.exec(`rm -f ${shq(bin)}`).catch(() => {});
          },
          async close() {
            for (const h of drivers.values()) h.d.stop();
            await box.exec(`rm -rf ${dir} ${dir}.*`);
          },
        },
      };
    },
    /**
     * The target as it is, <name>.c (or .cpp), compiled with OSS-Fuzz's $CC/$CXX and flags against the include folders a
     * session uses, and linked with the build's static libraries and $LIB_FUZZING_ENGINE into $OUT/<name>.
     */
    oss(name, source) {
      const file = `${name}.${ext}`;
      const arg = (t: string) => `"${t.replace(/["\\$`]/g, '\\$&').replace(/^\/src(?=\/|$)/, '$SRC').replace(/^\/work(?=\/|$)/, '$WORK')}"`;
      const libs = o.libs.length ? `-Wl,--start-group ${o.libs.map(arg).join(' ')} -Wl,--end-group` : '';
      return {
        file,
        source: source.endsWith('\n') ? source : `${source}\n`,
        compile: [
          `${cpp ? '$CXX $CXXFLAGS -std=gnu++17' : '$CC $CFLAGS'} ${o.incs.map(arg).join(' ')} -c $SRC/refuzz/${file} -o $WORK/${name}.o`,
          `$CXX $CXXFLAGS $WORK/${name}.o ${libs} $LIB_FUZZING_ENGINE ${o.sys.join(' ')} -lm -lpthread -ldl -o $OUT/${name}`,
        ],
      };
    },
  };
}

/** A session input that killed its process: the driver's death callback left the sanitizer's report on its last stderr line. */
export function died(r: InputReport, src: string, source?: string): InputReport {
  const m = /@@REFUZZ_CRASH (".*")\s*$/m.exec(r.message ?? '');
  if (r.status !== 'error' || !m) return r;
  let raw = '';
  try { raw = JSON.parse(m[1]); } catch { return r; }
  return { ...r, ...crashOf(raw, 1, src, source, true) };
}
