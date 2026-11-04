/**
 * Each surface's fuzzing state, kept between runs in one folder, the way a project keeps its OSS-Fuzz targets and corpora,
 * and written the way libFuzzer and AFL++ write theirs: at the moment something is found, never only at the end, so a run
 * stopped at any point loses at most the last few seconds of counts.
 *   surface.yaml   what the surface is (its entry points, the sources feeding it, the code it reaches), its coverage, its targets
 *   targets/       every fuzz target that builds and reaches the surface, one OSS-Fuzz file each. Targets are added, never
 *                  replaced by a better one: a target is rewritten only when it stops building or loading (from its error),
 *                  and removed only when pruning finds it covers nothing the others do not and has found nothing
 *   dict.txt       tokens of the surface's code, in libFuzzer's dictionary format, shared by every target
 *   corpus/        raw input bytes, one file per input that found surface coverage, named by its content hash, shared by every
 *                  target of the surface; a later run replays them first and then shrinks the folder to the fewest that still
 *                  cover what they covered
 *   coverage.json  surface lines covered since the code last changed, each target's contribution, the branches judged cold,
 *                  the promises the surface's entry points make, every run; rewritten every few seconds and when the
 *                  process is stopped
 *   findings/      one folder per failure cause, written when it is first seen and updated when it is judged: the finding, its
 *                  input, and for a confirmed defect an issue and a pull request written for the maintainers
 *   rejects/       targets that never built or never reached the surface, with why, to read later
 * The folders live in the project, in `.refuzz/<language>/<surface>/`, so they are committed with it and every checkout
 * starts where the last run left off. Beside the surfaces, `build/` holds the project's OSS-Fuzz build spec (src/build.ts)
 * and `oss-fuzz/` the OSS-Fuzz project folder built from it and the kept targets. A `.gitignore` keeps out findings (a
 * confirmed one can be an unfixed vulnerability), rejects and the OSS-Fuzz folder, which is rebuilt from the rest. Coverage written for code that has since changed is not taken; targets, the corpus and
 * the findings' inputs are, and run first.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Finding } from './engine.ts';
import type { Surface } from './surface.ts';
import type { Runtime } from './types.ts';

export interface RunRecord {
  at: string;
  execs: number;
  /** Surface lines this run's inputs ran, and the surface's lines in all. */
  covered: number;
  total: number;
  /** Entry points some input of this run reached: the surface confirmed as a way in. */
  entriesReached: string[];
  targets: number;
  defects: number;
  /** How long the surface was fuzzed this run, and the surface lines it covered for the first time. */
  ms?: number;
  gained?: number;
}

/** Where a surface's improvement loop stands (src/fuzzer.ts): kept between sessions while its code is unchanged. */
export interface Round { budgetMs: number; flat: number; iterations: number; plateaued: boolean }

/** What one target added, over its last run: surface lines it ran, lines no other target ran, inputs, findings. */
export interface Contribution { lines: number; unique: number; execs: number; findings: number }

export interface StoredTarget { name: string; source: string }

/**
 * Something a surface's entry points promise their callers, for a target's assertions to check (src/fuzzer.ts): a documented
 * error on bad input, a return contract, a round trip, two documented ways of computing the same thing agreeing, a bound, or
 * a weakness class's invariant. `id` is short and stable (a target's `refuzz-promises:` tag names it); `source` says where it
 * comes from (`doc comment of Parser.parse`, `signature of decode`, `weakness class CWE-125`).
 *   checkedBy   the kept targets whose assertions check it, when the state was last saved
 *   asked       improvement moves, made after coverage plateaued, that asked for a target checking it
 *   untestable  why no fuzz target can check it: the writer said so, or moves asking for it never got one
 *   dropped     why it is not a promise after all: verification found the documentation does not promise it
 *   broken      the bug verification confirmed through a target checking it
 * A promise untestable or dropped is no longer counted; a broken one counts as checked.
 */
export interface SurfacePromise { id: string; statement: string; source: string; checkedBy?: string[]; asked?: number; untestable?: string; dropped?: string; broken?: string }

/**
 * What fuzzing a surface is worth, from the judge (src/fuzzer.ts scoreSurfaces), kept in worth.json beside its coverage and
 * asked again only when its code changes: how directly outside data reaches it, what a bug there does, and the two combined.
 */
