/**
 * refuzz <path | github url | owner/name> [--language l[,l]] [--changed [base]] [--only name,name] [--surfaces N]
 *            [--call-ms N] [--minutes N] [--skip-fuzzed [since]] [--store dir]
 *            [--iteration-seconds N] [--max-iters N] [--plateau percent]
 *            [--cents N] [--poll-minutes 5] [--no-cwe] [--model name] [--fuzz-model name] (name: an OpenAI model, meta:<model>, openrouter:<model>)
 *
 * A loop that runs until --minutes or until stopped: it fuzzes the repository's latest commit (changed code first, then new
 * surfaces, then those still gaining) with a pool of workers, verifies what fails with a failing test beside the fuzzing,
 * and feeds the verdicts back to the targets. Every --poll-minutes it looks for a new commit: when one lands it builds it,
 * and goes on with the changed code first; with nothing left to fuzz or verify it waits for one.
 * --cents is the most its model calls may cost; writing spends only what is left after the money verifying needs. Stopped
 * at any moment, it is started again with the same command and goes on.
 *
 * Fuzzes a project's attack surfaces in every language perch scans: the project is built the way OSS-Fuzz builds it, from a
 * build spec in OSS-Fuzz's format (src/build.ts), the code says where data comes in and what it reaches (src/surface.ts),
 * the writer (src/models.ts) writes OSS-Fuzz targets per surface, code and the language's own engine
 * fuzz them, the judge rules on what failed (src/fuzzer.ts). Each surface's targets, corpus, coverage and findings persist between
 * runs (src/store.ts, `--store`), every target exported as it goes into OSS-Fuzz.
 * Writes results/fuzz/<project>-<stamp>.json after every phase of every batch of surfaces, marked partial until the run ends.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Ledger } from './llm/ledger.ts';
import { adapterFor } from './adapters/index.ts';
import { dedupe, FUZZ_DEFAULTS, type FuzzOptions, type FuzzResult } from './engine.ts';
import { buildProject } from './build.ts';
import { fuzzSurfaces } from './fuzzer.ts';
import { FUZZ_MODEL, fuzzModels, MODEL } from './models.ts';
import { head, run } from './run.ts';
import { Reports } from './report.ts';
import { Budget, budgetedJudge, budgetedWriter } from './schedule.ts';
import { SurfaceStore } from './store.ts';
import { readProject } from './syntax.ts';
import { loadWeaknesses } from './weaknesses.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const given = args[0];
if (!given || given.startsWith('--')) {
  console.error('usage: refuzz <path | github url | owner/name> [--language l] [--changed [base]] [--only names] [--surfaces N]');
  process.exit(2);
}

/** A local checkout as is; a GitHub repository cloned once into .fuzz/repos. */
async function checkout(spec: string): Promise<string> {
  if (existsSync(spec)) return resolve(spec);
  const m = /(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(spec);
  if (!m) throw new Error(`not a path or a GitHub repository: ${spec}`);
  const dir = resolve('.fuzz', 'repos', `${m[1]}__${m[2]}`);
  if (!existsSync(dir)) {
    mkdirSync(resolve('.fuzz', 'repos'), { recursive: true });
    const r = await run('git', ['clone', '-q', '--depth', '50', `https://github.com/${m[1]}/${m[2]}`, dir], { timeoutMs: 900_000 });
    if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.slice(-300)}`);
  } else {
    // The repository's latest commit: a session fuzzes what is new since the last one.
    const r = await run('git', ['-C', dir, 'pull', '-q', '--ff-only'], { timeoutMs: 900_000 });
    if (r.code !== 0) console.log(`  git pull failed, fuzzing the commit there is: ${r.stderr.trim().split('\n').at(-1)}`);
  }
  // Submodules are part of the build (ClickHouse's 150 libraries in contrib/): the checkout replaces the image's clone, so it
  // carries them.
  if (existsSync(join(dir, '.gitmodules'))) {
    const s = await run('git', ['-C', dir, 'submodule', 'update', '--init', '--recursive', '--depth', '1', '--jobs', '8'], { timeoutMs: 3_600_000 });
    if (s.code !== 0) console.log(`  git submodule update failed: ${s.stderr.trim().split('\n').at(-1)}`);
  }
  return dir;
}

/** Lines each file changed since `base`: `--changed` fuzzes only the methods they fall in. */
async function changedLines(dir: string, base: string): Promise<Map<string, Set<number>>> {
  const r = await run('git', ['-C', dir, 'diff', '-U0', `${base}...HEAD`]);
  if (r.code !== 0) throw new Error(`git diff ${base}...HEAD failed: ${r.stderr.slice(-300)}`);
  const out = new Map<string, Set<number>>();
  let file = '';
  for (const line of r.stdout.split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) { file = f[1]; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const set = out.get(file) ?? out.set(file, new Set()).get(file)!;
      const start = Number(h[1]), count = h[2] === undefined ? 1 : Number(h[2]);
      for (let l = start; l < start + Math.max(1, count); l++) set.add(l);
    }
  }
  return out;
}

const dir = await checkout(given);
const changedAt = args.indexOf('--changed');
/**
 * `--skip-fuzzed [since]`: the targets earlier runs of this project fuzzed (results files written since `since`, an ISO
 * date, today by default) are left out, so a run with a wider target question fuzzes only what the earlier ones did not.
 */
function fuzzedBefore(): Set<string> {
  const since = flag('skip-fuzzed') ?? new Date().toISOString().slice(0, 10);
  const name = dir.split('/').pop()!;
  const out = new Set<string>();
  const folder = resolve('results', 'fuzz');
  for (const f of existsSync(folder) ? readdirSync(folder) : []) {
    const stamp = f.slice(name.length + 1, name.length + 11);
    if (!f.startsWith(`${name}-`) || !f.endsWith('.json') || stamp < since) continue;
    const saved = JSON.parse(readFileSync(join(folder, f), 'utf8'));
    for (const r of saved.results ?? []) for (const q of r.targets ?? []) for (const t of project.targets) if (t.qualifiedName === q && t.language === r.language) out.add(`${t.path}#${q}`);
  }
  return out;
}
const o: FuzzOptions = {
  ...FUZZ_DEFAULTS,
  ...(flag('surfaces') ? { surfaces: Number(flag('surfaces')) } : {}),
  ...(flag('call-ms') ? { callMs: Number(flag('call-ms')) } : {}),
  ...(flag('minutes') ? { searchMs: Number(flag('minutes')) * 60_000 } : {}),
  ...(flag('iteration-seconds') ? { iterationMs: Number(flag('iteration-seconds')) * 1000 } : {}),
  ...(flag('max-iters') ? { maxIterations: Number(flag('max-iters')) } : {}),
  ...(flag('plateau') ? { plateau: Number(flag('plateau')) / 100 } : {}),
  ...(flag('only') ? { only: flag('only')!.split(',') } : {}),
  ...(flag('store') ? { store: flag('store') } : {}),
  ...(changedAt >= 0 ? { changed: await changedLines(dir, flag('changed') ?? 'origin/HEAD') } : {}),
  // The weakness catalog, when src/weaknesses.json exists; `--no-cwe` fuzzes without it, to measure what it adds.
  ...(args.includes('--no-cwe') ? {} : { weaknesses: loadWeaknesses() }),
};
const log = (s: string) => console.log(s);

