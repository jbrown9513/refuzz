/**
 * node src/reverify.ts <path | owner/name> --language l [--store dir] [--cents 100] [--judge jev|decisions] [--fresh] [--labeled] [--unmeasured]
 *
 * Verifies again the failures a store already holds (src/verify.ts), without fuzzing: each failure under
 * `<store>/<language>/<surface>/findings/`, with its input, goes through reproduce, contract and group on the project built
 * from its stored build spec. For a verifier that has changed since the session that found them. Bugs go to the store's
 * report, as a session's do. --fresh decides every candidate again, the ones an earlier verification decided included: for
 * measuring a changed verifier against labeled findings (src/score.ts). --labeled verifies only the failures at a labeled
 * finding's site (data/labels.json), and --unmeasured runs the tests without measuring the lines they ran.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Ledger } from './llm/ledger.ts';
import { adapterFor } from './adapters/index.ts';
import { buildProject } from './build.ts';
import { FUZZ_DEFAULTS, type Finding } from './engine.ts';
import { fuzzModels } from './models.ts';
import { Reports } from './report.ts';
import { OutOfBudget, providerOf, Spender } from './schedule.ts';
import { head, run } from './run.ts';
import { SurfaceStore } from './store.ts';
import { readProject } from './syntax.ts';
import { siteOf, Verifier } from './verify.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const given = args[0], language = flag('language');
if (!given || !language) { console.error('usage: node src/reverify.ts <path | owner/name> --language l [--store dir]'); process.exit(2); }
const dir = existsSync(given) ? resolve(given) : resolve('.fuzz', 'repos', given.replace('/', '__'));
const log = (s: string) => console.log(s);

const store = await SurfaceStore.open(dir, language, flag('store'));
const findings: Finding[] = [];
for (const surface of readdirSync(store.root)) {
  const folder = join(store.root, surface, 'findings');
  if (!existsSync(folder)) continue;
  for (const id of readdirSync(folder)) {
    const file = join(folder, id, 'finding.json');
    if (!existsSync(file)) continue;
    const f = JSON.parse(readFileSync(file, 'utf8')) as Finding;
    // The exact bytes, from input.bin: the readable form may have lost some.
    const bin = join(folder, id, 'input.bin');
    if (existsSync(bin)) f.input = `hex ${readFileSync(bin).toString('hex')}`;
    findings.push(f);
  }
}
// The failures at a labeled finding's site: the label's pattern found in the failure's `path:function` or in its function.
if (args.includes('--labeled')) {
  const project = await readProject(dir);
  const repo = dir.split('/').pop()!.replace('__', '/');
  const patterns = (JSON.parse(readFileSync(new URL('../data/labels.json', import.meta.url), 'utf8')).labels as { repo: string; match: string }[]).filter((l) => l.repo === repo).map((l) => new RegExp(l.match, 'm'));
  const at = findings.filter((f) => { const s = siteOf(project, f); return patterns.some((re) => re.test(`${s.path}:${s.function}`) || re.test(f.function)); });
  findings.splice(0, findings.length, ...at);
}
log(`reverify: ${findings.length} failures in ${store.root}`);

const ledger = new Ledger();
const raw = fuzzModels(ledger, dir);
// The money this verification may spend on models (`--cents`): candidates go highest-rated first, so it buys the likeliest.
const cents = Number(flag('cents') ?? 100);
// Calls in flight count against it too (schedule.ts Spender), and a refusal is a rejected call every caller handles. It
// counts from after the build: test setup is the project's, made once, not this verification's.
let spender: Spender | undefined;
const refuse = () => new OutOfBudget(`--cents ${cents} spent`);
// Re-verifying is the verifying model's work: the reproducer tests and the judgments on them.
const strong = raw.verify;
const writerKind = providerOf(strong.text), judgeKind = providerOf(strong.judge);
const models = {
  text: { model: strong.text.model, generate: (...a: Parameters<typeof strong.text.generate>) => spender!.run(writerKind, () => cents, refuse, () => strong.text.generate(...a)) },
  judge: { ...strong.judge, ask: (...a: Parameters<typeof strong.judge.ask>) => spender!.run(judgeKind, () => cents, refuse, () => strong.judge.ask(...a)) } as typeof strong.judge,
};
const adapter = (await adapterFor(language))!;
const built = await buildProject({ dir, language, adapter, writer: raw.text, specDir: store.specDir }, log);
const rt = await adapter.prepare(built, log);
spender = new Spender(ledger);
const remote = (await run('git', ['-C', dir, 'remote', 'get-url', 'origin'])).stdout.trim();
const repository = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
const reports = new Reports(dir, { name: dir.split('/').pop()!.replace(/^[^_]*__/, ''), ...(repository ? { repository } : {}), commit: await head(dir) }, null, flag('store') ? resolve(flag('store')!, 'report') : undefined);
try {
  const project = await readProject(dir);
  // Candidates an earlier verification of this store decided (its last report) are carried over, not verified again.
  const decided = new Set<string>();
  if (!args.includes('--fresh')) try {
    for (const c of JSON.parse(readFileSync(join(reports.root, 'latest.json'), 'utf8')).candidates ?? []) {
      // Only what a run test decided stands: a bug, or not a bug with the test that showed it. The rest is decided again.
      if (!(c.verdict === 'bug' || (c.verdict === 'not a bug' && c.tried))) continue;
      decided.add(c.key);
      reports.candidate(c);
    }
  } catch {}
  if (decided.size) log(`reverify: ${decided.size} candidates decided by the last verification, carried over`);
  await new Verifier({ p: project, rt, built, models, reports, log, defectAt: FUZZ_DEFAULTS.defectAt, fresh: args.includes('--fresh'), measure: !args.includes('--unmeasured') }).verify(findings, decided);
} finally {
  reports.finish();
  await rt.close?.();
  await built.box.stop();
}
const c = reports.session.candidates;
log(`\nBUGS: ${reports.session.bugs.length}`);
for (const b of reports.session.bugs) log(`  ${b.id} ${b.title} (${b.sites} site${b.sites === 1 ? '' : 's'}) → ${reports.root}/bugs/${b.id}/report.md`);
log(`candidates: ${c.length}: ${['bug', 'not a bug', 'not verified yet'].map((v) => `${c.filter((x) => x.verdict === v).length} ${v}`).join(', ')}`);
for (const x of c.filter((y) => y.verdict !== 'bug')) log(`  ${x.verdict}: ${x.function} ${x.where} ${x.type}: ${(x.why ?? '').slice(0, 200)}`);
log(`${ledger.summary().cents.toFixed(2)}¢`);
process.exit(0);
