/**
 * What the fuzz session (js_fuzz.mjs) and the Jazzer.js wrapper (js_jazzer.cjs) share:
 * reading errors and their stacks, whose code failed, which failures are clean rejections, and mapping V8's coverage offsets
 * to source lines. No top-level await, so the CommonJS Jazzer wrapper can require it.
 */
import { readFileSync } from 'node:fs';
import { createRequire, SourceMap, syncBuiltinESMExports } from 'node:module';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const toPath = (s) => (s.startsWith('file:') ? fileURLToPath(s) : s);

/** An error's type, message (with node's error code) and stack frames. */
export function describe(e) {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return { type: `thrown ${typeof e}`, message: String(e).slice(0, 600), stack: [] };
  const ctor = e.constructor?.name;
  const type = ctor && ctor !== 'Error' && ctor !== 'Object' ? ctor : String(e.name || 'Error');
  const code = typeof e.code === 'string' ? `[${e.code}] ` : '';
  return { type, message: `${code}${String(e.message ?? '')}`.slice(0, 1200), stack: frames(String(e.stack ?? '')) };
}

/** V8 stack lines, innermost first. A syntax error's first line is `file:line` with no `at`. */
export function frames(stack) {
  const out = [];
  const lines = stack.split('\n');
  const head = /^(file:\/\/\/?\S+?|\/\S+?):(\d+)$/.exec(lines[0] ?? '');
  if (head) out.push({ path: toPath(head[1]), line: Number(head[2]), name: '' });
  for (const l of lines) {
    const m = /^\s+at (?:async )?(?:(.*?) \()?((?:file:\/\/|\/)[^()]*?):(\d+):(\d+)\)?$/.exec(l);
    if (m) out.push({ path: toPath(m[2]), line: Number(m[3]), name: m[1] ?? '' });
  }
  return out;
}

/** The project's own files: under the root, not a dependency, not a harness or fuzz target. */
export const own = (root, path) => path.startsWith(`${root}/`) && !path.startsWith(`${root}/.refuzz-harness/`) && !path.includes('/node_modules/');

const sources = new Map();
const lineOf = (path, line) => {
  if (!sources.has(path)) { try { sources.set(path, readFileSync(path, 'utf8').split('\n')); } catch { sources.set(path, []); } }
  return sources.get(path)[line - 1] ?? '';
};

/** A line that asserts: an `assert(…)`, `assert.ok(…)`, `assert.strictEqual(…)`, `expect(…)` call. */
const ASSERTS = /(?<![\w$.])(?:assert(?:\.[\w$]+)?|expect)\s*\(/;

/**
 * Whose code failed: the innermost frame that is the harness's (or fuzz target's) or the project's decides. A dependency or a
 * built-in called straight from the harness is the harness's mistake; no frame of either (a throw of a non-error) is the
 * project's. A fuzz target's own failed assertion is a property it states, origin `assertion`: node:assert's AssertionError
 * (or a library's that names itself so), or a plain Error thrown on, or under, an assert-style line of the target (its own
 * `assert` helper). Any other error in the target's lines (a TypeError building arguments) stays its mistake.
 */
export function classify(e, harness, root) {
  const d = describe(e);
  const first = d.stack.find((f) => f.path === harness || own(root, f.path));
  const at = d.stack.filter((f) => f.path === harness);
  const mine = first?.path === harness;
  const asserted = mine && (isAssertion(e) || (d.type === 'Error' && at.some((f) => ASSERTS.test(lineOf(f.path, f.line)))));
  const origin = asserted ? 'assertion' : mine ? 'setup' : 'library';
  return {
    status: 'error', origin, type: asserted ? 'AssertionError' : d.type,
    message: asserted ? String(e.message ?? '').slice(0, 1200) : origin === 'setup' && at[0] ? `target line ${at[0].line}: ${d.message}` : d.message,
    frames: d.stack.filter((f) => own(root, f.path)).map((f) => ({ path: relative(root, f.path), line: f.line, name: f.name.replace(/^(Object|Module)\./, '') })).slice(0, 12).reverse(),
  };
}

/** A thrown standard rejection on a `throw` line of the project: the contract working, as the engine's oracle reads it. */
export function deliberate(r, root, rejections) {
  const inner = r.frames?.at(-1);
  if (!inner || !rejections.includes(r.type)) return false;
  return /\bthrow\b/.test(lineOf(`${root}/${inner.path}`, inner.line));
}

const BUILTIN = new Set([Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError, AggregateError]);

/**
 * A clean rejection: an invalid-value, parse or OS error, an error class the project defines (`projectClass`, where the
 * caller can tell where a class was defined), or a standard error the project throws on purpose. For hostile input that is
 * the right answer; for ordinary input it can still be a bug.
 */
export function rejection(e, r, root, rejections, projectClass = () => false) {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return false;
  const code = typeof e.code === 'string' ? e.code : '';
  // An OS error: a path that cannot be opened as asked.
  if (typeof e.syscall === 'string' || (typeof e.errno === 'number' && /^E[A-Z0-9]+$/.test(code))) return true;
  // Node's own invalid-argument errors say what is wrong with the value.
  if (/^ERR_(INVALID_ARG_(TYPE|VALUE)|OUT_OF_RANGE|INVALID_URL|INVALID_CHAR|INVALID_FILE_URL|UNKNOWN_ENCODING|BUFFER_OUT_OF_BOUNDS|INVALID_BUFFER_SIZE|ENCODING_INVALID_ENCODED_DATA|INVALID_MIME_SYNTAX)/.test(code)) return true;
  // RangeError is the invalid-value error, except where it reports a stack or memory blown by the input.
  if (e instanceof RangeError) return !/Maximum call stack|Invalid (typed )?array length|Invalid string length|Array buffer allocation failed|out of memory/i.test(String(e.message));
  // Malformed text: JSON.parse's SyntaxError, decodeURIComponent's URIError.
  if (e instanceof SyntaxError || e instanceof URIError) return true;
  for (let c = e.constructor; typeof c === 'function' && !BUILTIN.has(c) && c !== Object && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    if (/(Parse|Decode|Format|Syntax)Error$/.test(c.name) || projectClass(c)) return true;
  }
  return deliberate(r, root, rejections);
}

/** Where a line's own code starts: past the brace that closes the block above and an `else`, which belong to that block. */
export const lead = (text) => text.match(/^\s*(?:[}\])]\s*)*(?:else\b\s*)?/)[0].length;
export const quiet = (text) => /^\s*$|^\s*(\/\/|\/\*|\*)|^\s*[)\]}]+[;,)]*\s*$/.test(text);

