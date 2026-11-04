/**
 * Wraps a Jazzer.js fuzz target for refuzz's native engine: Jazzer stops at the first exception it sees, and most are not
 * findings (a rejection the target did not catch, a mistake in its own lines), so this target never throws. Each failure of
 * the real target's `fuzz(data)` is appended to $REFUZZ_CRASHES with its input and the classification the session gives it
 * (js_common.mjs's classify: assertion, library or setup), a few per cause, and fuzzing goes on. As in js_fuzz.mjs, the
 * network, child processes and stdin are closed to inputs.
 * Environment: REFUZZ_TARGET, REFUZZ_ROOT, REFUZZ_CRASHES, REFUZZ_REJECTIONS (comma-separated).
 */
const { appendFileSync } = require('node:fs');
const { classify, rejection, sandbox } = require('./js_common.mjs');

const target = process.env.REFUZZ_TARGET;
const root = process.env.REFUZZ_ROOT || '/src';
const rejections = (process.env.REFUZZ_REJECTIONS || '').split(',');
const guard = { fuzzing: false, blocked: null };
sandbox(guard);
/**
 * A CommonJS target is required, so what it requires goes through Jazzer's require hook and is instrumented. An ES module
 * is imported: Jazzer's require hook compiles what it reads as CommonJS, which breaks ES modules and TypeScript; imports go
 * through node's loader and js_hooks.mjs.
 */
let fuzz = null;
const loading = (/\.c[jt]s$/.test(target) ? Promise.resolve().then(() => require(target)) : import(require('node:url').pathToFileURL(target).href)).then((mod) => {
  fuzz = [mod.fuzz, mod.default?.fuzz].find((f) => typeof f === 'function');
  if (!fuzz) throw new Error('the target does not export a function fuzz(data)');
}).catch((e) => {
  process.stderr.write(`refuzz: the target did not load: ${e?.stack ?? e}\n`);
  process.exit(3);
});
const kept = new Map();

/** Appends a failing input, a few per cause: the same failure a thousand times says nothing more. */
function record(e, data) {
  if (guard.blocked) return;
  const r = classify(e, target, root);
  r.clean = r.origin === 'library' && rejection(e, r, root, rejections);
  const key = `${r.origin}|${r.type}|${r.frames.at(-1)?.path}:${r.frames.at(-1)?.line}`;
  const n = kept.get(key) ?? 0;
  kept.set(key, n + 1);
  if (n < 3) appendFileSync(process.env.REFUZZ_CRASHES, `${JSON.stringify({ input: Buffer.from(data).toString('base64'), report: r })}\n`);
}

module.exports.fuzz = function (data) {
  if (!fuzz) return loading.then(() => module.exports.fuzz(data));
  guard.blocked = null;
  guard.fuzzing = true;
  let out;
  try {
    out = fuzz(data);
  } catch (e) {
    guard.fuzzing = false;
    return record(e, data);
  }
  // An async input stays inside the sandbox until it settles.
  if (out && typeof out.then === 'function') {
    return out.then(() => { guard.fuzzing = false; }, (e) => { guard.fuzzing = false; record(e, data); });
  }
  guard.fuzzing = false;
};
