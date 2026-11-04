/**
 * What a project offers its users: the functions a user of the package, the command or the service can call. Verification
 * (src/verify.ts) decides a failure is a bug only when a test starting here fails: a function a file marks public is not
 * enough, since a package's internal module is importable but no user calls it.
 *
 *   package    what the package's manifest or entry module exports: Python's top-level `__all__` or `__init__` imports, a
 *              JavaScript package's `main`, `exports` and their re-exports, a Rust crate's `pub mod` chain and `pub use`, a
 *              C or C++ library's public headers. Go, JVM and C# packages are public unless under `internal` (or `impl`).
 *   commands   console scripts, `bin` entries, and every `main`.
 *   handlers   functions a framework calls: routes, CLI commands, listeners, bindings (decorators and annotations).
 *
 * Where a language has none of these signals, or a rule finds nothing, the file's own visibility (Runtime.isPublic) decides.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';
import type { Project } from './syntax.ts';
import type { Runtime, Target } from './types.ts';

export interface Api {
  /** A user can call it: the package exports it, a command runs it, or a framework calls it. */
  has(t: Target): boolean;
  /** Commands the project installs (console scripts, `bin` entries). */
  commands: string[];
}

/**
 * A language's rules: `entry` is what runs as a command whatever its file's visibility, `rule` whether the package exports
 * a public function (undefined: no signal, the file's visibility decides).
 */
interface Rules { rule: (t: Target) => boolean | undefined; entry?: (t: Target) => boolean; commands: string[] }

const read = (p: Project, path: string) => { try { return readFileSync(join(p.dir, path), 'utf8'); } catch { return undefined; } };
const has = (p: Project, path: string) => existsSync(join(p.dir, path));
/** The first segment of a qualified name: the class of a method, or the function itself. */
const top = (t: Target) => t.qualifiedName.split(/\.|::/)[0];
const segments = (path: string) => path.split('/').slice(0, -1);

