/**
 * Runs one Jazzer.js fuzz target in-process for many inputs, the way libFuzzer runs it. The target is a module exporting
 * `fuzz(data)` (`module.exports.fuzz = function (data) {…}` or `export function fuzz(data) {…}`); each input arrives on stdin
 * as a u32 LE length and the raw bytes, handed to it as a Buffer, and each gets one JSON line back (src/session.ts's
 * protocol). Usage: node --import js_hooks.mjs js_fuzz.mjs <target> <root> <timeout ms>
 *
 * The target runs in a worker thread, so an input that loops forever is stopped by terminating the worker, and the main
 * thread, which only relays, keeps answering. Coverage is V8's precise block coverage through the inspector, taken (and
 * reset) after each input: a feature is a project line that ran, with its execution count bucketed the way AFL buckets edge
 * counts, so an input that runs a loop more times is new too.
 *
 * As python_fuzz.py does: a failed assertion in the target's own lines is origin `assertion` (js_common.mjs's classify); an
 * error says whether it is a clean rejection; while an input runs, the network and child processes are refused; and
 * Math.random is reseeded before every input. `@jazzer.js/core`, for its FuzzedDataProvider, resolves from $REFUZZ_JAZZER
 * when the project does not have it (js_hooks.mjs).
 */
import { writeSync } from 'node:fs';
import { Session } from 'node:inspector';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { classify, describe, innermost, own, rejection, sandbox, sourceView } from './js_common.mjs';

const SELF = fileURLToPath(import.meta.url);
/** The standard errors a function throws on purpose to reject its input (the adapter's REJECTIONS). */
const REJECTIONS = ['Error', 'TypeError', 'RangeError', 'SyntaxError'];

/** AFL's hit-count buckets. */
const bucket = (n) => (n <= 3 ? n : n <= 7 ? 4 : n <= 15 ? 5 : n <= 31 ? 6 : n <= 127 ? 7 : 8);

/** Math.random as mulberry32, reset to the same seed before every input: a result that depends on it is repeatable. */
let seed = 0;
function seeded() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The sandbox's switch, on while an input runs, and what it refused. */
const guard = { fuzzing: false, blocked: null };

async function worker() {
  const { target, root } = workerData;
  Error.stackTraceLimit = 50;
  process.on('unhandledRejection', () => {});
  Math.random = seeded;
  sandbox(guard);
  let fuzz;
  try {
    const mod = await import(pathToFileURL(target).href);
    // An ES module's export, or CommonJS's module.exports.fuzz (a named export when node's lexer sees it, else on default).
    fuzz = [mod.fuzz, mod.default?.fuzz].find((f) => typeof f === 'function');
    if (!fuzz) throw new Error('the target does not export a function fuzz(data): `module.exports.fuzz = function (data) {…}` or `export function fuzz(data) {…}`');
  } catch (e) {
    const d = describe(e);
    const at = d.stack.find((f) => f.path === target);
    // A named import the module does not have: say what it does export, so the next target imports that.
    let has = '';
    const missing = /requested module '([^']+)' (?:does not provide an export named|is a CommonJS module)/.exec(d.message);
    if (missing) {
      // The hooks resolve a target's relative imports from the project root; the target's own folder is tried too.
      let m;
      for (const at of [pathToFileURL(join(root, missing[1])).href, new URL(missing[1], pathToFileURL(target)).href]) {
        try { m = await import(at); break; } catch {}
      }
      try {
        if (!m) throw new Error('not found');
        const names = Object.keys(m);
        has = `; that module exports ${names.map((n) => (n === 'default' ? 'a default export (import x from …)' : n)).join(', ') || 'nothing'}${m.default && typeof m.default === 'object' ? `, and its default export has ${Object.keys(m.default).slice(0, 40).join(', ')}` : ''}`;
      } catch {}
    }
    parentPort.postMessage({ fatal: `${d.type}: ${d.message}${at ? ` (target line ${at.line})` : ''}${has}` });
    return;
  }
  const session = new Session();
  session.connect();
  const post = (method, params) => { let out; session.post(method, params, (e, r) => { if (e) throw e; out = r; }); return out; };
  post('Profiler.enable');
  post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const views = new Map();
  /** Every script V8 has reported coverage for, by id: where a class was defined. */
  const scripts = new Map();
  /** What ran since the last call: `file:line:bucket` features and `[path, line]` lines, project files only. */
  const take = () => {
    const features = [], lines = [];
    for (const s of post('Profiler.takePreciseCoverage').result) {
      scripts.set(s.scriptId, s.url);
      if (!s.url.startsWith('file:')) continue;
      const path = fileURLToPath(s.url);
      if (!own(root, path)) continue;
      const ran = s.functions.filter((f) => f.ranges[0].count > 0);
      if (!ran.length) continue;
      let v = views.get(s.url);
      if (!v) { try { v = sourceView(path, globalThis.__refuzzGenerated?.[s.url]); } catch { v = { probes: [], lineOf: () => 0 }; } views.set(s.url, v); }
      const rel = path.slice(root.length + 1);
      const ranges = s.functions.flatMap((f) => f.ranges);
      const counted = new Map();
      for (const f of ran) {
        const fr = f.ranges[0];
        // A function's first line (its name, `export`) lies before its range: it ran when the function did.
        const head = v.lineOf(fr.startOffset);
        if (head) counted.set(head, Math.max(counted.get(head) ?? 0, fr.count));
        let lo = 0, hi = v.probes.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (v.probes[mid].off < fr.startOffset) lo = mid + 1; else hi = mid; }
        for (let i = lo; i < v.probes.length && v.probes[i].off < fr.endOffset; i++) {
          const p = v.probes[i];
          if (counted.has(p.line)) continue;
          const inner = innermost(ranges, p.off);
          if (inner?.count > 0) counted.set(p.line, inner.count);
        }
      }
      for (const [line, n] of counted) { features.push(`${rel}:${line}:${bucket(n)}`); lines.push([rel, line]); }
    }
    return { features, lines };
  };

  const classes = new WeakMap();
  /** The class is defined in one of the project's files, read from the function's location through the inspector. */
  const projectClass = (c) => {
    if (classes.has(c)) return classes.get(c);
    let yes = false;
    globalThis.__refuzzClass = c;
    try {
      const { result } = post('Runtime.evaluate', { expression: 'globalThis.__refuzzClass' });
      const props = post('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
      post('Runtime.releaseObject', { objectId: result.objectId });
      const at = props.internalProperties?.find((p) => p.name === '[[FunctionLocation]]')?.value?.value;
      const url = at && scripts.get(at.scriptId);
      yes = !!url && url.startsWith('file:') && own(root, fileURLToPath(url));
    } catch {
      yes = false;
    } finally {
      delete globalThis.__refuzzClass;
    }
    classes.set(c, yes);
    return yes;
  };

  take();
  parentPort.on('message', async (bytes) => {
    const data = Buffer.from(bytes);
    seed = 0;
    guard.blocked = null;
    let report, thrown, returned = false;
    guard.fuzzing = true;
    try {
      await fuzz(data);
      returned = true;
    } catch (e) {
      thrown = e;
    } finally {
      guard.fuzzing = false;
    }
    const cov = take();
    if (guard.blocked) report = { status: 'error', origin: 'setup', type: 'Sandbox', message: guard.blocked };
    else if (returned) report = { status: 'ok' };
    else {
      report = classify(thrown, target, root);
      report.clean = report.origin === 'library' && rejection(thrown, report, root, REJECTIONS, projectClass);
    }
    parentPort.postMessage({ ...report, ...cov });
  });
  parentPort.postMessage({ ready: true });
}

