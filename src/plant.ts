/**
 * node src/plant.ts <owner/name> --language l [--count 10] [--map file.jsonl]
 *
 * Bugs with a known answer, for measuring what fuzzing and verification miss: mutants of the project that its own tests let
 * through and that a caller could see (src/testmap.ts, perch coverage's report), planted into a copy of the checkout.
 * Each is a one-line edit no test catches, the kind of slip a pull request makes, so a session over the copy should report
 * it as a bug. The copy is a git worktree beside the checkout (`<checkout>__planted`), the edits left uncommitted so the
 * build copies them in (src/build.ts), with the checkout's build spec, and `.refuzz/planted.json` saying what was
 * planted where. One mutant per method, the likeliest to matter first, of the kinds that change behavior rather than text.
 *
 * Then fuzz the copy with `--only` the planted functions, and score it: node src/score.ts --planted <copy>.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run } from './run.ts';
import { readProject } from './syntax.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const repo = args[0], language = flag('language');
if (!repo || !language) { console.error('usage: node src/plant.ts <owner/name> --language l [--count 10] [--map file.jsonl]'); process.exit(2); }
const dir = resolve('.fuzz', 'repos', repo.replace('/', '__'));
const planted = `${dir}__planted`;

// The map: the one named, else the newest the store kept (src/testmap.ts), else a probe's report under .fuzz/coverage.
const newest = (folder: string) => (existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.jsonl')).map((f) => join(folder, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] : undefined);
const mapFile = flag('map') ?? newest(join(dir, '.refuzz', language, 'testmap')) ?? newest(resolve('.fuzz', 'coverage', repo.replace('/', '__'), 'coverage'));
if (!mapFile) { console.error(`no perch coverage report for ${repo}: run a session (src/testmap.ts) or pass --map`); process.exit(2); }

/** Kinds that change what the code does: not an emptied message string or a dropped log call. */
const BEHAVIOR = new Set(['boundary', 'condition', 'logic', 'arithmetic', 'update', 'return', 'not', 'negative', 'boolean', 'number', 'method', 'block', 'removal', 'chaining', 'collection', 'regex']);
interface Mutant { kind: string; line: number; column: number; from: string; to: string; original: string; mutated: string; matters: number | null; survives: number | null; equivalent?: boolean; invalid?: boolean; no_coverage?: boolean }
const rows = readFileSync(mapFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const candidates = rows.filter(([list]) => list === 'methods').flatMap(([, m]) => {
  const best = (m.mutants as Mutant[]).filter((x) => x.survives === 1 && !x.equivalent && !x.invalid && !x.no_coverage && (x.matters ?? 0) >= 0.5 && BEHAVIOR.has(x.kind))
    .sort((a, b) => (b.matters ?? 0) - (a.matters ?? 0))[0];
  return best ? [{ path: m.path as string, method: m.name as string, ...best }] : [];
}).sort((a, b) => (b.matters ?? 0) - (a.matters ?? 0)).slice(0, Number(flag('count') ?? 10));
if (!candidates.length) { console.error(`${mapFile} has no surviving mutant a caller could see`); process.exit(1); }

if (!existsSync(planted)) {
  const r = await run('git', ['-C', dir, 'worktree', 'add', '--detach', planted, 'HEAD']);
  if (r.code !== 0) { console.error(r.stderr); process.exit(1); }
} else await run('git', ['-C', planted, 'checkout', '--', '.']);
// The checkout's build spec, so the copy builds the same way without writing one.
const spec = join(dir, '.refuzz', language, 'build');
if (existsSync(spec)) cpSync(spec, join(planted, '.refuzz', language, 'build'), { recursive: true });

// Each edit at its place: the mutant's node text at its line and column, replaced. One the file no longer has is skipped.
const done: (typeof candidates[number] & { function: string; startLine: number; endLine: number })[] = [];
const byFile = new Map<string, typeof candidates>();
for (const c of candidates) byFile.set(c.path, [...(byFile.get(c.path) ?? []), c]);
for (const [path, list] of byFile) {
  let text = readFileSync(join(planted, path), 'utf8');
  // From the bottom up, so an edit never moves the place of one still to make.
  for (const c of [...list].sort((a, b) => b.line - a.line || b.column - a.column)) {
    const lines = text.split('\n');
    const at = lines.slice(0, c.line - 1).reduce((n, l) => n + l.length + 1, 0) + c.column;
    if (!text.startsWith(c.from, at)) { console.log(`  skipped ${path}:${c.line}: the code there is not \`${c.from.slice(0, 60)}\``); continue; }
    text = text.slice(0, at) + c.to + text.slice(at + c.from.length);
    done.push({ ...c, function: '', startLine: c.line, endLine: c.line });
  }
  writeFileSync(join(planted, path), text);
}
// Each planted line's function, as the fuzzer names it, for --only.
const p = await readProject(planted);
for (const d of done) { const t = p.at(d.path, d.line); d.function = t?.qualifiedName ?? d.method; d.startLine = t?.line ?? d.line; d.endLine = t?.endLine ?? d.line; }
mkdirSync(join(planted, '.refuzz'), { recursive: true });
writeFileSync(join(planted, '.refuzz', 'planted.json'), JSON.stringify({ from: mapFile, repo, language, mutants: done }, null, 2));
for (const d of done) console.log(`  ${d.path}:${d.line} ${d.function} (${d.kind}, ${Math.round((d.matters ?? 0) * 100)}%): ${d.original.trim()} → ${d.mutated.trim()}`);
console.log(`\n${done.length} planted in ${planted}\nfuzz it: npx tsx src/cli.ts ${planted} --language ${language} --only ${[...new Set(done.map((d) => d.function))].join(',')} --minutes 30\nscore it: npx tsx src/score.ts --planted ${planted}`);
