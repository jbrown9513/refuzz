/**
 * Verification: what the fuzzer flags is reported as a bug only once a failing test in the project's own test suite proves it,
 * the proof a maintainer accepts and the regression test that goes with the fix.
 *
 *   group      one candidate per function and kind of failure (candidateKey), its likeliest finding; one that did not happen
 *              again when run alone is left out.
 *   judge      one cheap judgment per candidate, all asked together: could a real caller hit it through the public API, does
 *              it break what the function documents, and is the input valid data or malformed data from outside. The
 *              judgment orders the candidates, likeliest first; it decides nothing, since a bug is a bug and the judge has
 *              read only the failure. The failing test is the proof, and a test that passes is what tells the target off.
 *   test       the writer writes one test in the project's framework and style, beside its tests, from an existing test of
 *              the same code, and it runs twice with the project's one-file test runner (test.sh wrote it, src/build.ts).
 *   check      the judge reads the test's output with the function's code and its callers: did it fail because of the bug,
 *              and not setup, imports or the test itself. A test that falls short goes back to the writer with its output
 *              while the rewrites make progress.
 *   reach      a function the project's own code calls must fail from where its callers enter too: a second test starts at
 *              an entry point (a command, a request, the public function a user calls) with input a user could give, and
 *              must fail because of the same bug. A failure only a direct call reaches is not a bug.
 *   verdict    a bug, or not a bug with the reason, and either way a test that was run decided it.
 *   record     the tests that pass are grouped by root cause into bugs (src/report.ts), checked against GitHub's issues.
 *
 * Each session also runs every open bug's test again: one that passes was fixed by the commits since.
 */
import type { DecisionModel } from './llm/models.ts';
import { createHash } from 'node:crypto';
import { choice, noul } from './llm/questions.ts';
import { tooLong, type Writer } from './llm/writer.ts';
import { errorClass, type Finding } from './engine.ts';
import { coverageFor as coverageOf, type Coverage } from './coverage.ts';
import { apiOf, type Api } from './api.ts';
import { containerPlace, type Place } from './place.ts';
import type { Bug, Reports, Site } from './report.ts';
import { PARALLEL, pool as inParallel, run, shq } from './run.ts';
import { OutOfBudget } from './schedule.ts';
import { shipped, shippedPath } from './surface.ts';
import { sourceOf, testsCalling, typesDeclaredAt, type Project } from './syntax.ts';
import type { Built, Runtime, Target } from './types.ts';

export interface Verified { key: string; finding: Finding; site: Site; path: string; source: string; command: string; input: Buffer; observed: string; documented: string; valid: boolean }

/** The input a finding records, as bytes: `hex …`, or the text as a JSON string. */
export function inputOf(f: Finding): Buffer {
  const x = f.input ?? '';
  if (x.startsWith('hex ')) return Buffer.from(x.slice(4), 'hex');
  try { return Buffer.from(JSON.parse(x), 'utf8'); } catch { return Buffer.from(x, 'utf8'); }
}

/**
 * The project line a failure happened at, and the function it is in: the innermost frame in the project's shipped code. A
 * frame in the fuzz target (its own assertion), a test, or an example is where the target noticed, not where the project failed.
 */
export function siteOf(p: Project, f: Finding): Site {
  for (const s of [...f.stack].reverse()) {
    const frame = /^(.+):(\d+) (\S+)$/.exec(s);
    if (frame && p.files.has(frame[1]) && shippedPath(frame[1]) && !p.at(frame[1], Number(frame[2]))?.test) return { path: frame[1], line: Number(frame[2]), function: frame[3] };
  }
  const t = p.targets.find((x) => x.qualifiedName === f.function);
  return { path: t?.path ?? '', line: t?.line ?? 0, function: f.function };
}

/** The project's functions on the failure's stack, innermost last. */
function stackTargets(p: Project, f: Finding): Target[] {
  const out = f.stack.flatMap((s) => {
    const m = /^(.+):(\d+) (\S+)$/.exec(s);
    if (!m) return [];
    const line = Number(m[2]);
    const t = p.targets.find((x) => x.path === m[1] && line >= x.line && line <= x.endLine);
    return t ? [t] : [];
  });
  if (out.length) return out;
  const t = p.targets.find((x) => x.qualifiedName === f.function && !x.test);
  return t ? [t] : [];
}

/**
 * The paths into a function from the shipped code's entry points (functions nothing in the project calls), each written
 * `entry → … → function`, and the functions that call it directly. Empty when nothing in the project calls it: then the
 * function is itself where callers enter. Shown are as many paths as a test writer can read through (`shown`).
 */
export function calledByName(p: Project, ok: (t: Target) => boolean, fn: Target, most = 8): Target[] {
  // A file holding an instance of the method's class names the class (an import, a type, a constructor): one that only
  // calls a method of the same name on something else (every `super().__init__()`) does not.
  const owner = fn.qualifiedName.split(/\.|::/).at(-2), named = owner && new RegExp(`\\b${owner.replace(/[^\w]/g, '')}\\b`);
  if (!named) return [];
  // A constructor is called by its class's name.
  const call = /^(__init__|constructor|new)$/.test(fn.name) ? new RegExp(`${named.source}\\s*\\(`) : new RegExp(`[.:>]${fn.name.replace(/[^\w]/g, '\\$&')}\\s*\\(`);
  const found = new Map<string, Target>();
  for (const [path, language] of p.files) {
    if (language !== fn.language || found.size >= most) continue;
    const text = p.read(path);
    if (!named.test(text)) continue;
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      if (found.size >= most || !call.test(l)) return;
      const t = p.at(path, i + 1);
      if (t && t.id !== fn.id && !t.test && ok(t)) found.set(t.id, t);
    });
  }
  return [...found.values()];
}

function callerPaths(p: Project, ok: (t: Target) => boolean, fn: Target, shown: number, api: Api): { paths: string[]; direct: Target[]; chains: Target[][] } {
  const up = (t: Target) => p.callers(t.id).map((id) => p.byId.get(id)).filter((c): c is Target => !!c && ok(c));
  // The graph misses a method called through a field or parameter (`self._channel.register(...)`): with no caller in it, the
  // methods that call one of that name in the project's own code, in its language, stand in for them.
  const graphed = up(fn), direct = graphed.length || fn.name === fn.qualifiedName ? graphed : calledByName(p, ok, fn);
  const chains: Target[][] = [];
  const queue: Target[][] = direct.map((c) => [c, fn]);
  const seen = new Set([fn.id, ...direct.map((c) => c.id)]);
  // A path ends where users call in (src/api.ts), or where nothing calls further up.
  while (queue.length && chains.length < shown) {
    const chain = queue.shift()!;
    const next = api.has(chain[0]) ? [] : up(chain[0]).filter((c) => !seen.has(c.id));
    if (!next.length) { chains.push(chain); continue; }
    for (const c of next) { seen.add(c.id); queue.push([c, ...chain]); }
  }
  return { paths: chains.map((c) => c.map((t) => `${t.qualifiedName}${api.has(t) ? ' (users call this)' : ''}`).join(' → ')), direct, chains };
}