/** The lines right above a definition and its header: decorators, annotations and attributes. */
function marks(p: Project, t: Target): string {
  const lines = p.read(t.path).split('\n');
  const out: string[] = [];
  for (let i = t.line - 2; i >= 0 && out.length < 12; i--) {
    const l = lines[i].trim();
    if (!l || /^(def|async def|class|fn|pub|func|function|return|end)\b|[;{}]$/.test(l) && !/^[@#[]/.test(l)) break;
    out.push(l);
  }
  return `${out.reverse().join('\n')}\n${t.header}`;
}

const HANDLER: Record<string, RegExp> = {
  // A decorator on an object (`@router.get`, `@app.command`, `@server.call_tool`) registers the function with a framework.
  python: /^@(?!(?:functools|pytest|typing|abc|mock|contextlib|dataclasses|unittest|enum)\.)\w+\.(?!setter\b|getter\b|deleter\b)\w+/m,
  java: /@(?:Get|Post|Put|Delete|Patch|Request|Message|Subscribe)Mapping\b|@(?:GET|POST|PUT|DELETE|PATCH|Path|Command|Handler)\b|@\w+Listener\b/,
  c_sharp: /\[(?:Http(?:Get|Post|Put|Delete|Patch)|Route|Function|HubMethodName)\b/,
  rust: /#\[(?:pyfunction|pymethods|pyclass|napi|wasm_bindgen|tauri::command|get|post|put|delete|patch|route|handler)\b/,
  typescript: /@(?:Get|Post|Put|Delete|Patch|All|MessagePattern|EventPattern|Query|Mutation|Command)\(/,
  go: /\bhttp\.ResponseWriter\b/,
};
HANDLER.kotlin = HANDLER.scala = HANDLER.groovy = HANDLER.java;
HANDLER.javascript = HANDLER.tsx = HANDLER.typescript;

/** Python: the names each top-level package's `__init__.py` exports, and the console scripts. */
function python(p: Project): Rules {
  const exports = new Map<string, { names: Set<string>; modules: Set<string> } | null>();
  const packageOf = (path: string) => {
    let d = dirname(path), found: string | undefined;
    while (d !== '.' && d !== '/' && has(p, join(d, '__init__.py'))) { found = d; d = dirname(d); }
    return found;
  };
  const exportsOf = (pkg: string) => {
    if (exports.has(pkg)) return exports.get(pkg)!;
    const init = read(p, join(pkg, '__init__.py')) ?? '';
    const names = new Set<string>(), modules = new Set<string>();
    const all = /^__all__\s*(?::[^=\n]*)?=\s*[[(]([\s\S]*?)[\])]/m.exec(init);
    if (all) for (const m of all[1].matchAll(/['"]([\w.]+)['"]/g)) names.add(m[1]);
    else {
      for (const m of init.matchAll(/^from\s+\.?([\w.]*)\s+import\s+(\([\s\S]*?\)|[^\n]+)/gm)) {
        const list = m[2].replace(/[()]/g, '').split(',').map((x) => x.trim().split(/\s+as\s+/).at(-1)!).filter(Boolean);
        if (list.includes('*')) modules.add(m[1].split('.')[0] || m[1]);
        else for (const n of list) names.add(n);
      }
      for (const m of init.matchAll(/^(?:async\s+)?(?:def|class)\s+(\w+)/gm)) names.add(m[1]);
    }
    // A name that is a submodule exports the whole submodule.
    for (const n of names) if (has(p, join(pkg, `${n}.py`)) || has(p, join(pkg, n, '__init__.py'))) modules.add(n);
    const out = names.size || modules.size ? { names, modules } : null;
    exports.set(pkg, out);
    return out;
  };
  const scripts: string[] = [], targets = new Set<string>();
  for (const f of ['pyproject.toml', 'setup.cfg', 'setup.py']) {
    const text = read(p, f);
    if (!text) continue;
    const section = f === 'pyproject.toml' ? [...text.matchAll(/^\[(?:project\.scripts|project\.gui-scripts|tool\.poetry\.scripts)\]\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)].map((m) => m[1]).join('\n') : text;
    for (const m of section.matchAll(/["']?([\w.-]+)["']?\s*=\s*["']?([\w.]+):([\w.]+)/g)) { scripts.push(m[1]); targets.add(`${m[2]}:${m[3]}`); }
  }
  return {
    commands: scripts,
    // A console script's function, matched by name within the script's package: its module often imports it from another.
    entry: (t) => (t.name === 'main' && /__name__\s*==\s*['"]__main__['"]/.test(p.read(t.path)))
      || [...targets].some((s) => { const [m, fn] = s.split(':'); return fn === t.qualifiedName && segments(t.path).includes(m.split('.')[0]); }),
    rule(t) {
      const pkg = packageOf(t.path);
      if (!pkg) return undefined;
      const ex = exportsOf(pkg);
      if (!ex) return undefined;
      const rel = posix.relative(pkg, t.path).replace(/\.py$/, '').split('/');
      if (rel[0] === '__init__') return ex.names.has(top(t));
      if (ex.modules.has(rel[0])) return !rel.some((x) => x.startsWith('_') && x !== '__init__');
      return ex.names.has(top(t));
    },
  };
}

/** A JavaScript or TypeScript source file for a path a manifest names (`dist/index.js` is built from `src/index.ts`). */
function sourceFor(p: Project, base: string, path: string): string | undefined {
  const rel = normalize(join(base, path)).replace(/^\.\//, '');
  const stems = [rel, rel.replace(/(^|\/)(dist|lib|build|out|esm|cjs)\//, '$1src/')].map((x) => x.replace(/\.(d\.ts|[cm]?js|[cm]?ts|tsx|jsx)$/, ''));
  for (const s of stems) for (const ext of ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx', '/index.ts', '/index.js']) if (p.files.has(s + ext)) return s + ext;
  return undefined;
}

/** JavaScript and TypeScript: what each package.json's entry files export, following re-exports, and its `bin` commands. */
function javascript(p: Project): Rules {
  const manifests = [...p.files.keys(), ...['package.json']].filter((f) => f.endsWith('package.json') && !f.includes('node_modules'));
  const all = new Set<string>([...new Set(manifests)].filter((f) => has(p, f)));
  const exposed = new Set<string>(), whole = new Set<string>(), owned: string[] = [], commands: string[] = [], binFiles: Record<string, string> = {};
  const strings = (x: unknown): string[] => typeof x === 'string' ? [x] : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : [];
  const follow = (file: string, names: Set<string> | '*', depth: number) => {
    if (depth > 6) return;
    const key = `${file}#${names === '*' ? '*' : [...names].sort().join(',')}`;
    if (exposed.has(key)) return;
    exposed.add(key);
    if (names === '*') whole.add(file);
    const text = p.read(file);
    for (const m of text.matchAll(/^export\s+(?:\*|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"]/gm)) {
      const target = m[2].startsWith('.') ? sourceFor(p, dirname(file), m[2]) : undefined;
      if (!target) continue;
      const list = m[1] === undefined ? '*' : new Set(m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean));
      if (names === '*' || list === '*' || [...list].some((n) => names.has(n))) follow(target, list, depth + 1);
      if (list !== '*') for (const n of list) exposed.add(`${target}:${n}`);
    }
    if (names !== '*') for (const n of names) exposed.add(`${file}:${n}`);
  };
  for (const m of all) {
    let json: Record<string, unknown>;
    try { json = JSON.parse(read(p, m) ?? ''); } catch { continue; }
    const base = dirname(m) === '.' ? '' : dirname(m);
    const entries = strings({ main: json.main, module: json.module, exports: json.exports, browser: typeof json.browser === 'string' ? json.browser : undefined });
    const bins = typeof json.bin === 'string' ? { [String(json.name ?? '').split('/').pop()!]: json.bin } : (json.bin as Record<string, string> | undefined) ?? {};
    commands.push(...Object.keys(bins));
    for (const [name, b] of Object.entries(bins)) { const f = sourceFor(p, base, b); if (f) binFiles[name] = f; }
    const files = [...entries, ...Object.values(bins)].map((e) => sourceFor(p, base, e)).filter((x): x is string => !!x);
    if (!files.length) continue;
    owned.push(base);
    for (const f of files) follow(f, '*', 0);
  }
  const ownerOf = (path: string) => owned.filter((b) => !b || path.startsWith(`${b}/`)).sort((a, b) => b.length - a.length)[0];
  const bins = new Set(Object.values(binFiles));
  return {
    commands,
    entry: (t) => bins.has(t.path),
    rule(t) {
      if (ownerOf(t.path) === undefined) return undefined;
      return whole.has(t.path) || exposed.has(`${t.path}:${top(t)}`) || exposed.has(`${t.path}:default`) && /export\s+default/.test(t.header);
    },
  };
}

/**
 * Rust: an item is the crate's when every module from lib.rs down to its file is `pub mod`, or a `pub use` names it. A
 * method follows its type, wherever the `impl` is: `impl FromStr for Version` in a private module is still `Version`'s.
 */
function rust(p: Project): (t: Target) => boolean | undefined {
  const reexported = new Set<string>(), declared = new Map<string, string[]>();
  for (const [f, lang] of p.files) if (lang === 'rust') {
    const text = p.read(f);
    for (const m of text.matchAll(/^\s*pub\s+use\s+([^;]+);/gm)) for (const n of m[1].matchAll(/(\w+)\s*(?:[,}]|$)/g)) reexported.add(n[1]);
    for (const m of text.matchAll(/^\s*pub\s+(?:struct|enum|trait|union|type)\s+(\w+)/gm)) declared.set(m[1], [...(declared.get(m[1]) ?? []), f]);
  }
  const fileExposed = (path: string): boolean | undefined => {
    const src = path.indexOf('src/');
    if (src < 0) return undefined;
    const crate = path.slice(0, src + 4), rel = path.slice(src + 4).replace(/\.rs$/, '').split('/');
    if (rel[0] === 'main' || rel[0] === 'bin') return false;
    if (rel.length === 1 && rel[0] === 'lib') return true;
    let parent = `${crate}lib.rs`;
    for (const mod of rel.filter((x) => x !== 'mod')) {
      const text = read(p, parent);
      if (text === undefined) return undefined;
      if (!new RegExp(`^\\s*pub\\s+mod\\s+${mod}\\b`, 'm').test(text)) return false;
      // A module's children live beside lib.rs or mod.rs, and in a folder named after any other file.
      const dir = /(^|\/)(lib|main|mod)\.rs$/.test(parent) ? parent.replace(/[^/]+$/, '') : parent.replace(/\.rs$/, '/');
      parent = has(p, `${dir}${mod}/mod.rs`) ? `${dir}${mod}/mod.rs` : `${dir}${mod}.rs`;
    }
    return true;
  };
  return (t) => {
    if (t.name === 'main' && /(^|\/)src\/(main\.rs|bin\/)/.test(t.path)) return true;
    const type = top(t) !== t.name ? top(t) : undefined;
    if (reexported.has(type ?? t.name)) return true;
    if (type && declared.has(type)) return declared.get(type)!.some((f) => reexported.has(type) || fileExposed(f) === true);
    return fileExposed(t.path);
  };
}

/** C and C++: a function or type a header outside `src`, `internal`, `private` or `detail` declares. */
function headers(p: Project): (t: Target) => boolean | undefined {
  const names = new Set<string>();
  let listed: string[] = [];
  try { listed = execFileSync('git', ['-C', p.dir, 'ls-files', '*.h', '*.hh', '*.hpp', '*.hxx'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean); } catch {}
  const pub = [...new Set([...p.files.keys(), ...listed])].filter((f) => /\.(h|hh|hpp|hxx)$/.test(f) && !segments(f).some((s) => /^(internal|private|detail|impl|test|tests)$/.test(s)));
  const inSrc = pub.filter((f) => !segments(f).includes('src'));
  for (const f of inSrc.length ? inSrc : pub) for (const m of (read(p, f) ?? '').matchAll(/\b(?:class|struct)\s+(\w+)|\b(\w+)\s*\(/g)) names.add(m[1] ?? m[2]);
  return (t) => (names.size ? names.has(t.name) || names.has(top(t)) : undefined);
}

/** Go, JVM, C#: public unless a package segment says it is internal. */
const notInternal = (p: Project, re: RegExp) => (t: Target) => !segments(t.path).some((s) => re.test(s)) && !(t.language === 'go' && /^package\s+main\b/m.test(p.read(t.path)));

export function apiOf(p: Project, rt: Runtime): Api {
  const isPublic = (t: Target) => rt.isPublic(t, p.read(t.path));
  const lang = rt.language;
  const { rule, entry, commands }: Rules = lang === 'python' ? python(p)
    : ['javascript', 'typescript', 'tsx'].includes(lang) ? javascript(p)
    : { commands: [], rule: lang === 'rust' ? rust(p) : ['c', 'cpp'].includes(lang) ? headers(p) : lang === 'go' ? notInternal(p, /^internal$/)
      : ['java', 'kotlin', 'scala', 'groovy', 'c_sharp'].includes(lang) ? notInternal(p, /^(internal|impl|shaded)$/i) : () => undefined };
  const memo = new Map<string, boolean>();
  return {
    commands,
    has(t) {
      if (t.test) return false;
      let v = memo.get(t.id);
      if (v === undefined) {
        const handler = HANDLER[t.language]?.test(marks(p, t)) ?? false;
        v = handler || (t.name === 'main' && !t.qualifiedName.includes('.')) || !!entry?.(t) || (isPublic(t) && (rule(t) ?? true));
        memo.set(t.id, v);
      }
      return v;
    },
  };
}
