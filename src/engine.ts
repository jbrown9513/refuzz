/**
 * `refuzz`: the parts of the pipeline every language shares, around src/fuzzer.ts. What is fuzzed is the
 * project's attack surfaces, found from its code (src/surface.ts).
 *   crash analyzer    an oracle flags failures the code did not raise on purpose and hangs; the judge rules on each: what kind of input
 *                     was it (ordinary, abuse, or a caller's misuse), and was the outcome wrong
 *   triage            findings deduplicated by cause
 * The writer (a small, fast model) writes OSS-Fuzz targets; the judge decides.
 */
import { createHash } from 'node:crypto';
import type { DecisionModel } from './llm/models.ts';
import { choice, MAX_BODY_CHARS, noul } from './llm/questions.ts';
import { declaredTypes, plainName, sourceOf, throwsOnPurpose, type Project } from './syntax.ts';
import type { Built, InputReport, Report, Runtime, Target } from './types.ts';
import type { Reports } from './report.ts';
import type { Budget } from './schedule.ts';
import type { Weakness } from './weaknesses.ts';

export interface FuzzOptions {
  /** The functions the crawl has given a part, by qualified name: one session-wide set, so each gets one part in all. */
  claimed?: Set<string>;
  /** Only the first this many surfaces the code has (`--surfaces`); by default every one. */
  surfaces: number;
  /** Probability the judge must give "defect" for a finding to count. */
  defectAt: number;
  /** The whole search's time (`--minutes`), shared out among the batches still to run; by default none: surfaces stop on their plateau. */
  searchMs: number;
  /** When the process started, so first-input time includes preparing the project. */
  started?: number;
  /**
   * When the search ends, as a time stamp: set once from `searchMs` where a language's run starts, so writing harnesses,
   * every batch and every phase come out of one budget instead of each starting a fresh one.
   */
  deadline?: number;
  /**
   * Where surfaces keep their fuzz targets, corpora, coverage and findings between runs (src/store.ts): `--store <dir>`, by
   * default the project's .refuzz. A benchmark gives each run its own, so one case's inputs never seed another's.
   */
  store?: string;
  /**
   * The improvement loop per surface (src/fuzzer.ts): the first iteration's fuzzing time, doubled each iteration after
   * (`--iteration-seconds`); at most this many iterations (`--max-iters`, unlimited by default); and the plateau, the least
   * share of the surface's lines an iteration must add (`--plateau`, a percentage): two iterations in a row under it end
   * the surface's improvement. The same plateau ends the run's rounds of new surfaces, on the whole project's coverage.
   */
  iterationMs: number;
  maxIterations: number;
  plateau: number;
  /** The session's model money (src/schedule.ts): writing and judging stop when it is spent; fuzzing does not. */
  budget?: Budget;
  /** Where verified bugs and the session's report go (src/report.ts); with it and `built`, failures are verified (src/verify.ts). */
  reports?: Reports;
  /** The built project, whose test suite proves a failure with a failing test (src/verify.ts). */
  built?: Built;
  /**
   * What the project's own tests run and check (src/testmap.ts), once perch coverage has measured it: read when a surface is
   * ranked and when its target is written, so a map that arrives during the session is used from then on.
   */
  testMap?: () => import('./testmap.ts').TestMap | undefined;
  /**
   * What verification said, by surface id, for its next turn: targets to rewrite (target name → why a failure it reported is
   * not a bug), and the bugs verified in it, which its next moves dig around.
   */
  fixes?: Map<string, Map<string, string>>;
  dig?: Map<string, string[]>;
  /**
   * What verification said about promises, by surface id then promise id: `broken` when a bug was verified through a target
   * checking it, `dropped` when what a target checking it asserted is not a documented promise. Applied by the surface's batch.
   */
  promised?: Map<string, Map<string, { broken?: string; dropped?: string }>>;
  /** Asked between rounds: true once the session should wind down (a new commit to fuzz, a stop). */
  stop?: () => boolean;
  /** Time one input may take before it is reported as a hang (libFuzzer's -timeout). */
  callMs: number;
  /** Only surfaces whose code includes a line in this set of path → changed lines (`--changed`). */
  changed?: Map<string, Set<number>>;
  /** These functions are the entry points (surface.ts named), grouped into surfaces like any others. */
  only?: string[];
  /** Surfaces whose first entry point (`path#qualifiedName`) an earlier run already fuzzed: `--skip-fuzzed` leaves them out. */
  skip?: Set<string>;
  /** Weakness classes from src/weaknesses.json: the judge picks each target's, the writer checks their invariants. Off with --no-cwe. */
  weaknesses?: Weakness[];
  /**
   * Called with the results so far after each batch of surfaces and after each phase within one, its findings judged as
   * far as they go, so a run that is killed keeps what it found.
   */
  onBatch?: (sofar: FuzzResult) => void;
}