/** One key per failing line: the many inputs and targets that fail there are one candidate. */
/**
 * One candidate per function and kind of failure: the target's assertions in a function are one candidate, and so is each
 * error type it raises. The many lines, inputs and targets behind it are one test's worth of proof.
 */
export const candidateKey = (language: string, f: Finding, site: Site) => `${language}|${site.path}|${site.function}|${f.kind === 'property' ? 'assertion' : `${f.kind}|${f.type}`}`;

/**
 * A test file of the project to write the new test like: one that tests a function on the stack, innermost first, else the
 * test file nearest the failing code.
 */
function exampleTest(p: Project, stack: Target[], site: Site): { path: string; text: string } | undefined {
  for (const t of [...stack].reverse()) {
    const test = testsCalling(p, t, 1)[0];
    if (test) return { path: test.path, text: p.read(test.path) };
  }
  const shared = (a: string, b: string) => { const x = a.split('/'), y = b.split('/'); let n = 0; while (n < x.length && x[n] === y[n]) n++; return n; };
  const files = [...new Set(p.targets.filter((t) => t.test && t.language === (stack[0]?.language ?? t.language)).map((t) => t.path))];
  const near = files.sort((a, b) => shared(b, site.path) - shared(a, site.path))[0];
  return near ? { path: near, text: p.read(near) } : undefined;
}

/**
 * What a test ran of the code on a failure's stack, as its runner measured it: each function entered or not, and whether the
 * failing line ran. Nothing measured (a runner that cannot say, or a run that ended before writing) says nothing either way.
 */
function ranOf(stack: Target[], site: Site, ran: Set<string> | undefined, output = ''): { missed: boolean; text: string } {
  if (!ran) return { missed: false, text: '' };
  const lines = (t: Target) => { let n = 0; for (let l = t.line; l <= t.endLine; l++) if (ran.has(`${t.path}:${l}`)) n++; return n; };
  // A traceback naming the line (Python's `file.py", line 20`, Go's and others' `file.go:20`) shows it ran, whatever the
  // measurement missed: code in a thread or process the measuring did not reach.
  const file = site.path.split('/').pop()!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A failure placed at its function's first line (an assertion of the fuzz target's, with no project frame) ran if the test
  // entered the function: a declaration line is no statement, and Go's coverage never counts it.
  const whole = stack.find((t) => t.path === site.path && t.line === site.line);
  const hit = (whole ? lines(whole) > 0 : ran.has(`${site.path}:${site.line}`)) || new RegExp(`${file}"?,? (line )?:?${site.line}\\b|${file}:${site.line}\\b`).test(output);
  return { missed: !hit, text: `MEASURED, WHAT THE TEST RAN OF THE CODE ON THE STACK: ${stack.map((t) => `${t.qualifiedName} ${lines(t) ? `${lines(t)} lines` : 'never entered'}`).join('; ')}. The failing line ${site.path}:${site.line} ${hit ? 'ran' : 'NEVER RAN'}.` };
}

/**
 * The comments in the failing function near the failing line, and its doc: where a maintainer says a behavior is meant (an
 * overshoot by one that detects the limit, a fallback kept on purpose). Shown to the judge apart from the code, where a cheap
 * model reads past them.
 */
