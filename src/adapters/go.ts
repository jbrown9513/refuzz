/**
 * Go: the project built and its modules downloaded by its OSS-Fuzz build spec (src/build.ts) in the base-builder-go image.
 * Fuzz targets are native Go fuzz tests (`func FuzzXxx(f *testing.F)`, what OSS-Fuzz builds with compile_native_go_fuzzer),
 * placed in the package under test in that container and run in-process under src/probes/go's driver, or under
 * go test -fuzz.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pool, shq } from '../run.ts';
import { containerPlace, type Place } from '../place.ts';
import type { Adapter, Built, FuzzRuntime, FuzzSession, InputReport, Report, Runtime, Target } from '../types.ts';

interface Module { dir: string; path: string; /** The go.mod language minor version (12 for `go 1.12`). `any` needs 18. */ go: number }

/** A package of the project: its import path, the name its package clause gives, and its directory in the repository. */
interface Pkg { path: string; name: string; dir: string; m: Module }

const SKIP_DIRS = /^(vendor|testdata|node_modules|third_party)$|^[._]/;

/** Every go.mod under the project, as its directory and module path. */
function modules(dir: string): Module[] {
  const out: Module[] = [];
  const walk = (d: string, depth: number) => {
    const mod = join(d, 'go.mod');
    if (existsSync(mod)) {
      const text = readFileSync(mod, 'utf8');
      const m = /^module\s+"?([^\s"]+)"?/m.exec(text);
      const ver = /^go\s+(\d+)(?:\.(\d+))?/m.exec(text);
      const go = ver ? (Number(ver[1]) > 1 ? 99 : Number(ver[2] ?? 0)) : 16;
      if (m) out.push({ dir: relative(dir, d), path: m[1], go });
    }
    if (depth >= 6) return;
    for (const e of readdirSync(d)) {
      if (SKIP_DIRS.test(e)) continue;
      const p = join(d, e);
      try { if (statSync(p).isDirectory()) walk(p, depth + 1); } catch {}
    }
  };
  walk(dir, 0);
  return out;
}

/** Modules of examples, tools and tests, which a fuzz target does not import and need not build. */
const AUXILIARY = /(^|\/)(_?examples?|testdata|tools|internal\/tools|hack|tests?|benchmarks?|fuzz)(\/|$)/;

/** The environment go commands run in once the network is cut: modules from the cache the build filled, nothing fetched. */
const OFFLINE = { GOFLAGS: '-mod=mod -buildvcs=false', GOPROXY: 'off' };