/**
 * A script as V8 ran it, for mapping coverage offsets to source lines: `generated` is code the hooks transformed (it carries
 * an inline source map); otherwise the file on disk is what ran. `probes` are each line's first character, sorted by offset.
 */
export function sourceView(path, generated) {
  const source = generated ?? readFileSync(path, 'utf8');
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  const text = (row) => source.slice(starts[row], (starts[row + 1] ?? source.length + 1) - 1);
  let map = null;
  if (generated) {
    const inline = /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,(\S+)\s*$/.exec(generated);
    if (inline) map = new SourceMap(JSON.parse(Buffer.from(inline[1], 'base64').toString('utf8')));
  }
  const rowOf = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };
  /** The original line of a generated position: itself without a source map; 0 when the map says nothing. */
  const lineAt = (row, col) => {
    if (!generated) return row + 1;
    if (!map) return 0;
    const e = map.findEntry(row, col);
    return e && e.generatedLine === row && typeof e.originalLine === 'number' ? e.originalLine + 1 : 0;
  };
  const lineOf = (off) => { const row = rowOf(off); return lineAt(row, off - starts[row]); };
  const probes = [];
  for (let row = 0; row < starts.length; row++) {
    const s = text(row);
    if (quiet(s)) continue;
    const col = lead(s);
    const line = lineAt(row, col);
    if (line) probes.push({ line, off: starts[row] + col });
  }
  return { probes, lineOf };
}

/** The innermost of `ranges` around an offset. */
export function innermost(ranges, off) {
  let inner = null;
  for (const r of ranges) if (r.startOffset <= off && off < r.endOffset && (!inner || r.endOffset - r.startOffset < inner.endOffset - inner.startOffset)) inner = r;
  return inner;
}

/**
 * Harnesses and fuzz targets must not use the network or start processes. Loading may (a project probing its platform);
 * inputs, while `guard.fuzzing` is on, may not. The refusal is thrown, and also recorded in `guard.blocked`, so a project that
 * catches it cannot hide that the harness reached out.
 */
export function sandbox(guard) {
  const require = createRequire(import.meta.url);
  const deny = (obj, key, what) => {
    const real = obj?.[key];
    if (typeof real !== 'function') return;
    obj[key] = function (...args) {
      if (guard.fuzzing) {
        guard.blocked ??= `${what} is not allowed in a harness`;
        const e = new Error(guard.blocked);
        e.code = 'REFUZZ_SANDBOX';
        throw e;
      }
      return real.apply(this, args);
    };
  };
  const net = require('node:net'), dgram = require('node:dgram'), cp = require('node:child_process');
  deny(net.Socket.prototype, 'connect', 'net.Socket.connect');
  deny(dgram.Socket.prototype, 'send', 'dgram.Socket.send');
  deny(dgram.Socket.prototype, 'bind', 'dgram.Socket.bind');
  deny(cp.ChildProcess.prototype, 'spawn', 'child_process.spawn');
  for (const f of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) deny(cp, f, `child_process.${f}`);
  // The inputs arrive on this process's stdin; the project's stdin is empty, as python_fuzz.py's is, so code that reads it
  // (a CLI's prompt, `fs.readFileSync(0)`) gets end of file instead of the next input. In js_fuzz.mjs process.stdin is the worker's own,
  // ended by the main thread; fd 0 and its paths are /dev/null here.
  const fs = require('node:fs');
  const nul = fs.openSync('/dev/null', 'r');
  const STDIN_PATHS = new Set(['/dev/stdin', '/dev/fd/0', '/proc/self/fd/0']);
  const away = (x) => (x === 0 ? nul : typeof x === 'string' && STDIN_PATHS.has(x) ? '/dev/null' : x);
  for (const f of ['readSync', 'read', 'readFileSync', 'readFile', 'openSync', 'open', 'createReadStream', 'fstatSync', 'fstat']) {
    const real = fs[f];
    if (typeof real === 'function') fs[f] = function (first, ...rest) { return real.call(this, away(first), ...rest); };
  }
  for (const f of ['readFile', 'open']) {
    const real = fs.promises[f];
    fs.promises[f] = function (first, ...rest) { return real.call(this, away(first), ...rest); };
  }
  // ES module imports of the built-ins see the replacements too.
  syncBuiltinESMExports();
}

/** A failed assertion: node:assert's, or any library's that names itself so. */
export const isAssertion = (e) => e != null && typeof e === 'object' && (e.code === 'ERR_ASSERTION' || e.name === 'AssertionError' || e.constructor?.name === 'AssertionError');
