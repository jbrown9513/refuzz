/**
 * JavaScript, TypeScript and TSX: the project built by its OSS-Fuzz build spec (src/build.ts) in the base-builder-javascript
 * image, its dependencies installed in its folder. Fuzz targets are Jazzer.js targets (`module.exports.fuzz = function
 * (data)` or `export function fuzz(data)`), written under the project's `.refuzz-harness/` in that container so their paths
 * resolve as the project's own do, and run in-process on raw bytes by src/probes/js_fuzz.mjs, one long-lived node per
 * target, with V8's precise coverage taken after every input. Node strips TypeScript types itself; src/probes/js_hooks.mjs
 * resolves the paths TypeScript projects write and sends TSX through esbuild. Jazzer.js, installed in the image (which also
 * gives targets @jazzer.js/core's FuzzedDataProvider), is the native engine, through src/probes/js_jazzer.cjs.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace } from '../place.ts';
import { HARNESS_CWD } from '../run.ts';
import type { Adapter, Built, FuzzRuntime, FuzzSession, Report, Runtime, Target } from '../types.ts';

/** Where the base image (src/images/base-javascript.Dockerfile) installs Jazzer.js and esbuild. */
const JAZZER_DIR = '/usr/local/lib/jazzer';
const JAZZER = `${JAZZER_DIR}/node_modules/.bin/jazzer`;
const ESBUILD = '/usr/local/lib/esbuild/node_modules/esbuild';
const REJECTIONS = ['Error', 'TypeError', 'RangeError', 'SyntaxError'];
/** The drivers, put in the project's `.refuzz-harness/` folder in the container beside the targets. */
const PROBES = ['js_hooks.mjs', 'js_common.mjs', 'js_fuzz.mjs', 'js_jazzer.cjs'];