function commentsNear(p: Project, site: Site, around = 8): string {
  const fn = p.at(site.path, site.line);
  const lines = p.read(site.path).split('\n');
  const from = Math.max(fn?.line ?? site.line, site.line - around), to = Math.min(fn?.endLine ?? site.line, site.line + around);
  const said = lines.slice(from - 1, to).map((l, i) => ({ n: from + i, text: /(?:^\s*(?:\*|--)|(?:^|\s)(?:#|\/\/|\/\*))\s?(.*)$/.exec(l)?.[1]?.trim() })).filter((x) => x.text && /[a-z]{3}/i.test(x.text));
  return [fn?.doc ? `doc: ${fn.doc.slice(0, 600)}` : '', ...said.map((x) => `line ${x.n}: ${x.text}`)].filter(Boolean).join('\n');
}

/**
 * Where the project's own shipped code makes the values a test builds by hand: for each of the project's types the test
 * constructs (`Name{` or `Name(`), the places outside tests that construct one, with the lines that follow (a Go literal's
 * fields). A function nothing in the project calls (a framework's callback, a message handler) still only ever gets values the
 * project makes, and a test that builds one no producer makes has failed on an input no caller gives.
 */
function producersOf(p: Project, language: string, test: string, most = 4): string {
  const declared = typesDeclaredAt(p, language);
  const built = [...new Set([...test.matchAll(/\b([A-Z]\w*)\s*[{(]/g)].map((m) => m[1]).filter((n) => declared.has(n)))].slice(0, most);
  const out: string[] = [];
  for (const name of built) {
    const call = new RegExp(`\\b${name}\\s*[{(]`), sites: string[] = [];
    for (const [path, lang] of p.files) {
      if (lang !== language || sites.length >= most) continue;
      const lines = p.read(path).split('\n');
      for (let i = 0; i < lines.length && sites.length < most; i++) {
        if (!call.test(lines[i]) || /^\s*(type|class|struct|def|func)\b/.test(lines[i]) || p.at(path, i + 1)?.test) continue;
        sites.push(`${path}:${i + 1}\n${lines.slice(i, i + 4).join('\n')}`);
      }
    }
    out.push(`${name}: ${sites.length ? `made by the project at\n${sites.join('\n')}` : 'never made by the project\'s shipped code'}`);
  }
  return out.join('\n\n');
}

/**
 * How the project's shipped code calls the project functions a test calls: a few call sites of each, those the test passes
 * nil, None or an empty value to first. A test that hands a constructor nil where every caller passes a configured dependency
 * (weaviate's NewAggregateParser, given a nil qualifier the server always sets) fails on a call no caller makes.
 */
function callSitesOf(p: Project, language: string, test: string, most = 4): string {
  const shipped = new Set(p.targets.filter((t) => !t.test && t.language === language).map((t) => t.name));
  // A call's arguments run to the end of its line, nested calls and function literals included: enough to see a nil.
  const calls = [...test.matchAll(/\b([A-Za-z_]\w*)\s*\(([^\n]{0,300})/g)].filter((m) => shipped.has(m[1]) && !/^(get|set|len|str|int|map|list|dict|print|make|append|new|New|Error|Errorf|String)$/.test(m[1]));
  const empty = (args: string) => /\b(nil|None|null|undefined)\b|""|\{\}|\[\]/.test(args);
  const names = [...new Set([...calls].sort((a, b) => Number(empty(b[2])) - Number(empty(a[2]))).map((m) => m[1]))].slice(0, most);
  const out: string[] = [];
  for (const name of names) {
    const call = new RegExp(`\\b${name}\\s*\\(`), sites: string[] = [];
    for (const [path, lang] of p.files) {
      if (lang !== language || sites.length >= 3) continue;
      const lines = p.read(path).split('\n');
      for (let i = 0; i < lines.length && sites.length < 3; i++) {
        if (!call.test(lines[i]) || /^\s*(func|def|function|fn|pub fn|async def)\b/.test(lines[i]) || p.at(path, i + 1)?.test) continue;
        sites.push(`${path}:${i + 1}\n${lines.slice(i, i + 4).join('\n')}`);
      }
    }
    if (sites.length) out.push(`${name}: called by the project at\n${sites.join('\n')}`);
  }
  return out.join('\n\n');
}

/** Text without terminal colour and cursor codes. */
const plain = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
/**
 * What a test's output says went wrong: the assertion, error and panic lines, not the stack frames and the runner's own
 * summary lines around them (Go prints `panic.go:859 +0x120` and `FAIL pkg 0.05s`, which say nothing).
 */
const failureLines = (output: string) => output.split('\n').map((l) => l.trim()).filter((l) => /error|fail|assert|exception|panic|\.go:\d+:|\.py:\d+:|\bwant\b|\bexpected\b/i.test(l) && !/\+0x[0-9a-f]+$|^goroutine \d|^\/|^FAIL\s|^FAIL$|^ok\s|^=+ \d+ failed|^--- FAIL/.test(l)).slice(-4).join(' ');

/**
 * At most `n` lines of a test's output that say why it failed. The end alone does not: a runner prints the logs it
 * captured after the failure (pytest's "Captured log" sections, a server's shutdown), and those can fill any tail. So the
 * lines kept are the ones after each place a stack trace starts or the test file itself is named, in order, then the end.
 */
const telling = (lines: string[], testPath: string, n = 150) => {
  if (lines.length <= n) return lines;
  const file = testPath.split('/').pop()!;
  const keep = new Set<number>();
  for (let i = lines.length - 40; i < lines.length; i++) keep.add(i);
  for (let i = 0; i < lines.length && keep.size < n; i++) {
    if (!lines[i].includes(file) && !/Traceback \(most recent call last\)|^panic: |panicked at|^\s*--- FAIL|^E\s{2,}/.test(lines[i])) continue;
    for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 25) && keep.size < n; j++) keep.add(j);
  }
  const kept = [...keep].sort((a, b) => a - b);
  return kept.flatMap((i, k) => (k && i !== kept[k - 1] + 1 ? ['…', lines[i]] : [lines[i]]));
};

/** The first `n` characters of a part of a request, ending at a line, marked as cut. */
const fit = (text: string, n: number) => (text.length <= n ? text : `${text.slice(0, Math.max(0, text.lastIndexOf('\n', n)) || n)}\n… (cut to fit)`);

/**
 * How long one reproducer test may run: ten times what the project's own test of one file took when its test setup was
 * checked (built.testSeconds, its compile included, so a slow-building project gets the time its build needs), and at
 * least two minutes. With no measurement, fifteen minutes, as before.
 */
const testLimit = (built: Built) => (built.testSeconds ? Math.max(120, built.testSeconds * 10) : 900);

export class Verifier {
  private issues?: Promise<{ number: number; title: string; body: string; url: string }[]>;
  private readonly p: Project;
  private readonly rt: Runtime;
  private readonly built: Built;
  private readonly place: Place;
  private readonly models: { judge: DecisionModel; text: Writer };
  /** The fuzzing model's judge: cheap enough to read every candidate, so the verifying model's tests go to the likeliest first. */
  private readonly screen?: DecisionModel;
  private readonly reports: Reports;
  private readonly log: (s: string) => void;
  private readonly defectAt: number;
  /** Told each verdict, and each bug recorded: the search turns them into rewrites of the target and digging (src/fuzzer.ts). */
  private readonly onVerdict?: (f: Finding, verdict: string, why: string, bug?: Bug) => void;
  /** When verification stops: candidates not decided by then stay not verified yet, for the next session or a re-verify. */
  private readonly until: number;
  private readonly ok: (t: Target) => boolean;
  /** Every candidate is tested, a failure at a known bug's site too: for measuring the verifier, not for a session. */
  private readonly fresh: boolean;
  /** Whether tests report the lines they ran (coverageFor); off only to measure the verifier without it. */
  private readonly measure: boolean;
  /** Test runs in flight: they take a core each, unlike the model calls around them. */
  private running = 0;
  private queued: (() => void)[] = [];
  /** What users can call (src/api.ts), worked out the first time it is needed. */
  private exposedApi?: Api;
  private get api(): Api { return this.exposedApi ??= apiOf(this.p, this.rt); }
  private exposedNames?: Set<string>;

  /**
   * The functions and classes a test names that users cannot call, among those on the failure's stack and the paths to it:
   * a test through one of them reached the failure the way no user can. A name some exported function also has does not count.
   */
  private hiddenIn(source: string, around: Target[]): string[] {
    this.exposedNames ??= new Set(this.p.targets.filter((t) => this.ok(t) && this.api.has(t)).flatMap((t) => [t.name, t.qualifiedName.split(/\.|::/)[0]]));
    const code = source.replace(/(^|\s)(#|\/\/).*$/gm, '$1');
    const names = new Set(around.filter((t) => !this.api.has(t)).flatMap((t) => [t.qualifiedName.split(/\.|::/)[0], t.name]));
    return [...names].filter((n) => n.length >= 4 && !/^__\w+__$/.test(n) && !this.exposedNames!.has(n) && new RegExp(`\\b${n.replace(/[^\w]/g, '\\$&')}\\b`).test(code));
  }

  /** What users can call that leads to `fn`: the starts of the paths to it, or else the exported functions near it, and the commands. */
  private usersOf(fn: Target | undefined, chains: Target[][]): string {
    let heads = [...new Map(chains.map((c) => c[0]).filter((t) => this.api.has(t)).map((t) => [t.id, t])).values()];
    if (fn && this.api.has(fn)) heads = [fn, ...heads];
    if (!heads.length && fn) {
      const shared = (a: string, b: string) => { const x = a.split('/'), y = b.split('/'); let n = 0; while (n < x.length && x[n] === y[n]) n++; return n; };
      heads = this.p.targets.filter((t) => this.ok(t) && t.language === fn.language && this.api.has(t)).sort((a, b) => shared(b.path, fn.path) - shared(a.path, fn.path)).slice(0, 25);
    }
    const lines = heads.slice(0, 25).map((t) => `  ${this.rt.importFor(t)}  # ${t.qualifiedName} in ${t.path}`);
    if (this.api.commands.length) lines.push(`  commands: ${this.api.commands.join(', ')}`);
    return lines.length ? `WHAT USERS CAN CALL THAT LEADS THERE (what the package exports, its commands, and the handlers its framework calls):\n${lines.join('\n')}` : '';
  }

  constructor(o: { p: Project; rt: Runtime; built: Built; models: { judge: DecisionModel; text: Writer }; reports: Reports; log: (s: string) => void; defectAt: number; until?: number; screen?: DecisionModel; onVerdict?: (f: Finding, verdict: string, why: string, bug?: Bug) => void; fresh?: boolean; measure?: boolean }) {
    this.p = o.p; this.rt = o.rt; this.built = o.built; this.place = containerPlace(o.built.box); this.models = o.models; this.reports = o.reports; this.log = o.log; this.defectAt = o.defectAt; this.onVerdict = o.onVerdict;
    this.until = o.until ?? Infinity; this.ok = shipped(o.p, o.rt); this.screen = o.screen; this.fresh = o.fresh ?? false; this.measure = o.measure ?? true;
  }

  /**
   * Runs one test file with its command at the project's root, in the image test.sh set up, the services CI starts beside the
   * tests started first and their environment set. The file is removed after. Its exit code and the end of its output.
   */
  /** How a test of this failure reports the project lines it ran, in the code on its stack, where its runner can (src/coverage.ts). */
  private async coverageFor(stack: Target[], tag: string): Promise<Coverage | undefined> {
    if (!this.measure) return undefined;
    return coverageOf(this.place, this.p, this.rt.language, this.built.src, stack.map((t) => t.path), `/tmp/refuzz-cov-${tag}-${Date.now().toString(36)}`);
  }

  private async test(path: string, source: string, command: string, cover?: Coverage): Promise<{ code: number; output: string; hung?: boolean; ran?: Set<string> }> {
    if (this.running >= PARALLEL) await new Promise<void>((r) => this.queued.push(r)); else this.running++;
    try {
      await this.place.put(this.built.src, { [path]: source });
      // Plain output: test runners colour theirs, and colour codes read back into a rewrite end up in its command.
      // The test is killed inside the container after its limit: a deadlocked test (a call waiting on a reply its fake
      // transport never sends) otherwise holds a slot for the runner's own timeout, ten minutes in Go, twice over.
      const limit = testLimit(this.built), started = Date.now();
      const covering = cover ? `${Object.entries(cover.env).map(([k, v]) => ` ${k}=${shq(v)}`).join('')}${cover.bin ? ` PATH=${shq(cover.bin)}:"$PATH"` : ''}` : '';
      const script = `[ -f /src/refuzz-services.sh ] && bash /src/refuzz-services.sh >/dev/null 2>&1; set -a; [ -f /src/refuzz-test.env ] && . /src/refuzz-test.env; set +a; export NO_COLOR=1 FORCE_COLOR=0 TERM=dumb CI=1${covering}; cd ${shq(this.built.src)} && timeout -s KILL ${limit} ${plain(command)}`;
      const r = await this.place.run(['bash', '-c', script], { timeoutMs: (limit + 60) * 1000 });
      await this.place.remove(`${this.built.src}/${path}`);
      // The lines it ran, when its runner wrote them: none written (the run never got that far) is not measured, not nothing run.
      let ran: Set<string> | undefined;
      if (cover) {
        if (cover.collect) await this.place.run(['bash', '-c', `cd ${shq(this.built.src)} && ${cover.collect}`], { timeoutMs: 300_000 });
        const written = await this.place.run(['bash', '-c', `cat ${shq(cover.file)} 2>/dev/null && rm -f ${shq(cover.file)}`]);
        if (written.code === 0 && written.stdout.trim()) ran = cover.read(written.stdout);
      }
      const output = telling(plain(`${r.stdout}\n${r.stderr}`).trim().split('\n'), path).join('\n');
      // Hung is a run that used its whole time, whatever killed it: an exit status alone does not say (137 is also memory).
      if ((Date.now() - started) / 1000 >= limit) return { code: r.code ?? 137, hung: true, ran, output: `${output}\nrefuzz: the test did not finish within ${limit}s, ten times what the project's own test of one file takes, and was killed: it hangs (a call waiting on something that never comes)` };
      return { code: r.code ?? 1, output, ran };
    } finally {
      this.running--;
      while (this.running < PARALLEL && this.queued.length) { this.running++; this.queued.shift()!(); }
    }
  }

  /** Each open bug's test, run on this commit: still failing, or passing because the bug was fixed. */
  async recheck() {
    if (!this.built.testSetup) return;
    for (const b of this.reports.open(this.rt.language)) {
      if (!b.reproducer.command) continue;
      const r = await this.test(b.reproducer.file, b.reproducer.source, b.reproducer.command);
      this.reports.recheck(b.id, r.code !== 0);
      this.log(`  verify: ${b.id} ${b.title}: ${r.code !== 0 ? 'its test still fails' : 'its test passes: fixed since it was found'}`);
    }
  }

  /**
   * Verifies a batch's failures. One candidate per function and kind of failure (candidateKey), its likeliest finding. Every
   * candidate is screened first by the judge, which costs a fraction of a cent where a test costs cents: could a real caller
   * hit it through the project's public API, and does it break what the function documents? Every candidate gets a test,
   * the likeliest first, so a session whose money or time runs out has tested those: as many at once as tests can run. A candidate an earlier
   * verification decided is not verified again.
   */
  async verify(findings: Finding[], decided = new Set<string>()): Promise<number> {
    const language = this.rt.language;
    const best = new Map<string, Finding>();
    for (const f of findings.filter((x) => x.kind !== 'nondeterministic' && x.reproduces !== false)) {
      const k = candidateKey(language, f, siteOf(this.p, f));
      const was = best.get(k);
      if (!was || (f.defect ?? 0) > (was.defect ?? 0) || ((f.defect ?? 0) === (was.defect ?? 0) && inputOf(f).length < inputOf(was).length)) best.set(k, f);
    }
    const open = [...best].filter(([key]) => !decided.has(key));
    const judged = await this.judgeAll(open);
    const ordered = judged.sort((a, b) => b.score - a.score);
    const passed: Verified[] = [];
    // As many at once as tests can run: started all together, the likeliest would not be the ones the money pays for.
    await inParallel(ordered, PARALLEL, async ({ key, f }) => {
      const site = siteOf(this.p, f);
      const base = { key, language, function: site.function, where: `${site.path}:${site.line}`, type: f.type, message: f.message.split('\n')[0].slice(0, 300) };
      this.reports.candidate({ ...base, verdict: 'not verified yet' });
      const v = await this.one(f, site, key).catch((e) => (e instanceof OutOfBudget ? { verdict: 'not verified yet' as const, why: 'the session\'s model money is spent' } : { verdict: 'not verified yet' as const, why: `verification stopped: ${String((e as Error).message).split('\n')[0]}` }));
      if ('source' in v) { passed.push({ key, finding: f, site, ...v }); this.reports.candidate({ ...base, verdict: 'bug' }); }
      else { this.reports.candidate({ ...base, verdict: v.verdict, why: v.why, ...('tried' in v && v.tried ? { tried: v.tried } : {}) }); this.onVerdict?.(f, v.verdict, v.why); }
      this.log(`  verify: ${site.function} ${site.path}:${site.line} ${f.type}: ${'source' in v ? 'verified: its test fails' : `${v.verdict} (${v.why.slice(0, 160)})`}`);
    });
    if (passed.length) await this.group(passed);
    return open.length;
  }

  /**
   * The one judgment before any test: three questions per candidate, every candidate in one batched request (a fraction of a
   * cent each, where a test costs cents). It scores the candidates so the likeliest are tested first, and says whether the
   * input was valid data (a bug) or malformed data from outside (a hardening issue). It rejects nothing: a candidate the
   * judge doubts is tested later, not never. One the money cannot pay for is left not verified yet.
   */
  private async judgeAll(open: [string, Finding][]): Promise<{ key: string; f: Finding; score: number; valid: boolean }[]> {
    const language = this.rt.language;
    const base = (key: string, f: Finding, site: Site) => ({ key, language, function: site.function, where: `${site.path}:${site.line}`, type: f.type, message: f.message.split('\n')[0].slice(0, 300) });
    const out: { key: string; f: Finding; score: number; valid: boolean }[] = [];
    const ask: { key: string; f: Finding; site: Site }[] = [];
    for (const [key, f] of open) {
      const site = siteOf(this.p, f);
      const known = this.reports.bugAt(language, site);
      if (known && known.status === 'open' && !this.fresh) { this.reports.candidate({ ...base(key, f, site), verdict: 'bug', bug: known.id, why: 'a known bug, found again' }); continue; }
      if (!this.built.testSetup) { this.reports.candidate({ ...base(key, f, site), verdict: 'not verified yet', why: 'the project\'s test suite could not be set up' }); continue; }
      ask.push({ key, f, site });
    }
    if (!ask.length) return out;
    // The cheap model reads every candidate, so the verifying model's tests go to the likeliest first. It rejects nothing: a
    // candidate it doubts is tested last, and one the session's time or money does not reach stays not verified yet. Without
    // it (or if it fails): assertion failures first (a property stated and broken), then crashes.
    let likely: Map<string, number> | undefined;
    if (this.screen) {
      const questions = Object.fromEntries(ask.map(({ f, site }, i) => [`c${i}`, noul({
        question: 'A fuzzer found this failure. Is it likely a real bug a maintainer would fix: reached through the project\'s public API with input a real caller or user could give, built the way callers build it, and against what the code is evidently meant to do? Unlikely when it needs input of the wrong type, a method called before the setup callers always do, a hand-built object, or a size no caller passes, or when the behavior is a documented or deliberate choice.',
        failure: `${f.type} at ${site.path}:${site.line} in ${site.function}: ${f.message.split('\n')[0].slice(0, 400)}`,
        called: f.function, harness: fit(f.harness ?? '', 3_000), input: (f.input ?? '').slice(0, 300),
        code: fit(stackTargets(this.p, f).map((t) => sourceOf(this.p, t)).join('\n\n'), 4_000),
      })]));
      try {
        const a = await this.screen.ask({ purpose: 'order fuzzing failures for verification' }, questions, 'fuzz-verify-screen');
        likely = new Map(ask.map(({ key }, i) => [key, a[`c${i}`]?.noul ?? 0.5]));
      } catch (e) { this.log(`  verify: screening failed, ordering by kind: ${String((e as Error).message).split('\n')[0]}`); }
    }
    for (const { key, f, site } of ask) { this.reports.candidate({ ...base(key, f, site), verdict: 'not verified yet', why: 'waiting for a test' }); out.push({ key, f, score: likely?.get(key) ?? (f.kind === 'property' ? 2 : 1), valid: true }); }
    this.log(`  verify: ${ask.length} candidates ordered for testing${likely ? ` (${[...likely.values()].filter((x) => x >= 0.5).length} likely)` : ''}`);
    return out;
  }

  private async one(f: Finding, site: Site, key: string): Promise<{ path: string; source: string; command: string; input: Buffer; observed: string; documented: string; valid: boolean } | { verdict: 'not a bug' | 'not verified yet'; why: string; tried?: { path: string; source: string; output?: string } }> {
    const stack = stackTargets(this.p, f);
    const fn = stack.at(-1);
    // Who calls the function the fuzz target entered, and from where: what input reaches it in the shipped program.
    const entered = this.p.targets.find((t) => t.qualifiedName === f.function && !t.test) ?? stack[0];
    const callers = entered ? callerPaths(this.p, this.ok, entered, 6, this.api) : { paths: [], direct: [], chains: [] };
    const users = this.usersOf(entered, callers.chains);
    const callersShown = [callers.direct.length
      ? `PATHS FROM WHERE USERS CALL IN TO ${entered!.qualifiedName}:\n${callers.paths.join('\n')}\n\nITS DIRECT CALLERS:\n${fit(callers.direct.map((t) => sourceOf(this.p, t)).join('\n\n'), 8_000)}`
      : entered && !this.api.has(entered) ? `Nothing in the project calls ${entered.qualifiedName} by name, and users cannot call it: it is internal (not exported by the package).`
      : `Nothing in the project calls ${entered?.qualifiedName ?? f.function}: it is where callers enter (a public function, a command, a handler).`, users].filter(Boolean).join('\n\n');
    // The code a test through users' entry points must not name: the stack, and the paths to it.
    const around = [...stack, ...callers.chains.flat()];
    const example = exampleTest(this.p, stack, site);
    // A name unique to the candidate: two tests in one package must not share a file.
    const tag = `refuzz_${createHash('sha1').update(key).digest('hex').slice(0, 10)}`;
    // Where the runner can measure it, each test reports the lines it ran: one that never ran the failing line proves nothing,
    // and the writer is told how far it got. A flow's failure has no one line.
    const cover = f.by === 'flow' ? undefined : await this.coverageFor(stack, tag);
    const reachedOf = (ran: Set<string> | undefined, output?: string) => ranOf(stack, site, ran, output);
    const fields = {
      plan: 'Which public function or request the project\'s callers send outside data through that reaches the failing line, how the project\'s tests set it up (imports, fixtures, test client, database), and which input makes the code fail there.',
      test_path: `Where the test file goes, relative to the project's root: beside the project's tests, named the way its test runner finds test files, with "${tag}" in the name.`,
      test: 'The complete test file: one test, written like the example test, that fails because of the bug.',
      documented: 'What the documentation of the function the test calls says it does with such input: its documented errors, return values and promises, quoted. "Nothing" when it documents nothing about it.',
    };
    // Rewritten while the attempts make progress: two in a row that end the same way mean the writer is stuck.
    let previous = '', last = '', stuck = 0, room = Infinity;
    for (;;) {
      if (Date.now() >= this.until) return { verdict: 'not verified yet', why: 'the session\'s time for verification ran out' };
      const prompt = [
        `HOW THE PROJECT'S TEST SUITE WAS SET UP (test.sh; services in /src/refuzz-services.sh are started and /src/refuzz-test.env is loaded before the test runs). The test is run with \`bash /src/refuzz-test-one.sh <its path>\`, which this setup wrote, so it goes where that script finds and runs it:\n${this.built.testSetup}`,
        example ? `A TEST OF THIS PROJECT TO WRITE THE NEW ONE LIKE (${example.path}):\n${fit(example.text, room)}` : 'THE PROJECT HAS NO TEST NEAR THIS CODE: write the test in the test framework its CI uses.',
        f.by === 'flow'
          ? `THE FLOW TO TEST: ${f.message}\nWrite one test that drives this flow through the running service the way the project's own integration tests do (its test server or client, its fixtures, the services test.sh starts), in the order a user would, applies the condition, and asserts what the flow promises: what was created is what is read back, a retried request has its effect once, one user never sees or changes another's data, an interrupted step leaves nothing half done. Use only the project's public API and its own test helpers; build no internal state by hand.`
          : `THE FAILURE THE FUZZER FOUND: ${f.type} at ${site.path}:${site.line} in ${site.function}: ${f.message.split('\n')[0]}\nSTACK, innermost last:\n${f.stack.join('\n')}`,
        f.by === 'flow' ? '' : `THE PUBLIC FUNCTION THE FUZZ TARGET CALLED: ${f.function}. The failing line may be in a private helper below it; the test enters where callers do, through this function or the public function or request that leads to it, never through the helper.`,
        f.by === 'flow' ? '' : `THE FUZZ TARGET THAT FOUND IT (it built its arguments itself; the test calls the project the way callers do):\n${fit(f.harness, room)}\nITS INPUT: ${f.input}`,
        `THE PROJECT'S CODE ON THE STACK:\n${fit(stack.map((t) => `${this.rt.importFor(t)}\n${t.doc ? `// ${t.doc}\n` : ''}${sourceOf(this.p, t)}`).join('\n\n'), room)}`,
        `THE TEST: one test, in the project's test framework and style, that calls the project the way its tests and real callers do (its public API, or a request through the app with the framework's test client and the project's fixtures), with the failing input, and fails because of the bug: it lets the project's own error propagate, or asserts what the function documents and the result breaks. It builds no internal state by hand, calls nothing private, and catches nothing the bug raises.`,
        previous,
      ].filter(Boolean).join('\n\n');
      let a: Record<string, string>;
      try { a = await this.models.text.generate(prompt, fields, 'fuzz-verify-test', `refuzz-${this.rt.language}`); }
      catch (e) { if (tooLong(e) && room > 2000) { room = room === Infinity ? 40_000 : Math.floor(room / 2); continue; } throw e; }
      const strip = (x: string | undefined) => (x ?? '').replace(/^```\w*\n|\n```\s*$/g, '').trim();
      // The test runs with the project's own one-file runner (test.sh wrote it), never a command the writer makes up.
      const path = strip(a.test_path).split('\n')[0].replace(/^\.?\//, '').replace(/`/g, ''), source = strip(a.test), command = `bash /src/refuzz-test-one.sh ${shq(path)}`;
      const pathOk = !!path && path.length <= 200 && !path.includes('..') && !/^\//.test(path) && /^[\w./@+-]+$/.test(path) && path.includes(tag);
      // A test that skips itself, or has no body to speak of, is the writer giving up: it is not run.
      const skips = /\bt\.Skip\w*\(|\bpytest\.skip\(|\bunittest\.SkipTest\b|@unittest\.skip|\bskip\(['"]|\bit\.skip\(|\bxit\(|#\[ignore\]/.test(source) || source.length < 60;
      if (!pathOk || !source || skips) {
        // The writer's own reason for not writing one: a skip message in the test, or its plan.
        const reason = (/Skip\w*\(\s*["'`]([^"'`]{8,240})/.exec(source)?.[1] ?? strip(a.plan).split('\n')[0].slice(0, 240)).trim();
        previous = skips ? 'YOUR LAST ANSWER SKIPPED ITSELF OR HAD NO BODY: a test that is skipped proves nothing. Write the test that fails because of the bug, or say in `plan` why none can be written and leave `test` empty.' : `YOUR LAST ANSWER GAVE NO USABLE TEST: the path must be relative to the project's root, contain "${tag}", and be a plain file path; the test must be complete.`;
        if (++stuck >= 2) return { verdict: 'not a bug', why: skips ? `the writer found no failing case to test${reason ? `: ${reason}` : ''}` : `the writer wrote no usable test${reason ? `: ${reason}` : ''}`, ...(source ? { tried: { path, source } } : {}) };
        continue;
      }
      // Twice, to tell a failure from a flaky one; a test that hung is not run again, it would hang again.
      const first = await this.test(path, source, command, cover);
      const runs = first.hung ? [first] : [first, await this.test(path, source, command)];
      const output = runs[0].output, measured = reachedOf(first.ran, first.output);
      let outcome: string;
      if (runs.some((r) => r.code === 0)) outcome = 'passes';
      // Measured, and the failing line never ran: whatever failed, it was not the bug.
      else if (measured.missed) outcome = `fails without running ${site.path}:${site.line}: ${errorClass(output)}`;
      else {
        // The one question after the test: why did it fail. The answer is the verdict and, for a bug, its kind.
        const shown = { language: this.rt.language, the_bug: `${f.type} at ${site.path}:${site.line} in ${site.function}: ${f.message.split('\n')[0]}`, test: source, output: output.slice(-6000), documented: (a.documented ?? '').trim().slice(0, 800), code: fit(stack.map((t) => sourceOf(this.p, t)).join('\n\n'), 12_000), callers: callersShown, ...(measured.text ? { measured: measured.text } : {}), ...(commentsNear(this.p, site) ? { comments_at_the_failing_line: commentsNear(this.p, site) } : {}), ...(producersOf(this.p, this.rt.language, source) ? { where_the_project_makes_the_values_the_test_builds: producersOf(this.p, this.rt.language, source) } : {}), ...(callSitesOf(this.p, this.rt.language, source) ? { how_the_project_calls_what_the_test_calls: callSitesOf(this.p, this.rt.language, source) } : {}) };
        const judgeWhy = (extra: Record<string, string> = {}) => this.models.judge.ask({ purpose: 'check that a test proves a fuzzing finding' }, {
          why: choice({ question: 'This test was written to prove a bug the fuzzer found, and it failed. Why did it fail? Judge what the function is evidently meant to do by its documentation, its name and signature, what its callers rely on, and the convention every implementation of its kind follows (a CA file holds a bundle of certificates; a sort comparison is false for equal items; a decoder rejects input shorter than its declared length): such a convention counts as a promise even when no comment states it. The project\'s code is shown with its comments, and so are its callers: what they pass is what the function is meant to take. A comment, or the code\'s plain structure, that makes the behavior a choice (a fallback kept for compatibility, an overshoot it accepts, a value it normalizes on purpose) settles it: not a bug. The code contradicting its own evident intent is a bug even when nothing documents it: cleanup it skips on some path, a check written for one flow applied to another that does not need it, state it records and never removes, an error it swallows that leaves its own bookkeeping wrong.', ...shown, ...extra }, {
            bug: 'The project does something wrong, against what the function is evidently meant to do, on ordinary input a normal caller passes, built the way callers build it.',
            hostile: 'The project does something wrong, against what it is evidently meant to do, but the input is malformed or hostile data from outside the program: a hardening issue.',
            setup: 'It fails in setup, an import, a missing dependency or service, the environment, or a mistake in the test itself, before or around the call.',
            unpromised: 'The assertion states one reasonable choice among several that nothing in the project or in convention settles, or an input the function was never meant to take. This includes: a value the language\'s standard library normalizes (invalid UTF-8 replaced, a number converted), accepting input a stricter reader would reject (a missing header, trailing data, a null) when nothing is harmed, an argument only the program\'s own author passes (a name or URI it registers, its configuration) that the project takes as given, and behavior the code or a comment states is deliberate.',
            uncalled: 'It reaches the failure only by calling the project as no caller does: nil, zero or an empty value where callers always pass a real one (including to a constructor or test helper), an object built by hand without what its constructor sets, a method called before the setup every caller does first (an init, add or open call; an assertion naming that call settles it) or with an argument sized against what every caller sizes it to (a buffer of the vocabulary\'s length), a mock or stand-in behaving as the real dependency never does, an input that every caller takes from the project\'s own bundled file or constant (an embedded config, a compiled-in table or spec) replaced with one the project never ships, state the project itself writes and reads back (its own index or data file, cache entry or database row) replaced by hand with content it never writes, crafted data for a format that runs code when loaded or is documented as unsafe to load from an untrusted source (pickle, cloudpickle, marshal, an unsafe YAML load), an argument where every call the project makes passes a configured value and the test passes nil, None or an empty one (how_the_project_calls_what_the_test_calls shows the calls), a value of the project\'s own type built in a way no place the project makes one does (where_the_project_makes_the_values_the_test_builds shows them; this holds for a function only a framework calls, such as a message handler, too), or an input no caller could produce.',
            unrelated: 'It fails for a reason that has nothing to do with the bug it was written to prove.',
          }),
        }, 'fuzz-verify-check');
        let why = (await judgeWhy()).why?.choice ?? 'unrelated';
        // A failure that is only an assertion (nothing crashed, nothing raised) stands on a promise: one the documentation states,
        // quoted. With none quoted, it is the test's own expectation, which the cheap judge too often takes for the project's.
        const quoted = !/^(nothing\b|none\b|n\/a\b|$)/i.test((a.documented ?? '').trim());
        if (f.kind === 'property' && !quoted && (why === 'bug' || why === 'hostile')) why = 'unpromised';
        if (why === 'bug' || why === 'hostile') {
          // A failure is a bug only when users reach it: a test of a function users call, naming nothing internal, is the
          // proof; otherwise a second test must start where users call in and fail too.
          const direct = !!entered && this.api.has(entered) && !this.hiddenIn(source, around).length;
          const reached = direct ? { path, source, output } : await this.reach(f, site, tag, { path, source, output }, callersShown, around, cover && (() => this.coverageFor(stack, `${tag}-reach`)), reachedOf);
          if ('verdict' in reached) return reached;
          // What the test output says went wrong: the panic, assertion or error lines, not the stack frames and the suite's
          // own summary line around them (Go prints `panic.go:859 +0x120` and `FAIL pkg 0.05s`, which say nothing).
          const observed = failureLines(reached.output).slice(0, 400) || `${f.type}: ${f.message.split('\n')[0]}`;
          return { path: reached.path, source: reached.source, command: `bash /src/refuzz-test-one.sh ${shq(reached.path)}`, input: inputOf(f), observed, documented: (a.documented ?? '').trim() || 'Nothing about such input.', valid: why === 'bug' };
        }
        outcome = why === 'unpromised' ? 'unpromised' : why === 'uncalled' ? 'uncalled' : `fails otherwise: ${why}: ${errorClass(output)}`;
      }
      // A test that never reached the failing line gets one try more: the writer is told how far it got, which it was not before.
      stuck = outcome === last ? stuck + 1 : 0;
      last = outcome;
      if (stuck >= (outcome.startsWith('fails without running') ? 2 : 1)) return { verdict: 'not a bug', why: outcome === 'passes' ? 'the test passes' : outcome === 'unpromised' ? 'the test fails, but only on an assertion nothing documents or settles' : outcome === 'uncalled' ? 'the test fails only by calling the project as no caller does (a missing argument, an empty hand-built object, or an impossible input)' : outcome.startsWith('fails without running') ? `the test never ran the failing line ${site.path}:${site.line}` : `the test fails, but not because of the bug: ${failureLines(output).slice(0, 300) || output.trim().split('\n').at(-1)?.slice(0, 200)}`, tried: { path, source, output: output.slice(-3000) } };
      previous = `YOUR LAST TEST ${outcome === 'passes' ? 'PASSED: it did not reach the bug, or caught what the bug raises' : outcome === 'unpromised' ? 'FAILED ON AN ASSERTION THE DOCUMENTATION DOES NOT PROMISE for the input it gives: assert only what the documentation guarantees, on an input it covers' : outcome === 'uncalled' ? 'FAILED ONLY BY CALLING THE PROJECT AS NO CALLER DOES: it passed nil, zero or an empty value for an argument callers always fill, or built an object by hand without what its constructor sets. Build everything the way the project\'s own tests and callers do, through its constructors and public entry points, and give the input a caller could produce; if the failure cannot be reached that way, there is no bug to prove' : outcome.startsWith('fails without running') ? `FAILED WITHOUT EVER RUNNING THE FAILING LINE ${site.path}:${site.line}: it failed on something else on the way` : 'FAILED, BUT NOT BECAUSE OF THE BUG (setup, imports, the environment, or the test\'s own mistake)'}. Fix that.${measured.text ? `\n${measured.text}` : ''}\n--- ${path}\n${source}\n--- its output when run with ${command}, the end\n${output.slice(-4000)}`;
    }
  }

  /**
   * The failure reached the way the project reaches it: a second test that starts at an entry point on a path to the function
   * (a command, a request through the test client, the public function a user calls), gives input a user or caller could
   * give, and fails because of the same bug. The writer always writes the test, even when it expects no caller to reach the
   * failure: running it decides, not the writer's opinion. A test that passes, or fails for another reason, goes back once
   * with its output; short of a failing test, only a direct call fails, and it is not a bug.
   */
  private async reach(f: Finding, site: Site, tag: string, direct: { path: string; source: string; output: string }, callersShown: string, around: Target[], cover?: () => Promise<Coverage | undefined>, reachedOf: (ran: Set<string> | undefined, output?: string) => { missed: boolean; text: string } = () => ({ missed: false, text: '' })): Promise<{ path: string; source: string; output: string } | { verdict: 'not a bug' | 'not verified yet'; why: string; tried?: { path: string; source: string; output?: string } }> {
    const reachTag = `${tag}_reach`;
    const fields = {
      entry: 'The entry point the test starts at, and the path from it to the failing function, as the project\'s code shows it.',
      test_path: `Where the test file goes, relative to the project's root, named the way its test runner finds test files, with "${reachTag}" in the name.`,
      test: 'The complete test file: one test that starts at that entry point with input a user or caller could give and fails because of the bug.',
    };
    let previous = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() >= this.until) return { verdict: 'not verified yet', why: 'the session\'s time for verification ran out' };
      const prompt = [
        `HOW THE PROJECT'S TEST SUITE WAS SET UP (the test is run with \`bash /src/refuzz-test-one.sh <its path>\`):\n${this.built.testSetup}`,
        `A TEST CALLING ${f.function} DIRECTLY FAILED BECAUSE OF A BUG: ${f.type} at ${site.path}:${site.line} in ${site.function}: ${f.message.split('\n')[0]}\n--- ${direct.path}\n${direct.source}\n--- its output, the end\n${direct.output.slice(-3000)}`,
        callersShown,
        `THE TEST TO WRITE: the same bug, reached the way the project reaches it. Start at an entry point on one of these paths, the way a user or the project's own callers do (a command run through the CLI test runner, a request through the framework's test client, the public function a user of the library calls), with input a user could give there. The callers above check, convert or limit what they pass: honor that. Write the test even if you expect no caller to reach the failure: running it decides, and a test from the entry point that passes is how a failure no caller can reach is dropped.`,
        previous,
      ].filter(Boolean).join('\n\n');
      const a = await this.models.text.generate(prompt, fields, 'fuzz-verify-reach', `refuzz-${this.rt.language}`);
      const strip = (x: string | undefined) => (x ?? '').replace(/^```\w*\n|\n```\s*$/g, '').trim();
      const entry = strip(a.entry), path = strip(a.test_path).split('\n')[0].replace(/^\.?\//, '').replace(/`/g, ''), source = strip(a.test);
      if (!source) { previous = 'YOUR LAST ANSWER HAD NO TEST: write one from the entry point closest to the failing function, with the input a caller could give there. Running it decides whether a caller reaches the failure.'; continue; }
      if (!path || path.length > 200 || path.includes('..') || /^\//.test(path) || !/^[\w./@+-]+$/.test(path) || !path.includes(reachTag)) { previous = `YOUR LAST ANSWER GAVE NO USABLE TEST PATH: relative to the project's root, containing "${reachTag}".`; continue; }
      const hidden = this.hiddenIn(source, around);
      if (hidden.length) {
        previous = `YOUR LAST TEST CALLS ${hidden.join(', ')}, WHICH USERS CANNOT CALL: it is internal to the project. Start at what users can call (listed above), or at a command or request that reaches it, and name nothing internal.\n--- ${path}\n${source}`;
        if (attempt === 1) return { verdict: 'not a bug', why: `only a direct call fails: every test the writer gave calls ${hidden.join(', ')}, which users cannot call`, tried: { path, source } };
        continue;
      }
      const command = `bash /src/refuzz-test-one.sh ${shq(path)}`;
      const r = await this.test(path, source, command, await cover?.());
      const measured = reachedOf(r.ran, r.output);
      if (r.code !== 0 && !measured.missed) {
        const same = await this.models.judge.ask({ purpose: 'check that a failure is reached from an entry point' }, {
          reached: noul({ question: 'The first test called a function directly and failed because of a bug. The second test starts where a user or the project\'s own code enters. Does the second test fail because of the same bug, starting at a real entry point, with input a user or caller could give there? Not if it fails in setup or on its own mistake, builds the function\'s input by hand past the entry point, calls a function or class users cannot call (anything internal, not in what users can call), skips a setup call the project\'s own callers always make first, or gives the entry point input the project would reject or never produce, such as a replacement for the file or constant the project itself always passes there (an embedded config, a compiled-in table or spec), or a file, cache entry or row the project writes itself, written by hand with content it never writes.', bug: `${f.type} at ${site.path}:${site.line} in ${site.function}`, entry, test: source, output: r.output.slice(-5000), callers: callersShown, ...(measured.text ? { measured: measured.text } : {}) }),
        }, 'fuzz-verify-reach-check');
        if ((same.reached?.noul ?? 0) >= 0.5) return { path, source, output: r.output };
      }
      previous = `YOUR LAST TEST (entry: ${entry.slice(0, 200)}) ${r.code === 0 ? 'PASSED: the entry point did not reach the bug, or the callers on the way check or convert the input' : measured.missed ? 'FAILED WITHOUT EVER RUNNING THE FAILING LINE: it failed on something else on the way' : 'FAILED, BUT NOT BECAUSE OF THE SAME BUG REACHED FROM THE ENTRY POINT'}. Fix that.${measured.text ? `\n${measured.text}` : ''}\n--- ${path}\n${source}\n--- its output, the end\n${r.output.slice(-3000)}`;
      if (attempt === 1) return { verdict: 'not a bug', why: `only a direct call fails: the test from ${entry.slice(0, 120)} ${r.code === 0 ? 'passes' : 'did not fail because of the bug'}`, tried: { path, source, output: r.output.slice(-3000) } };
    }
    return { verdict: 'not a bug', why: 'only a direct call fails: the writer gave no usable test from an entry point' };
  }

  /** Groups verified failures by root cause and records each group as a bug, with the duplicate check. */
  private async group(passed: Verified[]) {
    let groups: { members: string[]; title: string; cause: string }[] = [];
    try {
      const a = await this.models.text.generate(
        `VERIFIED FAILURES IN THIS PROJECT (${this.rt.language}):\n${passed.map((x, i) => `${i + 1}. ${x.site.function} at ${x.site.path}:${x.site.line}: ${x.observed}\n   documented: ${x.documented.slice(0, 300)}\n   code:\n${sourceOf(this.p, stackTargets(this.p, x.finding).at(-1) ?? this.p.targets[0]).slice(0, 2500)}`).join('\n\n')}`,
        {
          groups: 'A JSON array with one element per root cause: {"members": [the numbers of the failures that come from the same mistake], "title": "a maintainer\'s issue title naming the mistake and where", "cause": "one sentence: the mistake, in the code\'s terms"}. Every failure is in exactly one group; failures that only look alike but have different mistakes are in different groups.',
        },
        'fuzz-verify-group', `refuzz-${this.rt.language}`);
      const list = JSON.parse((a.groups ?? '[]').replace(/^```\w*\n|\n```\s*$/g, ''));
      if (Array.isArray(list)) groups = list.map((g) => ({ members: (g.members ?? []).map((n: number) => passed[n - 1]?.key).filter(Boolean), title: String(g.title ?? ''), cause: String(g.cause ?? '') }));
    } catch {}
    // Whatever the grouping left out is a group of its own.
    // A failure the writer did not group (the call failed, or the money is spent) is a bug of its own, named by its finding.
    for (const x of passed) if (!groups.some((g) => g.members.includes(x.key))) groups.push({ members: [x.key], title: `${x.finding.type} in ${x.site.function}`, cause: `${x.site.function} fails with ${x.finding.type}: ${x.finding.message.split('\n')[0].slice(0, 200)}` });
    // A bug's write-up must describe the project doing something wrong: a cause that restates normal behavior, or a test
    // that only failed on its own scaffolding, is not reported.
    const live = groups.filter((x) => x.members.length);
    for (const g of live) {
      const members = g.members.map((k) => passed.find((x) => x.key === k)!);
      const lead = members[0];
      const bug = this.reports.add({
        title: g.title || `${lead.finding.type} in ${lead.site.function}`,
        cause: g.cause,
        kind: lead.valid ? 'bug' : 'hardening',
        cwe: lead.finding.cwe,
        language: this.rt.language,
        sites: members.map((x) => x.site),
        observed: members.map((x) => x.observed).join('\n'),
        documented: lead.documented,
        reproducer: { file: lead.path, source: lead.source, command: lead.command, inputHex: lead.input.toString('hex') },
        // A duplicate check that cannot run (no money left, GitHub unreachable) leaves the bug recorded without it.
        duplicates: [],
      }, lead.input);
      for (const x of members) {
        this.reports.candidate({ key: x.key, language: this.rt.language, function: x.site.function, where: `${x.site.path}:${x.site.line}`, type: x.finding.type, message: x.finding.message.split('\n')[0].slice(0, 300), verdict: 'bug', bug: bug.id });
        this.onVerdict?.(x.finding, 'bug', bug.cause, bug);
      }
      this.log(`  verify: bug ${bug.id}: ${bug.title} (${bug.sites.length} site${bug.sites.length === 1 ? '' : 's'})${bug.duplicates.length ? `; may be reported already: ${bug.duplicates.map((d) => d.url).join(' ')}` : ''}`);
    }
  }

  /** Issues in the project's GitHub repository that may report the same bug: those sharing its words, asked about one by one. */

}