export const FUZZ_DEFAULTS: FuzzOptions = { surfaces: Infinity, defectAt: 0.5, searchMs: Infinity, callMs: 5_000, iterationMs: 30_000, maxIterations: Infinity, plateau: 0.01 };

/**
 * What kind of failure a harness had, so two attempts that failed the same way can be told from two that moved on: the
 * compiler's error code when the message has one (rustc's E0433, tsc's TS2307, csc's CS0246); for a trial whose inputs did
 * not reach the project, that and the error they stopped on; otherwise the error's own line (a traceback's last exception
 * line, or the first line) with paths, line and column numbers, addresses and quoted names taken out.
 */
export function errorClass(failure: string): string {
  const what = /=> ([\s\S]*)$/.exec(failure)?.[1] ?? failure;
  const code = /\berror\[(E\d{4})\]|\b((?:TS|CS)\d{4})\b/.exec(what);
  if (code) return code[1] ?? code[2];
  const head = what.split('\n')[0];
  if (/^every input ran the same path/.test(head)) return 'every input ran the same path';
  if (/^no input reached/.test(head)) return `no input reached the project: ${[...head.matchAll(/\b(\w*(?:Error|Exception)|panic|HarnessLoad)\b/g)].at(-1)?.[1] ?? '-'}`;
  const lines = what.split('\n').map((l) => l.trim()).filter((l) => l && !/^(error: could not compile|warning\b|Compiling\b|Traceback\b)/.test(l));
  const first = lines.findLast((l) => /^[\w.]+(Error|Exception)\b/.test(l)) ?? lines[0] ?? '';
  return first
    .replace(/(?:\.{0,2}\/)?(?:[\w.@+-]+\/)+[\w.@+-]+/g, '<path>')
    .replace(/0x[0-9a-fA-F]+/g, '<addr>')
    .replace(/(["'`]).*?\1/g, '<name>')
    .replace(/\d+/g, '#')
    .slice(0, 160);
}

export interface Finding {
  /** The function rejected the input with a clean error: right for hostile input, so never a hardening finding. */
  clean?: boolean;
  kind: 'crash' | 'hang' | 'nondeterministic' | 'property';
  /** The weakness class the judge attributes it to (a CWE id from src/weaknesses.json), when one fits better than none. */
  cwe?: string;
  /** The judge's probability that it is an instance of one of the target's weakness classes rather than robustness noise. */
  security?: number;
  /** Project line the failure came from, or the target's file for the other kinds. */
  where: string;
  type: string;
  message: string;
  harness: string;
  /** The input value the harness was given, readable. */
  input?: string;
  /** The source around the failing line, or the property check that failed. */
  line: string;
  stack: string[];
  function: string;
  by?: string;
  /** The surface and the fuzz target that found it: a verdict on it goes back to that target (src/fuzzer.ts). */
  surface?: string;
  target?: string;
  /** The judge's scores: valid input handled wrongly (a bug), abuse handled wrongly (a hardening finding), and the larger of the two. */
  bug?: number;
  hardening?: number;
  defect?: number;
  finding?: 'bug' | 'hardening';
  verdict?: string;
  reproduces?: boolean;
  /** Found by a target of an inner function the surface hands its input to (a decomposition's part): that function. */
  via?: string;
  /** The input to the surface's own target that reproduced it through the entry point; without one it is not reported. */
  lifted?: string;
}

export interface FuzzResult {
  language: string;
  targets: string[];
  probed: number;
  coverage: number;
  /** Harnesses written; surfaces a harness got into (coverage reached an entry point); harnesses that loaded, reaching or not. */
  harnesses: { written: number; working: number; loaded?: number };
  findings: Finding[];
  /** Seconds from the start of the run until the first fuzz input, including the build. */
  firstInputSeconds?: number;
}

/** A harness with an integer of five or more digits, or a power, in it: a size no caller expects to be fast. */
export const largeInput = (code: string, isImport: (line: string) => boolean = (l) => /^(import|from|use|using|require|#include)\b/.test(l)) => /(?<![\w.])\d{5,}(?![\w.])|\*\*\s*\(?\s*\d{3,}|\d{3,}\s*\*\*|\bpow\s*\(/.test(code.split('\n').filter((l) => !isImport(l)).join('\n'));

/**
 * Whether a harness names anything of the project it is for, in its code: comments, string literals and import lines left
 * out, so an assertion's message or an #include of the file does not count. One that names nothing (`(void)data; return
 * 0;`, a writer saying in a comment that it found no way in) fuzzes nothing, and its only findings are timeouts of the
 * process around it: ClickHouse's 12 such targets reported 12 hangs.
 */
export function namesProject(code: string, targets: Target[], isImport: (line: string) => boolean = () => false): boolean {
  const body = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
    .split('\n').filter((l) => !isImport(l.trim()) && !/^(import|from|use|using|require|#)\b|^#/.test(l.trim())).join('\n');
  const words = new Set(body.match(/[A-Za-z_$][\w$]*/g) ?? []);
  return targets.some((t) => words.has(t.name) || plainName(t.qualifiedName).split(/[.:]+/).some((part) => part.length > 2 && words.has(part)));
}

export const describe = (t: Target, rt: Runtime) => `${rt.importFor(t)}\n    ${t.header}${t.doc ? `\n    // ${t.doc}` : ''}`;

/**
 * The import lines for the project's types and functions a test uses: a test inside the project reaches them by its own
 * scope, a harness outside it has to import them, and the writer cannot guess from where.
 */
export function importsFor(example: string, p: Project, rt: Runtime, subject: Target): string[] {
  const out = new Set<string>();
  const words = new Set(example.match(/[A-Za-z_]\w*/g) ?? []);
  for (const t of p.targets) {
    if (t.test || t.language !== rt.language || t.id === subject.id) continue;
    const owner = t.qualifiedName.includes('.') ? plainName(t.qualifiedName).split('.').at(-2)! : t.name;
    if (owner.length < 3 || !words.has(owner) || owner === subject.name) continue;
    out.add(rt.importFor(t));
  }
  out.delete(rt.importFor(subject));
  return [...out];
}

/** A definition's parameters read from its header: each one's name, and whether it is a pointer or array (a buffer, an object). */
function headerParams(header: string): { name: string; pointer: boolean }[] {
  const open = header.indexOf('(');
  if (open < 0) return [];
  let depth = 0, at = open + 1;
  const parts: string[] = [];
  for (let i = open; i < header.length; i++) {
    const ch = header[i];
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '>') { depth--; if (depth === 0) { parts.push(header.slice(at, i)); break; } }
    else if (ch === ',' && depth === 1) { parts.push(header.slice(at, i)); at = i + 1; }
  }
  return parts.map((x) => ({ name: /([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*(?:=[^,]*)?$/.exec(x.trim())?.[1] ?? '', pointer: /[*&[]/.test(x) })).filter((x) => x.name && x.name !== 'void');
}

/** An assertion or a check-and-crash: `assert(…)`, an all-capitals check macro (`FD_TEST(…)`, `CHECK(…)`), or an `if` whose body aborts or logs fatally. */
const CHECK = /^\s*(?:[A-Z][A-Z0-9_]*|\w*assert\w*)\s*\(|^\s*if\s*\(.*\b(?:abort|__builtin_trap|[A-Z0-9_]*(?:ERR|CRIT|FATAL|PANIC|ABORT|DIE)[A-Z0-9_]*)\s*\(/i;

/**
 * A native abort (an assertion, a project's check-and-crash macro) on one of the first statements of a function the harness
 * called, checking only scalar arguments that are not a buffer's length: the function stating its precondition, as a
 * deliberate throw of a rejection does in a language with exceptions. Such an argument is one only the program decides (a
 * mode, a source, an index into its own tables), and the harness passed what no caller passes. A length right after a
 * pointer argument is left out: it describes data from outside, and an abort on it is the function trusting its input, which
 * stays a finding. Returns what the harness should be told, or undefined.
 */
export function precondition(p: Project, rep: Report): string | undefined {
  if (rep.status !== 'error' || !/^(ABRT|SIGABRT|assertion)$/.test(rep.type ?? '')) return undefined;
  const outer = rep.frames?.[0];
  const fn = outer && p.at(outer.path, outer.line);
  if (!outer || !fn || outer.line < fn.bodyStart) return undefined;
  const code = p.read(fn.path).split('\n').slice(fn.bodyStart - 1, outer.line).map((l) => l.replace(/\/\/.*$|\/\*.*?\*\//g, '').trim()).filter((l) => l && l !== '{' && !/^\*|^\/\*/.test(l));
  // The failing check is among the first three statements, and every statement before it is a check too.
  if (!code.length || code.length > 3 || !code.every((l) => CHECK.test(l))) return undefined;
  // A check of what a call returned (`FD_TEST( parse( buf, sz ) )`) is that call's work failing, not an argument check.
  if (/\b[a-z_]\w*\s*\(/.test(code.at(-1)!.replace(/^\s*(?:if\s*\(\s*)?\w+\s*\(/, ''))) return undefined;
  const params = headerParams(fn.header);
  const words = new Set(code.at(-1)!.match(/[A-Za-z_]\w*/g) ?? []);
  const used = params.map((x, i) => ({ ...x, i })).filter((x) => words.has(x.name));
  if (!used.length || used.some((x) => x.pointer || params[x.i - 1]?.pointer)) return undefined;
  return `the function's own precondition at ${outer.path}:${outer.line} (${code.at(-1)!.slice(0, 120)}) rejected ${used.map((x) => x.name).join(', ')}: pass the values the project's callers pass for arguments only the program sets`;
}

/**
 * The oracle for one run: a Finding when it failed in the project's code and was not a deliberate rejection, or hung on an
 * input of ordinary size; null otherwise.
 */
export function oracle(p: Project, rt: Runtime, callMs: number): (rep: Report, code: string, by: string, t: Target, input?: string) => Finding | null {
  const fnAt = (path: string, line: number) => p.at(path, line)?.qualifiedName ?? path;
  // Error types the project declares, in any of its files of this language: throwing one is the project's contract.
  let declared: Set<string> | undefined;
  const projectType = (type: string) => (declared ??= declaredTypes(p, rt.language)).has(type.split(/[.:]/).pop()!);
  return (rep, code, by, t, input) => {
    if (rep.status === 'timeout') {
      if (largeInput(`${code}\n${input ?? ''}`, rt.isImport)) return null;
      return { kind: 'hang', where: t.path, type: 'Timeout', message: `did not finish within ${callMs / 1000}s`, harness: code, input, line: '', stack: [], function: t.qualifiedName, by };
    }
    if (rep.status !== 'error' || rep.origin !== 'library' || rt.environmental(rep) || precondition(p, rep)) return null;
    const inner = rep.frames?.at(-1);
    const stack = (rep.frames ?? []).map((f) => `${f.path}:${f.line} ${f.name}`);
    if (rep.native) return { kind: 'crash', by, where: inner ? `${inner.path}:${inner.line}` : t.path, type: rep.type ?? 'NativeCrash', message: rep.message ?? '', harness: code, input, line: '', stack, function: inner ? fnAt(inner.path, inner.line) : t.qualifiedName };
    if (!inner) return null;
    const root = p.tree(inner.path);
    const lines = p.read(inner.path).split('\n');
    // In a language with exceptions, a throw of a standard rejection, or of an error type the project defines, is the contract
    // working. In one where errors are values, a panic or crash never is.
    if (!rt.errorsAreValues && !!root && throwsOnPurpose(root, inner.line) && (rt.rejections.includes(rep.type ?? '') || projectType(rep.type ?? ''))) return null;
    return { kind: 'crash', by, where: `${inner.path}:${inner.line}`, type: rep.type ?? 'Error', message: rep.message ?? '', clean: (rep as InputReport).clean, harness: code, input, line: lines.slice(Math.max(0, inner.line - 6), inner.line + 2).join('\n'), stack, function: fnAt(inner.path, inner.line) };
  };
}

/** One finding per cause (kind, type, place), keeping the smallest reproduction. */
export function dedupe(raw: Finding[]): Finding[] {
  const byCause = new Map<string, Finding>();
  const size = (f: Finding) => f.harness.length + (f.input?.length ?? 0);
  for (const f of raw) {
    const key = `${f.kind}|${f.type}|${f.where}|${f.kind === 'crash' ? '' : f.function}`;
    const have = byCause.get(key);
    if (!have || size(f) < size(have)) byCause.set(key, f);
  }
  return [...byCause.values()];
}

/**
 * An input as the judge sees it: whole, unless one question with it would not fit in a request to the judge, in which case
 * its start, with how much was left out.
 */
const shown = (input: string) => (input.length <= MAX_BODY_CHARS / 4 ? input : `${input.slice(0, MAX_BODY_CHARS / 4)}… (${input.length - MAX_BODY_CHARS / 4} more characters)`);

/**
 * No judge before the test. A distinct failure is a candidate as found: the failing test decides whether it is a bug, and the
 * one question after the test says what kind. Weakness classes the entry point is exposed to (src/weaknesses.ts) label the
 * finding's CWE when the failure's message or type names one of them.
 */
export async function judge(p: Project, rt: Runtime, subjects: Target[], distinct: Finding[], jev: DecisionModel, weaknesses?: Map<string, Weakness[]>): Promise<void> {
  const calledIn = (code: string) => subjects.find((s) => new RegExp(`(?<![\\w$])${s.name.replace(/\W/g, '')}\\s*[(!<]`).test(code.trimEnd().split('\n').at(-1) ?? '')) ?? subjects.find((s) => code.includes(s.name));
  for (const f of distinct) {
    const called = calledIn(f.harness);
    const classes = weaknesses?.get(f.function) ?? (called ? weaknesses?.get(called.qualifiedName) : undefined) ?? [];
    // A clean rejection of hostile input is the library doing its job; everything else is tested.
    f.bug = f.clean ? 0 : 1;
    f.hardening = 0;
    f.defect = f.clean ? 0 : 1;
    f.finding = 'bug';
    f.security = classes.length ? 0.5 : 0;
    f.verdict = f.clean ? 'a clean rejection' : 'to be tested';
    const named = classes.find((w) => new RegExp(w.id.replace(/\W/g, '\\$&'), 'i').test(`${f.type} ${f.message}`));
    if (named) f.cwe = named.id;
  }
}