/** Whether any file outside node_modules is TSX or JSX, which node cannot run without a transform. */
function hasJsx(dir: string, depth = 0): boolean {
  if (depth > 6) return false;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (e.isDirectory() ? hasJsx(join(dir, e.name), depth + 1) : /\.(tsx|jsx)$/.test(e.name)) return true;
  }
  return false;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The keys of a `module.exports = { … }` object literal, at its top level only: a name the object's methods merely call
 * (dot-prop's `getPathSegments`, called inside `get`) is not exported.
 */
function objectExportKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const m = /module\.exports\s*=\s*\{/.exec(source);
  if (!m) return keys;
  let depth = 1, quote = '', start = true;
  for (let i = m.index + m[0].length; i < source.length && depth > 0; i++) {
    const c = source[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    if ('{[('.includes(c)) { depth++; start = false; continue; }
    if ('}])'.includes(c)) { depth--; continue; }
    if (depth !== 1) continue;
    if (c === ',') { start = true; continue; }
    if (start && /[A-Za-z_$]/.test(c)) {
      const word = /^(?:(?:async|get|set|static)\s+)?\*?\s*([A-Za-z_$][\w$]*)/.exec(source.slice(i))!;
      keys.add(word[1]);
      i += word[0].length - 1;
      start = false;
    } else if (!/\s/.test(c)) start = false;
  }
  return keys;
}

/** The file exports `name`: an `export` on its declaration, in an export list, as the default, or through module.exports. */
function exported(name: string, source: string): 'named' | 'default' | null {
  const n = escape(name);
  if (new RegExp(`export\\s+default\\s+(?:(?:async\\s+)?function\\s*\\*?\\s*|(?:abstract\\s+)?class\\s+)?${n}\\b|module\\.exports\\s*=\\s*${n}\\s*;?\\s*$`, 'm').test(source)) return 'default';
  if (new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\s*\\*?|(?:abstract\\s+)?class|const|let|var)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}|(?:module\\.)?exports\\.${n}\\s*=`).test(source)) return 'named';
  if (objectExportKeys(source).has(name)) return 'named';
  return null;
}

/**
 * A CommonJS file: no ES module syntax. Node's ESM import of it sees only the names its lexer finds statically, which misses
 * method shorthand (`module.exports = { get(o, p) { … } }`), so a harness loads it with require.
 */
const isCommonJs = (source: string) => !/^\s*(?:export\s|import\s*[\w{*'"])/m.test(source);

/**
 * A target written as an ES module gets `require` for the CommonJS files it loads, declared on its first line so every
 * line number the drivers report is still the target's own.
 */
function withRequire(code: string): string {
  if (!isEsm(code) || !/\brequire\s*\(/.test(code) || /\b(?:const|let|var|function)\s+require\b|\bcreateRequire\b/.test(code)) return code;
  return `import { createRequire as refuzzCreateRequire } from 'node:module'; const require = refuzzCreateRequire(import.meta.url); ${code}`;
}

/** Names `module.exports = (…) => …` after its file, the way a caller would import it. */
const fileName = (path: string) => path.split('/').pop()!.replace(/\.\w+$/, '').replace(/[^\w$]+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\d/, '_$&');

/** A target written as an ES module (imports or exports), not CommonJS: it decides the file's extension. */
const isEsm = (code: string) => /^\s*(?:import\s*[\w{*'"]|export\s)/m.test(code);

/** A libFuzzer dictionary entry: the token quoted, its quote, backslash and non-printable bytes escaped. */
const dictEntry = (t: string) => `"${[...Buffer.from(t, 'utf8')].map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('')}"`;

/** The package.json the project's records name: its own, read from the checkout. */
function packageOf(dir: string): { dependencies?: Record<string, string>; workspaces?: unknown } | undefined {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { return undefined; }
}

/** Prints, one per line, the dependencies (argv[2], JSON) with no `node_modules/<name>` in the folder argv[1] or above it. */
const MISSING = `
const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const [src, deps] = [process.argv[1], JSON.parse(process.argv[2])];
const found = (d) => { for (let at = src; ; at = dirname(at)) { if (existsSync(join(at, 'node_modules', d))) return true; if (at === dirname(at)) return false; } };
for (const d of deps) if (!found(d)) console.log(d);
`;

/** A target's `./` paths are from the project's folder; kept two folders down in OSS-Fuzz's copy, they climb back to it. */
const fromSubfolder = (source: string) => source.replace(/(\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])\.\//g, '$1$2../../');

export const javascript: Adapter = {
  languages: ['javascript', 'typescript', 'tsx'],
  // The build installed the project's dependencies: each one its package.json lists is in node_modules, in its folder or a
  // workspace root above it, where its files import it from.
  async ready(b) {
    const pkg = packageOf(b.dir);
    if (!pkg) return undefined;
    const deps = Object.keys(pkg.dependencies ?? {});
    if (!deps.length && !pkg.workspaces) return undefined;
    if (!deps.length) {
      const r = await b.box.exec(`test -d ${JSON.stringify(`${b.src}/node_modules`)}`);
      return r.code === 0 ? undefined : `the project is a workspace and ${b.src}/node_modules does not exist: its dependencies were not installed`;
    }
    const r = await containerPlace(b.box).run(['node', '-e', MISSING, b.src, JSON.stringify(deps)], { timeoutMs: 120_000 });
    if (r.code !== 0) return `checking the installed dependencies failed: ${(r.stderr || r.stdout).trim().slice(-400)}`;
    const missing = r.stdout.trim().split('\n').filter(Boolean);
    return missing.length ? `dependencies in package.json are not installed in ${b.src}/node_modules: ${missing.join(', ')}` : undefined;
  },
  async prepare(b, log) {
    const language = b.language;
    const place = containerPlace(b.box);
    const work = `${b.src}/.refuzz-harness`;
    await place.put(work, Object.fromEntries(PROBES.map((f) => [f, readFileSync(resolve(import.meta.dirname, '..', 'probes', f))])));
    // esbuild compiles TSX and JSX, and TypeScript that node's type stripping cannot run (`<T>expr` assertions).
    const jsx = language === 'tsx' || language === 'typescript' || hasJsx(b.dir);
    const env: Record<string, string> = { REFUZZ_ROOT: b.src, REFUZZ_JAZZER: JAZZER_DIR, ...(jsx ? { REFUZZ_ESBUILD: ESBUILD } : {}) };
    const nodeArgs = ['--no-warnings', '--enable-source-maps', '--import', `file://${work}/js_hooks.mjs`];
    const read = (path: string) => (existsSync(join(b.dir, path)) ? readFileSync(join(b.dir, path), 'utf8') : '');
    const isImport = (l: string) => /^\s*import\s*[\w{*'"]/.test(l) || /^\s*(const|let|var)\s+[\w${}\s,:]+=\s*require\(\s*['"][^'"]+['"]\s*\)(\.[\w$]+)?\s*;?\s*$/.test(l);

    /** What a harness imports to call `t`: the function or class, by its file's path from the root. */
    function importFor(t: Target): string {
      const rel = `./${t.path}`;
      const source = read(t.path);
      const cjs = isCommonJs(source);
      if (t.qualifiedName === 'module.exports') return cjs ? `const ${fileName(t.path)} = require('${rel}');` : `import ${fileName(t.path)} from '${rel}';`;
      const top = t.qualifiedName.replace(/^(module\.)?exports\./, '').split('.')[0];
      const how = exported(top, source);
      if (cjs) return how === 'default' ? `const ${top} = require('${rel}');` : `const { ${top} } = require('${rel}');`;
      return how === 'default' ? `import ${top} from '${rel}';` : `import { ${top} } from '${rel}';`;
    }

    const rt: Runtime = {
      language,
      guide: [
        `${language === 'javascript' ? 'JavaScript' : 'TypeScript'} statements, one per item, run in order as the body of an async function in an ES module at the project root (node 24${language === 'javascript' ? '' : ', types stripped: annotations allowed, no JSX in the harness'}).`,
        "Nothing is in scope: each harness starts with its own imports. Bring a target into scope with an import of its file by its path from the project root, extension included, exactly as shown: `import { parse } from './src/parse.ts';` or, for a default export, `import parse from './src/parse.ts';`. A CommonJS file can also be loaded with `const parse = require('./lib/parse.js');`.",
        '`await` is allowed. The last line calls the target and binds what it returns: `const result = target(...);` (a returned Promise is awaited). Do not catch errors; let them propagate.',
      ].join(' '),
      importFor,
      isImport,
      bindsResult: (l) => /^\s*(?:(?:const|let|var)\s+)?result\s*(?::[^=]+)?=(?![=>])/.test(l),
      parseWrap: (code) => ({ source: code, offset: 0 }),
      isPublic(t, source) {
        if (t.qualifiedName === 'module.exports' || /^(module\.)?exports\.[\w$]+$/.test(t.qualifiedName)) return true;
        const parts = t.qualifiedName.replace('.prototype.', '.').split('.');
        if (parts.length > 2 || parts.some((p) => /^[_#]/.test(p))) return false;
        return exported(parts[0], source) !== null || /^\s*export\s/.test(t.header);
      },
      errorsAreValues: false,
      rejections: REJECTIONS,
      environmental: (r) => /^(ProcessExit|Unsettled)$/.test(r.type ?? '') || /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (module|package)|ERR_UNSUPPORTED_|ERR_UNKNOWN_FILE_EXTENSION|ERR_REQUIRE_|ERR_DLOPEN|EAI_AGAIN|ENOTFOUND|ENETUNREACH|ECONNREFUSED|no JSX transform/.test(r.message ?? '')
        // A path the harness named that is not there, or not a file: the sandbox's filesystem, not the project.
        || /^(ENOENT|EISDIR|ENOTDIR|EACCES|EPERM|EEXIST)\b/.test(r.message ?? ''),
      fuzz: fuzzRuntime(),
    };
    return rt;

    /** The file a target is written to: an ES module or CommonJS by its syntax, TypeScript for a TypeScript project. */
    function targetFile(name: string, code: string): string {
      return `${name}.fuzz.${isEsm(code) ? 'm' : 'c'}${language === 'javascript' ? 'js' : 'ts'}`;
    }

    function fuzzRuntime(): FuzzRuntime {
      const lang = language === 'javascript' ? 'JavaScript' : 'TypeScript';
      return {
        guide: [
          `A Jazzer.js fuzz target, the file OSS-Fuzz runs, in ${lang} run by node 24${language === 'javascript' ? '' : ' with its types stripped (only annotations that erase: `data: Buffer`, `x as T`, `import type`; no enums, namespaces, parameter properties, `<T>expr` or JSX)'}: either CommonJS, \`module.exports.fuzz = function (data) { … };\` with \`require\` for imports, or an ES module, \`export function fuzz(data) { … }\` with \`import\` lines. Not both in one file.`,
          "It imports the project by each file's path from the project root, extension included, exactly as shown for the target: `const { parse } = require('./lib/parse.js');` or `import { parse } from './src/parse.ts';` (a default export: `import parse from './src/parse.ts';`). The project's dependencies are installed and import by name.",
          "data is a Buffer of the fuzzer's raw bytes, any length and any content. Build the target's arguments from it: when the target takes bytes or text, pass data itself, or `data.toString('utf8')`; otherwise `const { FuzzedDataProvider } = require('@jazzer.js/core');` (or `import { FuzzedDataProvider } from '@jazzer.js/core';`), `const fdp = new FuzzedDataProvider(data);`, and take each argument from it in turn (`fdp.consumeIntegralInRange(lo, hi)`, `fdp.consumeBoolean()`, `fdp.consumeString(n, 'utf-8')`, `fdp.consumeBytes(n)`, `fdp.consumeNumber()`, `fdp.pickValue([...])`, and `fdp.consumeRemainingAsString()` or `fdp.consumeRemainingAsBytes()` for the rest). Objects the project makes are made through its own constructors and factories, as its tests make them. An async target returns its promise (`async function fuzz(data)` with `await`).",
          "Catch only the errors the project documents for invalid input, around the call that throws them, and return: `try { doc = parse(text); } catch (e) { if (e instanceof ParseError) return; throw e; }`. Never swallow every error: anything else the project throws is what the fuzzer is looking for.",
          "State what must hold of the result with node:assert inside fuzz, after the call (`const assert = require('node:assert');` or `import assert from 'node:assert';`): a round trip (parse what it printed, decode what it encoded), the result's type, size or range, agreement with another function of the project that should agree, an output path staying inside its base. Each assertion carries a message showing the values it compared: `assert.ok(again === text, `round trip changed ${JSON.stringify(text)} into ${JSON.stringify(again)}`)`, or `assert.deepStrictEqual(again, doc, 'round trip changed the document')`. A failing assertion is a finding; assert only what the project promises for every input it accepts, never exact values you would compute by hand.",
          'No network, no child processes, no printing, and no files written outside a directory from `fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-"))`.',
        ].join(' '),
        async session(targets) {
          const dir = `${work}/f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          const files = new Map(Object.entries(targets).map(([name, code]) => [name, targetFile(name, code)]));
          const errors: Record<string, string> = {};
          for (const name of Object.keys(targets)) if (!/^[\w-]+$/.test(name)) errors[name] = `${name} is not a name a file can take`;
          await place.put(dir, Object.fromEntries(Object.entries(targets).filter(([name]) => !errors[name]).map(([name, code]) => [files.get(name)!, withRequire(code)])));
          const make = (name: string, timeoutMs: number) => place.driver(['node', ...nodeArgs, `${work}/js_fuzz.mjs`, `${dir}/${files.get(name)}`, b.src, String(timeoutMs)], { cwd: HARNESS_CWD, env });
          const drivers = new Map<string, { d: ReturnType<typeof make>; timeout: number }>();
          await Promise.all(Object.keys(targets).filter((n) => !errors[n]).map(async (name) => {
            const d = make(name, 1_000);
            if (await d.start()) drivers.set(name, { d, timeout: 1_000 });
            else errors[name] = d.fatal ?? 'did not load';
          }));
          const session: FuzzSession = {
            async run(name, inputs, timeoutMs, deadline) {
              let h = drivers.get(name);
              if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'TargetLoad', message: errors[name] ?? 'no such target' }));
              // The driver's timer is set when it starts; a different allowance needs a new process.
              if (h.timeout !== timeoutMs) { h.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
              return h.d.run(inputs, timeoutMs, deadline);
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
          // Under Jazzer.js's loader, TypeScript modules load with no exports (seen with 4.0 on node 24), so TypeScript and TSX
          // projects get the in-process session only.
          if (language === 'javascript') session.native = (name, corpus, dict, seconds) => runJazzer(name, `${dir}/${files.get(name)!}`, corpus, dict, seconds);
          // TypeScript under Jazzer.js: the target and the project code it imports bundled into one CommonJS file by esbuild,
          // since Jazzer.js's loader gives TypeScript modules no exports. The bundle sits under the project's folder, outside
          // .refuzz-harness, so Jazzer.js instruments the project's code inside it.
          else session.native = async (name, corpus, dict, seconds) => {
            const bundled = await bundle(`${dir}/${files.get(name)!}`, name);
            if (bundled.error) return { crashes: [], corpus, execs: 0, error: `the TypeScript target did not bundle for Jazzer.js: ${bundled.error}` };
            return runJazzer(name, bundled.file!, corpus, dict, seconds);
          };
          return { session, errors };
        },
        oss: (name, source) => ossTarget(b, language, name, source),
      };
    }

    /**
     * Jazzer.js on one target for `seconds`, seeded with `corpus` and `dict`, through js_jazzer.cjs, which records every
     * failure with its input and goes on. Its instrumentation reaches the CommonJS the project loads; code it does not
     * instrument leaves libFuzzer mutating blind, and the log says so.
     */
    /** A TypeScript target and the project code it imports as one CommonJS file, for Jazzer.js; node_modules stay outside. */
    async function bundle(target: string, name: string): Promise<{ file?: string; error?: string }> {
      // A folder per target: every surface names its targets s0_fuzz_1_1 and on, and surfaces fuzz at once in one container.
      const own = createHash('sha1').update(target).digest('hex').slice(0, 12);
      const out = `${b.src}/.refuzz-jazzer/${own}/${name}.cjs`;
      // A target's `./` paths are from the project's root, as refuzz's loader resolves them (src/probes/js_hooks.mjs), not from
      // its own folder under .refuzz-harness.
      const root = `{ name: 'refuzz-root', setup(b) { b.onResolve({ filter: /^\\.\\.?(\\/|$)/ }, (a) => a.importer.includes('/.refuzz-harness/') ? { path: require('path').resolve(${JSON.stringify(b.src)}, a.path) } : undefined); } }`;
      const script = `require(${JSON.stringify(ESBUILD)}).build({ entryPoints: [${JSON.stringify(target)}], outfile: ${JSON.stringify(out)}, bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', sourcemap: 'inline', absWorkingDir: ${JSON.stringify(b.src)}, logLevel: 'error', plugins: [${root}] }).then(() => console.log('bundled'), (e) => { console.error(String(e.message || e).slice(0, 2000)); process.exit(1); })`;
      const r = await b.box.exec(`cd ${b.src} && mkdir -p .refuzz-jazzer/${own} && node -e ${JSON.stringify(script)} 2>&1`, { timeoutMs: 120_000 });
      return r.code === 0 && /bundled/.test(r.stdout) ? { file: out } : { error: r.stdout.trim().slice(-1500) };
    }

    async function runJazzer(name: string, target: string, corpus: Buffer[], dict: string[], seconds: number) {
      const base = `${target.replace(/\/[^/]*$/, '')}/${name}-jazzer`;
      await place.remove(base);
      await place.put(base, {
        ...Object.fromEntries((corpus.length ? corpus : [Buffer.from([0])]).map((c, i) => [`corpus/seed${i}`, c])),
        'artifacts/.keep': '',
        dict: [...new Set(dict)].filter((t) => t.length && t.length <= 64).map(dictEntry).join('\n') + '\n',
        'crashes.jsonl': '',
      });
      const r = await place.run([
        JAZZER, `${work}/js_jazzer.cjs`, `${base}/corpus`,
        '-i', `${b.src}/`, '-e', 'node_modules', '-e', '.refuzz-harness', '--disable_bug_detectors', '.*', '--timeout', '2000',
        '--', `-max_total_time=${seconds}`, `-dict=${base}/dict`, `-artifact_prefix=${base}/artifacts/`, '-print_final_stats=1',
      ], {
        cwd: HARNESS_CWD, timeoutMs: (seconds + 120) * 1000,
        env: { ...env, NODE_OPTIONS: nodeArgs.join(' '), REFUZZ_TARGET: target, REFUZZ_CRASHES: `${base}/crashes.jsonl`, REFUZZ_REJECTIONS: REJECTIONS.join(',') },
      });
      const output = `${r.stdout}\n${r.stderr}`;
      const execs = Number(/stat::number_of_executed_units:\s*(\d+)/.exec(output)?.[1] ?? [...output.matchAll(/^#(\d+)/gm)].at(-1)?.[1] ?? 0);
      const cov = Math.max(0, ...[...output.matchAll(/\bcov: (\d+)/g)].map((m) => Number(m[1])));
      if (!execs) log(`  jazzer ${name}: did not run: ${output.trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`);
      else if (/refuzz: the target did not load/.test(output)) log(`  jazzer ${name}: ${/refuzz: the target did not load: .*/.exec(output)![0].slice(0, 300)}`);
      else if (cov < 10) log(`  jazzer ${name}: ${execs} execs but ${cov} coverage counters: the project's code was not instrumented or not reached (${output.trim().split('\n').filter((l) => !/^Skip loading/.test(l)).slice(-3).join(' | ').slice(0, 300)})`);
      else log(`  jazzer ${name}: ${execs} execs, ${cov} coverage counters`);
      const files = await place.get(base);
      await place.remove(base);
      const crashes: { input: Buffer; report: Report }[] = (files['crashes.jsonl']?.toString('utf8') ?? '').split('\n').filter(Boolean).map((l) => {
        const c = JSON.parse(l);
        return { input: Buffer.from(c.input, 'base64'), report: c.report as Report };
      });
      for (const [f, input] of Object.entries(files)) {
        if (!f.startsWith('artifacts/')) continue;
        const leaf = f.slice('artifacts/'.length);
        if (leaf.startsWith('timeout-')) crashes.push({ input, report: { status: 'timeout', origin: 'library', type: 'Timeout', message: 'Jazzer.js: ran longer than 2s' } });
        else if (leaf.startsWith('crash-') || leaf.startsWith('oom-')) crashes.push({ input, report: { status: 'error', origin: 'library', native: leaf.startsWith('oom-'), type: leaf.startsWith('oom-') ? 'OutOfMemory' : 'JazzerCrash', message: output.trim().split('\n').slice(-8).join('\n').slice(-600) } });
      }
      const grown = Object.entries(files).filter(([f]) => f.startsWith('corpus/')).map(([, c]) => c);
      return { crashes, corpus: grown, execs, ...(execs || crashes.length ? {} : { error: output.trim().split('\n').filter((l) => !/^Skip loading/.test(l)).slice(-6).join('\n') }) };
    }
  },
};

/**
 * One target in the project's OSS-Fuzz folder: kept as $SRC/refuzz/<name>.js (.ts for TypeScript), its `./` paths
 * (from the project's folder) rewritten to climb back up to it, and built by copying it into the project's folder at
 * refuzz/<name>/, beside a package.json saying whether it is an ES module or CommonJS; installing @jazzer.js/core into
 * the project when its build did not; then OSS-Fuzz's compile_javascript_fuzzer, which copies the project to $OUT on its
 * first call (a later target's folder is copied there after it).
 */
function ossTarget(b: Built, language: string, name: string, source: string): { file: string; source: string; compile: string[] } {
  const ext = language === 'javascript' ? 'js' : 'ts';
  const file = `${name}.${ext}`;
  const project = b.src.replace(/^\/src\/+/, '');
  const at = `refuzz/${name}`;
  return {
    file,
    source: fromSubfolder(withRequire(source)),
    compile: [
      `mkdir -p $SRC/${project}/${at}`,
      `cp $SRC/refuzz/${file} $SRC/${project}/${at}/${file}`,
      `echo '{ "type": "${isEsm(source) ? 'module' : 'commonjs'}" }' > $SRC/${project}/${at}/package.json`,
      `(cd $SRC/${project} && { [ -f node_modules/@jazzer.js/core/package.json ] || npm install --no-save --no-audit --no-fund @jazzer.js/core@4; })`,
      `compile_javascript_fuzzer ${project} ${at}/${file}`,
      ...(ext === 'js' ? [] : [`mv $OUT/${file} $OUT/${name}`]),
      `mkdir -p $OUT/${project}/refuzz && cp -r $SRC/${project}/${at} $OUT/${project}/refuzz/`,
    ],
  };
}