async function main() {
  const [target, root, ms] = process.argv.slice(2);
  const timeoutMs = Number(ms) || 1_000;
  const out = (o) => writeSync(1, `${JSON.stringify(o)}\n`);
  const seen = new Set();
  let w = null;
  let answer = null;
  /** A fresh worker with the target loaded; null and the reason when it does not load. */
  const start = () => new Promise((done) => {
    // Its stdout and stderr are kept off this process's stdout, which carries the reports.
    const next = new Worker(SELF, { workerData: { target, root }, stdin: true, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    next.stdin.end();
    next.stdout.resume();
    next.stderr.resume();
    next.on('message', (m) => {
      if (m.ready) { w = next; done(null); } else if (m.fatal) { done(m.fatal); } else answer?.({ kind: 'report', m });
    });
    next.on('error', (e) => { if (w === next) answer?.({ kind: 'error', e }); else done(describe(e).message); });
    next.on('exit', (code) => { if (w === next) { w = null; answer?.({ kind: 'exit', code }); } else done(`the target exited while loading (status ${code})`); });
  });
  const fatal = await start();
  if (fatal) { out({ fatal }); process.exit(0); }
  out({ ready: true });

  const run = async (input) => {
    if (!w) { const why = await start(); if (why) return { status: 'error', origin: 'setup', type: 'TargetLoad', message: why }; }
    const current = w;
    const got = await new Promise((done) => {
      const timer = setTimeout(() => done({ kind: 'timeout' }), timeoutMs);
      answer = (x) => { clearTimeout(timer); answer = null; done(x); };
      current.postMessage(input);
    });
    answer = null;
    if (got.kind === 'report') return got.m;
    // A hang, an uncaught error from a timer, an exit or running out of memory: this worker is done.
    w = null;
    await current.terminate();
    if (got.kind === 'timeout') return { status: 'timeout', origin: 'library', type: 'Timeout', message: `ran longer than ${timeoutMs}ms` };
    if (got.kind === 'exit') return { status: 'error', origin: 'library', type: 'ProcessExit', message: `the target exited (status ${got.code})` };
    if (got.e?.code === 'ERR_WORKER_OUT_OF_MEMORY') return { status: 'error', origin: 'library', native: true, type: 'OutOfMemory', message: got.e.message };
    return classify(got.e, target, root);
  };

  // Inputs are read whole, then run one at a time.
  let buf = Buffer.alloc(0);
  const queue = [];
  let busy = false, ended = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const r = await run(queue.shift());
      const features = (r.features ?? []).filter((f) => !seen.has(f));
      features.forEach((f) => seen.add(f));
      out({ ...r, features });
    }
    busy = false;
    if (ended) process.exit(0);
  };
  process.stdin.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
      const n = buf.readUInt32LE(0);
      queue.push(Buffer.from(buf.subarray(4, 4 + n)));
      buf = buf.subarray(4 + n);
    }
    pump();
  });
  // The session closed its end: nothing more will come.
  process.stdin.on('end', () => { ended = true; if (!busy) process.exit(0); });
}

if (isMainThread) await main();
else await worker();
