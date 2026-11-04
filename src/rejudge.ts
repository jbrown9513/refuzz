/**
 * node src/rejudge.ts <results/fuzz/….json> [--out other.json]
 *
 * Asks the judge again about a finished run's findings, with the judge's current questions: tuning the judge does not need the
 * fuzzing run again. Writes the file back with each finding's new verdict and prints what changed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Ledger } from './llm/ledger.ts';
import { adapterFor } from './adapters/index.ts';
import { judge, type Finding } from './engine.ts';
import { buildProject } from './build.ts';
import { judgeModel, writerModel } from './models.ts';
import { SurfaceStore } from './store.ts';
import { readProject } from './syntax.ts';

const file = process.argv[2];
if (!file) { console.error('usage: node src/rejudge.ts <results/fuzz/….json>'); process.exit(2); }
const saved = JSON.parse(readFileSync(file, 'utf8'));
const project = await readProject(saved.project);
const ledger = new Ledger();
const jev = judgeModel(ledger, saved.project);
// --out writes the re-judged results to another file, leaving the run's own file as it was.
const outAt = process.argv.indexOf('--out');
const target = outAt > 0 ? process.argv[outAt + 1] : file;
const at = saved.options?.defectAt ?? 0.5;
const label = (f: Finding) => ((f.defect ?? 0) >= at ? f.finding ?? 'defect' : 'dropped');

for (const r of saved.results) {
  if (!r.findings?.length) continue;
  const adapter = await adapterFor(r.language);
  // The same built project the run fuzzed: its stored spec, and the image built from it, unchanged since.
  const store = await SurfaceStore.open(saved.project, r.language, saved.options?.store);
  const built = await buildProject({ dir: saved.project, language: r.language, adapter: adapter!, writer: writerModel(ledger), specDir: store.specDir}, () => {});
  const rt = await adapter!.prepare(built, () => {});
  try {
    const subjects = project.targets.filter((t) => r.targets.includes(t.qualifiedName) && t.language === r.language);
    const before = r.findings.map(label);
    const old = r.findings.map((f: Finding) => f.verdict);
    await judge(project, rt, subjects, r.findings, jev);
    r.findings.forEach((f: Finding, i: number) => {
      const now = label(f);
      console.log(`${before[i] === now ? '  ' : '* '}${before[i]} → ${now}: ${f.type} at ${f.where} in ${f.function}\n      was: ${old[i]}\n      now: ${f.verdict}`);
    });
  } finally {
    await rt.close?.();
    await built.box.stop();
  }
}
writeFileSync(target, JSON.stringify(saved, null, 2));
console.log(`${ledger.summary().cents.toFixed(3)}¢ → ${target}`);
