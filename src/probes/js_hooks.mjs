/**
 * Module hooks for running a harness inside a JavaScript or TypeScript project, loaded with `node --import`. Node runs .ts by
 * stripping types but does not resolve the paths TypeScript projects write: `./parse.js` for `parse.ts`, extensionless
 * paths, directory imports, tsconfig `paths`. A harness's own `./` imports are taken from the project root, not its folder.
 * A fuzz target's `@jazzer.js/core` (its FuzzedDataProvider) resolves from $REFUZZ_JAZZER, where Jazzer.js is installed, when
 * the project does not have it itself.
 *
 * Types are stripped here rather than by node, so TypeScript inside node_modules (a workspace package) runs too. Stripping
 * keeps every offset, which keeps V8's coverage offsets on the source lines. Code that cannot be stripped (enums, namespaces,
 * parameter properties) is transformed, and TSX and JSX go through esbuild; those carry an inline source map, and the
 * generated code is kept in globalThis.__refuzzGenerated so the fuzz session (js_fuzz.mjs) can map coverage back.
 */
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.REFUZZ_ROOT || '/src';
const HARNESSES = join(ROOT, '.refuzz-harness') + '/';
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const SWAP = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const generated = {};
/** For the grammar session, which maps coverage of transformed code in the same thread. */
globalThis.__refuzzGenerated = generated;

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** Files a path TypeScript would accept could mean, in the order tsc tries them. */
function candidates(p) {
  const ext = extname(p);
  return [...(SWAP[ext] ?? []).map((e) => p.slice(0, -ext.length) + e), ...EXTENSIONS.map((e) => p + e), ...EXTENSIONS.map((e) => join(p, `index${e}`))];
}

/** JSON with comments and trailing commas, as tsconfig.json allows, made plain JSON. Strings are kept whole: `"@/app/*"` is not a comment. */
function jsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { const start = i; for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++; out += text.slice(start, i + 1); continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** A tsconfig.json's compilerOptions, with a relative `extends` merged under them; `paths` resolve against `dir`. */
function readTsconfig(file, depth = 0) {
  try {
    const json = JSON.parse(jsonc(readFileSync(file, 'utf8')));
    const own = { ...(json.compilerOptions ?? {}) };
    if (own.paths) own.pathsBase = resolve(dirname(file), own.baseUrl ?? '.');
    const base = typeof json.extends === 'string' && /^\.\.?\//.test(json.extends) && depth < 4 ? readTsconfig(resolve(dirname(file), json.extends.endsWith('.json') ? json.extends : `${json.extends}.json`), depth + 1) : {};
    return { ...base, ...own };
  } catch {
    return {};
  }
}

const tsconfig = readTsconfig(join(ROOT, 'tsconfig.json'));
const COMMONJS = /^commonjs$/i.test(tsconfig.module ?? '') && (() => { try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).type !== 'module'; } catch { return true; } })();

/** tsconfig `paths` with one `*`, relative to `baseUrl`: `@/*` → `src/*`. */
const aliasesOf = (config) => Object.entries(config.paths ?? {}).map(([from, to]) => ({ from, to: to.map((t) => resolve(config.pathsBase ?? ROOT, t)) }));
const nearest = new Map();
/**
 * The aliases in force for a file: those of the nearest tsconfig.json above it within the project, so an app in a monorepo
 * (`apps/web/tsconfig.json` mapping `@/lib/*`) resolves its own aliases; the root's when none is nearer.
 */
function aliasesFor(parentURL) {
  let dir = parentURL?.startsWith('file:') ? dirname(fileURLToPath(parentURL)) : ROOT;
  if (dir.startsWith(HARNESSES) || !dir.startsWith(ROOT)) dir = ROOT;
  const start = dir;
  if (nearest.has(start)) return nearest.get(start);
  let found = aliasesOf(tsconfig);
  for (; dir.startsWith(ROOT); dir = dirname(dir)) {
    if (!dir.includes('/node_modules/') && isFile(join(dir, 'tsconfig.json'))) { found = aliasesOf(readTsconfig(join(dir, 'tsconfig.json'))); break; }
    if (dir === ROOT) break;
  }
  nearest.set(start, found);
  return found;
}

