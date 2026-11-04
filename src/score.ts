/**
 * node src/score.ts <owner/name>… [--session file]
 * node src/score.ts --planted <copy>
 *
 * Scores a verification against the findings labeled by hand (data/labels.json): each repository's newest session
 * (`.refuzz/report/latest.json`, or --session for one repository), its reported bugs matched to the labels. A real
 * finding must be reported, as a bug or a hardening issue; a false one must not be reported at all. Run after
 * `src/reverify.ts --fresh`, which decides every stored failure again with the current verifier.
 *
 * --planted scores a session over a copy with planted bugs (src/plant.ts): for each, whether fuzzing failed in its function
 * (a candidate there) and whether verification reported it. Missing a planted bug is what the labels cannot show.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Bug, SessionReport } from './report.ts';

const args = process.argv.slice(2);
const plantedAt = args.indexOf('--planted');
if (plantedAt >= 0) {
  const copy = resolve(args[plantedAt + 1]);
  const { mutants } = JSON.parse(readFileSync(join(copy, '.refuzz', 'planted.json'), 'utf8')) as { mutants: { path: string; line: number; startLine: number; endLine: number; function: string; kind: string; original: string; mutated: string }[] };
  const root = join(copy, '.refuzz', 'report');
  const session = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8')) as SessionReport;
  const all = new Map((JSON.parse(readFileSync(join(root, 'bugs.json'), 'utf8')).bugs as Bug[]).map((b) => [b.id, b]));
  // In the planted function: from its first line to its last, as the copy's code has it.
  const inside = (m: typeof mutants[number], path: string, line: number) => path === m.path && line >= m.startLine && line <= m.endLine;
  let failed = 0, reported = 0;
  for (const m of mutants) {
    const there = session.candidates.filter((c) => { const [path, line] = [c.where.replace(/:\d+$/, ''), Number(/:(\d+)$/.exec(c.where)?.[1])]; return c.function === m.function || inside(m, path, line); });
    const bugs = session.bugs.filter((b) => all.get(b.id)?.sites.some((x) => x.function === m.function || inside(m, x.path, x.line)));
    if (there.length) failed++;
    if (bugs.length) reported++;
    console.log(`  ${bugs.length ? 'reported' : there.length ? `failed, ${there.map((c) => c.verdict).join('; ')}` : 'missed'}  ${m.path}:${m.line} ${m.function} (${m.kind}): ${m.original.trim().slice(0, 60)} → ${m.mutated.trim().slice(0, 60)}`);
  }
  console.log(`\nplanted: ${mutants.length}; fuzzing failed in ${failed}; reported ${reported}`);
  process.exit(0);
}
const at = args.indexOf('--session'), sessionFile = at >= 0 ? args[at + 1] : undefined;
const repos = args.filter((a, i) => !a.startsWith('--') && !(at >= 0 && i === at + 1));
const { labels } = JSON.parse(readFileSync(new URL('../data/labels.json', import.meta.url), 'utf8')) as { labels: { repo: string; label: 'real' | 'false'; match: string; why: string }[] };

let real = 0, found = 0, wrong = 0, falses = 0;
for (const repo of repos.length ? repos : [...new Set(labels.map((l) => l.repo))]) {
  const root = resolve('.fuzz', 'repos', repo.replace('/', '__'), '.refuzz', 'report');
  const file = sessionFile ?? join(root, 'latest.json');
  if (!existsSync(file)) { console.log(`${repo}: no session at ${file}`); continue; }
  const session = JSON.parse(readFileSync(file, 'utf8')) as SessionReport;
  const all = new Map((JSON.parse(readFileSync(join(root, 'bugs.json'), 'utf8')).bugs as Bug[]).map((b) => [b.id, b]));
  // What each reported bug is matched on: every site as `path:function`, and its title.
  const reported = session.bugs.map((b) => ({ ...b, text: [...(all.get(b.id)?.sites ?? []).map((s) => `${s.path}:${s.function}`), b.title].join('\n') }));
  console.log(`${repo} (${session.session.id}, ${session.bugs.length} reported, ${session.candidates.length} candidates)`);
  const matched = new Set<string>();
  for (const l of labels.filter((x) => x.repo === repo)) {
    const re = new RegExp(l.match, 'm');
    const hits = reported.filter((b) => re.test(b.text));
    hits.forEach((b) => matched.add(b.id));
    const ok = l.label === 'real' ? hits.length > 0 : hits.length === 0;
    if (l.label === 'real') { real++; if (hits.length) found++; } else { falses++; if (hits.length) wrong++; }
    console.log(`  ${ok ? 'ok  ' : 'MISS'} ${l.label.padEnd(5)} ${hits.length ? hits.map((b) => `${b.kind} ${b.id}`).join(', ') : 'not reported'.padEnd(20)}  ${l.why}`);
  }
  for (const b of reported.filter((x) => !matched.has(x.id))) console.log(`  new  ${b.kind.padEnd(9)} ${b.id}  ${b.title}`);
}
console.log(`\nreal reported: ${found} of ${real}; false reported: ${wrong} of ${falses}`);