export interface SurfaceWorth {
  /** 0..1: how directly outside data reaches it and what a bug there does, one score. */
  worth: number;
  /** How likely each kind of harness (src/fuzzer.ts HARNESS_KINDS) is to expose a defect here, 0..1 by kind id. */
  kinds?: Record<string, number>;
}

export interface Stored {
  targets: StoredTarget[];
  /** Every stored input, by its file name (its content hash). */
  corpus: { name: string; input: Buffer }[];
  /** Inputs of failures found before, judged or not: run again so an unjudged one is judged and a fixed one is seen to be. */
  failing: Buffer[];
  /** `path:line` of every surface line covered since the code last changed. */
  covered: Set<string>;
  contribution: Record<string, Contribution>;
  /** Branches (`path:line`) the writer judged cold since the code last changed: not worth aiming inputs at again. */
  skipped: Set<string>;
  /** The promises its entry points make, listed since the code last changed; undefined when not listed for this code yet. */
  promises?: SurfacePromise[];
  runs: RunRecord[];
  round?: Round;
  /** The judge's worth for this code; undefined until asked. */
  worth?: SurfaceWorth;
  /** For a handler surface: the flow conditions (src/fuzzer.ts FLOW_CONDITIONS) a flow test has tried on this code, by id. */
  flows?: Record<string, string>;
  /** Never fuzzed; or fuzzed before and its code changed since. */
  fresh: boolean;
  changed: boolean;
}

export const EXT: Record<string, string> = { rust: 'rs', c: 'c', cpp: 'cpp', python: 'py', javascript: 'js', typescript: 'ts', tsx: 'ts', go: 'go', java: 'java', kotlin: 'kt', scala: 'scala', groovy: 'groovy', ruby: 'rb', php: 'php', lua: 'lua', c_sharp: 'cs', swift: 'swift', zig: 'zig', solidity: 'sol', bash: 'sh' };

const sha = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');

/**
 * A path that, if it exists, is a directory and not a link to one (`lstat` reports a link, dangling or not, as a link): the
 * store never writes where a symlink points.
 */
function realDirectory(at: string) {
  let stat;
  try { stat = lstatSync(at); } catch { return; }
  if (!stat.isDirectory()) throw new Error(`${at} is not a directory (a symlink or a file): refuzz does not write through it`);
}