function aliased(specifier, parentURL) {
  for (const { from, to } of aliasesFor(parentURL)) {
    const [pre, post = ''] = from.split('*');
    if (!from.includes('*') ? specifier !== from : !(specifier.startsWith(pre) && specifier.endsWith(post))) continue;
    const middle = from.includes('*') ? specifier.slice(pre.length, specifier.length - post.length) : '';
    for (const t of to) for (const c of [t.replace('*', middle), ...candidates(t.replace('*', middle))]) if (isFile(c)) return c;
  }
  return null;
}

/**
 * A workspace package imported by name whose exports point at build output that was never built (`@scope/pkg/error` →
 * `node_modules/@scope/pkg/dist/error.mjs`, missing): the source it is built from. Monorepos lay `src/` out as their build
 * writes `dist/`, so the output path with its build directories swapped for `src` is tried first, then `src/<subpath>`.
 */
function fromSource(specifier, missing) {
  if (!missing || /^(node:|\.|\/|file:)/.test(specifier)) return null;
  // The package the missing file belongs to: the nearest folder above it with a package.json (a self-import through the
  // package's "imports" map, `#crypto` → `./dist/runtime/crypto.mjs`, never passes through node_modules).
  let dir = null;
  for (let d = dirname(missing); d.length > 1; d = dirname(d)) if (isFile(join(d, 'package.json'))) { dir = d; break; }
  if (!dir) return null;
  // The output path inside the package, taken before the link (pnpm's node_modules/@scope/pkg → packages/pkg) is followed.
  const rel = missing.slice(dir.length + 1);
  let pkg;
  try { pkg = realpathSync(dir); } catch { return null; }
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const sub = specifier.startsWith('#') ? '' : specifier.slice(name.length).replace(/^\//, '');
  const noExt = (p) => p.replace(/\.(m|c)?js$|\.d\.(m|c)?ts$/, '');
  const out = /^(?:(?:dist|build|lib|out|esm|cjs|es|module|types)\/){1,2}/;
  const tries = [out.test(rel) ? join(pkg, 'src', rel.replace(out, '')) : null, join(pkg, 'src', sub || 'index'), join(pkg, sub || 'index')].filter(Boolean);
  for (const t of tries) for (const c of [t, ...candidates(noExt(t))]) if (isFile(c)) return c;
  return null;
}

/**
 * Workspace packages (two levels down: packages/x, apps/x), whose own node_modules hold dependencies a pnpm workspace does
 * not hoist to the root, where harnesses run from.
 */
const workspaces = (() => {
  const out = [];
  try {
    for (const a of readdirSync(ROOT, { withFileTypes: true })) {
      if (!a.isDirectory() || a.name.startsWith('.') || a.name === 'node_modules') continue;
      for (const b of readdirSync(join(ROOT, a.name), { withFileTypes: true })) if (b.isDirectory() && isFile(join(ROOT, a.name, b.name, 'package.json'))) out.push(join(ROOT, a.name, b.name));
    }
  } catch {}
  return out;
})();

/** A bare package a harness imports that only a workspace package has installed: resolved as that package would. */
function fromWorkspace(specifier, context, next) {
  if (/^(node:|#|\.|\/|file:)/.test(specifier)) return null;
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  for (const w of workspaces) {
    if (!statSync(join(w, 'node_modules', name), { throwIfNoEntry: false })) continue;
    try { return next(specifier, { ...context, parentURL: pathToFileURL(join(w, 'package.json')).href }); } catch {}
  }
  return null;
}

/** The automatic JSX runtime when the project has one to import, React.createElement otherwise. */
const jsxSource = (() => {
  if (tsconfig.jsxImportSource) return tsconfig.jsxImportSource;
  try { return statSync(join(ROOT, 'node_modules', 'react')).isDirectory() ? 'react' : null; } catch { return null; }
})();

let esbuild;
function transformJsx(source, path, format) {
  esbuild ??= process.env.REFUZZ_ESBUILD ? createRequire(import.meta.url)(process.env.REFUZZ_ESBUILD) : null;
  if (!esbuild) throw new Error(`no JSX transform for ${path}: esbuild is not installed`);
  // esbuild sees one file, so a re-export of another file's type (`export { ScimId }`) survives it as it does stripping.
  if (/\.[mc]?tsx?$/.test(path)) source = elideTypeImports(source, path);
  return esbuild.transformSync(source, { loader: path.endsWith('.jsx') ? 'jsx' : /\.[mc]?ts$/.test(path) ? 'ts' : 'tsx', format: format === 'module' ? 'esm' : 'cjs', platform: 'node', sourcemap: 'inline', sourcefile: path, ...(jsxSource ? { jsx: 'automatic', jsxImportSource: jsxSource } : { jsx: 'transform' }), target: 'node22', ...(format === 'module' && /\brequire\s*\(/.test(source) ? { banner: "import { createRequire as __refuzzRequire } from 'node:module'; const require = __refuzzRequire(import.meta.url);" } : {}) }).code;
}

/**
 * Blanks imported names nothing else in the file mentions. Without `import type`, `import { QueryValue } from './query'`
 * names only a type, which stripping leaves and linking then rejects; tsc drops such imports. Blanking keeps every offset.
 */
function elideTypeImports(code, path) {
  let out = code;
  const blank = (start, end) => { out = out.slice(0, start) + out.slice(start, end).replace(/[^\n]/g, ' ') + out.slice(end); };
  // Names the imported file declares only as types (`export type ScimId = string`), which a re-export (`export { ScimId }`)
  // would otherwise keep alive: tsc knows from the other file, and so does this, by reading it.
  const typesOnly = new Set();
  const typesIn = (specifier, from = path, depth = 0) => {
    if (!from || depth > 4 || !/^\.\.?(\/|$)/.test(specifier)) return new Set();
    const file = candidates(resolve(dirname(from), specifier)).find(isFile);
    if (!file) return new Set();
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { return new Set(); }
    const types = new Set([...text.matchAll(/^\s*export\s+(?:declare\s+)?(?:type|interface)\s+([\w$]+)/gm)].map((x) => x[1]));
    // Through an index's `export * from './trie'`, where most libraries' types reach their entry point.
    for (const x of text.matchAll(/^\s*export\s+(?:type\s+)?\*\s+from\s+(['"])([^'"\n]+)\1/gm)) for (const t of typesIn(x[2], file, depth + 1)) types.add(t);
    // And its named re-exports, `export { Template } from './template'`: a name that is a type there is one here.
    for (const x of text.matchAll(/^\s*export\s+(type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\3/gm)) {
      const there = x[1] ? null : typesIn(x[4], file, depth + 1);
      for (const part of x[2].split(',')) {
        const [name, as = name] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
        if (name && (!there || there.has(name) || /^\s*type\s/.test(part))) types.add(as);
      }
    }
    for (const v of text.matchAll(/^\s*export\s+(?:declare\s+)?(?:const|let|var|function\*?|class|enum|abstract\s+class|async\s+function)\s+([\w$]+)/gm)) types.delete(v[1]);
    return types;
  };
  for (const m of code.matchAll(/(?<=^[ \t]*)import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\2/gm)) {
    const rest = code.slice(0, m.index) + code.slice(m.index + m[0].length);
    const types = typesIn(m[3]);
    const inner = m.index + m[0].indexOf('{') + 1;
    let at = inner;
    for (const part of m[1].split(',')) {
      const start = at;
      at += part.length + 1;
      const [imported, local = imported] = part.trim().split(/\s+as\s+/);
      if (!local || !/^[\w$]+$/.test(local)) continue;
      const typeOnly = types.has(imported);
      if (!typeOnly && new RegExp(`(?<![\\w$])${local.replace(/\$/g, '\\$')}(?![\\w$])`).test(rest)) continue;
      if (typeOnly) typesOnly.add(local);
      blank(start, Math.min(at, inner + m[1].length));
    }
  }
  // The same names in the file's own export lists, and type-only names re-exported straight from another file.
  for (const m of code.matchAll(/(?<=^[ \t]*)export\s*\{([^}]*)\}(\s*from\s*(['"])([^'"\n]+)\3)?/gm)) {
    const types = m[4] ? typesIn(m[4]) : typesOnly;
    const inner = m.index + m[0].indexOf('{') + 1;
    let at = inner;
    for (const part of m[1].split(',')) {
      const start = at;
      at += part.length + 1;
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name && types.has(name)) blank(start, Math.min(at, inner + m[1].length));
    }
  }
  return out;
}

const moduleSyntax = (s) => /^\s*(import\s*[\w{*'"]|export\s)/m.test(s);

registerHooks({
  resolve(specifier, context, next) {
    // Harnesses sit in folders under .refuzz-harness/; the probe's own files beside them import each other as usual. The path
    // is absolute, not a file: URL, which `require` (a CommonJS fuzz target's) does not take.
    if (context.parentURL?.startsWith('file:') && /^\.\.?(\/|$)/.test(specifier) && dirname(fileURLToPath(context.parentURL)).startsWith(HARNESSES)) {
      specifier = resolve(ROOT, specifier);
    }
    try {
      return next(specifier, context);
    } catch (error) {
      if (!/MODULE_NOT_FOUND|ERR_UNSUPPORTED_DIR_IMPORT/.test(error.code ?? '')) throw error;
      let path = null;
      if (/^\.\.?(\/|$)/.test(specifier) && context.parentURL?.startsWith('file:')) path = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
      else if (specifier.startsWith('file:')) path = fileURLToPath(specifier);
      else if (specifier.startsWith('/')) path = specifier;
      const found = path ? candidates(path).find(isFile) : aliased(specifier, context.parentURL) ?? fromSource(specifier, /Cannot find module '([^']+)'/.exec(error.message)?.[1]);
      if (!found) {
        if (specifier.startsWith('@jazzer.js/') && process.env.REFUZZ_JAZZER) return next(createRequire(join(process.env.REFUZZ_JAZZER, 'package.json')).resolve(specifier), context);
        const elsewhere = path ? null : fromWorkspace(specifier, context, next);
        if (elsewhere) return elsewhere;
        throw error;
      }
      return next(found, context);
    }
  },
  load(url, context, next) {
    if (!url.startsWith('file:')) return next(url, context);
    const path = fileURLToPath(url);
    // A project whose tsconfig compiles to CommonJS runs its TypeScript as CommonJS, as its tests do (ts-jest, ts-node): its
    // import cycles (liquidjs's tags importing the index that imports them) work there and fail as ES modules.
    if (COMMONJS && /\.(ts|cts)$/.test(path) && path.startsWith(ROOT) && !path.startsWith(HARNESSES) && !path.includes('/node_modules/')) {
      return { format: 'commonjs', source: (generated[url] = transformJsx(readFileSync(path, 'utf8'), path, 'commonjs')), shortCircuit: true };
    }
    if (/\.(tsx|jsx)$/.test(path)) {
      const source = readFileSync(path, 'utf8');
      const format = path.endsWith('.mts') || moduleSyntax(source) ? 'module' : 'commonjs';
      return { format, source: (generated[url] = transformJsx(source, path, format)), shortCircuit: true };
    }
    let loaded;
    try {
      loaded = next(url, context);
    } catch (error) {
      // node strips TypeScript in its own loader, which cannot run `<T>expr` assertions: esbuild compiles the file whole.
      if (error.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') throw error;
      const source = readFileSync(path, 'utf8');
      const format = path.endsWith('.mts') || (!path.endsWith('.cts') && moduleSyntax(source)) ? 'module' : 'commonjs';
      return { format, source: (generated[url] = transformJsx(source, path, format)), shortCircuit: true };
    }
    if (!/-typescript$/.test(loaded.format ?? '')) return loaded;
    const source = String(loaded.source ?? readFileSync(path, 'utf8'));
    let code;
    try {
      code = stripTypeScriptTypes(source, { mode: 'strip' });
    } catch (error) {
      // A syntax error's stack starts `:line`; with the path in front the probe can say which harness line it was.
      if (error.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') throw Object.assign(error, { stack: `${path}${String(error.stack).replace(/^\s*(?=:\d)/, '')}` });
      try {
        code = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: true, sourceUrl: url });
      } catch (again) {
        // TypeScript node cannot run even by transforming (`<T>expr` assertions): esbuild compiles it whole.
        if (again.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') throw again;
        const format = loaded.format.replace('-typescript', '');
        return { format, source: (generated[url] = transformJsx(source, path, format)), shortCircuit: true };
      }
    }
    code = elideTypeImports(code, path);
    if (code.length !== source.length || code.includes('//# sourceMappingURL=data:')) generated[url] = code;
    return { format: loaded.format.replace('-typescript', ''), source: code, shortCircuit: true };
  },
});