console.log(`refuzz ${dir}`);
let project = await readProject(dir);
if (args.includes('--skip-fuzzed')) {
  o.skip = fuzzedBefore();
  console.log(`  leaving out ${o.skip.size} targets earlier runs fuzzed`);
}
const wanted = flag('language')?.split(',');
const languages = [...project.languages].filter(([l]) => !wanted || wanted.includes(l)).sort((a, b) => b[1] - a[1]);
console.log(`  methods by language: ${languages.map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}`);

const ledger = new Ledger();
// The session's limits and what it keeps between runs (its history), beside the store.
const budget = new Budget(resolve(o.store ?? join(dir, '.refuzz'), 'session.json'), ledger, flag('cents') ? Number(flag('cents')) : Infinity, Number.isFinite(o.searchMs) ? o.searchMs / 60_000 : null, log);
o.budget = budget;
// The session's report for the dashboard (src/report.ts), with the repository it can link to.
const remote = (await run('git', ['-C', dir, 'remote', 'get-url', 'origin'])).stdout.trim();
const repository = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
const reports = new Reports(dir, { name: dir.split('/').pop()!.replace(/^[^_]*__/, ''), ...(repository ? { repository } : {}), commit: await head(dir) }, Number.isFinite(o.searchMs) ? o.searchMs / 60_000 : null, o.store ? resolve(o.store, 'report') : undefined);
o.reports = reports;
const sessionEnd = Date.now() + o.searchMs;
const results: (FuzzResult | { language: string; error: string })[] = [];
const out = resolve('results', 'fuzz', `${dir.split('/').pop()}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
mkdirSync(join(out, '..'), { recursive: true });
/**
 * The results file, rewritten whole each time. `partial` is the language in progress, saved after each of its phases so a run killed before its end keeps what it found: the file then says
 * `partial: true`, and `unjudged` counts its findings the judge has not scored yet (no `defect`), which the final save judges.
 * Phases saved: each judging during the search, search, judge.
 */
const save = (partial?: FuzzResult) => writeFileSync(out, JSON.stringify({ project: dir, options: { ...o, onBatch: undefined, budget: undefined, reports: undefined, built: undefined, changed: o.changed ? Object.fromEntries([...o.changed].map(([k, v]) => [k, v.size])) : undefined }, model: MODEL, fuzzModel: FUZZ_MODEL, cents: ledger.summary().cents, cost: ledger.summary().by, ...(partial ? { partial: true, unjudged: partial.findings.filter((f) => f.defect === undefined).length } : {}), results: partial ? [...results, partial] : results }, null, 2));
o.onBatch = save;
// Before preparing a language, so the time to the first fuzz input includes the image and the build.
o.started = Date.now();
// The watcher: a new commit in the repository, looked for every --poll-minutes (5 by default). A clone refuzz made (under
// .fuzz/repos) is fetched and pulled; a checkout someone works in is only watched for commits made in it, never pulled into.
const managed = dir.startsWith(resolve('.fuzz', 'repos'));
const pollMs = Number(flag('poll-minutes') ?? 5) * 60_000;
let fuzzedAt = await head(dir);
let newCommit = false;
const latest = async () => {
  if (!managed) return head(dir);
  await run('git', ['-C', dir, 'fetch', '-q'], { timeoutMs: 300_000 });
  const r = await run('git', ['-C', dir, 'rev-parse', '@{u}']);
  return r.code === 0 ? r.stdout.trim() : head(dir);
};
// --poll-minutes 0 fuzzes the commit there is and nothing after it.
const watch = pollMs > 0 ? setInterval(() => { void latest().then((c) => { if (c !== fuzzedAt) newCommit = true; }).catch(() => {}); }, pollMs) : undefined;
// A new commit ends a pass only once it has fuzzed an hour (or the session's time, if shorter): ClickHouse lands commits every
// few minutes and takes most of an hour to build, so a pass that stopped at the first one would never fuzz at all.
let passStart = Date.now();
const MIN_PASS_MS = Math.min(60 * 60_000, o.searchMs);
o.stop = () => newCommit && Date.now() - passStart >= MIN_PASS_MS;

/** One pass over the languages on the commit checked out. */
async function fuzzLanguages() {
  for (const [i, [language]] of languages.entries()) {
    // The session's time left is shared among the languages left.
    o.searchMs = Number.isFinite(sessionEnd) ? Math.max(0, (sessionEnd - Date.now()) / (languages.length - i)) : Infinity;
    const adapter = await adapterFor(language);
    if (!adapter) {
      console.log(`  ${language}: no runner`);
      results.push({ language, error: 'no runner for this language' });
      continue;
    }
    try {
      const raw = fuzzModels(ledger, dir);
      const models = budget ? { judge: budgetedJudge(raw.judge, budget), text: budgetedWriter(raw.text, budget), verify: { judge: budgetedJudge(raw.verify.judge, budget), text: budgetedWriter(raw.verify.text, budget) } } : raw;
      // The project built the way OSS-Fuzz builds it, from its build spec (src/build.ts), before any target is written. A
      // spec is written whatever the budget: nothing runs without one. Its cost still counts.
      const store = await SurfaceStore.open(dir, language, o.store);
      const built = await buildProject({ dir, language, adapter, writer: raw.text, specDir: store.specDir }, log);
      const rt = await adapter.prepare(built, log);
      o.built = built;
      try {
        const r = await fuzzSurfaces(project, rt, models, o, log);
        results.push(r);
        console.log(`  ${language}: ${Object.keys(r.surfaces ?? {}).length} surfaces (${r.targets.length} entry points), ${r.harnesses.working} reached by their targets (${r.harnesses.loaded ?? 0} targets kept, ${r.harnesses.written} writer calls), ${r.probed} inputs (${r.junk ?? 0} dropped as junk), ${r.coverage} lines covered, ${dedupe(r.findings).length} distinct failures`);
      } finally {
        await rt.close?.();
        await built.box.stop();
      }
    } catch (error) {
      console.log(`  ${language}: ERROR ${String((error as Error)?.stack ?? error)}`);
      results.push({ language, error: String((error as Error).message) });
    }
  }

}

// The loop: fuzz the commit there is; when a new one lands, the pass winds down (rounds in progress end, what was found is
// verified), the commit is pulled and built, and the next pass fuzzes changed code first. With
// nothing left to fuzz or verify, it waits for the next commit. It ends at --minutes, or when stopped.
for (;;) {
  passStart = Date.now();
  await fuzzLanguages();
  if (Date.now() >= sessionEnd) break;
  if (!newCommit) {
    log('  watch: nothing left to fuzz or verify on this commit; waiting for a new one');
    while (!newCommit && Date.now() < sessionEnd) await new Promise((r) => setTimeout(r, Math.min(pollMs, sessionEnd - Date.now())));
    if (!newCommit) break;
  }
  if (managed) await run('git', ['-C', dir, 'pull', '-q', '--ff-only'], { timeoutMs: 900_000 });
  fuzzedAt = await head(dir);
  newCommit = false;
  log(`  watch: new commit ${fuzzedAt.slice(0, 12)}: building it, scanning what changed, fuzzing changed code first`);
  project = await readProject(dir);
  reports.session.project.commit = fuzzedAt;
}
if (watch) clearInterval(watch);

save();
budget.record({ commit: await head(dir), covered: Object.fromEntries(results.flatMap((r) => ('coverage' in r ? [[r.language, r.coverage]] : []))), bugs: reports.session.bugs.filter((x) => x.new).length });
reports.money({ modelCents: budget.spent(), limitCents: Number.isFinite(budget.limit) ? budget.limit : null });
reports.finish();
{
  // The handover: every reproducible failure, deduplicated by cause, with its shrunk input and the harness that found it,
  // in each surface's findings/ folder of the store, verified as each surface's turn ended (fuzzer.ts verify).
  const found = results.flatMap((r) => ('findings' in r ? r.findings.filter((f) => f.reproduces !== false && f.kind !== 'nondeterministic') : []));
  const by = new Map<string, number>();
  for (const f of found) by.set(f.kind, (by.get(f.kind) ?? 0) + 1);
  console.log(`\n  FINDINGS: ${found.length} reproducible failure${found.length === 1 ? '' : 's'}${by.size ? ` (${[...by].map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}, each with its input and harness under the store's findings/ folders`);
  for (const f of found.slice(0, 40)) console.log(`    ${f.kind.padEnd(8)} ${f.function} ${f.where}: ${f.type}: ${f.message.split('\n')[0].slice(0, 120)}`);
  if (found.length > 40) console.log(`    … ${found.length - 40} more in ${out}`);
  console.log(`  report: ${reports.root}/latest.json`);
}
console.log(`  ${budget.summary()}`);
const by = ledger.summary().by;
console.log(`${ledger.summary().cents.toFixed(3)}¢ (${Object.entries(by).map(([k, v]) => `${k} ${(v.usd * 100).toFixed(3)}¢ over ${v.calls} calls${v.cachedTokens ? `, ${Math.round((100 * v.cachedTokens) / Math.max(1, v.inputTokens))}% of input from the prompt cache` : ''}`).join(', ')}) → ${out}`);
// Everything is saved: a writer request the search stopped waiting for must not keep the process alive.
process.exit(0);