/** Written whole and renamed, so a killed run leaves no half file. */
function put(file: string, data: string | Buffer) {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** A value as YAML: maps, lists, strings, numbers and booleans, block style. */
function yaml(v: unknown, indent = ''): string {
  const scalar = (x: unknown) => typeof x === 'string' ? (/^[\w./:@-][\w ./:@#()<>,+-]*$/.test(x) && !/^(true|false|null|yes|no|~|\d.*)$/i.test(x) && !/:\s|\s#|\s$/.test(x) ? x : JSON.stringify(x)) : String(x);
  if (Array.isArray(v)) return v.length ? v.map((x) => x && typeof x === 'object' ? `${indent}-\n${yaml(x, `${indent}  `)}` : `${indent}- ${scalar(x)}`).join('\n') : `${indent}[]`;
  if (v && typeof v === 'object') return Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => x && typeof x === 'object' && (!Array.isArray(x) || x.length) ? `${indent}${k}:\n${yaml(x, `${indent}  `)}` : `${indent}${k}: ${Array.isArray(x) ? '[]' : scalar(x)}`).join('\n');
  return `${indent}${scalar(v)}`;
}

/** libFuzzer's dictionary format: one quoted entry per line, bytes outside printable ASCII escaped. */
export function dictionary(terms: string[]): string {
  const esc = (t: string) => [...Buffer.from(t, 'utf8')].map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('');
  return [...new Set(terms.filter((t) => t.length && t.length <= 128))].map((t) => `"${esc(t)}"`).join('\n') + '\n';
}

/**
 * The fewest inputs that still cover every surface line any of them covered: greedy set cover, the input adding the most
 * uncovered lines first. libFuzzer's `-merge=1` does the same for its corpus.
 */
export function minimize(inputs: { input: Buffer; lines: string[] }[]): Buffer[] {
  const left = new Set(inputs.flatMap((x) => x.lines));
  const pool = [...inputs].sort((a, b) => a.input.length - b.input.length);
  const out: Buffer[] = [];
  while (left.size) {
    let best = -1, gain = 0;
    pool.forEach((x, i) => { const g = x.lines.reduce((n, l) => n + Number(left.has(l)), 0); if (g > gain) { gain = g; best = i; } });
    if (best < 0) break;
    for (const l of pool[best].lines) left.delete(l);
    out.push(pool[best].input);
    pool.splice(best, 1);
  }
  return out;
}

export class SurfaceStore {
  readonly root: string;
  readonly ext: string;

  private constructor(root: string, language: string) { this.root = root; this.ext = EXT[language] ?? 'txt'; }

  /**
   * The store for one project and language: `given` (`--store`), or the project's `.refuzz/<language>`. A project fuzzed
   * is one nobody here wrote, so a path into it that a symlink diverts (a committed `.refuzz` or `.refuzz` link) is
   * refused rather than written through.
   */
  static async open(dir: string, language: string, given?: string): Promise<SurfaceStore> {
    if (given) return new SurfaceStore(resolve(given, language), language);
    const base = resolve(dir, '.refuzz');
    for (const at of [resolve(dir, '.refuzz'), base, join(base, language)]) realDirectory(at);
    mkdirSync(base, { recursive: true });
    if (!existsSync(join(base, '.gitignore'))) put(join(base, '.gitignore'), '# refuzz: build specs, targets, corpora, dictionaries and coverage are committed; these are not.\n*/*/findings/\n*/*/rejects/\n*/oss-fuzz/\n*.tmp\n');
    return new SurfaceStore(join(base, language), language);
  }

  /** A surface's folder, its own and its subfolders checked as the store's are: a committed link there is not followed. */
  folder(s: Surface): string {
    const dir = join(this.root, s.id);
    for (const at of [dir, ...['targets', 'corpus', 'findings', 'rejects'].map((x) => join(dir, x))]) realDirectory(at);
    return dir;
  }

  /** What earlier runs left for a surface. `hash` is its code's (surface.ts sourceHash): coverage of other code is not taken. */
  load(s: Surface, hash: string): Stored {
    const dir = this.folder(s);
    const files = (sub: string) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((f) => !f.endsWith('.tmp')).sort() : []);
    const targets = files('targets').filter((f) => f.endsWith(`.${this.ext}`)).map((f) => ({ name: f.slice(0, -this.ext.length - 1), source: readFileSync(join(dir, 'targets', f), 'utf8') }));
    const corpus = files('corpus').map((name) => ({ name, input: readFileSync(join(dir, 'corpus', name)) }));
    const failing = files('findings').filter((f) => existsSync(join(dir, 'findings', f, 'input.bin'))).map((f) => readFileSync(join(dir, 'findings', f, 'input.bin')));
    let state: { hash?: string; covered?: string[]; runs?: RunRecord[]; contribution?: Record<string, Contribution>; skipped?: string[]; promises?: SurfacePromise[]; round?: Round } = {};
    try { state = JSON.parse(existsSync(join(dir, 'coverage.json')) ? readFileSync(join(dir, 'coverage.json'), 'utf8') : '{}'); } catch {}
    const same = state.hash === hash;
    let worth: (SurfaceWorth & { hash?: string }) | undefined;
    try { worth = existsSync(join(dir, 'worth.json')) ? JSON.parse(readFileSync(join(dir, 'worth.json'), 'utf8')) : undefined; } catch {}
    let flows: { hash?: string; tried?: Record<string, string> } | undefined;
    try { flows = existsSync(join(dir, 'flows.json')) ? JSON.parse(readFileSync(join(dir, 'flows.json'), 'utf8')) : undefined; } catch {}
    return { targets, corpus, failing, covered: new Set(same ? state.covered ?? [] : []), contribution: same ? state.contribution ?? {} : {}, skipped: new Set(same ? state.skipped ?? [] : []), promises: same && Array.isArray(state.promises) ? state.promises : undefined, runs: state.runs ?? [], round: same ? state.round : undefined, worth: worth?.hash === hash && typeof worth.worth === 'number' ? { worth: worth.worth, ...(worth.kinds ? { kinds: worth.kinds } : {}) } : undefined, flows: flows?.hash === hash ? flows.tried ?? {} : undefined, fresh: !state.hash, changed: !!state.hash && !same };
  }

  /** A flow condition tried on a handler surface, and what its test concluded, for this code. */
  saveFlow(s: Surface, hash: string, condition: string, verdict: string) {
    const file = join(this.folder(s), 'flows.json');
    let state: { hash?: string; tried?: Record<string, string> } = {};
    try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {}
    if (state.hash !== hash) state = { hash, tried: {} };
    state.tried = { ...state.tried, [condition]: verdict };
    put(file, JSON.stringify(state, null, 2));
  }

  /** The judge's worth for a surface's code, in its own file: it says nothing about whether the surface was fuzzed. */
  saveWorth(s: Surface, hash: string, worth: SurfaceWorth) {
    put(join(this.folder(s), 'worth.json'), JSON.stringify({ hash, ...worth }, null, 2));
  }

  /** The name the next new target of a surface takes: fuzz_1, fuzz_2, …, never one used before, kept or rejected. */
  nextName(s: Surface, taken: Iterable<string> = []): string {
    const dir = this.folder(s);
    const used = [...['targets', 'rejects'].flatMap((x) => (existsSync(join(dir, x)) ? readdirSync(join(dir, x)) : [])), ...taken].map((f) => Number(/^fuzz_(\d+)\b/.exec(f)?.[1] ?? 0));
    return `fuzz_${Math.max(0, ...used) + 1}`;
  }

  /** A target that builds and reached the surface, written the moment it did: a new one, or one rewritten from its error. */
  /** How the surface's promises break into properties of the functions it hands its input to, and what no part covers. */
  /** A part of the surface's decomposition, added to what earlier parts wrote. */
  addDecomposition(s: Surface, text: string) {
    const path = join(this.folder(s), 'decomposition.md');
    const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (!before.includes(text.trim())) put(path, `${before}${before ? '\n' : ''}${text.trim()}\n`);
  }

  saveTarget(s: Surface, name: string, source: string) {
    put(join(this.folder(s), 'targets', `${name}.${this.ext}`), source);
  }

  /** A target taken out of the portfolio, kept in rejects/ with why: it could not be fixed, or it added nothing. */
  dropTarget(s: Surface, name: string, source: string, why: string) {
    const dir = this.folder(s);
    rmSync(join(dir, 'targets', `${name}.${this.ext}`), { force: true });
    put(join(dir, 'rejects', `${name}.${this.ext}`), source);
    put(join(dir, 'rejects', `${name}.txt`), `${why}\n`);
  }

  /** A target the writer wrote that did not build or reach, with why, to read later. */
  reject(s: Surface, name: string, source: string, why: string) {
    put(join(this.folder(s), 'rejects', `${name}.failed.txt`), `${why}\n\n${source}`);
  }

  saveDictionary(s: Surface, terms: string[]) {
    put(join(this.folder(s), 'dict.txt'), dictionary(terms));
  }

  /** An input that found surface coverage, written the moment it did. Named by its hash, so writing one twice changes nothing. */
  addInput(s: Surface, input: Buffer) {
    const file = join(this.folder(s), 'corpus', sha(input));
    if (!existsSync(file)) put(file, input);
  }

  /**
   * The corpus shrink, the separate pass libFuzzer's `-merge=1` is: of the stored inputs this run replayed, the ones not among
   * the fewest covering what all of them covered are deleted. Inputs written since are new coverage and stay.
   */
  shrink(s: Surface, replayed: { input: Buffer; lines: string[] }[], stored: string[]): number {
    const kept = minimize(replayed);
    const keep = new Set(kept.map((b) => sha(b)));
    for (const b of kept) this.addInput(s, b);
    let removed = 0;
    for (const name of stored) if (!keep.has(name)) { rmSync(join(this.folder(s), 'corpus', name), { force: true }); removed++; }
    return removed;
  }

  /**
   * A change to a surface's stored promises made outside its search (a verdict arriving while no batch runs it): applied to
   * coverage.json in place, only while it was written for the same code.
   */
  updatePromises(s: Surface, hash: string, change: (list: SurfacePromise[]) => void) {
    const file = join(this.folder(s), 'coverage.json');
    let state: { hash?: string; promises?: SurfacePromise[] } = {};
    try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { return; }
    if (state.hash !== hash || !Array.isArray(state.promises)) return;
    change(state.promises);
    put(file, JSON.stringify(state, null, 2));
  }

  /** Coverage, each target's contribution and the runs so far, with surface.yaml describing them. Synchronous, so a signal handler can call it. */
  saveState(s: Surface, o: { hash: string; covered: Set<string>; total: number; contribution: Record<string, Contribution>; skipped: Set<string>; promises?: SurfacePromise[]; runs: RunRecord[]; round: Round }) {
    const dir = this.folder(s);
    const runs = o.runs.slice(-50);
    put(join(dir, 'coverage.json'), JSON.stringify({ hash: o.hash, covered: [...o.covered].sort(), contribution: o.contribution, skipped: [...o.skipped].sort(), promises: o.promises, runs, round: o.round }, null, 2));
    const reached = new Set(runs.flatMap((r) => r.entriesReached));
    const count = (sub: string) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((f) => !f.endsWith('.tmp')).length : 0);
    put(join(dir, 'surface.yaml'), `${yaml({
      id: s.id,
      language: s.language,
      confirmed: reached.size > 0,
      entries: s.entries.map((e) => ({ name: e.qualifiedName, at: `${e.path}:${e.line}`, reached: reached.has(e.qualifiedName) })),
      sources: s.sources.map((x) => ({ kind: x.kind, api: x.api, at: `${x.path}:${x.line}`, in: x.in })),
      via: s.via.map((v) => ({ name: v.qualifiedName, at: `${v.path}:${v.line}` })),
      reaches: s.reach.length,
      code: o.hash,
      coverage: { lines: o.covered.size, of: o.total, percent: o.total ? Math.round((1000 * o.covered.size) / o.total) / 10 : 0 },
      promises: o.promises?.map((x) => ({ id: x.id, statement: x.statement, source: x.source, state: x.dropped ? 'dropped' : x.untestable ? 'untestable' : x.broken ? 'broken' : x.checkedBy?.length ? 'checked' : 'unchecked' })),
      targets: Object.entries(o.contribution).map(([name, c]) => ({ name, lines: c.lines, unique: c.unique, execs: c.execs, findings: c.findings })),
      corpus: count('corpus'),
      runs: runs.map((r) => ({ at: r.at, execs: r.execs, covered: r.covered, targets: r.targets, defects: r.defects })),
    })}\n`);
  }

  /**
   * A failure, kept with its input the moment it is seen, and again when it is judged. A confirmed defect is written up for
   * the maintainers: issue.md reports it, pr.md proposes adding the target that found it with the input as a regression seed.
   * Nothing is filed or opened from here. One judged not a defect keeps only its record.
   */
  saveFinding(s: Surface, f: Finding, input: Buffer, confirmed: boolean, target?: string): string {
    const id = sha(`${f.kind}|${f.type}|${f.where}|${f.kind === 'crash' ? '' : f.function}`).slice(0, 12);
    const dir = join(this.folder(s), 'findings', id);
    put(join(dir, 'finding.json'), JSON.stringify({ ...f, target, judged: f.defect !== undefined }, null, 2));
    put(join(dir, 'input.bin'), input);
    if (!confirmed) {
      rmSync(join(dir, 'issue.md'), { force: true });
      rmSync(join(dir, 'pr.md'), { force: true });
      return dir;
    }
    const what = f.kind === 'property' ? 'breaks a property it promises' : f.kind === 'hang' ? 'hangs' : `${f.type}`;
    const where = f.where.includes(':') ? f.where : f.function;
    const entry = s.entries[0];
    const file = target ? `${target}.${this.ext}` : 'the fuzz target';
    put(join(dir, 'issue.md'), [
      `# ${f.function}: ${what} at ${where}`,
      '',
      `${f.message.split('\n')[0]}`,
      '',
      `Reached through \`${entry.qualifiedName}\` (${entry.path}:${entry.line})${s.sources.length ? `, which receives data from \`${s.sources[0].api}\` at ${s.sources[0].path}:${s.sources[0].line}` : ''}.`,
      '',
      '## Input',
      '',
      '`input.bin`, the raw bytes the fuzz target was given. As text:',
      '',
      '```',
      (f.input ?? '').slice(0, 4000),
      '```',
      '',
      ...(f.stack.length ? ['## Stack', '', '```', ...f.stack.slice(-20), '```', ''] : []),
      ...(f.kind === 'property' && f.line ? ['## The assertion that failed', '', '```', f.line.slice(0, 3000), '```', ''] : []),
      '## Reproducing',
      '',
      `The language's \`oss-fuzz/\` folder beside the surfaces is an OSS-Fuzz project holding ${file}: with OSS-Fuzz's helper, \`python infra/helper.py build_fuzzers --sanitizer address <project> <checkout>\` then \`python infra/helper.py reproduce <project> <target> input.bin\`.`,
      '',
    ].join('\n'));
    put(join(dir, 'pr.md'), [
      `# Add a fuzz target for ${entry.qualifiedName}`,
      '',
      `This adds an OSS-Fuzz target for the code reached through ${s.entries.map((e) => `\`${e.qualifiedName}\``).join(', ')}, with a dictionary and a seed corpus, and the input that ${f.kind === 'hang' ? 'hangs' : f.kind === 'property' ? 'breaks a property' : 'crashes'} at ${where} as a regression seed.`,
      '',
      `Files: the project's OSS-Fuzz folder (\`oss-fuzz/\`: Dockerfile, build.sh, project.yaml) with ${file}, its dictionary and seed corpus under \`refuzz/\`.`,
      '',
    ].join('\n'));
    return dir;
  }

  /** The language's build spec folder (src/build.ts), beside the surfaces. */
  get specDir(): string {
    realDirectory(join(this.root, 'build'));
    return join(this.root, 'build');
  }

  /**
   * The language's OSS-Fuzz project folder, `oss-fuzz/`: what OSS-Fuzz's `projects/<name>/` would hold to run every kept
   * target. The build spec's Dockerfile with the targets copied in, its build.sh followed by each target's build lines, its
   * project.yaml, and under refuzz/ each target with its dictionary and seed corpus (the surface's corpus and every
   * confirmed finding's input). Written whole each time; returns the targets' OSS-Fuzz names.
   */
  exportProject(rt: Runtime, targets: { surface: Surface; name: string; source: string }[]): string[] {
    const spec = this.specDir;
    const read = (f: string) => (existsSync(join(spec, f)) ? readFileSync(join(spec, f), 'utf8') : '');
    if (!rt.fuzz || !read('Dockerfile') || !read('build.sh')) return [];
    const out = join(this.root, 'oss-fuzz');
    realDirectory(out);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'refuzz'), { recursive: true });
    const lines: string[] = [];
    const names: string[] = [];
    for (const t of targets) {
      const name = `${t.surface.id}_${t.name}`.replace(/[^A-Za-z0-9_]/g, '_');
      const { file, source, compile } = rt.fuzz.oss(name, t.source);
      const folder = this.folder(t.surface);
      writeFileSync(join(out, 'refuzz', file), source);
      if (existsSync(join(folder, 'dict.txt'))) writeFileSync(join(out, 'refuzz', `${name}.dict`), readFileSync(join(folder, 'dict.txt')));
      const seeds = join(out, 'refuzz', `${name}_seed_corpus`);
      mkdirSync(seeds, { recursive: true });
      for (const f of existsSync(join(folder, 'corpus')) ? readdirSync(join(folder, 'corpus')) : []) writeFileSync(join(seeds, f), readFileSync(join(folder, 'corpus', f)));
      for (const f of existsSync(join(folder, 'findings')) ? readdirSync(join(folder, 'findings')) : []) if (existsSync(join(folder, 'findings', f, 'issue.md'))) writeFileSync(join(seeds, `regression-${f}`), readFileSync(join(folder, 'findings', f, 'input.bin')));
      lines.push(...compile, `[ -f $SRC/refuzz/${name}.dict ] && cp $SRC/refuzz/${name}.dict $OUT/${name}.dict`, `(cd $SRC/refuzz/${name}_seed_corpus && zip -q -r $OUT/${name}_seed_corpus.zip . || true)`);
      names.push(name);
    }
    const dockerfile = read('Dockerfile').trimEnd().split('\n');
    const at = dockerfile.findIndex((l) => /^\s*COPY\s+build\.sh/i.test(l));
    dockerfile.splice(at >= 0 ? at + 1 : dockerfile.length, 0, 'COPY refuzz $SRC/refuzz');
    writeFileSync(join(out, 'Dockerfile'), `${dockerfile.join('\n')}\n`);
    writeFileSync(join(out, 'build.sh'), `${read('build.sh').trimEnd()}\n\n# Fuzz targets written by refuzz, one per line group, each with its dictionary and seed corpus.\n${lines.join('\n')}\n`);
    chmodSync(join(out, 'build.sh'), 0o755);
    writeFileSync(join(out, 'project.yaml'), read('project.yaml').replace(/^# project:.*\n/m, ''));
    return names;
  }
}