/** The module a repository path belongs to: the innermost go.mod above it. */
const moduleOf = (mods: Module[], path: string) => mods.filter((m) => m.dir === '' || path === m.dir || path.startsWith(`${m.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];

const packageName = (source: string) => /^package\s+(\w+)/m.exec(source)?.[1]?.replace(/_test$/, '') ?? '';

const importPath = (m: Module, path: string) => {
  const d = dirname(path) === '.' ? '' : dirname(path);
  const rest = m.dir ? d.slice(m.dir.length + 1) : d;
  return rest ? `${m.path}/${rest}` : m.path;
};

/** Import specs on target lines: `import "x"`, `import y "x"`, `import ("a"; "b")`, or a bare `"x"` from inside a group. */
function importSpecs(line: string): string[] {
  const body = line.trim().replace(/^import\b/, '').trim().replace(/^\(|\)$/g, '');
  return body.split(';').map((s) => s.trim()).filter((s) => /^(?:[\w.]+\s+)?"[^"]+"$/.test(s));
}

const isImport = (l: string) => /^\s*import\b/.test(l) || /^\s*(?:[\w.]+\s+)?"[^"\s]+"\s*;?\s*$/.test(l);

/**
 * The packages a target can import build, and every package's test dependencies resolve. Packages whose build fails are
 * named by `go build`'s `# path` headers; those and the packages depending on them are dropped and the rest built again.
 */
const READY = `pkgs=$(go list -f '{{if and (ne .Name "main") .GoFiles}}{{.ImportPath}}{{end}}' ./...) || exit 1
if ! out=$(go build $pkgs 2>&1); then
  bad=$(printf '%s\\n' "$out" | sed -n 's/^# //p' | sort -u)
  [ -n "$bad" ] || { printf '%s\\n' "$out" >&2; exit 1; }
  pkgs=$(go list -f '{{.ImportPath}} {{join .Deps " "}}' $pkgs | awk 'NR==FNR { bad[$1]; next } { for (i = 1; i <= NF; i++) if ($i in bad) next; print $1 }' <(printf '%s\\n' "$bad") -)
  go build $pkgs || exit 1
fi
go list -test -deps ./... > /dev/null`;

export const go: Adapter = {
  languages: ['go'],
  // Each module a target can import builds, and its packages' test dependencies resolve, offline: the build downloaded what
  // its go.mod requires.
  async ready(b) {
    const mods = modules(b.dir).filter((m) => !AUXILIARY.test(m.dir));
    if (!mods.length) return 'the project has no go.mod outside its examples and tools';
    // Usable when a module builds offline: prepare fuzzes the modules that list and leaves the others out, so a tool nested
    // in the repository with its own go.mod (an upgrader, a code generator) never holds the build back.
    const failed: string[] = [];
    for (const m of mods) {
      // The packages a target can import: not a main package, which is a command (and one with no main of its own, inngest's
      // tests/, fails `go build` even online), nor a folder of tests alone, which has nothing to build.
      // A package that does not build on this machine's architecture (gVisor's slimvm is amd64's alone, and the box may be
      // arm64) is left out, with whatever imports it, when the rest builds: no target can run it here anyway.
      const r = await b.box.exec(`bash -c ${shq(READY)}`, { cwd: join(b.src, m.dir), env: OFFLINE, timeoutMs: 1_800_000 });
      if (r.code === 0) return undefined;
      failed.push(`module ${m.path} (${m.dir || '.'}) does not build offline: ${(r.stderr || r.stdout).trim().split('\n').slice(-8).join('\n')}`);
    }
    return failed.join('\n\n');
  },
  async prepare(b, log) {
    const dir = b.dir;
    const mods = modules(dir);
    if (!mods.length) throw new Error('no go.mod in the project');
    const box = b.box;
    const place = containerPlace(box);
    const env = OFFLINE;
    const at = (m: Module) => join(b.src, m.dir);
    log(`  go: ${mods.map((m) => m.path).join(', ')} in ${b.src}`);

    const sources = new Map<string, string>();
    const read = (path: string) => {
      if (!sources.has(path)) sources.set(path, existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '');
      return sources.get(path)!;
    };
    // Each package's exported API in one line per name (`go doc -short`), read once: a method's target is shown how to make
    // its receiver, which is what a target most often gets wrong.
    const short = new Map<string, string>();
    // Every package of the project, where it is and what its package clause says: a fuzz target goes in the directory of the
    // package it names. A module whose packages do not list (its dependencies were not downloaded) has no targets.
    const pkgs: Pkg[] = [];
    const broken = new Set<string>();
    for (const m of mods) {
      const list = await box.exec(`go list -f '{{.ImportPath}}\t{{.Name}}\t{{.Dir}}' ./...`, { cwd: at(m), env, timeoutMs: 300_000 });
      if (list.code !== 0) {
        broken.add(m.dir);
        log(`  go: ${m.path} left out, its packages do not list: ${list.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
        continue;
      }
      for (const l of list.stdout.split('\n')) {
        const [path, name, d] = l.trim().split('\t');
        if (path && name && d?.startsWith(`${b.src}/`)) pkgs.push({ path, name, dir: d.slice(b.src.length + 1), m });
        else if (path && name && d === b.src) pkgs.push({ path, name, dir: '', m });
      }
      await pool(pkgs.filter((p) => p.m === m).map((p) => p.path).slice(0, 400), 8, async (pkg) => {
        const r = await box.exec(`go doc -short ${shq(pkg)} 2>/dev/null`, { cwd: at(m), env, timeoutMs: 60_000 });
        if (r.code === 0) short.set(pkg, r.stdout);
      });
    }
    const makers = (pkg: string, name: string, type: string) => {
      const lines = (short.get(pkg) ?? '').split('\n');
      const i0 = lines.findIndex((l) => new RegExp(`^type ${type}\\b`).test(l));
      if (i0 < 0) return [];
      const out: string[] = [];
      for (let i = i0 + 1; i < lines.length && /^ {4}func /.test(lines[i]); i++) out.push(`${name}.${lines[i].trim().replace(/^func /, '')}`);
      return out;
    };
    const importLine = (t: Target) => {
      const m = moduleOf(mods, t.path)!;
      const path = importPath(m, t.path), name = packageName(read(t.path));
      const line = path.split('/').at(-1) === name ? `import "${path}"` : `import ${name} "${path}"`;
      const parts = t.qualifiedName.split('.');
      const make = parts.length > 1 ? makers(path, name, parts[0]) : [];
      return make.length ? `${line}\n// a ${parts[0]} is made with ${make.slice(0, 4).join('; ')}` : line;
    };

    const docs = new Map<string, Promise<string>>();
    const doc = (what: string, cwd: string) => {
      // Compact: a package's constructors, types and functions;
      // a type's fields and methods.
      const type = /\.\w+$/.test(what.split('/').at(-1)!);
      if (!docs.has(what)) docs.set(what, box.exec(`go doc ${type ? '' : '-short '}${shq(what)} 2>&1`, { cwd, env, timeoutMs: 60_000 }).then((r) => {
        if (r.code !== 0) return '';
        const lines = r.stdout.split('\n');
        const items = type
          ? lines.filter((l) => /^\t\w+ /.test(l) || /^func /.test(l)).map((l) => l.trim().replace(/^func \([^)]*\) /, '.').replace(/^func /, ''))
          : [...lines.filter((l) => /^ {4}func /.test(l)), ...lines.filter((l) => /^type /.test(l)), ...lines.filter((l) => /^func /.test(l))].map((l) => l.trim().replace(/^func /, '').replace(/ (struct|interface)\{ \.\.\. \}$/, ' $1'));
        return items.join('; ').slice(0, 900);
      }));
      return docs.get(what)!;
    };
    /** A target that names something a package does not have is shown what it does have, as `go doc` prints it. */
    async function apiHint(code: string, msgs: string[], cwd: string): Promise<string> {
      const specs = code.split('\n').filter(isImport).flatMap(importSpecs);
      const pathOf = (q: string) => {
        for (const s of specs) {
          const [, alias, path] = /^(?:([\w.]+)\s+)?"(.+)"$/.exec(s)!;
          const parts = path.split('/');
          const last = /^v\d+$/.test(parts.at(-1)!) && parts.length > 1 ? parts.at(-2) : parts.at(-1);
          if ((alias ?? last) === q) return path;
        }
        return undefined;
      };
      const wanted = new Map<string, string>();
      for (const m of msgs) {
        const pkg = /undefined: (\w+)\.\w+/.exec(m);
        const type = /(?:type \*?|struct literal of type \*?)(\w+)\.(\w+)/.exec(m);
        if (type && pathOf(type[1])) wanted.set(`${pathOf(type[1])}.${type[2]}`, `${type[1]}.${type[2]}`);
        else if (pkg && pathOf(pkg[1])) wanted.set(pathOf(pkg[1])!, pkg[1]);
      }
      const shown = await Promise.all([...wanted].slice(0, 2).map(async ([w, label]) => { const d = await doc(w, cwd); return d ? `${label} has: ${d}` : ''; }));
      return shown.filter(Boolean).join('\n');
    }

    // Where the native engine keeps the corpus it grows: under the build cache.
    const gocache = (await box.exec('go env GOCACHE')).stdout.trim();
    let seq = 0;
    const rt: Runtime = {
      language: 'go',
      guide: 'Go statements inside a function body, one per item. Bring packages into scope with one `import "path"` line each (they are hoisted into the import block); call the project through its package name, as the import line for the target gives it. Every variable you declare must be used. Build the arguments, then the last line calls the target and binds what it returns: `result := pkg.Parse(...)`, or `result, err := pkg.Parse(...)` when it also returns an error. For a method, first build a value of its type through the package\'s constructors, as its tests do. For a temporary directory use os.MkdirTemp. Write only statements: no package clause, no func declarations (a func literal is fine).',
      importFor: importLine,
      isImport,
      bindsResult: (l) => /^\s*(var\s+)?result\b(\s*,\s*\w+)*\s*(\s[\w.*\[\]]+\s*)?:?=(?!=)/.test(l),
      parseWrap: (code) => ({ source: `package refuzz\nfunc _() {\n${code}\n}\n`, offset: 2 }),
      isPublic(t, source) {
        if (!t.path.endsWith('.go') || t.path.endsWith('_test.go') || /(^|\/)(testdata|vendor|internal\/testutil)\//.test(t.path)) return false;
        const mod = moduleOf(mods, t.path);
        if (!mod || broken.has(mod.dir) || ['main', ''].includes(packageName(source))) return false;
        return t.qualifiedName.split('.').every((part) => /^[A-Z]/.test(part));
      },
      errorsAreValues: true,
      rejections: [],
      environmental: (r) => /network is unreachable|no such host|connection refused|cannot find package|no required module/.test(r.message ?? '')
        // A path the target named that is not there, or not a file: the sandbox's filesystem, not the project. Go returns these
        // as errors; one panicked with (a Must function, a target that panics on the error) is the same.
        || /^\*(fs|os)\.(PathError|LinkError|SyscallError)$|^syscall\.Errno$/.test(r.type ?? '')
        || /: (no such file or directory|is a directory|not a directory|permission denied|file exists|read-only file system)$/.test(r.message ?? ''),
    };
    rt.fuzz = goFuzz({ place, env, mods, pkgs, src: b.src, gocache, apiHint, gen: () => `refuzzg_${process.pid}_${++seq}`, log });
    return rt;
  },
};

/** src/probes/go: the in-process driver, copied into the module as a package of its own for the serve file to import. */
const REFUZZ_PACKAGE = resolve(import.meta.dirname, '..', 'probes', 'go');

/**
 * The file beside a target in its package that makes the test binary a session driver: one test that hands the target's
 * function to refuzz.Serve. It shares the target's package clause, so it reaches an unexported Fuzz function as the target's
 * package does.
 */
const SERVE = (clause: string, refuzz: string, fn: string, test = 'TestRefuzzServe') => `package ${clause}

import (
	"testing"

	refuzz "${refuzz}"
)

func ${test}(t *testing.T) { refuzz.Serve(${JSON.stringify(fn)}, ${fn}) }
`;

/** `any` as a type, outside comments, written as `interface{}` so a module older than go 1.18 still compiles. */
function goPre118(code: string): string {
  return code.split('\n').map((line) => {
    const cut = line.indexOf('//');
    const body = cut >= 0 ? line.slice(0, cut) : line;
    const rest = cut >= 0 ? line.slice(cut) : '';
    return body.replace(/\bany\b/g, 'interface{}') + rest;
  }).join('\n');
}

/** The build tag on every file the fuzzer writes into a package (see `tagged`). */
const BUILD_TAG = '//go:build refuzz\n// +build refuzz';

/** Go's fuzz corpus file: `go test fuzz v1` and one `[]byte("…")` line. */
function corpusFile(b: Buffer): string {
  let s = '';
  for (const c of b) s += c >= 0x20 && c < 0x7f && c !== 0x22 && c !== 0x5c ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, '0')}`;
  return `go test fuzz v1\n[]byte("${s}")\n`;
}

/** The bytes of a corpus file's `[]byte("…")` or `[]byte(\`…\`)`: Go's string escapes undone. */
function parseCorpusFile(text: string): Buffer | null {
  const m = /\[\]byte\(("(?:\\.|[^"\\])*"|`[^`]*`)\)/.exec(text);
  if (!m) return null;
  if (m[1].startsWith('`')) return Buffer.from(m[1].slice(1, -1), 'utf8');
  const s = Array.from(m[1].slice(1, -1)), out: number[] = [];
  const simple: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34, "'": 39 };
  const take = (n: number) => { const x = s.slice(i + 1, i + 1 + n).join(''); i += n; return x; };
  let i = 0;
  for (; i < s.length; i++) {
    if (s[i] !== '\\') { out.push(...Buffer.from(s[i], 'utf8')); continue; }
    const c = s[++i];
    if (c in simple) out.push(simple[c]);
    else if (c === 'x') out.push(parseInt(take(2), 16));
    else if (c === 'u' || c === 'U') out.push(...Buffer.from(String.fromCodePoint(parseInt(take(c === 'u' ? 4 : 8), 16) || 0), 'utf8'));
    else if (/[0-7]/.test(c)) { i--; out.push(parseInt(take(3), 8) & 255); }
  }
  return Buffer.from(out);
}

/** goimports, pinned: the base image has the same version installed; OSS-Fuzz's image runs it with `go run`. */
const GOIMPORTS = 'golang.org/x/tools/cmd/goimports@v0.51.0';

interface FuzzContext {
  place: Place;
  env: Record<string, string>;
  mods: Module[];
  pkgs: Pkg[];
  /** The project's folder in the container. */
  src: string;
  /** The container's go build cache, where go test -fuzz keeps the corpus it grows. */
  gocache: string;
  apiHint: (code: string, msgs: string[], cwd: string) => Promise<string>;
  gen: () => string;
  log: (s: string) => void;
}

/** Where a target goes: the package its clause names, and its fuzz function. */
interface Placed { pkg: Pkg; clause: string; fn: string }

/**
 * Native Go fuzz targets, `func FuzzXxx(f *testing.F)` calling `f.Fuzz(func(t *testing.T, data []byte) {…})` in a _test.go
 * file of the package under test (its own package or `<name>_test`), the file OSS-Fuzz's compile_native_go_fuzzer builds.
 * Each target's top-level names get a suffix of its own (src/probes/gorename), so every target of a package sits in its
 * directory with a serve file beside it until it is released, and one build of the package, instrumented for coverage and
 * for fuzzing, serves the batch: as src/probes/go's driver, one process per target, and as the fuzzer, run with
 * -test.fuzz naming the target's function.
 */
function goFuzz(c: FuzzContext): FuzzRuntime {
  const { place, env, mods, pkgs, src } = c;
  const dirOf = (d: string) => (d ? `${src}/${d}` : src);
  const locks = new Map<string, Promise<unknown>>();
  /** Runs `work` while nothing else of ours has files in the package's directory. */
  const locked = <T>(pkg: Pkg, work: () => Promise<T>): Promise<T> => {
    const next = (locks.get(pkg.dir) ?? Promise.resolve()).then(work, work);
    locks.set(pkg.dir, next.catch(() => {}));
    return next;
  };
  /** Target and build numbers, for the whole runtime: targets of every session share a package's directory. */
  let ids = 0, builds = 0;
  /** The target's top-level names with `suffix` added (src/probes/gorename), built once per container. */
  let renamer: Promise<string> | undefined;
  // Every build of a package with new target files adds a coverage-instrumented copy of the package to Go's build cache,
  // which Go itself trims only after days: past CACHE_MB it is emptied, and the next builds fill it with what they use.
  const CACHE_MB = Number(process.env.REFUZZ_GO_CACHE_MB) || 40_000;
  const trimCache = async () => {
    const r = await place.run(['sh', '-c', `du -sm ${shq(c.gocache)} 2>/dev/null | cut -f1`], { env, timeoutMs: 300_000 });
    if (Number(r.stdout.trim()) > CACHE_MB) {
      c.log(`  go: build cache ${r.stdout.trim()} MB, over ${CACHE_MB} MB: emptied`);
      await place.run(['go', 'clean', '-cache'], { env, timeoutMs: 900_000 });
    }
  };
  const apart = async (text: string, suffix: string, scratch: string): Promise<{ text: string; seeds: Buffer[] } | { error: string }> => {
    renamer ??= (async () => {
      const dir = '/tmp/refuzz-gorename';
      await place.put(dir, { 'main.go': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'gorename', 'main.go')) });
      const r = await place.run(['sh', '-c', 'GO111MODULE=off GOFLAGS= go build -o gorename main.go'], { cwd: dir, env, timeoutMs: 300_000 });
      if (r.code !== 0) throw new Error(`gorename did not build: ${r.stdout}${r.stderr}`);
      return `${dir}/gorename`;
    })();
    const tool = await renamer;
    const dir = `${scratch}/scratch${++scratches}`;
    await place.put(dir, { 'target_test.go': text });
    try {
      const r = await place.run([tool, suffix, 'target_test.go'], { cwd: dir, timeoutMs: 60_000 });
      if (r.code !== 0) return { error: (r.stdout + r.stderr).trim().replaceAll(`${dir}/`, '').slice(0, 800) || 'the file does not parse' };
      const seeds = (JSON.parse(r.stdout.trim() || '[]') as string[]).map((b) => Buffer.from(b, 'base64'));
      return { text: (await place.run(['cat', 'target_test.go'], { cwd: dir })).stdout, seeds };
    } finally { await place.remove(dir); }
  };
  const importsOf = (code: string) => code.split('\n').filter(isImport).flatMap(importSpecs).map((s) => s.replace(/^.*"(.+)"$/, '$1'));
  /** The package a target's clause names: the one it imports by that name (an external test package), else one the targets live in, else the shallowest. */
  const locate = (source: string, project: Target[]): Placed | string => {
    const clause = /^\s*package\s+(\w+)/m.exec(source)?.[1];
    if (!clause) return 'the file has no package clause: start it with the package under test, `package <name>` or `package <name>_test`';
    const fn = /^func\s+(Fuzz\w*)\s*\(\s*\w+\s+\*testing\.F\s*\)/m.exec(source)?.[1];
    if (!fn) return 'the file has no fuzz function: `func FuzzXxx(f *testing.F)` at the top level, calling f.Fuzz(func(t *testing.T, data []byte) { … })';
    const name = clause.replace(/_test$/, '');
    const named = pkgs.filter((p) => p.name === name && !/(^|\/)refuzzg?_/.test(p.dir)).sort((a, b) => a.dir.length - b.dir.length);
    if (!named.length) return `package ${clause}: no package of this project is named ${name}; the clause must be the package under test (${[...new Set(project.map((t) => pkgs.find((p) => p.dir === (dirname(t.path) === '.' ? '' : dirname(t.path)))?.name).filter(Boolean))].slice(0, 4).join(', ') || 'see the import paths'}) or that name with _test`;
    const imported = importsOf(source);
    const homes = new Set(project.map((t) => (dirname(t.path) === '.' ? '' : dirname(t.path))));
    const pkg = named.find((p) => imported.includes(p.path)) ?? named.find((p) => homes.has(p.dir)) ?? named[0];
    return { pkg, clause, fn };
  };
  /**
   * The source as built: `any` spelled out for an old module, imports fixed by goimports, in a folder of its own under
   * `scratch` (a directory of ours in the module), so targets prepared at once never write into one folder.
   */
  let scratches = 0;
  // Every file the fuzzer writes into a package carries a build tag the project's own `go test` and `go vet` never set,
  // so a verification test compiling that package never sees a target the fuzzer is writing or removing at the same time.
  const tagged = (t: string) => (t.startsWith('//go:build refuzz') ? t : `${BUILD_TAG}\n\n${t}`);
  const prepared = async (source: string, m: Module, scratch: string) => {
    const text = tagged(m.go < 18 ? goPre118(source) : source);
    const dir = `${scratch}/scratch${++scratches}`;
    await place.put(dir, { 'target_test.go': text });
    const r = await place.run(['goimports', 'target_test.go'], { cwd: dir, env, timeoutMs: 120_000 });
    await place.remove(dir);
    return r.code === 0 ? r.stdout : text;
  };
  return {
    guide: [
      'A Go fuzz target as OSS-Fuzz builds it (compile_native_go_fuzzer): one complete _test.go file in the package under test. Start with its package clause: the package\'s own name, which reaches its unexported functions, or that name with _test, which imports the package by its path like any caller.',
      `Import paths: ${mods.map((m) => m.path).join(', ')}, with a package's directory after the module path. Then \`import "testing"\` and the rest, then one function: \`func FuzzParse(f *testing.F) { f.Add([]byte("1.2.3")); f.Fuzz(func(t *testing.T, data []byte) { … }) }\`. f.Add seeds are optional; the callback takes exactly (t *testing.T, data []byte).`,
      'Split data into arguments yourself, checking lengths before every slice: `if len(data) < 2 { return }`, take a byte for a number or a flag (`n := int(data[0])`, `flag := data[1]&1 == 1`), then use the rest as a string or bytes (`s := string(data[2:])`). Build objects the way the project\'s own tests do, through its constructors.',
      'When a function returns an error, `if err != nil { return }` for the errors it documents, and carry on with the result otherwise. Never panic or t.Fatal on a documented error: only a broken promise is a finding.',
      'Assert properties of each result inside the callback with t.Fatalf: a round trip (parse what it printed), a result\'s range or order, two functions that should agree: `if got := v.String(); got != s { t.Fatalf("String() = %q, parsed from %q", got, s) }`. Do not print. Write interface{} rather than any when the module\'s go.mod says a version before 1.18.',
    ].join(' '),
    async session(targets, project) {
      const errors: Record<string, string> = {};
      const built = new Map<string, { placed: Placed; source: string; driver: ReturnType<Place['driver']>; exe: string; seeds: Buffer[] }>();
      /** Each built target's files in its package, there until the target is released. */
      const files = new Map<string, { inBox: string; file: string; serve: string; pkg: Pkg }>();
      const gens = new Map<Module, Promise<{ inBox: string; refuzz: string; gen: string }>>();
      /** A package of ours in the module: the driver's package, the test binaries, the scratch files. */
      const genOf = (m: Module) => {
        if (!gens.has(m)) gens.set(m, (async () => {
          const gen = c.gen();
          const inBox = `${dirOf(m.dir)}/${gen}`;
          await place.put(`${inBox}/refuzz`, Object.fromEntries(readdirSync(REFUZZ_PACKAGE).map((f) => [f, readFileSync(join(REFUZZ_PACKAGE, f))])));
          return { inBox, refuzz: `${m.path}/${gen}/refuzz`, gen };
        })());
        return gens.get(m)!;
      };
      /** The project's packages the targets reach, instrumented: what each input ran anywhere in the project. */
      const covered = new Map<Pkg, Promise<string[]>>();
      const coverpkg = (pkg: Pkg) => {
        if (!covered.has(pkg)) {
          const m = pkg.m;
          const roots = [...new Set([pkg.path, ...project.filter((t) => moduleOf(mods, t.path) === m).map((t) => importPath(m, t.path))])];
          covered.set(pkg, place.run(['go', 'list', '-deps', '-f', '{{.ImportPath}}', ...roots], { cwd: dirOf(m.dir), env, timeoutMs: 300_000 })
            .then((r) => r.stdout.split('\n').map((l) => l.trim()).filter((l) => (l === m.path || l.startsWith(`${m.path}/`)) && !/\/refuzzg?_/.test(l))));
        }
        return covered.get(pkg)!;
      };
      // Each target is renamed apart (gorename gives its top-level names a suffix of its own), so the targets of one package
      // sit in its directory together for the whole session: one build of the package serves all of them, as the driver and
      // as the fuzzer, and fuzzing one never waits on another.
      const prep: { name: string; placed: Placed; text: string; seeds: Buffer[]; file: string; serve: string; fn: string; test: string; g: { inBox: string; refuzz: string; gen: string } }[] = [];
      await pool(Object.entries(targets), 4, async ([name, source]) => {
        const placed = locate(source, project);
        if (typeof placed === 'string') { errors[name] = placed; return; }
        const g = await genOf(placed.pkg.m);
        const id = ++ids;
        const suffix = `_p${id}`;
        const renamed = await apart(await prepared(source, placed.pkg.m, g.inBox), suffix, g.inBox);
        if ('error' in renamed) { errors[name] = renamed.error; return; }
        const fn = `${placed.fn}${suffix}`, test = `TestRefuzzServe${suffix}`;
        prep.push({ name, placed: { ...placed, fn }, text: renamed.text, seeds: renamed.seeds, file: `refuzz_${g.gen}_${id}_test.go`, serve: `refuzzserve_${g.gen}_${id}_test.go`, fn, test, g });
      });
      const byPkg = new Map<Pkg, typeof prep>();
      for (const x of prep) (byPkg.get(x.placed.pkg) ?? byPkg.set(x.placed.pkg, []).get(x.placed.pkg)!).push(x);
      await pool([...byPkg], 4, async ([pkg, batch]) => {
        const inBox = dirOf(pkg.dir);
        const cover = await coverpkg(pkg);
        const g = batch[0].g;
        const compile = async () => {
          const exe = `${g.inBox}/b${++builds}.test`;
          if (builds % 25 === 0) await trimCache();
          const out = await place.run(['sh', '-c', `go test -tags refuzz -c -fuzz=. -cover -covermode=count ${cover.length ? `-coverpkg=${shq(cover.join(','))}` : ''} -ldflags=-checklinkname=0 -o ${exe} . 2>&1 && test -x ${exe}`], { cwd: inBox, env, timeoutMs: 900_000 });
          return { exe, out };
        };
        const errorOf = async (x: (typeof prep)[number], out: string) => {
          const lines = x.text.split('\n');
          const own = out.split('\n').flatMap((l) => {
            const e = new RegExp(`${x.file.replace(/\./g, '\\.')}:(\\d+)(?::\\d+)?: (.*)`).exec(l);
            return e ? [`line ${e[1]}: ${e[2].replaceAll(`_p${x.fn.split('_p').pop()}`, '')} (at: ${lines[Number(e[1]) - 1]?.trim().slice(0, 160) ?? ''})`] : [];
          });
          const hint = own.length ? await c.apiHint(x.text, own, dirOf(pkg.m.dir)) : '';
          let error = own.length ? `${own.slice(0, hint ? 3 : 8).join('\n')}${hint ? `\n${hint}` : ''}` : out.trim().split('\n').filter((l) => !/^#/.test(l)).slice(0, 8).join('\n').slice(0, 1200) || 'the target did not build';
          // An import path that no module provides is a guess; the project's own imports of a package with the same last
          // two path elements are where it really lives.
          const missing = /(?:finding module for package|no required module provides package|cannot find package "?)\s*([\w.\-/]+)/.exec(out)?.[1];
          if (missing) {
            const tail = missing.split('/').slice(-2).join('/').replace(/[.]/g, '\\.');
            const found = await place.run(['sh', '-c', `grep -rhoE --include='*.go' '"[^" ]*/${tail}"' . | sort | uniq -c | sort -rn | head -n 5`], { cwd: src, env, timeoutMs: 60_000 });
            const real = found.stdout.split('\n').map((l) => l.trim().replace(/^\d+\s+/, '')).filter((p) => p && p !== `"${missing}"`);
            error += real.length ? `\nNo module provides ${missing}. The project's own code imports it as ${real.join(' or ')}.` : `\nNo module provides ${missing}, and no file of the project imports a package by that name: call what the project's own code calls.`;
          }
          return error;
        };
        const take = (x: (typeof prep)[number]) => place.run(['rm', '-f', x.file, x.serve], { cwd: inBox });
        const ok = await locked(pkg, async () => {
          await place.put(inBox, Object.fromEntries(batch.flatMap((x) => [[x.file, x.text], [x.serve, tagged(SERVE(x.placed.clause, x.g.refuzz, x.fn, x.test))]])));
          let left = [...batch];
          // A failing build names the files it failed in: those come out and the rest builds again. A failure in no file
          // of ours (the serve file's function of the wrong shape, an import cycle) is found by building them one at a time.
          for (;;) {
            if (!left.length) return { exe: '', left };
            const { exe, out } = await compile();
            if (out.code === 0) return { exe, left };
            const named = left.filter((x) => out.stdout.includes(x.file) || out.stdout.includes(x.serve));
            if (named.length && named.length < left.length) {
              for (const x of named) { errors[x.name] = await errorOf(x, out.stdout); await take(x); }
              left = left.filter((x) => !named.includes(x));
              continue;
            }
            if (left.length === 1) { errors[left[0].name] = await errorOf(left[0], out.stdout); await take(left[0]); return { exe: '', left: [] }; }
            for (const x of left) await take(x);
            const kept: typeof left = [];
            for (const x of left) {
              await place.put(inBox, { [x.file]: x.text, [x.serve]: tagged(SERVE(x.placed.clause, x.g.refuzz, x.fn, x.test)) });
              const one = await compile();
              if (one.out.code === 0) kept.push(x);
              else { errors[x.name] = await errorOf(x, one.out.stdout); await take(x); }
            }
            left = kept;
          }
        });
        for (const x of ok.left) {
          files.set(x.name, { inBox, file: x.file, serve: x.serve, pkg });
          // `timeout` ends a driver the session dropped without closing its stdin; the driver's own watchdog does the same.
          // It runs in the package's folder, as `go test` runs a package's tests, so the paths its tests read (testdata/,
          // test/key) resolve the same way for a target.
          const driver = place.driver(['timeout', '-s', 'KILL', '14400', ok.exe, '-test.run', `^${x.test}$`, '-test.timeout=0'], { cwd: inBox, env: { ...env, REFUZZ_ROOT: src, REFUZZ_GEN: x.g.inBox, REFUZZ_TARGET: `${inBox}/${x.file}`, REFUZZ_MODULE: pkg.m.path, REFUZZ_MODDIR: pkg.m.dir } });
          if (await driver.start()) built.set(x.name, { placed: x.placed, source: x.text, driver, exe: ok.exe, seeds: x.seeds });
          else errors[x.name] = driver.fatal ?? 'the target did not start';
        }
      });

      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          const h = built.get(name);
          if (!h) return inputs.map((): InputReport => ({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: errors[name] ?? 'no such target' }));
          return h.driver.run(inputs, timeoutMs, deadline);
        },
        // The target's own build, built with -fuzz, is the fuzzer: its fuzz function runs with -test.fuzz, the seeds in
        // testdata/fuzz/<fn> (the function's name is the target's own, so no other run reads them). It stops at its first
        // failure: each one is kept, taken out of the seeds, and the fuzzer started again for the time left.
        async native(name, corpus, dict, seconds) {
          const h = built.get(name);
          if (!h) return { crashes: [], corpus: [], execs: 0, error: errors[name] ?? `${name} is not built in this session` };
          const { pkg, fn } = h.placed;
          const inBox = dirOf(pkg.dir);
          const seeds = `testdata/fuzz/${fn}`;
          // Outside GOCACHE, which trimCache empties while other targets fuzz.
          const cache = `/tmp/refuzzcache/${pkg.path}`;
          await place.put(inBox, Object.fromEntries([...h.seeds, ...corpus.slice(0, 400), ...dict.slice(0, 100).map((t) => Buffer.from(t, 'utf8'))].map((b) => [`${seeds}/refuzz-${createHash('sha1').update(b).digest('hex').slice(0, 16)}`, corpusFile(b)])));
          await place.remove(`${cache}/${fn}`);
          const crashes: { input: Buffer; report: Report }[] = [];
          const causes = new Set<string>();
          let execs = 0, runs = 0;
          const end = Date.now() + seconds * 1000;
          try {
            while (crashes.length < 8) {
              // The first run gets at least a second, however short the share: a fuzzer given no time did not run. Later runs,
              // after a failure, need time enough to find another.
              const left = Math.max(runs ? 0 : 1, Math.floor((end - Date.now()) / 1000));
              if (runs++ && left < 5) break;
              const r = await place.run(['sh', '-c', `${h.exe} -test.run '^$' -test.fuzz '^${fn}$' -test.fuzztime ${left}s -test.parallel 4 -test.fuzzcachedir ${shq(cache)} 2>&1`], { cwd: inBox, env, timeoutMs: (left + 600) * 1000 });
              execs += Math.max(0, ...[...r.stdout.matchAll(/execs: (\d+)/g)].map((x) => Number(x[1])));
              if (process.env.REFUZZ_DEBUG) c.log(`  [debug] go native: ${r.stdout.trim().split('\n').slice(-12).join('\n')}`);
              // A new failing input is written to testdata; a seed that fails is already there.
              const failed = new RegExp(`Failing input written to (testdata/fuzz/${fn}/\\S+)`).exec(r.stdout)?.[1] ?? new RegExp(`(?:seed corpus entry: |--- FAIL: )${fn}/(\\S+)`).exec(r.stdout)?.[1];
              const path = failed && (failed.startsWith('testdata/') ? failed : `${seeds}/${failed}`);
              if (!path) {
                // A fuzzer that ran nothing did not fuzz: its own words are the engine's error.
                if (!execs) return { crashes, corpus: [], execs, error: `exit ${r.code}, ${left}s: ${r.stdout.trim().split('\n').filter((l) => !/^coverage:/.test(l)).slice(-8).join('\n').slice(0, 1200) || 'no output'}` };
                break;
              }
              const got = await place.run(['cat', path], { cwd: inBox });
              if (got.code !== 0) { if (!execs && !crashes.length) return { crashes, corpus: [], execs, error: `the failing input ${path} could not be read: ${got.stdout.trim().slice(-300)}\n${r.stdout.trim().split('\n').slice(-6).join('\n')}` }; break; }
              const input = parseCorpusFile(got.stdout);
              await place.remove(`${inBox}/${path}`);
              if (!input) continue;
              // The session reads the failure the way it reads any input's: origin, type and the project's frames.
              const [again] = await h.driver.run([input], 10_000);
              const tail = r.stdout.split('\n').filter((l) => !/^\s*fuzz: elapsed/.test(l)).join('\n').trim().slice(-600);
              const report: Report = again && again.status !== 'ok' ? again : { status: 'error', origin: 'library', type: /hung|deadline/.test(r.stdout) ? 'Timeout' : 'FuzzFailure', message: tail };
              // The fuzzer finds the same shallow failure again first: once it repeats, the rest of the time would too.
              const cause = report.origin === 'assertion' ? `assertion|${report.message}` : `${report.type}|${report.frames?.at(-1)?.path}:${report.frames?.at(-1)?.line}`;
              if (causes.has(cause)) break;
              causes.add(cause);
              crashes.push({ input, report });
            }
            // What the fuzzer found interesting is kept in the cache directory, one file per input.
            const grown = Object.values(await place.get(`${cache}/${fn}`)).map((b) => parseCorpusFile(b.toString('utf8'))).filter((b): b is Buffer => !!b);
            return { crashes, corpus: grown, execs };
          } finally {
            await place.remove(`${inBox}/${seeds}`);
            await place.remove(`${cache}/${fn}`);
          }
        },
        async release(name) {
          const h = built.get(name);
          h?.driver.stop();
          built.delete(name);
          // A build serves every target of its batch: it goes once the last of them is released.
          if (h && ![...built.values()].some((y) => y.exe === h.exe)) await place.remove(h.exe);
          const x = files.get(name);
          files.delete(name);
          if (x) await locked(x.pkg, () => place.run(['rm', '-f', x.file, x.serve], { cwd: x.inBox }));
        },
        async close() {
          for (const h of built.values()) h.driver.stop();
          for (const x of files.values()) await locked(x.pkg, () => place.run(['rm', '-f', x.file, x.serve], { cwd: x.inBox }));
          for (const g of gens.values()) await place.remove((await g).inBox);
        },
      };
      return { session, errors };
    },
    /**
     * The target as OSS-Fuzz builds it: its fuzz function renamed after the target so targets never collide, its imports
     * tidied by goimports, and built by compile_native_go_fuzzer into $OUT/<name>, with go-118-fuzz-build's testing package
     * added to the module as OSS-Fuzz's Go projects add it. A target in the package's own clause goes into the package's
     * directory; one in the external test package (`<name>_test`), which go-118-fuzz-build cannot build beside the package,
     * goes into a package of its own below it, where it imports the package by its path as it already does.
     */
    oss(name, source) {
      const placed = locate(source, []);
      if (typeof placed === 'string') throw new Error(`${name}: ${placed}`);
      const { pkg, clause, fn } = placed;
      const renamed = `Fuzz_${name}`;
      const external = clause.endsWith('_test');
      const own = `refuzz_${name.toLowerCase()}`;
      let text = tagged((pkg.m.go < 18 ? goPre118(source) : source).replace(new RegExp(`^(func\\s+)${fn}(\\s*\\()`, 'm'), `$1${renamed}$2`));
      if (external) text = text.replace(/^(\s*package\s+)\w+/m, `$1${own}`);
      const file = `${name}_test.go`;
      const dir = external ? `${dirOf(pkg.dir)}/${own}` : dirOf(pkg.dir);
      const path = external ? `${pkg.path}/${own}` : pkg.path;
      return {
        file,
        source: text.endsWith('\n') ? text : `${text}\n`,
        compile: [
          `mkdir -p ${dir} && cp $SRC/refuzz/${file} ${dir}/${file}`,
          `go run ${GOIMPORTS} -w ${dir}/${file}`,
          `(cd ${dirOf(pkg.m.dir)} && go get github.com/AdamKorcz/go-118-fuzz-build/testing && compile_native_go_fuzzer ${path} ${renamed} ${name})`,
        ],
      };
    },
  };
}
