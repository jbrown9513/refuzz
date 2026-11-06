/**
 * Fuzzing of the project's attack surfaces (src/surface.ts) with OSS-Fuzz targets: files in the form OSS-Fuzz runs for the
 * language (an Atheris `TestOneInput(data)`, `LLVMFuzzerTestOneInput`, a cargo-fuzz `fuzz_target!`…), taking raw bytes. The
 * writer (gpt-6-luna) writes and refines targets, the language's own engine fuzzes them, the judge rules on what failed. refuzz
 * does not fuzz: it measures what the engine's inputs ran.
 *
 * Each surface keeps a portfolio of targets and one corpus between runs (src/store.ts), and the portfolio only grows:
 *   start    every stored target is built. One that no longer builds or loads is rewritten from its error; the others are
 *            kept as they are. The stored corpus and the inputs of earlier failures run first through every target.
 *   search   a new target's seeds run once through refuzz's driver, which measures every input's project lines; then the
 *            targets take turns under the language's engine (libFuzzer, Atheris, Jazzer, cargo-fuzz, go test -fuzz…) on the
 *            shared corpus, and each input the engine keeps is measured once. Junk is clamped: an input that reaches none
 *            of the surface's entry points, or fails in the target's own code, never joins the corpus. A language with no
 *            engine for its targets is not fuzzed; an engine that runs nothing is the target's error.
 *   improve  only errors are rewritten: a target that does not build, whose inputs reach no entry point, that mostly fails
 *            in its own code, or that asserts what the function never promised. Working targets are never replaced. The
 *            search runs in iterations with a doubling budget; after each, the writer makes one move aimed at what the
 *            targets miss (functions and branches no input reached, confirmed defects to dig around): inputs for an existing target, a new target, or branches judged cold and left
 *            out from then on. A new target joins the portfolio the moment it reaches a surface line no other target
 *            reached, and is discarded otherwise. Beside coverage, each surface has the promises its entry points make
 *            (documented errors, return contracts, round trips, bounds, its weakness classes' invariants), listed once per
 *            version of its code, and each target names the promises its assertions check. A surface stops when two
 *            iterations in a row gain under `plateau` and every promise is checked by some target or found untestable;
 *            until then the move after flat iterations is a target checking the promises none checks, which joins on that.
 *   judge    the judge sees only failures: an assertion is vetted against the documentation first, and each defect is run again
 *            alone. A target that covers nothing the others do not and found nothing is pruned at the end of the run.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DecisionModel } from './llm/models.ts';
import { choice, scoreFor, scoreOf, type Answer } from './llm/questions.ts';
import { tooLong, type Writer } from './llm/writer.ts';
import { dedupe, describe, errorClass, importsFor, namesProject, oracle, precondition, type Finding, type FuzzOptions, type FuzzResult } from './engine.ts';
import { pool as inParallel, PARALLEL } from './run.ts';
import { OutOfBudget, rank, type Budget, type Standing } from './schedule.ts';
import { SurfaceStore, type Contribution, type Round, type RunRecord, type SurfacePromise } from './store.ts';
import { crawlOrder, describeSources, discoverSurfaces, named, priorWorth, shipped, sourceHash, surfaceLines, surfaceOf, type Surface } from './surface.ts';
import { branchPoints, constantPool, freeTrees, sourceOf, testExamples, testsCalling, typesDeclaredAt, type Project } from './syntax.ts';
import type { FuzzSession, InputReport, Runtime, Target } from './types.ts';
import { siteOf, Verifier } from './verify.ts';
import { exposure, type Weakness } from './weaknesses.ts';
import { describeFixtures, fixtureSeeds, fixturesOf } from './fixtures.ts';
import { apiHint } from './apihint.ts';
import { gapOf, mapTests, testsRunning, type TestMap } from './testmap.ts';

/** What every target is told, whatever the language: the same for every surface, so it is sent as the cached block. */
const TARGETS = `A fuzz target is the file a project adds to OSS-Fuzz: the fuzzing engine calls its entry point millions of times with raw bytes and keeps the inputs that reach new code. It is judged by how much of the surface its inputs reach and by the defects it exposes.
JUNK: an input the target throws away before it reaches the code under test is wasted time, and most fuzzers spend most of theirs on it. Write the target so that almost every byte string reaches an entry point: take structure from the bytes (a FuzzedDataProvider or the language's equivalent) instead of demanding a format up front; where the code first checks something random bytes almost never satisfy (a magic number, a checksum or CRC, a length field that must match, a signature, a MAC), the target builds the input from fuzzed contents and computes that part itself the project's way, with one fuzzed choice that corrupts it instead (a flipped byte, a wrong length, a dropped or swapped part), so inputs both pass and fail the check. Signing or encrypting uses the project's own function and a fixed test key; values the project would generate (the time, ids, nonces) are fixed so the same input gives the same result.
DATA FROM OUTSIDE: an argument that carries data from outside the program (a packet, message, file, header, request, response, token, document) is built the way the program receives it, as bytes through the project's own decoder or parser, never filled in field by field or through a constructor that refuses bad values, which reaches states no sender can produce. Code that sends a request and decodes the answer (an HTTP or API client, an RPC stub) gets an in-process fake transport the client library supports (httpx.MockTransport, a requests adapter, an in-memory stream) that returns the fuzzed bytes as the server's response: there is no network. Arguments the program holds itself (its configuration, a mode, a capacity, objects it builds) are made as the project's tests make them, through its constructors and factories in the order the tests call them.
ASSERTIONS: after the call, assert what the project promises for every input it accepts, each with a message showing the values compared: a round trip (decode what it encoded, parse what it printed), agreement between two of the project's ways of computing the same thing (a public function and the internal one it wraps, two backends or modes documented as equal), a declared length or count respected, an output staying inside its base path. Never assert exact values computed by hand, or anything the documentation does not promise. Never skip inputs whose declared length differs from the data, whose value is empty or missing, or whose offset runs past the end; on those, assert the function rejected the input with its own error or returned a result consistent with what the input declares. The request lists the promises the surface's entry points make, each with an id: assert the ones the target can, on the inputs where each applies, and give the target a comment line \`refuzz-promises:\` followed by the ids of the promises its assertions check.
NEVER REPLACE THE PROJECT'S OWN CODE: do not redefine, stub, monkeypatch or mock any method, class or module of the project (no define_method or define_singleton_method on its objects, no reassigning its functions, no mock of its classes). Its wrappers, error handlers and validation are part of what is tested: a failure that only happens because the target removed them (a controller's rescue block replaced by a bare yield) is the target's, never the project's. Fake only what lies outside the project: the network, a database or cache server, authentication, the clock, the filesystem outside a temporary directory. When the code needs its framework loaded (a web app's application environment, a logger, configuration), load it the way the project's tests do.
Catch only the exceptions the project documents for invalid input, by their exact classes. Never use the network, start processes, print, or write outside a temporary directory. Code only, no prose.`;

/**
 * Code without the plain sentences a writer sometimes leaves in it ("These inputs are valid for every case."). A line is a
 * sentence when it is four words or more with none of the punctuation code is made of, holds one of the small words English
 * needs and code never strings together, and does not start with a keyword a statement in some language starts with.
 */
const STATEMENT = /^(return|assert|raise|throw|yield|await|if|elif|else|unless|while|until|for|foreach|do|then|end|begin|case|when|import|from|export|require|use|using|include|def|fn|func|function|fun|class|struct|module|package|let|var|val|const|local|my|our|static|pub|private|public|protected|go|defer|select|pass|break|continue|not|puts|print|println|echo|del|global|nonlocal|lambda|with|try|except|finally|catch|rescue|ensure|match|loop|in|of|and|or|is)$/;
const FILLER = /^(the|a|an|is|are|be|been|was|were|of|to|that|this|these|those|which|will|should|must|can|may|each|every|for|so|it|its|it's|they|their|we|our|you|your|when|because|only)$/i;
const prose = (line: string) => {
  const t = line.trim().replace(/[.!:]$/, '').replace(/`[^`]*`/g, 'name').replace(/`.*$/, '');
  if (/[(){}[\]=;<>"`#/\\|&*+$@%^~]/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean).map((w) => w.replace(/[,:.!?]+$/, ''));
  return words.length >= 4 && words.every((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w)) && !STATEMENT.test(words[0]) && words.some((w) => FILLER.test(w));
};
const withoutProse = (code: string) => code.replace(/^```\w*\n|\n```\s*$/g, '').split('\n').filter((l) => !prose(l)).join('\n');

/** A line comment in the target's language, for the tag lines below. */
const COMMENT: Record<string, string> = { python: '#', ruby: '#', bash: '#', lua: '--' };
/**
 * A target written when perch scan steered the fuzzer has a `refuzz-suspects:` line naming the scan findings it tested. The
 * scan is gone, so the line means nothing now: it stays in stored targets until their next rewrite, which drops it.
 */
const OLD_SUSPECTS_TAG = 'refuzz-suspects:';
/** The line naming the surface's promises (src/store.ts SurfacePromise) its assertions check. */
const PROMISES_TAG = 'refuzz-promises:';
/** And the line naming the kind of harness the target is (HARNESS_KINDS). */
const KIND_TAG = 'refuzz-kind:';
/**
 * And the line naming the inner function a decomposition's part targets: a function the surface hands its input to, called
 * directly with what its callers guarantee, so its inputs reach code end-to-end inputs rarely get to.
 */
const INNER_TAG = 'refuzz-inner:';
/**
 * The kinds of harness a target can be. The judge scores each for a surface (scoreSurfaces): how likely that kind is to
 * expose a defect a maintainer fixes there. The first target is the kind scored highest, each later one the highest no kept
 * target is yet, and a kind scored near zero is never written.
 */
const HARNESS_KINDS: { id: string; name: string; does: string }[] = [
  { id: 'fromtest', name: 'a project test, fuzzed', does: 'is one of the project\'s own tests that measurably runs this surface (shown under TESTS THAT RUN THIS SURFACE), made a target: its setup, fixtures, objects and order of calls stay as the test has them, since that is how the project calls this code, and the values it passes in (strings, numbers, payloads, names, options, collections and their sizes) come from the bytes instead; it asserts what the test asserts wherever that holds for every input, and the promises listed otherwise' },
  { id: 'wellformed', name: 'well-formed, then altered', does: 'builds a complete valid input the way the project\'s tests do, starting from its test data where there is some: real keys and certificates (loaded, or generated once at the target\'s start), real signatures and MACs, a whole file or message with correct lengths, counts and checksums; the bytes choose its values and one alteration (a changed algorithm, header or claim, a swapped, stripped or duplicated signature or element, a length, count or dimension pushed to its limit), recomputing what a sender could recompute; and asserts the security property: what was altered without the key is rejected, what is valid is accepted with exactly the values that were signed, and decoding stays within the declared sizes' },
  { id: 'malformed', name: 'malformed input', does: 'feeds the decoder truncated, oversized and inconsistent input: a declared length or count that disagrees with the data, offsets past the end, wrong magic or version, invalid encodings, and asserts it rejects each with its own documented error and never reads past the data' },
  { id: 'roundtrip', name: 'round trip', does: 'encodes what it decoded and decodes what it encoded, prints what it parsed and parses what it printed, and asserts the result equals the original for every input the project accepts' },
  { id: 'differential', name: 'differential', does: 'computes the same thing two of the project\'s own ways (a public function and the internal one it wraps, two backends or modes documented as equal, a fast path and a slow path) and asserts they agree on every input' },
  { id: 'bounds', name: 'bounds and limits', does: 'asserts that declared counts, lengths, sizes, offsets and ranges in the result are respected: what it says it holds, it holds; nothing exceeds the limits the documentation states' },
  { id: 'sequence', name: 'call sequence', does: 'drives a stateful object through call orderings its documentation allows, derived from the bytes, and asserts the documented invariants hold after each call and that disallowed orderings are rejected rather than corrupting state' },
  { id: 'oom', name: 'allocation limits', does: 'runs the code under a memory limit or an allocation failure placed by the bytes (the project\'s own limit setting, as its tests set it, small enough to be reached partway through; or the allocator made to fail on the Nth call), lets the project abort the operation its own way, then runs its cleanup, shutdown or next request exactly as the program would, and asserts nothing half-built or already freed is used: what an out-of-memory abort leaves behind is never read again' },
  { id: 'resources', name: 'resource bounds', does: 'asserts that the result\'s size and the work done stay proportional to the input: no unbounded allocation, repetition or recursion from a small input' },
  { id: 'api', name: 'live API', does: 'starts the project\'s own HTTP service inside the target the way the project\'s API tests do (its server or router constructor, its configuration loader, the database and services the running deployment uses, from /src/refuzz-run.env and /src/refuzz-test.env), keeps it running across inputs, and drives it with requests as a client does: the bytes choose a request sequence, its fields and values, every request is one a client could send, and the assertions check what the API documents for each response (the status, the body, that a retried request has its effect once, that one user never sees another\'s data); state persists between inputs, so what a sequence needs is created with unique names from the bytes' },
  { id: 'isolation', name: 'isolation and authorization', does: 'builds two tenants, namespaces, keys or principals from the bytes and asserts one never reads, changes or is granted the other\'s data, and that every authorization decision the documentation states is enforced' },
];
/** The target with its tag lines: after a `<?php` or `#!` first line, which must stay first. */
function tagged(language: string, source: string, promises: string[] = [], kind?: string, inner?: string): string {
  const body = source.split('\n').filter((l) => !l.includes(OLD_SUSPECTS_TAG) && !l.includes(PROMISES_TAG) && !l.includes(KIND_TAG) && !l.includes(INNER_TAG)).join('\n');
  const lines = ([[PROMISES_TAG, promises], [KIND_TAG, kind ? [kind] : []], [INNER_TAG, inner ? [inner] : []]] as const).filter(([, ids]) => ids.length).map(([tag, ids]) => `${COMMENT[language] ?? '//'} ${tag} ${ids.join(' ')}`);
  if (!lines.length) return body;
  const [first, ...rest] = body.split('\n');
  return /^(<\?php|#!)/.test(first) ? [first, ...lines, ...rest].join('\n') : [...lines, body].join('\n');
}
const tagsOf = (source: string, tag: string) => new Set(source.split('\n').filter((l) => l.includes(tag)).flatMap((l) => l.slice(l.indexOf(tag) + tag.length).trim().split(/\s+/)).filter(Boolean));

/** Raw bytes as a person reads them: text when they are printable UTF-8, hex otherwise. */
export function showInput(b: Buffer): string {
  const text = b.toString('utf8');
  return Buffer.from(text, 'utf8').equals(b) && !/[\x00-\x08\x0e-\x1f\x7f]/.test(text) ? JSON.stringify(text) : `hex ${b.toString('hex')}`;
}

/**
 * The code a surface's entry points hand their input to, everything perch's call graph reaches from them, most complex
 * first, and the string literals in it. `budget` characters of it, when a model could not take all of it.
 */
function reached(p: Project, surface: Surface, budget = Infinity): string {
  const entries = new Set(surface.entries.map((e) => e.id));
  const found = surface.reach.filter((m) => !entries.has(m.id)).sort((a, b) => b.complexity - a.complexity);
  if (!found.length) return '';
  let out = '', left = budget;
  for (const m of found) {
    const src = sourceOf(p, m);
    if (src.length > left) continue;
    out += `# ${m.qualifiedName} (${m.path})\n${src}\n`;
    left -= src.length;
  }
  const words = constantPool(found.map((m) => ({ source: sourceOf(p, m), language: m.language }))).string;
  return `CODE IT HANDS ITS INPUT TO:\n${out}${words.length ? `STRING LITERALS IN THAT CODE: ${words.join(' ')}` : ''}`;
}

/**
 * The functions a decomposition writes parts for, each with the source of its callers in the surface, which show what it is
 * handed: `budget` characters of it, the functions themselves first.
 */
function partsCode(p: Project, surface: Surface, fns: Target[], budget = Infinity): string {
  const inReach = new Map(surface.reach.map((m) => [m.id, m]));
  let out = '', left = budget;
  for (const fn of fns) {
    const src = sourceOf(p, fn);
    out += `# ${fn.qualifiedName} (${fn.path})\n${src}\n`;
    left -= src.length;
  }
  for (const fn of fns) for (const id of p.callers(fn.id)) {
    const c = inReach.get(id);
    if (!c) continue;
    const src = sourceOf(p, c);
    if (src.length > left) continue;
    out += `## ${fn.qualifiedName} is called from ${c.qualifiedName} (${c.path})\n${src}\n`;
    left -= src.length;
  }
  return `FUNCTIONS TO WRITE A PART FOR, EACH WITH THE CALLERS THAT HAND IT ITS INPUT:\n${out}`;
}

/** The first `n` characters of a part of a request, ending at a line, marked as cut. */
function fit(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.lastIndexOf('\n', n);
  return `${text.slice(0, cut > 0 ? cut : n)}\n… (cut to fit)`;
}

/** The surface's string literals, unquoted: the dictionary its targets start from, before the writer adds to it. */
function literalsOf(p: Project, s: Surface): string[] {
  const pool = constantPool(s.reach.map((m) => ({ source: sourceOf(p, m), language: m.language })));
  return pool.string.map((x) => { try { return JSON.parse(x.replace(/^'(.*)'$/, '"$1"')); } catch { return x.slice(1, -1); } }).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64);
}

/**
 * The error types the project declares in a language, each with the file declaring it: a target catches the project's
 * rejections by their exact names, and a writer that cannot see them guesses names and modules that do not exist.
 */
export function errorTypes(p: Project, language: string, near: string): string {
  const dir = near.replace(/[^/]*$/, '');
  // Read once with the project (syntax.ts readProject): the ones in the surface's own folder first, then the rest.
  const out = p.errorTypes
    .filter((e) => e.language === language && !TEST_FILE.test(e.path))
    .sort((a, b) => Number(!a.path.startsWith(dir)) - Number(!b.path.startsWith(dir)))
    .slice(0, 40)
    .map((e) => `${e.name} (${e.path})`);
  return out.length ? `ERROR TYPES THE PROJECT DECLARES, AND THE FILE EACH IS IN (catch only these, by these names, imported from these files; no other exist):\n${out.join('\n')}` : '';
}

/** Where a test of the project lives: a tests directory, or a file named test_…, …_test or ….test. */
const TEST_FILE = /(^|\/)(tests?|testing|__tests__)\/|(^|\/)test_[^/]*$|_test\.\w+$|\.test\.\w+$/i;

/** Where the project constructs the class a method belongs to, up to six lines with their files. */
function builtAtIn(p: Project, target: Target): string {
  const owner = target.qualifiedName.split('.').slice(-2, -1)[0]?.replace(/<.*$/, '');
  if (!owner || !/^\w+$/.test(owner)) return '';
  const made = new RegExp(`(\\bnew\\s+(?:[\\w\\\\.]*[\\\\.])?${owner}\\s*[(<]|\\b${owner}(?:::|\\.)new\\b|&?\\b${owner}\\s*\\{)`);
  const declared = new RegExp(`\\b(class|struct|interface|trait|enum|type|impl|record)\\s+(?:[\\w<>,: ]*\\s)?${owner}\\b`);
  const out: string[] = [];
  for (const [path, language] of p.files) {
    if (language !== target.language || out.length >= 6) continue;
    let text = '';
    try { text = p.read(path); } catch { continue; }
    if (!text.includes(owner)) continue;
    text.split('\n').forEach((l, i) => { if (out.length < 6 && made.test(l) && !declared.test(l)) out.push(`${path}:${i + 1}: ${l.trim().slice(0, 200)}`); });
  }
  return out.length ? `WHERE THE PROJECT CONSTRUCTS ${owner}:\n${out.join('\n')}` : '';
}

/** The declarations of the constants a target uses: its source names them but not their values. */
export function constantsOf(p: Project, s: Target): string {
  const names = [...new Set(sourceOf(p, s).match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])].slice(0, 24);
  if (!names.length) return '';
  const dir = s.path.replace(/[^/]*$/, '');
  const files = [s.path, ...[...p.files].filter(([f, l]) => l === s.language && f !== s.path && !TEST_FILE.test(f)).map(([f]) => f).sort((a, b) => Number(!a.startsWith(dir)) - Number(!b.startsWith(dir)))];
  const out: string[] = [];
  const left = new Set(names);
  for (const f of files) {
    if (!left.size) break;
    const lines = p.read(f).split('\n');
    for (const name of [...left]) {
      const decl = new RegExp(`^\\s*#\\s*define\\s+${name}\\b|\\b${name}\\b\\s*(?::[^=\\n]*)?=(?!=)`);
      const i = lines.findIndex((l) => decl.test(l) && !/^\s*(\/\/|#(?!\s*define)|\*)/.test(l) && !/\b(if|while|return|for)\b/.test(l));
      if (i < 0) continue;
      let end = i;
      while (end < i + 4 && end + 1 < lines.length && !/[;)\]}]\s*$|["'`\d]\s*,?\s*$/.test(lines[end])) end++;
      out.push(`${f}:${i + 1}: ${lines.slice(i, end + 1).map((l) => l.trim()).join(' ').slice(0, 400)}`);
      left.delete(name);
    }
  }
  return out.length ? `CONSTANTS THE TARGET USES (use these values, never a guess):\n${out.join('\n')}` : '';
}

/**
 * How the project creates the objects a C-style target takes: for each `name_t *` or `struct name *` parameter with
 * constructor functions (`name_new`, `name_join`, `name_init`, `name_create`), the lines of a test (or other project code)
 * that call them and size their memory, up to six per type.
 */
export function constructionOf(p: Project, s: Target): string {
  const prefixes = [...new Set([...s.header.matchAll(/\bstruct\s+(\w+)\s*(?:const\s*)?\*|\b(\w+)_t\s*(?:const\s*)?\*/g)].map((m) => m[1] ?? m[2]))];
  const names = new Set(p.targets.filter((t) => !t.test && t.language === s.language).map((t) => t.name));
  const dir = s.path.replace(/[^/]*$/, '');
  const files = [...p.files].filter(([, l]) => l === s.language).map(([f]) => f)
    .sort((a, b) => Number(!TEST_FILE.test(a)) - Number(!TEST_FILE.test(b)) || Number(!a.startsWith(dir)) - Number(!b.startsWith(dir)));
  const out: string[] = [];
  for (const prefix of prefixes.slice(0, 4)) {
    if (!['new', 'join', 'init', 'create'].some((k) => names.has(`${prefix}_${k}`))) continue;
    const make = new RegExp(`\\b${prefix}_(?:new|join|init|create)\\s*\\(`);
    const sized = new RegExp(`\\b${prefix}_(?:new|join|init|create|footprint|align)\\s*\\(`);
    for (const f of files) {
      let text = '';
      try { text = p.read(f); } catch { continue; }
      if (!make.test(text)) continue;
      const lines = text.split('\n');
      const at = lines.findIndex((l) => make.test(l));
      if (p.at(f, at + 1)?.name.startsWith(`${prefix}_`)) continue;
      const kept: string[] = [];
      for (let i = Math.max(0, at - 6); i < lines.length && i <= at + 2 && kept.length < 6; i++) {
        if (!sized.test(lines[i])) continue;
        for (let j = i; j < lines.length && kept.length < 6; j++) { kept.push(lines[j].trim()); i = j; if (/;\s*(\/[/*].*)?$/.test(lines[j])) break; }
      }
      out.push(`# ${prefix}_… (${f}:${at + 1}${TEST_FILE.test(f) ? '' : ', project code: no test creates one'})\n${kept.join('\n')}`);
      break;
    }
  }
  return out.length ? `HOW THE PROJECT CREATES THE OBJECTS THIS TARGET TAKES (create them the same way, through these functions, with memory of the size and alignment its footprint and align functions give):\n${out.join('\n')}` : '';
}

export interface FuzzRun extends FuzzResult {
  execs: number;
  /** The weakness classes the judge picked per surface, when there was a catalog. */
  weaknesses?: Record<string, string[]>;
  /** Surfaces never fuzzed, and why. */
  unfuzzed?: Record<string, string>;
  /** Each surface fuzzed: its entry points, the sources feeding it, its coverage over all runs, its targets, where it is stored. */
  surfaces?: Record<string, { entries: string[]; sources: string[]; covered: number; total: number; entriesReached: string[]; targets: Record<string, Contribution>; added: string[]; fixed: string[]; pruned: string[]; folder: string }>;
  /** The language's OSS-Fuzz project folder and the targets in it, every kept target of every surface. */
  ossFuzz?: { folder: string; targets: string[] };
  /** Inputs that never reached an entry point or failed in the target's own code, and were dropped. */
  junk?: number;
}

/**
 * Target builds in flight at once, across every worker of the process. A compiled language's build takes gigabytes each (a
 * Go test binary of a large module, a Rust crate), and with one per worker they exhaust the container host's memory; so
 * they are limited to a share of the cores, or `REFUZZ_BUILDS`. An interpreted language's loads are light and not limited.
 */
const COMPILED = new Set(['go', 'rust', 'c', 'cpp', 'java', 'kotlin', 'scala', 'groovy', 'swift', 'zig', 'c_sharp', 'solidity']);
const BUILDS = Number(process.env.REFUZZ_BUILDS) || Math.max(1, Math.floor(PARALLEL / 4));
let building = 0;
const buildWaiters: (() => void)[] = [];
async function buildSlot<T>(language: string, work: () => Promise<T>): Promise<T> {
  if (COMPILED.has(language)) { while (building >= BUILDS) await new Promise<void>((r) => buildWaiters.push(r)); building++; }
  try { return await work(); } finally { if (COMPILED.has(language)) { building--; buildWaiters.shift()?.(); } }
}

/** Weakness classes per entry point (`language|name`), asked of the judge once per process. */
const exposed = new Map<string, Weakness[]>();

/** A target is in error when, after this many measured inputs, none reached an entry point, or most failed in its own code. */
const JUDGED_AFTER = 300;
/** A target is pruned only after this many inputs this run with nothing unique, no finding, and others left. */
const PRUNE_AFTER = 5_000;
/** A promise still unchecked after this many moves asked for a target checking it is taken as one no fuzz target can check. */
const PROMISE_ASKS = 3;
/** A native run shorter than this is not started: building the engine's binary alone takes longer. */
const NATIVE_MIN_SECONDS = 10;

/**
 * A load failure the environment causes: an error the runtime counts as environmental raised from the project's own code, not
 * the target's. Returns what is missing.
 */
/** The runtime's own driver and probe files (src/probes), compiled or loaded beside every target. */
const PROBE_FILES = existsSync(join(import.meta.dirname, 'probes')) ? readdirSync(join(import.meta.dirname, 'probes'), { recursive: true }).map(String).map((f) => f.split('/').pop()!).filter((f) => f.includes('.')) : [];

function environmentalLoad(error: string, projectDir: string, rt: Runtime): string | undefined {
  const lines = error.trim().split('\n');
  // An error inside the runtime's own driver or probe (a `refuzz/driver.go` that the project's go directive cannot compile):
  // no rewrite of the target changes it, and every target of the run would fail the same way.
  // A driver frame that a target's own call passes through (Ruby's require wrapper, under a target's `require "wrong"`) is
  // the target's mistake: the trace also names the target's file (fuzz_1.rb, s0_fuzz_1_2.go).
  const targetFrame = lines.slice(0, 16).some((l) => /(?:^|[\s/(])(?:s\d+_)?fuzz_\d+[\w-]*\.\w+:\d+/.test(l));
  if (!targetFrame) for (const l of lines.slice(0, 6)) {
    const probe = PROBE_FILES.find((name) => new RegExp(`(?:^|[\\s/(])(?:[\\w.-]+/)*refuzz/${name.replace(/\./g, '\\.')}:\\d+`).test(l));
    if (probe) return `the ${rt.language} driver (${probe}) does not build or load in this project: ${l.trim().slice(0, 160)}`;
  }
  // A header, module or file the project's own code asks for that is not there (a cFS app's cfe.h without cFE beside it): no
  // rewrite of the target changes that. The line naming it carries the project file that asked.
  const missing = lines.find((l) => /file not found|cannot load such file|No module named|Cannot find module|cannot open source file|No such file or directory/i.test(l));
  // On the same line (a compiler's `file:line: fatal error`), or on the first frame after it (a traceback's innermost caller).
  const at = missing ? lines.indexOf(missing) : -1;
  const asker = missing && lines.slice(at, at + 4).map((l) => /((?:\/[^\s:'"]+|[\w.-]+(?:\/[\w.-]+)+)\.\w+):\d+/.exec(l)?.[1]).find(Boolean);
  if (asker) {
    const rel = asker.replace(/^(\/work\/src\/|\/src\/)/, '').replace(`${projectDir}/`, '');
    if (!rel.startsWith('/') && existsSync(join(projectDir, rel))) return `${rel} needs what is not in this checkout: ${missing!.replace(/^.*?(fatal )?error:\s*/, '').trim().slice(0, 160)}`;
  }
  const last = lines.findLast((l) => /^\s*[\w.]+(Error|Exception)\b/.test(l)) ?? lines[0];
  const m = /^\s*([\w.]+(?:Error|Exception))\b:?\s*(.*)$/.exec(last);
  if (!m || !rt.environmental({ status: 'error', type: m[1].split('.').pop(), message: m[2] })) return undefined;
  // A name the target imports that the module does not have is the target's mistake, whatever module it named.
  if (/cannot import name|has no attribute|is not exported|does not provide an export/i.test(m[2])) return undefined;
  // The frames the error passed through, read from the lines before its message: a path inside the message names the module
  // it looked in, not where it was raised.
  const before = lines.slice(0, lines.lastIndexOf(last)).join('\n');
  const files = [...before.matchAll(/File "([^"]+)"|(\/[^\s"':]+\.\w+)(?=[:"\s,)])/g)].map((x) => x[1] ?? x[2]);
  return files.at(-1)?.startsWith(projectDir) ? `${m[1]}: ${m[2]}`.slice(0, 160) : undefined;
}

/** What the writer is asked to do: a surface's first target, a new one aimed at what the others miss, or a fix. */
type Ask = { kind: 'first' } | { kind: 'decompose'; fns: Target[] } | { kind: 'improve'; note: string } | { kind: 'fix'; source: string; error: string; again: number; inner?: string };

/**
 * What the writer answered. For a first target or a fix, `source` is the target. For an improvement step, `action` is the move
 * it chose: `seeds` (inputs for the target named `forTarget`), `target` (a new target in `source`), `skip` (branches, as
 * `path:line`, it judged cold), or `untestable` (promises no fuzz target can check, in `untestable` with why, which any
 * move may also carry). `promises`: the ids of the surface's promises a target's assertions check.
 */
interface Written { source: string; promises: string[]; kind?: string; dictionary: string[]; seeds: Buffer[]; action?: 'seeds' | 'target' | 'skip' | 'untestable' | 'parts'; forTarget?: string; skip?: string[]; untestable?: { id: string; why: string }[]; inner?: string; parts?: Written[]; composition?: string }

/**
 * Surfaces the writer proposes for code no surface found in the code covers: it reads the functions left (most complex
 * first) and the surfaces already fuzzed, and names the entry points through which outside data gets to them. A request too
 * long for the model is sent again with the list halved.
 */
async function proposeSurfaces(p: Project, rt: Runtime, writer: Writer, left: Target[], have: Surface[], log: (s: string) => void): Promise<Surface[]> {
  if (!left.length) return [];
  const ok = shipped(p, rt);
  const sorted = [...left].sort((a, b) => b.complexity - a.complexity);
  const fields = {
    plan: 'Which of the listed functions handle data that comes from outside the program (files, network, messages, commands, documents, configuration it is given), and which function a caller hands that data to first, whether listed or not.',
    surfaces: 'A JSON array, one element per new surface: {"entries": [qualified names of the functions a fuzz target calls with the outside data, exactly as named in the project], "why": "what data comes in there"}. Functions whose code is mostly the same go in one surface. [] when none of the listed code handles outside data.',
  };
  for (let n = sorted.length; n > 0; n = Math.floor(n / 2)) {
    const prompt = [
      `PROJECT: ${p.dir.split('/').pop()} (${rt.language})`,
      `SURFACES ALREADY FUZZED (their entry points):\n${have.map((x) => x.entries.map((e) => e.qualifiedName).join(', ')).join('\n')}`,
      `FUNCTIONS NO INPUT HAS RUN YET${n < sorted.length ? ` (the ${n} most complex of ${sorted.length})` : ''}:\n${sorted.slice(0, n).map((m) => `${m.qualifiedName} (${m.path}:${m.line}) ${m.header}${m.doc ? ` // ${m.doc}` : ''}`).join('\n')}`,
    ].join('\n\n');
    try {
      const a = await writer.generate(prompt, fields, 'fuzz-surfaces', `refuzz-${rt.language}`);
      let list: unknown;
      try { list = JSON.parse((a.surfaces ?? '[]').replace(/^```\w*\n|\n```\s*$/g, '')); } catch { list = []; }
      const out: Surface[] = [];
      const asked = Array.isArray(list) ? list.length : 0;
      for (const x of Array.isArray(list) ? list : []) {
        const names = Array.isArray((x as { entries?: unknown }).entries) ? ((x as { entries: unknown[] }).entries.filter((y) => typeof y === 'string') as string[]) : [];
        const entries = [...new Map(names.flatMap((name) => p.targets.filter((t) => t.language === rt.language && ok(t) && named(t, [name]))).map((t) => [t.id, t])).values()];
        if (entries.length) out.push(surfaceOf(p, rt, entries, [], ok));
      }
      const fresh = out.filter((x) => !have.some((y) => y.id === x.id));
      log(`  surfaces: the writer proposed ${asked} for ${left.length} functions no surface covers: ${out.length} name project functions, ${fresh.length} not fuzzed already${fresh.length ? `: ${fresh.map((x) => x.entries.map((e) => e.qualifiedName).join('+')).join(', ')}` : ''}`);
      return fresh;
    } catch (error) {
      if (tooLong(error)) continue;
      log(`  surfaces: the writer failed: ${String((error as Error).message).split('\n')[0]}`);
      return [];
    }
  }
  return [];
}

export async function fuzzSurfaces(p: Project, rt: Runtime, models: { judge: DecisionModel; text: Writer; verify?: { judge: DecisionModel; text: Writer } }, o: FuzzOptions, say: (s: string) => void): Promise<FuzzRun> {
  if (!rt.fuzz) throw new Error(`the ${rt.language} runner has no fuzz targets`);
  const t0 = Date.now();
  const log = (m: string) => say(`${m}  [${Math.round((Date.now() - t0) / 1000)}s]`);
  // A run asked for some surfaces (--only, --changed, --surfaces) fuzzes those and nothing else.
  const whole = !o.only && !o.changed && !Number.isFinite(o.surfaces);
  const surfaces = discoverSurfaces(p, rt, o);
  const fed = surfaces.filter((x) => x.sources.length).length;
  log(`  surfaces: ${surfaces.length}${o.only ? ' from the functions named with --only' : `, ${fed} fed by a source the code reads, ${surfaces.length - fed} public API or reached by dispatch`}, ${surfaces.reduce((n, x) => n + x.entries.length, 0)} entry points`);
  const store = await SurfaceStore.open(p.dir, rt.language, o.store);
  log(`  store: ${store.root}`);
  const total: FuzzRun = { language: rt.language, targets: [], probed: 0, execs: 0, coverage: 0, harnesses: { written: 0, working: 0, loaded: 0 }, findings: [], surfaces: {}, junk: 0 };
  const lines = new Set<string>();
  const deadline = Date.now() + o.searchMs;

  // The whole project's coverage: every shipped function's lines, and those any surface's inputs ran in this run or before.
  const code = p.targets.filter(shipped(p, rt));
  const projectTotal = code.reduce((n, m) => n + m.endLine - m.line + 1, 0);
  const known = new Map(surfaces.map((x) => [x.id, x]));
  // Surfaces the writer proposed in earlier sessions, by their entry points, kept with the store: fuzzed again like the rest.
  const proposedFile = join(store.root, 'proposed.json');
  const proposedBefore: string[][] = (() => { try { return JSON.parse(readFileSync(proposedFile, 'utf8')); } catch { return []; } })();
  const coveredLines = () => {
    const out = new Set(lines);
    for (const x of known.values()) for (const l of store.load(x, sourceHash(p, x)).covered) out.add(l);
    return out;
  };
  // A whole-project run also has the writer propose surfaces for code no input has run.
  if (whole) for (const ids of proposedBefore) {
    const entries = ids.map((id) => p.byId.get(id)).filter((t): t is Target => !!t);
    if (entries.length) { const x = surfaceOf(p, rt, entries); if (!known.has(x.id)) known.set(x.id, x); }
  }
  // Surfaces the judge has scored, this session or before (store.ts SurfaceWorth); the rest stand on the code-read prior.
  const scored = new Set<string>();
  /** What the project's tests run and check, once measured (src/testmap.ts, started below). */
  let testMap: TestMap | undefined;
  /**
   * A surface's worth is how directly outside data reaches it and what a bug there does (the judge's score, or the prior), times
   * how much of its code the project's tests leave unchecked, once measured: from half, where every mutant of its code is
   * caught, to one and a half, where none is or no test runs it. A bug the tests already catch is not one fuzzing finds.
   */
  const standingOf = (x: Surface): Standing => {
    const st = store.load(x, sourceHash(p, x));
    const last = st.runs.at(-1);
    if (st.worth?.kinds) scored.add(x.id);
    const gap = testMap ? gapOf(testMap, [...x.entries, ...x.reach]) : undefined;
    return { fresh: st.fresh, changed: st.changed, plateaued: !!st.round?.plateaued, rate: last?.ms ? (last.gained ?? 0) / (last.ms / 60_000) : undefined, lastAt: last?.at ?? '', targets: st.targets.length, worth: (st.worth?.worth ?? priorWorth(x)) * (gap === undefined ? 1 : 0.5 + gap) };
  };
  const standings = new Map([...known.values()].map((x) => [x.id, standingOf(x)]));
  log(`  worth: ${scored.size} of ${standings.size} surfaces scored by the judge before; the rest ordered by what the code says feeds them until it scores them`);

  /**
   * What fuzzing each surface is worth and which kind of harness to write first, from the judge, asked once per surface
   * and kept with its store: one score and one choice, six surfaces a request, in the order the code-read prior puts
   * them. It runs beside the search, so the queue is scored ahead of the workers taking from it.
   */
  const WORTH = [
    "Reached only by this program's own code with values it builds itself, or a test helper, logging or metrics: a bug here changes nothing a user sees. This includes reading back the program's own storage (its segment, index, log or metadata files, cache entries, database rows it wrote): only corruption makes them malformed.",
    "Exported for other packages of the same program, fed data that code already parsed and validated; a bug gives a wrong value a later step catches or one job fails.",
    'Public API of a library, called by dependent programs with their own data; a bug returns a wrong answer or fails a request.',
    'Handles data from outside the process after a trusted layer decoded it (a parsed request, a loaded configuration); a bug fails requests or corrupts stored data.',
    'Reads or decodes raw bytes or text from outside the process (a network peer, a request body, a file a user or another program supplies, standard input, a query string), where a bug crashes the process, loses data, or lets one tenant reach another. Not the program\'s own storage files, which it wrote itself.',
  ];
  const scoreSurfaces = async (stopping: () => boolean) => {
    const queue = [...known.values()].filter((x) => !scored.has(x.id)).sort((a, b) => priorWorth(b) - priorWorth(a));
    let n = 0, next = 0;
    // Four requests in flight: a large project (Temporal: 5,800 surfaces) is scored in minutes, ahead of the workers.
    const lane = async () => { for (;;) {
      if (next >= queue.length || stopping()) return;
      const batch = queue.slice(next, next + 6);
      next += 6;
      const state = {
        purpose: 'rank the surfaces of a program by what fuzzing each is worth',
        language: rt.language,
        surfaces: batch.map((x, k) => ({ n: k + 1, entry_points: x.entries.slice(0, 4).map((e) => ({ name: e.qualifiedName, file: e.path, header: e.header.slice(0, 300), doc: e.doc.slice(0, 400) })), source: sourceOf(p, x.entries[0]).slice(0, 1500), input_from: x.sources.slice(0, 5).map((y) => `${y.kind}: ${y.api} in ${y.in}`), public_callers: x.via.slice(0, 5).map((v) => v.qualifiedName), functions_reached: x.reach.length })),
      };
      const questions = Object.fromEntries(batch.flatMap((_, k) => [
        [`s${k + 1}_worth`, scoreFor(models.judge, `Surface ${k + 1}: how directly does data from outside the process reach its entry points, and what does a bug in the code they reach do?`, WORTH)],
        // A fuzzed project test is written whenever a test measurably runs the surface, so the judge does not choose it.
        [`s${k + 1}_kind`, choice({ question: `Surface ${k + 1}: which kind of fuzz harness is most likely to expose a defect a maintainer would fix in its code?` }, Object.fromEntries(HARNESS_KINDS.filter((h) => h.id !== 'fromtest').map((h) => [h.id, `${h.name}: ${h.does}`])))],
      ]));
      let a: Record<string, Answer>;
      try { a = await models.judge.ask(state, questions, 'fuzz-worth'); } catch (error) { log(`  worth: scoring stopped after ${n} surfaces: ${String((error as Error).message).split('\n')[0]}`); next = queue.length; return; }
      for (const [k, x] of batch.entries()) {
        // Unanswered, the prior stands, and it is not asked again for this code.
        const worth = scoreOf(a[`s${k + 1}_worth`], WORTH.length) ?? priorWorth(x);
        const kinds = Object.fromEntries(HARNESS_KINDS.map((h) => [h.id, a[`s${k + 1}_kind`]?.probabilities?.[h.id] ?? 0]));
        store.saveWorth(x, sourceHash(p, x), { worth, kinds });
        scored.add(x.id);
        standings.set(x.id, standingOf(x));
        n++;
      }
    } };
    await Promise.all([lane(), lane(), lane(), lane()]);
    const top = [...standings.entries()].sort((a, b) => b[1].worth - a[1].worth).slice(0, 5).map(([id, st]) => `${id} ${st.worth.toFixed(2)}`);
    log(`  worth: ${n} surfaces scored by the judge this session, ${scored.size} of ${standings.size} in all; the most worth fuzzing: ${top.join(', ')}`);
  };
  const turns = new Map<string, number>();
  const canWrite = () => o.budget?.canWrite() ?? true;
  const before = coveredLines().size;
  let proposed = !whole, batches = 0;
  const tierOf = (x: Standing) => (x.changed ? 'changed' : x.fresh ? 'new' : x.plateaued ? 'plateaued' : 'gaining');
  {
    const all = [...standings.values()];
    log(`  schedule: ${all.filter((x) => x.changed).length} surfaces whose code changed, ${all.filter((x) => x.fresh).length} never fuzzed, ${all.filter((x) => !x.changed && !x.fresh && !x.plateaued).length} still gaining, ${all.filter((x) => !x.changed && !x.fresh && x.plateaued).length} plateaued${o.budget && Number.isFinite(o.budget.limit) ? `; ${o.budget.limit}¢ for model calls` : ''}`);
  }

  // What the project's tests run and check, measured once for the surfaces first in line, beside the fuzzing: no worker waits
  // for it. When it comes, the surfaces are ranked again with it and targets written from then on start from those tests.
  const MAPPED = 12;
  if (o.built?.testSetup) {
    const first = rank([...known.keys()].map((id) => standings.get(id)!), true).slice(0, MAPPED).map((i) => [...known.values()][i]);
    const code = first.flatMap((x) => [...x.entries, ...x.reach]).filter((m) => !m.test && m.language === rt.language);
    const files = [...new Set(code.map((m) => m.path))].slice(0, 60);
    const near = first.flatMap((x) => [...x.entries, ...x.via, ...[...x.reach].sort((a, b) => b.complexity - a.complexity).slice(0, 10)]);
    const tests = [...new Set(near.flatMap((m) => testsCalling(p, m, 8)).map((t) => t.path))];
    void mapTests({ built: o.built, revision: p.revision, files, tests, cacheDir: join(store.root, 'testmap'), timeoutMs: Math.max(60_000, deadline - Date.now()), log })
      .then((map) => {
        if (!map) return;
        testMap = map;
        for (const x of known.values()) standings.set(x.id, standingOf(x));
        const gaps = first.map((x) => ({ x, gap: gapOf(map, [...x.entries, ...x.reach]) })).filter((y) => y.gap !== undefined).sort((a, b) => b.gap! - a.gap!);
        log(`  tests: least checked by the project's tests: ${gaps.slice(0, 5).map((y) => `${y.x.id} ${Math.round(y.gap! * 100)}% unchecked`).join(', ') || 'none of the measured surfaces'}`);
      }, (e) => log(`  tests: ${String((e as Error).message).split('\n')[0]}`));
  }

  // Surfaces a worker has now: their batch holds their promises and saves them.
  const busy = new Set<string>();
  const fixes = o.fixes ?? new Map<string, Map<string, string>>();
  const dig = o.dig ?? new Map<string, string[]>();
  const claimed = o.claimed ?? new Set<string>();
  // Every surface's failures are verified as its turn ends, beside the fuzzing (verify.ts: reproduce through the project's
  // callers, the contract, the judge): no worker waits for it, and what it says goes back to the surface's next turn. A
  // target whose failure was not the project's is rewritten with why; a verified bug is dug around.
  const onVerdict = (f: Finding, verdict: string, why: string, bug?: { title: string; cause: string }) => {
    if (!f.surface) return;
    if (verdict === 'bug' && bug) {
      const list = dig.get(f.surface) ?? [];
      const line = `${bug.title}: ${bug.cause}`;
      if (!list.includes(line)) list.push(line);
      dig.set(f.surface, list);
    } else if (verdict === 'not a bug' && why.startsWith('the test passes') && f.target) {
      const m = fixes.get(f.surface) ?? new Map<string, string>();
      m.set(f.target, `A FAILURE THIS TARGET REPORTED DID NOT HAPPEN WHEN A TEST CALLED THE PROJECT THE WAY ITS CALLERS DO: ${f.type}: ${f.message.split('\n')[0].slice(0, 300)}. ${f.kind === 'property' ? 'Its assertion states something the public API does not promise, or the target built the state it asserts about by hand: remove the assertion, or make it through the public API as a caller would.' : 'The target reached it through internal code or arguments the documentation rules out: call the project the way its callers and tests do, with the arguments they pass, and nothing built by hand.'}`);
      fixes.set(f.surface, m);
    }
  };
  const verifier = o.reports && o.built ? new Verifier({ p, rt, built: o.built, models: models.verify ?? models, reports: o.reports, log, defectAt: o.defectAt, until: deadline + o.searchMs, screen: models.verify ? models.judge : undefined, onVerdict }) : undefined;
  const verifying = new Set<Promise<void>>();
  // Writing stops short of the limit by what verifying needs: the candidates waiting, and as many again as a batch of
  // failures has brought on average, at what a decided candidate has cost (three of the dearest calls before one has).
  const arrivals = { n: 0, failures: 0 };
  const mine = () => (o.reports?.session.candidates ?? []).filter((c) => c.language === rt.language);
  const perCandidate = () => { const decided = mine().filter((c) => c.verdict !== 'not verified yet').length; return decided ? (o.budget?.spender.spentOn('fuzz-verify') ?? 0) / decided : 3 * (o.budget?.spender.dearest() ?? 0); };
  if (verifier) o.budget?.reserveFor(() => (mine().filter((c) => c.verdict === 'not verified yet').length + (arrivals.n ? arrivals.failures / arrivals.n : 0)) * perCandidate());
  const verify = (findings: Finding[]) => {
    const fresh = findings.filter((f) => f.reproduces !== false && f.kind !== 'nondeterministic');
    if (!verifier || !fresh.length) return;
    arrivals.n++; arrivals.failures += fresh.length;
    const job = verifier.verify(fresh).then(() => report(), (e) => log(`  verify: stopped: ${String((e as Error).message).split('\n')[0]}`));
    verifying.add(job);
    void job.finally(() => verifying.delete(job));
  };
  const promised = o.promised ?? new Map<string, Map<string, { broken?: string; dropped?: string }>>();
  const report = () => {
    if (!o.reports) return;
    const all = [...known.keys()].map((id) => standings.get(id)!);
    const ps = promisesNow();
    o.reports.language(rt.language, {
      coverage: { lines: coveredLines().size, total: projectTotal, new: coveredLines().size - before },
      surfaces: { total: known.size, fuzzed: turns.size, changed: all.filter((x) => x.changed).length, new: all.filter((x) => x.fresh).length, gaining: all.filter((x) => !x.changed && !x.fresh && !x.plateaued).length, plateaued: all.filter((x) => !x.changed && !x.fresh && x.plateaued).length },
      inputs: total.probed,
      targets: total.harnesses.loaded ?? 0,
      promises: { total: ps.length, checked: ps.filter((x) => x.broken || x.checkedBy?.length).length, broken: ps.filter((x) => x.broken).length, untestable: ps.filter((x) => x.untestable).length },
    });
  };
  /** Every known surface's stored promises, but those found not to be promises. */
  function promisesNow(): SurfacePromise[] { return [...known.values()].flatMap((x) => store.load(x, sourceHash(p, x)).promises ?? []).filter((x) => !x.dropped); }

  // The loop: a pool of fuzzing workers, two per core. Each takes the best surface no other worker has (schedule.ts rank,
  // the one fuzzed fewest times this session first) and runs its rounds for a slice. Every reproducible failure is kept with
  // its input, deduplicated and shrunk, and verified as the turn ends (verify below). The session ends at its time limit, when
  // its money is spent, when it is told to stop (a new commit to fuzz), or, with no limit, once every surface has had a
  // turn and plateaued.
  const slots = PARALLEL * 2;
  // Each worker's fuzz session saves its state on a signal: one listener each, more than Node's default of ten.
  process.setMaxListeners(Math.max(process.getMaxListeners(), slots * 2 + 10));
  let proposing: Promise<void> | undefined;
  let hostGone = '';
  // A new commit (o.stop) is taken up once a turn has finished on this one: a build is never thrown away unfuzzed.
  // Money spent means nothing more can be written, judged or proven: what fuzzing would still find waits for the next
  // session's money, so the session ends here rather than at the clock.
  const broke = () => !!o.budget && o.budget.spent() >= o.budget.limit;
  const stopping = () => Date.now() >= deadline || (!!o.stop?.() && turns.size > 0) || !!hostGone || broke();
  // Every turn parses files and walks their trees (syntax.ts freeTrees): what the turns walked is freed as the session
  // runs, on a timer, since the workers are all inside their turns most of the time.
  const freeing = setInterval(() => void freeTrees(), 15_000);
  const scoring = scoreSurfaces(stopping).catch((error) => log(`  worth: ${String((error as Error).message).split('\n')[0]}`));
  const nextSurface = async (): Promise<string | undefined> => {
    for (;;) {
      if (stopping()) return undefined;
      const ids = [...known.keys()].filter((id) => !busy.has(id));
      const queue = rank(ids.map((id) => standings.get(id)!), canWrite()).map((i) => ids[i]);
      queue.sort((a, b) => (turns.get(a) ?? 0) - (turns.get(b) ?? 0));
      // The writer proposes surfaces for code nothing covers once what changed and what was never fuzzed have had their turn.
      if (whole && !proposed && canWrite() && ![...known.keys()].some((id) => !turns.has(id) && ['changed', 'new'].includes(tierOf(standings.get(id)!)))) {
        proposed = true;
        proposing = (async () => {
          const covered = coveredLines();
          const ran = (m: Target) => { for (let l = m.line; l <= m.endLine; l++) if (covered.has(`${m.path}:${l}`)) return true; return false; };
          for (const x of await proposeSurfaces(p, rt, models.text, code.filter((m) => !ran(m)), [...known.values()], log)) {
            if (known.has(x.id)) continue;
            known.set(x.id, x);
            standings.set(x.id, standingOf(x));
            proposedBefore.push(x.entries.map((e) => e.id));
          }
          mkdirSync(store.root, { recursive: true });
          writeFileSync(proposedFile, JSON.stringify(proposedBefore, null, 2));
        })();
      }
      const all = [...known.keys()];
      const done = all.every((id) => turns.has(id) && standings.get(id)!.plateaued) && !fixes.size;
      // With no time limit, a session whose surfaces have all plateaued is done; with one, plateaued surfaces fuzz on.
      if (!Number.isFinite(deadline) && done && !busy.size && !proposing) return undefined;
      const id = queue.find((x) => Number.isFinite(deadline) || !(turns.has(x) && standings.get(x)!.plateaued) || fixes.has(x));
      if (id) { busy.add(id); return id; }
      // Nothing free to take: wait for a worker or the proposal to finish, then look again.
      if (!busy.size && !proposing) return undefined;
      await new Promise((r) => setTimeout(r, 1000));
      if (proposing) await Promise.race([proposing.then(() => { proposing = undefined; }), new Promise((r) => setTimeout(r, 1000))]);
    }
  };
  const worker = async () => {
    for (let id = await nextSurface(); id; id = await nextSurface()) {
      const surface = known.get(id)!;
      try {
        const left = Number.isFinite(deadline) ? deadline - Date.now() : Infinity;
        // A slice: the surface's next round at least, its share of the time left among the surfaces waiting for a first
        // turn, and ending early enough for verification to finish before the time is up.
        const waiting = [...known.keys()].filter((x) => !turns.has(x)).length;
        const round = store.load(surface, sourceHash(p, surface)).round?.budgetMs ?? o.iterationMs;
        const tail = 0;
        const slice = Number.isFinite(left) ? Math.max(0, Math.min(left - tail, Math.max(round, left / Math.max(1, Math.ceil(waiting / slots))))) : Infinity;
        batches++;
        log(`  fuzz: ${id} (${tierOf(standings.get(id)!)}), ${Number.isFinite(slice) ? `${Math.round(slice / 1000)}s` : 'until it plateaus'}`);
        const sofar = (r: FuzzResult) => o.onBatch?.({ ...total, targets: [...total.targets, ...r.targets], probed: total.probed + r.probed, coverage: lines.size, findings: [...total.findings, ...r.findings], harnesses: { written: total.harnesses.written + r.harnesses.written, working: total.harnesses.working + r.harnesses.working } });
        const own = new Map([[id, fixes.get(id) ?? new Map<string, string>()]]);
        fixes.delete(id);
        const r = await fuzzBatch([surface], p, rt, models, { ...o, searchMs: slice, deadline, onBatch: sofar, fixes: own, dig, promised, claimed, testMap: () => testMap }, log, lines, store);
        turns.set(id, (turns.get(id) ?? 0) + 1);
        standings.set(id, standingOf(surface));
        total.targets.push(...r.targets);
        total.execs += r.execs;
        total.probed += r.probed;
        total.junk! += r.junk ?? 0;
        total.harnesses.written += r.harnesses.written;
        total.harnesses.working += r.harnesses.working;
        total.harnesses.loaded = (total.harnesses.loaded ?? 0) + (r.harnesses.loaded ?? 0);
        total.findings.push(...r.findings);
        verify(r.findings);
        Object.assign(total.surfaces!, r.surfaces);
        total.unfuzzed = { ...total.unfuzzed, ...r.unfuzzed };
        total.weaknesses = { ...total.weaknesses, ...r.weaknesses };
        total.coverage = lines.size;
        if (r.firstInputSeconds !== undefined) total.firstInputSeconds = Math.min(total.firstInputSeconds ?? Infinity, r.firstInputSeconds);
        o.onBatch?.(total);
        report();
      } catch (error) {
        const msg = String((error as Error).message).split('\n')[0];
        log(`  fuzz: ${id} stopped: ${msg}`);
        turns.set(id, (turns.get(id) ?? 0) + 1);
        // The container host gone (Docker down, its socket missing): nothing more can run, and every pick would fail the
        // same way at the judge's expense. Any other failure waits before the next pick.
        if (/docker|\/var\/run\/.*\.sock|Cannot connect|unable to start|ECONNREFUSED/i.test(msg)) { hostGone = msg; }
        else await new Promise((r) => setTimeout(r, 15_000));
      } finally {
        busy.delete(id);
      }
    }
  };
  try { await Promise.all(Array.from({ length: slots }, worker)); } finally { clearInterval(freeing); }
  while (verifying.size) await Promise.allSettled([...verifying]);
  await scoring;
  if (hostGone) log(`  fuzz: stopped early: the container host failed (${hostGone.slice(0, 160)})`);
  // What was found is verified before the session ends: the slices left time for it.
  report();
  const fuzzed = new Map([...known].filter(([id]) => turns.has(id)));
  total.coverage = coveredLines().size;
  log(`  project: ${total.coverage} of ${projectTotal} lines of shipped ${rt.language} code covered (${total.coverage - before} new this session), ${fuzzed.size} of ${known.size} surfaces fuzzed in ${batches} turn${batches === 1 ? '' : 's'}`);
  {
    const ps = promisesNow();
    if (ps.length) log(`  promises: ${ps.filter((x) => x.broken || x.checkedBy?.length).length} of ${ps.length} checked by a target, ${ps.filter((x) => x.broken).length} broken by a verified bug, ${ps.filter((x) => x.untestable).length} untestable`);
  }
  // Every kept target of every surface, run or not this time, in the language's OSS-Fuzz project folder.
  const kept = [...new Map([...surfaces, ...fuzzed.values()].map((x) => [x.id, x])).values()].flatMap((x) => store.load(x, sourceHash(p, x)).targets.map((y) => ({ surface: x, name: y.name, source: y.source })));
  const exported = store.exportProject(rt, kept);
  if (exported.length) { total.ossFuzz = { folder: `${store.root}/oss-fuzz`, targets: exported }; log(`  oss-fuzz: ${exported.length} targets in ${store.root}/oss-fuzz`); }
  return total;
}

/** A target in the running portfolio. */
interface Live {
  name: string;
  source: string;
  session: FuzzSession;
  /** Its name in the session that built it: unique across the batch, since one session can hold several surfaces' targets. */
  id: string;
  /** Kept in the store already, or still on trial (a new target that has not yet reached anything the others did not). */
  kept: boolean;
  /** The surface's promises its assertions check, from its `refuzz-promises:` line. */
  promises: Set<string>;
  /** The kind of harness it is (HARNESS_KINDS), from its `refuzz-kind:` line. */
  kind?: string;
  /** The inner function it targets, a decomposition's part (its `refuzz-inner:` line); its inputs must reach that, not an entry. */
  inner?: Target;
  execs: number;
  measured: number;
  reachedInputs: number;
  setupErrors: number;
  /** Inputs that reached an entry point and failed one of its assertions, per assertion: one firing on most masks the rest. */
  failing: Map<string, { n: number; message: string }>;
  /** Surface lines its inputs ran this run. */
  lines: Set<string>;
  seen: Set<string>;
  findings: number;
  /** Recent setup errors and rejected inputs, for a fix. */
  errs: string[];
  rejected: string[];
  /** Inputs since it last reached a new surface line: a turn is given to the target most likely to find the next. */
  dry: number;
}

async function fuzzBatch(surfaces: Surface[], p: Project, rt: Runtime, models: { judge: DecisionModel; text: Writer }, o: FuzzOptions, log: (s: string) => void, allLines: Set<string>, store: SurfaceStore): Promise<FuzzRun> {
  const fz = rt.fuzz!;
  const subjects = surfaces.map((x) => x.entries[0]);
  const callMs = o.callMs;
  const started = o.started ?? Date.now();
  // The slice (searchMs) is fuzzing time: it starts at the batch's first input. Until then, writing and building the first
  // target are bounded only by the session's end (deadline), so a slice shorter than the writer's first answer still fuzzes.
  let until = o.deadline ?? Date.now() + o.searchMs;
  const examples = testExamples(p, subjects);
  const all = surfaces.map((_, t) => t);
  // The test data each surface's tests read (src/fixtures.ts): shown to the writer, and the small files seed the corpus.
  const fixtures = all.map((t) => fixturesOf(p, surfaces[t]));
  for (const t of all) if (fixtures[t].length) log(`  ${surfaces[t].id}: ${fixtures[t].length} test data files (${[...new Set(fixtures[t].map((f) => f.what))].slice(0, 4).join(', ')})`);
  // Each entry point's weakness classes are asked once per process, not once per batch: a surface comes back for many turns.
  const fresh = subjects.filter((x) => !exposed.has(`${rt.language}|${x.qualifiedName}`));
  if (o.weaknesses?.length && fresh.length) {
    const got = await exposure(fresh, rt, o.weaknesses, models.judge, (s) => sourceOf(p, s), (s) => describe(s, rt)).catch((e) => { if (e instanceof OutOfBudget) return new Map<string, Weakness[]>(); throw e; });
    for (const x of fresh) exposed.set(`${rt.language}|${x.qualifiedName}`, got.get(x.qualifiedName) ?? []);
  }
  const byName = new Map(subjects.map((x) => [x.qualifiedName, exposed.get(`${rt.language}|${x.qualifiedName}`) ?? []]));
  const hashes = surfaces.map((x) => sourceHash(p, x));
  const stored = surfaces.map((x, t) => store.load(x, hashes[t]));
  log(`  store: ${stored.reduce((n, x) => n + x.targets.length, 0)} targets on ${stored.filter((x) => x.targets.length).length} of ${all.length} surfaces from earlier runs, ${stored.reduce((n, x) => n + x.corpus.length, 0)} stored inputs, ${stored.reduce((n, x) => n + x.covered.size, 0)} lines covered before`);

  /** Each surface's improvement loop, carried over from the last session while its code is unchanged. */
  const rounds = stored.map((x): Round => x.round ?? { budgetMs: o.iterationMs, flat: 0, iterations: 0, plateaued: false });
  /**
   * Each surface's promises, carried over like its rounds; undefined until listed for this code. Verification's verdicts on
   * them (o.promised) are applied whenever they are read.
   */
  const promises = stored.map((x) => x.promises);
  const promisesOf = (t: number): SurfacePromise[] => {
    for (const [id, n] of o.promised?.get(surfaces[t].id) ?? []) {
      const x = promises[t]?.find((y) => y.id === id);
      if (x && n.broken && !x.broken) x.broken = n.broken;
      if (x && n.dropped && !x.dropped) x.dropped = n.dropped;
    }
    return promises[t] ?? [];
  };
  /** Promises still standing: neither found untestable nor found not to be promises. */
  const standing = (t: number) => promisesOf(t).filter((x) => !x.untestable && !x.dropped);
  /** Those no kept target's assertions check, and no verified bug has broken. */
  const unchecked = (t: number) => standing(t).filter((x) => !x.broken && ![...portfolio[t].values()].some((y) => y.kept && y.promises.has(x.id)));
  const batchStart = Date.now();
  const sessions: FuzzSession[] = [];
  let written = 0, execs = 0, junk = 0, gen = 0;
  let firstInput: number | undefined;
  let fuzzing = false;
  const noteFirst = () => {
    if (!fuzzing) { fuzzing = true; until = Math.min(o.deadline ?? Infinity, Date.now() + o.searchMs); }
    if (firstInput === undefined) { firstInput = (Date.now() - started) / 1000; log(`  first fuzz input: ${firstInput.toFixed(0)}s from the start of the run`); }
  };
  const flag = oracle(p, rt, callMs);
  const raw: Finding[] = [];
  /** Each failure's surface, input and target. */
  const behind = new Map<Finding, { t: number; input: Buffer; live: Live }>();
  const causeOf = (f: Finding) => `${f.kind}|${f.type}|${f.where}|${f.kind === 'crash' ? '' : f.function}`;
  const blocked = new Map<number, string>();
  /** A surface blocked by its environment; a driver that does not build blocks every surface, since all share it. */
  const block = (t: number, env: string) => { for (const u of / driver \(/.test(env) ? all : [t]) blocked.set(u, env); };
  // A surface whose code the build does not compile (PHP built --disable-all has no phar) is not faked by its targets.
  for (const t of all) if (rt.compiled && !surfaces[t].entries.some((e) => rt.compiled!(e))) {
    block(t, `${surfaces[t].entries[0].path} is not compiled into the build: build.sh must build it (enable it in the project's configure options)`);
    log(`  ${surfaces[t].id}: blocked: ${surfaces[t].entries[0].path} is not compiled into the build`);
  }

  /**
   * One writer call writes one target, or makes one improvement move. `background`: other targets of the surface keep fuzzing while this one is written (a new target aimed at what they miss,
   * a fix of one of several), so it goes at the writer's slower, cheaper tier. A surface's first target and the fix of its
   * only one are waited on, and go at the standard tier.
   */
  /**
   * The import line for each of the project's types and top-level functions named in a request, from the file it is declared
   * in, written by the runner's own importFor: the writer copies them instead of guessing a module.
   */
  let types: Map<string, string[]> | undefined;
  const declaredIn = (t: number, text: string): string => {
    types ??= typesDeclaredAt(p, rt.language);
    const words = new Set(text.match(/[A-Za-z_]\w*/g) ?? []);
    const at = new Map<string, Set<string>>();
    const add = (name: string, path: string) => (at.get(name) ?? at.set(name, new Set()).get(name)!).add(path);
    for (const [name, paths] of types) if (words.has(name)) for (const x of paths) add(name, x);
    for (const m of p.targets) if (m.language === rt.language && !m.test && !m.qualifiedName.includes('.') && words.has(m.name)) add(m.name, m.path);
    if (!at.size) return '';
    const line = (name: string, path: string) => rt.importFor({ ...subjects[t], path, name, qualifiedName: name });
    return `HOW TO IMPORT THE PROJECT'S NAMES USED ABOVE, each from the file it is declared in. Use these lines; a module not listed here may not exist:\n${[...new Set([...at].flatMap(([name, paths]) => [...paths].map((x) => line(name, x))))].join('\n')}`;
  };
  const shown = (x: Target) => (rt.isPublic(x, p.read(x.path)) ? describe(x, rt) : `(not importable: ${x.qualifiedName} in ${x.path})\n    ${x.header}${x.doc ? `\n    // ${x.doc}` : ''}`);
  /**
   * The kinds of harness for this surface, as the judge scored them (store.ts SurfaceWorth.kinds), and which to write now:
   * the highest-scored kind no kept target is yet. A kind the judge gives under an eighth of the chance is not written.
   */
  // A request handler, with the project's service running: the live API harness comes first, whatever the judge scored.
  const isHandler = (x: Surface) => x.sources.some((y) => y.kind === 'request') || x.entries.some((e) => /handler|handle[A-Z_]|serve|endpoint|controller|route|middleware|intercept/i.test(e.qualifiedName) && !/provider|client|fetch|get[A-Z]\w*data/i.test(e.qualifiedName));
  /** The project's tests that measurably ran a surface's entry points (src/testmap.ts), most of them first: at most three. */
  const measuredTests = (t: number): Target[] => {
    const map = o.testMap?.();
    if (!map) return [];
    const found = new Map<string, Target>();
    for (const e of surfaces[t].entries) for (const x of testsRunning(map, e)) {
      const test = p.at(x.path, x.line);
      if (test?.test) found.set(test.id, test);
    }
    return [...found.values()].slice(0, 3);
  };
  const kindsPart = (t: number, others: Live[]): string => {
    const surface = surfaces[t];
    const scores = { ...(store.load(surface, sourceHash(p, surface)).worth?.kinds ?? {}) };
    const fromTest = measuredTests(t).length > 0;
    if (!Object.keys(scores).length && !o.built?.service && !fromTest) return '';
    if (o.built?.service && isHandler(surface)) scores.api = 1; else scores.api = 0;
    // A test that runs the surface is the first thing to fuzz: its calls are the project's own.
    scores.fromtest = fromTest ? 1 : 0;
    const have = new Set(others.filter((x) => x.kept && x.kind).map((x) => x.kind!));
    const ranked = HARNESS_KINDS.map((k) => ({ ...k, score: scores[k.id] ?? 0 })).sort((a, b) => b.score - a.score);
    const next = ranked.find((k) => k.score >= 1 / 8 && !have.has(k.id));
    const lines = ranked.map((k) => `${k.id} (${k.name}, ${Math.round(k.score * 100)}%${have.has(k.id) ? ', a kept target is one' : ''}): ${k.does}`);
    return `KINDS OF HARNESS, scored by a judge for this surface by how likely each is to expose a defect a maintainer fixes:\n${lines.join('\n')}\n\n${next ? `THE KIND TO WRITE NOW: ${next.id}. The target is a ${next.name} harness: it ${next.does}. It still reaches the entry points with nearly every input and keeps the other rules above.` : 'Every kind worth writing has a kept target: write the kind whose assertions the code reached least.'} A kind under 12% is not worth a target here.`;
  };
  const write = async (t: number, ask: Ask, others: Live[], background = false): Promise<Written | string> => {
    if (Date.now() >= until) return 'the search time is up';
    const s = subjects[t], surface = surfaces[t];
    // A test measured running the surface is its example; failing that, the shortest test whose code names the entry point.
    const ran = measuredTests(t);
    const ex = ran.length ? sourceOf(p, ran[0]) : examples.get(s.id);
    const test = ran[0] ?? (ex ? testsCalling(p, s, 1)[0] : undefined);
    const own = test ? rt.importsOfTest?.(test) ?? [] : [];
    const imports = own.length ? own : ex ? importsFor(ex, p, rt, s) : [];
    const seenTests = new Set(test ? [test.id] : []);
    const more = [...surface.entries.slice(1), ...surface.via].flatMap((x) => testsCalling(p, x, 1)).filter((x) => !seenTests.has(x.id) && !!seenTests.add(x.id)).map((x) => sourceOf(p, x));
    const rest = surface.entries.slice(1);
    const ws = byName.get(s.qualifiedName) ?? [];
    const promised = standing(t);
    const stable = [TARGETS, `HOW A FUZZ TARGET IS WRITTEN IN THIS PROJECT (${rt.language}):\n${fz.guide}`].join('\n\n');
    const fields: Record<string, string> = {
      plan: 'The use cases this target drives, read from the project\'s tests, documentation and callers: what each passes and how it is set up. How the target turns the bytes into those arguments so nearly every input reaches an entry point, and what it builds itself (framing, checksums, lengths, signatures) with a fuzzed choice to corrupt it. Which assertions it makes after the call.',
      target: `The complete fuzz target file, in ${rt.language}, as HOW A FUZZ TARGET IS WRITTEN IN THIS PROJECT says.`,
      promises: 'The ids of the promises listed above that this target\'s assertions check, space-separated, or none.',
      kind: 'The id of the kind of harness this target is, from KINDS OF HARNESS above: one word.',
      dictionary: 'A JSON array of strings: the tokens, keywords, field names, magic values and delimiters the code under test compares its input against, as they appear in the raw bytes. No comments.',
      seeds: 'A JSON array of up to 5 strings, each a whole input exactly as the target receives its bytes (as text), that reaches the target\'s main use cases; [] when the target splits its bytes into several arguments.',
    };
    // A decomposition, as Theorem's fractional proofs make one: the surface's promises broken into properties of the functions
    // it hands its input to, each fuzzed on that function directly with what its callers guarantee, where an input space far
    // smaller than the entry point's reaches rare states quickly. A part's failure counts only once an input to the surface's own
    // target reproduces it (lift, below).
    if (ask.kind === 'decompose') {
      for (const k of Object.keys(fields)) delete fields[k];
      Object.assign(fields, {
        composition: 'How this surface\'s promises are decided by the functions it hands its input to: for each, which functions decide it and why their properties together imply it. Then the parts no listed function covers.',
        parts: `A JSON array with one part for each function listed under FUNCTIONS TO WRITE A PART FOR: {"function": its qualified name, exactly as shown there; "promise": the property of that function the composition needs; "precondition": what every caller in the project guarantees about its arguments, read from the call sites shown; "target": the complete fuzz target file, in ${rt.language}, as HOW A FUZZ TARGET IS WRITTEN IN THIS PROJECT says, calling that function directly, building from the bytes only arguments that meet the precondition, and asserting the property}.`,
        dictionary: 'A JSON array of strings the parts\' functions compare their input against (tokens, keywords, magic values, delimiters), as they appear in the raw bytes.',
      });
    }
    // After an iteration the writer chooses one move, and only a new target carries code.
    if (ask.kind === 'improve') {
      for (const k of Object.keys(fields)) delete fields[k];
      Object.assign(fields, {
        plan: 'For the branches listed below: which an existing target can take with other inputs, which need another way in (another entry point, an object built another way), and which are cold (error paths only a failing environment takes, debug or platform code, code behind settings callers never use).',
        action: 'One word: seeds, target, skip or untestable. seeds when inputs to an existing target would take branches no input took; target when no existing target can get there, or to check promises no target checks; skip when the branches left are cold; untestable when the only thing left is promises no fuzz target can check.',
        for_target: 'For seeds: the name of the target the inputs are for, exactly as listed. Otherwise none.',
        seeds: 'For seeds: a JSON array of up to 8 strings, each a whole input exactly as that target receives its bytes: text as it is, or "hex:" and the bytes in hex for binary input, each aimed at one listed branch. Otherwise [].',
        target: `For target: the complete new fuzz target file, in ${rt.language}, as HOW A FUZZ TARGET IS WRITTEN IN THIS PROJECT says. Otherwise none.`,
        promises: 'For target: the ids of the promises listed above that its assertions check, space-separated. Otherwise none.',
        kind: 'For target: the id of the kind of harness it is, from KINDS OF HARNESS above: one word. Otherwise none.',
        untestable: 'A JSON array of {"id": …, "why": …}: promises listed as checked by no target that no fuzz target can check (what they promise cannot be seen from the call\'s result or errors, or needs what a target must not use), each with why. [] when every one can be checked.',
        dictionary: 'A JSON array of strings the code at the listed branches compares its input against (tokens, keywords, magic values, delimiters), as they appear in the raw bytes.',
        skip: 'For skip: a JSON array of the cold branches, each "path:line" as listed. Otherwise [].',
      });
    }
    // A request too long for the model is sent again with its longest part halved: the called code by whole methods, any
    // other part by lines.
    const cuts = new Map<number, number>();
    for (let budget = Infinity; ; ) {
      const calls = ask.kind === 'decompose' ? partsCode(p, surface, ask.fns, budget) : reached(p, surface, budget);
      const parts = [
        `TARGET: ${s.qualifiedName} in ${s.path}`, shown(s), `SOURCE:\n${sourceOf(p, s)}`, constantsOf(p, s), calls,
        ran.length ? `TESTS THAT RUN THIS SURFACE (measured: running each ran the entry point):\n${ran.map((x) => `# ${x.qualifiedName} (${x.path})\n${sourceOf(p, x)}`).join('\n\n')}` : ex ? `A TEST OF THIS PROJECT THAT CALLS IT:\n${ex}` : '',
        more.length ? `TESTS OF THIS PROJECT THAT CALL THE SURFACE'S OTHER WAYS IN:\n${more.join('\n\n')}` : '',
        constructionOf(p, s), builtAtIn(p, s), errorTypes(p, s.language, s.path),
        o.built ? describeFixtures(fixtures[t], o.built.src) : '',
        imports.length ? `HOW TO IMPORT THE PROJECT'S NAMES THAT TEST USES:\n${imports.join('\n')}` : '',
        rest.length ? `THIS SURFACE'S OTHER ENTRY POINTS, which its targets also reach:\n${rest.map((m) => `${shown(m)}\n${sourceOf(p, m)}`).join('\n\n')}` : '',
        describeSources(surface, (x) => rt.importFor(x), (x) => rt.isPublic(x, p.read(x.path))),
        o.built?.service ? `THE PROJECT'S OWN SERVICE IS DEPLOYED IN THIS CONTAINER at ${o.built.service.url}, with its database and settings; the settings and credentials are in /src/refuzz-run.env (read it at the target's start): ${Object.keys(o.built.service.env).join(', ')}. A target that drives the API starts the project's HTTP server inside the target, the way the project's API tests construct it, against that same database and configuration, and sends it requests: coverage is measured in the target's process, so a request to a server in another process reaches nothing.` : '',
        ws.length ? `WEAKNESS CLASSES THIS CODE IS EXPOSED TO (inputs and assertions should test each):\n${ws.map((w) => `${w.id} ${w.name}: ${w.invariant}${w.attacks?.length ? ` Inputs that attack it: ${w.attacks.join('; ')}` : ''}`).join('\n')}` : '',
        promised.length ? `PROMISES THIS SURFACE'S ENTRY POINTS MAKE (assert those the target can, on the inputs where each applies, and name the ids it checks):\n${promised.map((x) => `${x.id}: ${x.statement} (${x.source})`).join('\n')}` : '',
        ask.kind === 'fix' || ask.kind === 'decompose' ? '' : kindsPart(t, others),
        ask.kind === 'decompose' ? `DECOMPOSE THIS SURFACE. Its targets call the entry point, where the input space is vast and the deep states rare. Each function listed under FUNCTIONS TO WRITE A PART FOR is one the entry point hands its input to: state the property of it that the surface's promises rest on, and write one target for it that calls the function directly. A part's target gives the function exactly what its callers can, no less and no tidier: read every call site shown and build arguments as they do there, with everything they pass (the rest of the buffer after the field it decodes, a slice longer than the length it declares, every value an earlier step can leave), or its failures are not the project's, and a tidier input hides the bugs the callers' inputs reach. Sizes, counts, lengths and repetitions come from a few bytes and reach their type's limits and past them (a row of 70,000 cells for a 16-bit count): the target builds the large input itself, since the fuzzer's inputs stay small. A function its file hides from others (static in C or C++, private or internal elsewhere) is still a part: its target reaches it the way that language lets a test in (C and C++: #include the function's own source file in the target, so the static function is defined in it; elsewhere, the test-only access the project's own tests use).${others.some((x) => !x.inner) ? `\nTHE SURFACE'S OWN TARGETS, WHICH CALL THE ENTRY POINT:\n${others.filter((x) => !x.inner).map((x) => `--- ${x.name}\n${x.source}`).join('\n')}` : ''}` : '',
        ask.kind === 'improve' ? `THIS SURFACE'S FUZZ TARGETS, WHICH KEEP RUNNING. After the last iteration, choose the one move that gets inputs into the code listed below.\n${others.map((x) => `--- ${x.name}\n${x.source}`).join('\n')}\n\n${ask.note}` : '',
        ask.kind === 'fix' ? `THIS FUZZ TARGET HAS AN ERROR. Rewrite it so the error is gone, changing what the error names and keeping the rest (its use cases and its sound assertions).${ask.again > 1 ? ` This is the same error ${ask.again} times in a row: the code it names is still there. Change that code.` : ''}\n--- the target\n${ask.source}\n--- the error\n${ask.error}` : '',
        ask.kind === 'fix' ? apiHint(p, ask.error, ask.source, s.language, (x) => rt.isPublic(x, p.read(x.path)), (x) => rt.importFor(x)) : '',
        ask.kind === 'fix' && ask.inner ? (() => { const m = surface.reach.find((y) => y.qualifiedName === ask.inner); return m ? `THIS TARGET IS A PART OF THE SURFACE'S DECOMPOSITION: it calls ${m.qualifiedName} directly, with only arguments its callers can give, and its inputs must reach that function (not the entry point).\n${shown(m)}\n${sourceOf(p, m)}\n${rt.importFor(m)}` : ''; })() : '',
      ];
      parts.push(declaredIn(t, parts.join('\n')));
      const sized = parts.map((x, i) => (cuts.has(i) ? fit(x, cuts.get(i)!) : x));
      const prompt = sized.filter(Boolean).join('\n\n');
      try {
        written++;
        const a = await models.text.generate(prompt, fields, `fuzz-${ask.kind}`, `refuzz-${rt.language}`, stable, background);
        const json = (x: string | undefined): unknown[] => { try { const v = JSON.parse((x ?? '[]').replace(/^```\w*\n|\n```\s*$/g, '')); return Array.isArray(v) ? v : []; } catch { return []; } };
        const strings = (x: string | undefined) => json(x).filter((y): y is string => typeof y === 'string');
        if (ask.kind === 'decompose') {
          // A part is for a function it was asked for: another the writer names instead is one the crawl gave elsewhere.
          const inner = new Set(ask.fns.map((m) => m.qualifiedName));
          const parts = json(a.parts).flatMap((y): Written[] => {
            const z = y as { function?: unknown; promise?: unknown; precondition?: unknown; target?: unknown };
            const fn = typeof z?.function === 'string' ? z.function.trim() : '';
            const source = typeof z?.target === 'string' ? withoutProse(z.target).trim() : '';
            if (!inner.has(fn) || !source || /\s/.test(fn)) return [];
            return [{ source, action: 'target', inner: fn, promises: [], dictionary: [], seeds: [], composition: `${fn}: ${String(z.promise ?? '').trim()} Given: ${String(z.precondition ?? '').trim()}` }];
          });
          return { source: '', action: 'parts', parts, composition: (a.composition ?? '').trim(), promises: [], dictionary: strings(a.dictionary), seeds: [] };
        }
        const action = ask.kind === 'improve' ? (/\b(seeds|target|skip|untestable)\b/i.exec(a.action ?? '')?.[1].toLowerCase() as Written['action']) : 'target';
        if (!action) return 'the writer chose no move';
        const source = action === 'target' ? withoutProse(a.target ?? '').trim() : '';
        if (action === 'target' && !source) return 'the writer returned no target';
        const pids = new Set(promised.map((y) => y.id));
        const kindId = [...(a.kind ?? '').trim().toLowerCase().split(/[\s,]+/), ...tagsOf(source, KIND_TAG)].find((x) => HARNESS_KINDS.some((k) => k.id === x));
        return {
          source, action, kind: kindId,
          // The ids named in the field and on the target's own `refuzz-promises:` line, when it wrote one.
          promises: [...new Set([...(a.promises ?? '').split(/[\s,]+/), ...tagsOf(source, PROMISES_TAG)])].filter((x) => pids.has(x)),
          untestable: json(a.untestable).flatMap((y) => { const z = y as { id?: unknown; why?: unknown }; return typeof z?.id === 'string' && pids.has(z.id) && typeof z.why === 'string' && z.why.trim() ? [{ id: z.id, why: z.why.trim() }] : []; }),
          dictionary: strings(a.dictionary),
          seeds: strings(a.seeds).map((x) => (/^hex:/i.test(x) ? Buffer.from(x.slice(4).replace(/[^0-9a-f]/gi, ''), 'hex') : Buffer.from(x, 'utf8'))),
          forTarget: (a.for_target ?? '').trim().split(/\s+/)[0],
          skip: strings(a.skip),
        };
      } catch (error) {
        if (tooLong(error)) {
          const i = sized.reduce((m, x, j) => (x.length > sized[m].length ? j : m), 0);
          if (!sized[i]) return 'the writer failed: the request does not fit the model';
          if (i === 4) budget = Math.floor(calls.length / 2); else cuts.set(i, Math.floor(sized[i].length / 2));
          continue;
        }
        return `the writer failed: ${String((error as Error).message).split('\n')[0]}`;
      }
    }
  };

  /**
   * The promises a surface's entry points make, listed by one writer call on its first turn and again when its code changes:
   * from their headers, doc comments and source, the sources feeding them, and the invariants of the weakness classes the judge
   * found them exposed to. A class the writer leaves out is listed as the catalog states its invariant. A call that fails
   * lists nothing, and the next turn asks again.
   */
  const listPromises = async (t: number) => {
    if (promises[t] || Date.now() >= until) return;
    const surface = surfaces[t];
    const ws = [...new Map(surface.entries.flatMap((e) => byName.get(e.qualifiedName) ?? []).map((w) => [w.id, w])).values()];
    const fields = {
      plan: 'For each entry point, what its documentation, signature and code promise a caller: the error it raises or returns for malformed, truncated, missing or out-of-range input; what it returns; round trips (decoding what it encoded, parsing what it printed); two documented ways of computing the same thing that must agree; bounds (output size against input size, declared lengths and counts respected). Then what each weakness class listed requires of these functions.',
      promises: 'A JSON array, one element per promise: {"id": a short id, lowercase words joined by hyphens, naming the function and what it promises; "statement": one sentence a fuzz target can assert after the call, naming the function, the inputs it is about and the outcome promised; "source": where it comes from: "doc comment of <function>", "signature of <function>", "code of <function>", or the weakness class id}. For each weakness class listed, one promise whose id is the class id in lowercase ("cwe-20"), stating its invariant for these functions. Only what the documentation, signature, code or a listed class promises; [] when nothing.',
    };
    const cuts = new Map<number, number>();
    for (;;) {
      const parts = [
        `ENTRY POINTS, AND THE SOURCE OF EACH:\n${surface.entries.map((e) => `${shown(e)}${e.doc ? `\n    // ${e.doc}` : ''}\n${sourceOf(p, e)}`).join('\n\n')}`,
        describeSources(surface, (x) => rt.importFor(x), (x) => rt.isPublic(x, p.read(x.path))),
        ws.length ? `WEAKNESS CLASSES THESE FUNCTIONS ARE EXPOSED TO, AND THE INVARIANT EACH KEEPS:\n${ws.map((w) => `${w.id} ${w.name}: ${w.invariant}`).join('\n')}` : '',
        errorTypes(p, subjects[t].language, subjects[t].path),
      ];
      const sized = parts.map((x, i) => (cuts.has(i) ? fit(x, cuts.get(i)!) : x));
      try {
        const a = await models.text.generate(sized.filter(Boolean).join('\n\n'), fields, 'fuzz-promises', `refuzz-${rt.language}`, undefined, portfolio[t].size > 0);
        let raw: unknown;
        try { raw = JSON.parse((a.promises ?? '[]').replace(/^```\w*\n|\n```\s*$/g, '')); } catch { raw = []; }
        const out = new Map<string, SurfacePromise>();
        for (const x of Array.isArray(raw) ? raw : []) {
          const y = x as { id?: unknown; statement?: unknown; source?: unknown };
          const id = typeof y?.id === 'string' ? y.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) : '';
          if (id && typeof y.statement === 'string' && y.statement.trim() && !out.has(id)) out.set(id, { id, statement: y.statement.trim(), source: typeof y.source === 'string' && y.source.trim() ? y.source.trim() : 'code' });
        }
        for (const w of ws) { const id = w.id.toLowerCase().replace(/[^a-z0-9]+/g, '-'); if (!out.has(id)) out.set(id, { id, statement: w.invariant, source: `weakness class ${w.id}` }); }
        if (promises[t]) return;
        promises[t] = [...out.values()];
        // A surface whose coverage had plateaued is not done while a promise is unchecked.
        if (unchecked(t).length) rounds[t] = { ...rounds[t], plateaued: false };
        log(`  ${surface.id}: ${promises[t].length} promises listed (${ws.length} from weakness classes): ${promises[t].map((x) => x.id).join(', ')}`);
        return;
      } catch (error) {
        if (tooLong(error)) {
          const i = sized.reduce((m, x, j) => (x.length > sized[m].length ? j : m), 0);
          if (!sized[i]) return;
          cuts.set(i, Math.floor(sized[i].length / 2));
          continue;
        }
        log(`  ${surface.id}: listing its promises failed, asked again next turn: ${String((error as Error).message).split('\n')[0]}`);
        return;
      }
    }
  };

  const envOf = (error: string) => environmentalLoad(error, p.dir, rt);

  /** The inner function a part's target names on its `refuzz-inner:` line: one the surface hands its input to. */
  const innerOf = (t: number, source: string): Target | undefined => {
    const name = [...tagsOf(source, INNER_TAG)][0];
    return name ? surfaces[t].reach.find((m) => m.qualifiedName === name) : undefined;
  };

  /** Builds targets of one or more surfaces in one session; returns each one's Live, or its error. */
  const build = async (items: { t: number; name: string; source: string; kept: boolean }[]): Promise<(Live | string)[]> => {
    if (!items.length) return [];
    // A target that names nothing of the project fuzzes nothing: sent back to its writer unbuilt, as a build error is.
    const empty = items.map((x) => (namesProject(x.source, [...surfaces[x.t].entries, ...surfaces[x.t].reach, ...surfaces[x.t].via], rt.isImport) ? undefined
      : `the target calls nothing in the project: it names none of the surface's functions or types (${[...surfaces[x.t].entries, ...surfaces[x.t].via].map((e) => e.name).slice(0, 4).join(', ')}) outside comments and strings. Call the function it is for, through what the project's own callers or tests use; a target that only reads its input fuzzes nothing`));
    if (empty.some(Boolean)) {
      const rest = await build(items.filter((_, i) => !empty[i]));
      return empty.map((e) => e ?? rest.shift()!);
    }
    const named = items.map((x) => ({ ...x, id: `s${x.t}_${x.name}_${++gen}` }));
    const { session, errors } = await buildSlot(rt.language, () => fz.session(Object.fromEntries(named.map((x) => [x.id, x.source])), subjects));
    sessions.push(session);
    return named.map((x) => {
      if (errors[x.id]) { session.release?.(x.id); return errors[x.id]; }
      return { name: x.name, source: x.source, session, id: x.id, kept: x.kept, promises: tagsOf(x.source, PROMISES_TAG), kind: [...tagsOf(x.source, KIND_TAG)][0], inner: innerOf(x.t, x.source), execs: 0, measured: 0, reachedInputs: 0, setupErrors: 0, failing: new Map(), lines: new Set(), seen: new Set(), findings: 0, errs: [], rejected: [], dry: 0 };
    });
  };

  // Every stored target, every surface, in one build: a target that no longer builds is fixed from its error in the search.
  const buildStart = Date.now();
  const firstBuild = await build(all.flatMap((t) => stored[t].targets.map((x) => ({ t, name: x.name, source: x.source, kept: true }))));
  const portfolio = all.map(() => new Map<string, Live>());
  const broken = all.map(() => [] as { name: string; source: string; error: string }[]);
  let k = 0;
  for (const t of all) for (const x of stored[t].targets) {
    const r = firstBuild[k++];
    if (typeof r === 'string') {
      const env = envOf(r);
      if (env) block(t, env);
      broken[t].push({ name: x.name, source: x.source, error: r });
    } else portfolio[t].set(x.name, r);
  }
  if (firstBuild.length) log(`  build: ${firstBuild.filter((x) => typeof x !== 'string').length} of ${firstBuild.length} stored targets built in ${Math.round((Date.now() - buildStart) / 1000)}s${blocked.size ? `; ${blocked.size} surfaces blocked by the environment (${[...new Set(blocked.values())].join('; ')})` : ''}`);

  const runAt = new Date().toISOString();
  const pruned = all.map(() => [] as string[]);
  type State = { covered: Set<string>; coveredNow: Set<string>; entriesHit: Set<string>; execs: number; defects: number };
  /** Branches the writer judged cold, per surface, kept between runs: no move is aimed at them again. */
  const skipped = all.map((t) => new Set(stored[t].skipped));
  const states = all.map((t): State => ({ covered: new Set(stored[t].covered), coveredNow: new Set(), entriesHit: new Set(), execs: 0, defects: 0 }));
  const contribution = (t: number): Record<string, Contribution> => {
    const out: Record<string, Contribution> = { ...stored[t].contribution };
    const live = [...portfolio[t].values()].filter((x) => x.kept);
    for (const x of live) {
      const unique = [...x.lines].filter((l) => !live.some((y) => y !== x && y.lines.has(l))).length;
      out[x.name] = x.execs ? { lines: x.lines.size, unique, execs: x.execs, findings: x.findings } : out[x.name] ?? { lines: 0, unique: 0, execs: 0, findings: 0 };
    }
    for (const name of pruned[t]) delete out[name];
    return out;
  };
  const save = (t: number) => {
    const x = states[t], total = surfaceLines(surfaces[t]).total;
    const kept = [...portfolio[t].values()].filter((y) => y.kept);
    for (const y of promisesOf(t)) y.checkedBy = kept.filter((z) => z.promises.has(y.id)).map((z) => z.name);
    store.saveState(surfaces[t], { hash: hashes[t], covered: x.covered, total, contribution: contribution(t), skipped: skipped[t], promises: promises[t], round: rounds[t], runs: [...stored[t].runs, { at: runAt, execs: x.execs, covered: x.coveredNow.size, total, entriesReached: [...x.entriesHit], targets: [...portfolio[t].values()].filter((y) => y.kept).length, defects: x.defects, ms: Date.now() - batchStart, gained: x.covered.size - stored[t].covered.size }] });
  };
  // Coverage is saved every ten seconds and when the process is told to stop, as AFL++ rewrites its stats.
  const flush = () => { for (const t of all) save(t); };
  const timer = setInterval(flush, 10_000);
  const stop = (signal: NodeJS.Signals) => { flush(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const causes = new Set<string>();

  const checkpoint = (phase: string) => {
    o.onBatch?.({ language: rt.language, targets: surfaces.map((s) => s.id), probed: execs, coverage: allLines.size, harnesses: { written, working: states.filter((x) => x.entriesHit.size).length }, findings: dedupe(raw), firstInputSeconds: firstInput });
    log(`  saved after ${phase}`);
  };

  /**
   * A target in error is rewritten, and only it: the same name, the same file, the error fixed. Fixing runs beside the
   * search, and the target is out of the rotation until its fix builds. Rewriting goes on while it makes progress: when two
   * rewrites in a row end in the error they were given, or the surface has stopped, the target is given up for this run.
   */
  const pendingFixes = new Set<Promise<void>>();
  /** Surfaces whose search has ended: nothing more is written for them. */
  const done = all.map(() => false);
  const fixing = new Set<string>();
  const fixState = new Map<string, { tries: number; lastError: string; again: number; seen?: Set<string> }>();
  const fix = (t: number, x: { name: string; source: string; kept: boolean }, error: string) => {
    const key = `${t}#${x.name}`;
    if (fixing.has(key)) return;
    const running = portfolio[t].get(x.name);
    if (running) { portfolio[t].delete(x.name); running.session.release?.(running.id); }
    const was = fixState.get(key) ?? { tries: 0, lastError: '', again: 0, seen: new Set<string>() };
    const cls = errorClass(error);
    // No progress is an error this target has had before, in a row or not: rewrites that cycle among a few errors (PHP's
    // phar targets went round three for 160 rewrites) are stuck as surely as one that repeats.
    const seen = new Set(was.seen ?? []);
    const state = { tries: was.tries + 1, lastError: cls, again: seen.has(cls) ? was.again + 1 : 1, seen: seen.add(cls) };
    fixState.set(key, state);
    if (state.again > 2 || done[t] || Date.now() >= until) {
      // A target that worked in an earlier run stays stored: what broke it may be this run's environment, not the target, and
      // the next run tries it again. Only a target that never worked is given up on.
      if (x.kept) log(`  ${surfaces[t].id}: ${x.name} could not be fixed this run; kept, and tried again next run (${error.split('\n')[0].slice(0, 160)})`);
      else log(`  ${surfaces[t].id}: ${x.name} dropped (${error.split('\n')[0].slice(0, 160)})`);
      return;
    }
    fixing.add(key);
    log(`  ${surfaces[t].id}: ${x.name} has an error, rewriting it (${error.split('\n')[0].slice(0, 160)})`);
    const job = (async () => {
      const w = await write(t, { kind: 'fix', source: x.source, error, again: state.again, inner: [...tagsOf(x.source, INNER_TAG)][0] }, [], portfolio[t].size > 0);
      if (typeof w === 'string') { log(`  ${surfaces[t].id}: ${x.name}: ${w}`); return; }
      if (done[t] || Date.now() >= until) return;
      // A rewrite keeps the promises the target checked when the writer names none.
      const source = tagged(rt.language, w.source, w.promises.length ? w.promises : [...tagsOf(x.source, PROMISES_TAG)], w.kind ?? [...tagsOf(x.source, KIND_TAG)][0], [...tagsOf(x.source, INNER_TAG)][0]);
      const [r] = await build([{ t, name: x.name, source, kept: x.kept }]);
      fixing.delete(key);
      if (typeof r === 'string') {
        store.reject(surfaces[t], `${x.name}.fix${state.tries}`, source, r);
        const env = envOf(r);
        if (env) { block(t, env); log(`  ${surfaces[t].id}: blocked by the environment: ${env}`); return; }
        fix(t, { name: x.name, source, kept: x.kept }, r);
        return;
      }
      addSeeds(t, w);
      portfolio[t].set(x.name, r);
      fixedNames[t].add(x.name);
      // A fixed stored target is written back at once; a new one still has its trial.
      if (x.kept) store.saveTarget(surfaces[t], x.name, source);
      log(`  ${surfaces[t].id}: ${x.name} rewritten and built`);
    })().catch((e) => log(`  ${surfaces[t].id}: fixing ${x.name} failed: ${String((e as Error).message).split('\n')[0]}`)).finally(() => { fixing.delete(key); pendingFixes.delete(job); });
    pendingFixes.add(job);
  };

  /** The shared corpus per surface: raw inputs that reached its entry points and added coverage. */
  type Entry = { input: Buffer; gain: number };
  const corpora = all.map(() => [] as Entry[]);
  const dicts = all.map((t) => new Set<string>(literalsOf(p, surfaces[t])));
  const addSeeds = (t: number, w: Written) => {
    for (const d of w.dictionary) if (d) dicts[t].add(d);
    store.saveDictionary(surfaces[t], [...dicts[t]]);
    for (const s of w.seeds) seeds[t].push(s);
  };
  const seeds = all.map((t) => fixtureSeeds(p, fixtures[t]));
  const replayed = all.map(() => [] as { input: Buffer; lines: string[] }[]);

  /**
   * Reads what one input did through one target. Returns whether it added coverage. Junk (no entry point reached, or a failure
   * in the target's own code) is counted and dropped: it never joins the corpus.
   */
  const consider = (t: number, live: Live, r: InputReport, input: Buffer, by: string, replaying = false): boolean => {
    const here = surfaceLines(surfaces[t]), st = states[t];
    live.execs++;
    st.execs++;
    if (r.lines) live.measured++;
    const mine: string[] = [];
    let fresh = 0;
    for (const [path, line] of r.lines ?? []) {
      allLines.add(`${path}:${line}`);
      if (!here.has(path, line)) continue;
      const key = `${path}:${line}`;
      mine.push(key);
      if (!st.coveredNow.has(key)) { st.coveredNow.add(key); fresh++; }
      st.covered.add(key);
      if (!live.lines.has(key)) { live.lines.add(key); live.dry = 0; }
      const e = here.entry(path, line);
      if (e) st.entriesHit.add(e.qualifiedName);
    }
    live.dry++;
    // A part's target reaches its inner function; the surface's own targets an entry point.
    const inner = live.inner;
    const reachedEntry = r.lines ? (inner ? r.lines.some(([path, line]) => path === inner.path && line >= inner.line && line <= inner.endLine) : r.lines.some(([path, line]) => !!here.entry(path, line))) : undefined;
    if (reachedEntry) live.reachedInputs++;
    const remember = (list: string[], line: string) => { if (line && !list.includes(line)) { list.push(line); if (list.length > 6) list.shift(); } };
    const setup = r.origin === 'setup' || (r.status === 'error' && !r.origin);
    if (setup) { live.setupErrors++; remember(live.errs, `${r.type ?? r.status}: ${(r.message ?? '').split('\n')[0].slice(0, 240)}`); }
    else if (r.status === 'error' && r.origin === 'library') { const pre = precondition(p, r); if (pre) { live.setupErrors++; remember(live.errs, `${r.type}: ${pre}`); } }
    if (reachedEntry === false) remember(live.rejected, `${showInput(input).slice(0, 160)} => ${r.status} ${r.type ?? ''} ${(r.message ?? r.result ?? '').split('\n')[0].slice(0, 160)}`);
    if (replaying && mine.length) replayed[t].push({ input, lines: mine });
    // Failures: a crash or hang in the project, or the target's own assertion. An assertion that fires on an input that never
    // ran an entry point is about the target, not the project (what it built before the call, a check of its own): no finding.
    if (r.status !== 'ok' && !setup && !(r.origin === 'assertion' && reachedEntry === false)) {
      const f = r.origin === 'assertion' ? asserted(t, live, r, input, by) : flag(r, live.source, by, subjects[t], showInput(input));
      if (f) {
        f.surface = surfaces[t].id;
        f.target = live.name;
        if (live.inner) f.via = live.inner.qualifiedName;
        raw.push(f);
        behind.set(f, { t, input, live });
        if (f.kind === 'property' && reachedEntry) {
          const at = live.failing.get(f.where) ?? { n: 0, message: (f.message ?? '').split('\n')[0].slice(0, 300) };
          at.n++;
          live.failing.set(f.where, at);
        }
        live.findings++;
        // A hang is kept only once it hangs again run alone with ten times the time (below): a busy machine makes slow calls.
        if (f.kind !== 'hang' && !causes.has(causeOf(f))) { causes.add(causeOf(f)); store.saveFinding(surfaces[t], f, input, false, live.name); }
      }
    }
    // Junk clamped: only an input that got into the surface, without failing in the target's own code, is kept.
    const novel = !!(r.novel || (r.features ?? []).some((x) => !live.seen.has(x)));
    for (const x of r.features ?? []) live.seen.add(x);
    if (setup || reachedEntry === false || (reachedEntry === undefined && !mine.length)) { junk++; return false; }
    // A target on trial whose inputs get in joins the portfolio when it checks a promise no kept target checks: on code
    // already covered, that is what it adds.
    if (!live.kept && mine.length) {
      const own = unchecked(t).filter((x) => live.promises.has(x.id)).map((x) => x.id);
      if (own.length) admit(t, live, `checks ${own.length} promise${own.length === 1 ? '' : 's'} no other target checks (${own.join(', ')})`);
      // Or when it is a kind of harness (HARNESS_KINDS) no kept target is: its assertions are what it adds, on the same lines.
      else if (live.kind && ![...portfolio[t].values()].some((y) => y.kept && y.kind === live.kind)) admit(t, live, `is the surface's ${live.kind} harness, which no other target is`);
    }
    if (!(fresh || novel)) return false;
    const c = corpora[t];
    if (!c.some((x) => x.input.equals(input))) c.push({ input, gain: fresh + 1 });
    if (fresh) {
      store.addInput(surfaces[t], input);
      // A target on trial joins the portfolio the moment it reaches a surface line no other target has.
      if (!live.kept) admit(t, live, `reached ${fresh} surface line${fresh === 1 ? '' : 's'} no other target had`);
    }
    return true;
  };

  /** A target on trial joins the portfolio: kept in the store, and with it the lines and promises it brings. */
  const admit = (t: number, live: Live, why: string) => {
    live.kept = true;
    store.saveTarget(surfaces[t], live.name, live.source);
    log(`  ${surfaces[t].id}: ${live.name} ${why}: added to the portfolio`);
  };

  /** A failed assertion of the target: a finding, keyed by the assertion so its many inputs are one cause. */
  const asserted = (t: number, live: Live, r: InputReport, input: Buffer, by: string): Finding => {
    const msg = r.message ?? '';
    // The assertion's own line when the driver says which (`line 12`, Ruby's `(target):12`); otherwise the line whose text the
    // message starts with. Never the message itself: it carries the values compared, which differ on every input.
    // A driver that knows the assertion's line in the target reports it as a frame named `target`.
    const n = r.frames?.find((f) => f.name === 'target')?.line?.toString() ?? /(?:line |\(target\):)(\d+)/.exec(`${msg}\n${(r.frames ?? []).map((f) => `${f.path}:${f.line}`).join('\n')}`)?.[1];
    const lines = live.source.split('\n');
    const head = msg.split(/:\s|\n/)[0].trim();
    const at = n ? lines[Number(n) - 1]?.trim() : undefined;
    // With neither, the message up to its first value (a quote, a number, an `=`): `Claims() = "…", want "…"` is one
    // assertion however many values it reports. Never the whole message.
    const template = head.replace(/["'`=<>\d].*$/s, '').trim();
    const line = at || lines.find((l) => head.length > 8 && l.includes(head.slice(0, 40)))?.trim() || (template.length >= 4 ? template : errorClass(head));
    return { kind: 'property', by, where: `${surfaces[t].id}/${live.name}#${createHash('sha1').update(line).digest('hex').slice(0, 8)}`, type: `Assertion ${r.type ?? ''}`.trim(), message: msg, harness: live.source, input: showInput(input), line, stack: (r.frames ?? []).map((f) => `${f.path}:${f.line} ${f.name}`), function: subjects[t].qualifiedName };
  };

  const runOn = async (t: number, live: Live, inputs: Buffer[], by: string, replaying = false, timeout = callMs) => {
    const fit = inputs.filter((b) => b.length <= 1 << 20);
    if (!fit.length) return [];
    noteFirst();
    const reports = await live.session.run(live.id, fit, timeout, until);
    execs += reports.length;
    reports.forEach((r, i) => consider(t, live, r, fit[i], by, replaying));
    return reports;
  };

  /** A target is in error when its inputs reach no entry point, or mostly fail in its own lines. */
  const inError = (live: Live): string | undefined => {
    if (live.measured < JUDGED_AFTER) return undefined;
    if (!live.reachedInputs) return `NO INPUT REACHED AN ENTRY POINT after ${live.measured} inputs: the target fails or returns before the call, or calls other code. Build what the call needs the way the project does, and make nearly every byte string reach it.\n${live.errs.length ? `ERRORS IN THE TARGET'S OWN CODE:\n${live.errs.join('\n')}\n` : ''}INPUTS AND WHAT HAPPENED:\n${live.rejected.join('\n')}`;
    if (live.setupErrors * 2 > live.execs) return `MOST INPUTS (${live.setupErrors} of ${live.execs}) FAILED IN THE TARGET'S OWN CODE, before or around the call:\n${live.errs.join('\n')}`;
    // One assertion failing on most inputs that get in: the inputs end there, and the calls and checks after it never run,
    // so every input finds that one failure and nothing deeper. The failure is already recorded.
    const top = [...live.failing.values()].sort((a, b) => b.n - a.n)[0];
    if (top && live.reachedInputs >= JUDGED_AFTER / 2 && top.n * 2 > live.reachedInputs) return `MOST INPUTS THAT REACH THE CODE (${top.n} of ${live.reachedInputs}) FAIL ONE ASSERTION, so nothing after it runs:\n${top.message}\nThat failure is recorded already. Rewrite the target so its inputs keep exercising the code: if the assertion states something the project does not promise for these inputs, correct it to what the project does promise; if it shows a real defect, keep it but make it the target's last check, after every other call and assertion, so each input still runs all of them.`;
    return undefined;
  };

  /**
   * What the surface's targets miss, for the improvement step after an iteration. Branches judged cold are left out. Once
   * its coverage has plateaued (`flat`), the promises no target checks are what the move is for.
   */
  const gaps = (t: number, flat = false): string => {
    const surface = surfaces[t], st = states[t];
    const byPath = new Map<string, number[]>();
    for (const key of st.covered) { const at = key.lastIndexOf(':'); (byPath.get(key.slice(0, at)) ?? byPath.set(key.slice(0, at), []).get(key.slice(0, at))!).push(Number(key.slice(at + 1))); }
    const entered = surface.reach.filter((f) => (byPath.get(f.path) ?? []).some((l) => l >= f.line && l <= f.endLine));
    const missed = entered.map((f) => { const root = p.tree(f.path); return { f, open: root ? branchPoints(root, p.read(f.path), f.line, f.endLine).filter((b) => !st.covered.has(`${f.path}:${b.line}`) && !skipped[t].has(`${f.path}:${b.line}`)) : [] }; })
      .filter((x) => x.open.length).sort((a, b) => Number(surface.entries.includes(b.f)) - Number(surface.entries.includes(a.f)) || b.open.length - a.open.length);
    const unentered = surface.reach.filter((f) => !entered.includes(f));
    // A target whose last new line came within its first few inputs, out of many: it enumerates.
    const enumerating = [...portfolio[t].values()].filter((x) => x.kept && x.execs >= 10_000 && x.execs - x.dry < Math.max(500, x.execs * 0.02));
    return [
      `SURFACE LINES REACHED: ${st.covered.size} of ${surfaceLines(surface).total}.`,
      surface.entries.some((e) => !st.entriesHit.has(e.qualifiedName)) ? `ENTRY POINTS NO INPUT HAS REACHED: ${surface.entries.filter((e) => !st.entriesHit.has(e.qualifiedName)).map((e) => e.qualifiedName).join(', ')}` : '',
      unentered.length ? `FUNCTIONS OF THIS SURFACE NO INPUT HAS REACHED:\n${unentered.map((f) => `${f.qualifiedName} (${f.path}:${f.line})`).join('\n')}` : '',
      missed.length ? `BRANCHES NO INPUT HAS TAKEN, IN FUNCTIONS INPUTS DO REACH:\n${missed.flatMap((x) => x.open.map((b) => `${x.f.qualifiedName} ${x.f.path}:${b.line} (${b.kind}): ${b.text}`)).join('\n')}` : '',
      enumerating.length && st.covered.size < surfaceLines(surface).total ? `TARGETS WHOSE INPUTS STOPPED REACHING NEW LINES ALMOST AT ONCE. They run a few fixed cases over and over instead of deriving every value from the bytes; an enumeration of hand-picked scenarios is not fuzzing, since the engine can never find what the list leaves out:\n${enumerating.map((x) => `${x.name}: its last new line came after ${x.execs - x.dry} of ${x.execs} inputs`).join('\n')}\nThe next target derives each argument, field, claim and value from the bytes (FuzzedDataProvider or the language's equivalent), with the scenarios, if any, as one fuzzed choice among many.` : '',
      unchecked(t).length ? `PROMISES THIS SURFACE'S CODE MAKES THAT NO TARGET CHECKS YET${flat ? '. Coverage has stopped growing: the move is a new target whose assertions check these on the inputs where each applies, naming their ids; a promise no fuzz target can check goes in untestable, with why' : ''}:\n${unchecked(t).map((x) => `${x.id}: ${x.statement} (${x.source})`).join('\n')}` : '',
      o.dig?.get(surface.id)?.length ? `BUGS VERIFIED IN THIS SURFACE WITH A FAILING TEST. Dig around them: the same mistake reached another way, in the functions beside it, and the worst it can do:\n${o.dig.get(surface.id)!.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
  };

  /** A new target from the writer, built and put on trial. */
  const added = all.map(() => [] as string[]);
  const asking = all.map(() => false);
  const fixedNames = all.map(() => new Set<string>());
  const addTarget = async (t: number, ask: Ask) => {
    asking[t] = true;
    try {
      const w = await write(t, ask, [...portfolio[t].values()]);
      if (typeof w === 'string') { log(`  ${surfaces[t].id}: ${w}`); return; }
      if (w.action === 'parts') await placeParts(t, w); else await place(t, w);
    } finally { asking[t] = false; }
  };
  /** A decomposition: its composition kept with the surface, and each part's target placed beside the surface's own. */
  const placeParts = async (t: number, w: Written): Promise<string[]> => {
    const parts = w.parts ?? [];
    addSeeds(t, { ...w, seeds: [] });
    if (w.composition || parts.length) store.addDecomposition(surfaces[t], [w.composition ?? '', '', ...parts.map((x) => `- ${x.composition}`)].join('\n'));
    log(`  ${surfaces[t].id}: decomposed into ${parts.length} part${parts.length === 1 ? '' : 's'}${parts.length ? `: ${parts.map((x) => x.inner).join(', ')}` : ''}`);
    return (await Promise.all(parts.map((x) => place(t, x)))).filter((x): x is string => !!x);
  };
  /**
   * The crawl: every function below a surface's entry points with a branch, depth first from them (crawlOrder), gets a part
   * of its own, one writer call each, until the run's time or budget is spent. A function many surfaces reach is a part of
   * the first that gets to it, in this run or an earlier one.
   */
  const claimed = o.claimed ?? new Set<string>();
  let seeded = false;
  const crawl = async (t: number) => {
    // This batch's own parts from earlier runs are claimed once its targets are loaded.
    if (!seeded) { seeded = true; for (const u of all) for (const x of [...portfolio[u].values(), ...broken[u]]) for (const fn of tagsOf(x.source, INNER_TAG)) claimed.add(fn); }
    for (const fn of crawlOrder(p, surfaces[t])) {
      if (Date.now() >= until || done[t] || blocked.has(t) || !(o.budget?.canWrite() ?? true)) return;
      if (claimed.has(fn.qualifiedName)) continue;
      claimed.add(fn.qualifiedName);
      const d = await byUntil(write(t, { kind: 'decompose', fns: [fn] }, [...portfolio[t].values()], true));
      if (!d) return;
      if (typeof d === 'string') { log(`  ${surfaces[t].id}: part for ${fn.qualifiedName}: ${d}`); continue; }
      if (!d.parts?.length) { log(`  ${surfaces[t].id}: part for ${fn.qualifiedName}: the writer wrote none`); continue; }
      await placeParts(t, d);
    }
  };
  const place = async (t: number, w: Written): Promise<string | undefined> => {
    if (done[t]) return undefined;
    const name = store.nextName(surfaces[t], [...portfolio[t].keys(), ...added[t]]);
    const source = tagged(rt.language, w.source, w.promises, w.kind, w.inner);
    addSeeds(t, w);
    added[t].push(name);
    const [r] = await build([{ t, name, source, kept: false }]);
    if (typeof r === 'string') {
      const env = envOf(r);
      if (env) { block(t, env); log(`  ${surfaces[t].id}: blocked by the environment: ${env}`); return; }
      fix(t, { name, source, kept: false }, r);
      return;
    }
    portfolio[t].set(name, r);
    log(`  ${surfaces[t].id}: ${name} written and built${w.inner ? ` (part: ${w.inner})` : w.kind ? ` (${w.kind})` : ''}; on trial until it reaches a line no other target has`);
    return name;
  };

  /**
   * A model call the search waits on, waited on only until the search's time is up: the call goes on, and what it brings is
   * used if it still can be (a late target is not placed in a surface that has stopped; judging finishes after the search).
   */
  const byUntil = <T>(work: Promise<T>): Promise<T | void> => (Number.isFinite(until) ? Promise.race([work, new Promise<void>((r) => setTimeout(r, Math.max(0, until - Date.now())))]) : work);

  /** One surface for the whole search: its targets take turns, errors are fixed, and each iteration ends with one move by the writer. */
  const runSurface = async (t: number) => {
    const surface = surfaces[t];
    for (const x of broken[t]) if (!blocked.has(t)) fix(t, { ...x, kept: true }, x.error);
    // A target whose failures verification rejected is rewritten from that, as a target in error is: it would go on reporting
    // the same non-bug.
    for (const [name, why] of o.fixes?.get(surface.id) ?? []) { const live = portfolio[t].get(name); if (live && !blocked.has(t)) fix(t, live, why); }
    // Its promises, on its first turn and after its code changed: the first target is written knowing them; a surface with
    // targets fuzzes while they are listed.
    const listing = blocked.has(t) ? Promise.resolve() : listPromises(t);
    if (!portfolio[t].size && !broken[t].length && !blocked.has(t)) { await byUntil(listing); await byUntil(addTarget(t, { kind: 'first' })); }
    // Decomposed from the start, beside the first target, and all the way down: every function below the entry point with a
    // branch gets a part of its own, depth first, while the surface fuzzes.
    if (!blocked.has(t)) void listing.then(() => crawl(t));
    // The stored corpus and the inputs of earlier failures run first through every target: the search picks up where the
    // last run stopped, and a failure not yet judged is found again.
    const carried = [...stored[t].corpus.map((c) => c.input), ...stored[t].failing];
    for (const live of portfolio[t].values()) await runOn(t, live, carried, 'replay', true);
    if (stored[t].corpus.length && replayed[t].length) {
      const removed = store.shrink(surface, replayed[t], stored[t].corpus.map((c) => c.name));
      if (removed) log(`  ${surface.id}: corpus shrunk: ${stored[t].corpus.length - removed} of ${stored[t].corpus.length} stored inputs cover everything the stored corpus covered`);
    }
    // Iterations, as in GitHub Security Lab's fuzzing loop: fuzz for a budget, measure what it gained, then the writer makes
    // one move aimed at what no input reached (inputs for a target, a new target, or branches judged cold), and the next
    // iteration gets twice the budget. Coverage plateaus when two iterations in a row gain less than `plateau` of what was
    // covered, or every surface line is covered; the surface stops then only if no promise is left unchecked, and otherwise
    // the moves ask for targets checking them. It also stops after `maxIterations`, or when the run's time is up.
    const total = surfaceLines(surface).total;
    let iteration = rounds[t].iterations, budget = rounds[t].budgetMs, flat = rounds[t].flat, firstTried = -1, start = states[t].covered.size, turn = 0;
    /** The iterations finished when each new target joined: one on trial gets one whole iteration to reach a line no other target has. */
    const joined = new Map<string, number>();
    let end = Math.min(until, Date.now() + budget);
    /** Coverage has plateaued: the moves are for the promises no target checks. */
    let flatNow = states[t].covered.size >= total || flat >= 2;
    const improve = async () => {
      asking[t] = true;
      try {
        await listing;
        const asked = flatNow ? unchecked(t) : [];
        for (const x of asked) x.asked = (x.asked ?? 0) + 1;
        const w = await write(t, { kind: 'improve', note: gaps(t, flatNow) }, [...portfolio[t].values()], true);
        if (typeof w === 'string') { log(`  ${surface.id}: ${w}`); return; }
        for (const u of w.untestable ?? []) {
          const x = promisesOf(t).find((y) => y.id === u.id);
          if (x && !x.untestable) { x.untestable = `the writer: ${u.why}`; log(`  ${surface.id}: promise ${x.id} untestable: ${u.why.slice(0, 160)}`); }
        }
        if (w.action === 'untestable') {
          log(`  ${surface.id}: iteration ${iteration}: the writer judged ${(w.untestable ?? []).length} promise${(w.untestable ?? []).length === 1 ? '' : 's'} untestable`);
        } else if (w.action === 'skip') {
          const cold = (w.skip ?? []).filter((x) => /^.+:\d+$/.test(x));
          for (const x of cold) skipped[t].add(x);
          addSeeds(t, { ...w, seeds: [] });
          log(`  ${surface.id}: iteration ${iteration}: the writer judged ${cold.length} branch${cold.length === 1 ? '' : 'es'} cold`);
        } else if (w.action === 'seeds') {
          addSeeds(t, { ...w, seeds: [] });
          const live = [...portfolio[t].values()];
          const x = portfolio[t].get(w.forTarget ?? '') ?? live.find((y) => y.kept) ?? live[0];
          const before = states[t].covered.size;
          if (x) await runOn(t, x, w.seeds, 'seeds');
          log(`  ${surface.id}: iteration ${iteration}: ${w.seeds.length} inputs for ${x?.name ?? 'no target'} reached ${states[t].covered.size - before} new surface lines`);
        } else {
          const name = await place(t, w);
          if (name) joined.set(name, iteration);
        }
      } finally {
        asking[t] = false;
        end = Math.min(until, Date.now() + budget);
      }
    };
    const nextNative = new Map<string, number>();
    /** Targets whose seeds have been measured: after that only the engine runs them. */
    const probed = new Set<string>();
    const fixingAny = () => [...fixing].some((f) => f.startsWith(`${t}#`));
    // A surface continuing from an earlier session ended that session fuzzing, before its move: it makes the move first.
    if (iteration > 0 && !rounds[t].plateaued && portfolio[t].size) { end = Infinity; void improve(); }
    while (Date.now() < until && !blocked.has(t) && !o.stop?.()) {
      // An iteration ends when its budget is spent and the last move has landed; the targets keep fuzzing while the writer works.
      if (Date.now() >= end && !asking[t] && (portfolio[t].size || !fixingAny())) {
        iteration++;
        const size = states[t].covered.size, gain = (size - start) / Math.max(1, start);
        flat = gain < o.plateau ? flat + 1 : 0;
        // A promise that moves kept asking for and no target came to check is taken as untestable: the loop does not ask forever.
        for (const x of unchecked(t)) if ((x.asked ?? 0) >= PROMISE_ASKS) { x.untestable = `${x.asked} moves asked for a target checking it, and none joined`; log(`  ${surface.id}: promise ${x.id} untestable: ${x.untestable}`); }
        const open = standing(t).length, left = unchecked(t).length;
        log(`  ${surface.id}: iteration ${iteration} (${Math.round(budget / 1000)}s): ${size - start} new surface lines, ${size} of ${total}; promises ${open - left} of ${open} checked`);
        for (const [name, at] of joined) {
          const x = portfolio[t].get(name);
          if (!x || x.kept || at >= iteration) continue;
          portfolio[t].delete(name);
          x.session.release?.(x.id);
          store.reject(surface, x.name, x.source, `reached no surface line the other targets had not, in a whole iteration (${x.execs} inputs)`);
          log(`  ${surface.id}: ${x.name} reached nothing the other targets had not in a whole iteration; discarded`);
        }
        flatNow = size >= total || flat >= 2;
        rounds[t] = { budgetMs: budget * 2, flat, iterations: iteration, plateaued: flatNow && !left };
        if (rounds[t].plateaued || iteration >= o.maxIterations) break;
        if (flatNow) log(`  ${surface.id}: coverage has plateaued, but ${left} promise${left === 1 ? ' is' : 's are'} unchecked: not done, the next move is a target checking ${left === 1 ? 'it' : 'them'}`);
        checkpoint(`round ${iteration} of ${surface.id}`);
        budget *= 2;
        start = size;
        if (portfolio[t].size) { end = Infinity; void improve(); } else end = Math.min(until, Date.now() + budget);
        continue;
      }
      const live = [...portfolio[t].values()];
      if (!live.length) {
        // No working target: one first target is written per iteration, and an iteration without one gains nothing.
        if (fixingAny() || asking[t] || firstTried === iteration) { await new Promise((r) => setTimeout(r, 1000)); continue; }
        firstTried = iteration;
        await byUntil(addTarget(t, { kind: 'first' }));
        continue;
      }
      // The target whose inputs last found something new runs most; every target gets a turn.
      const x = turn++ % 4 === 0 ? live[turn % live.length] : live.reduce((a, b) => (a.dry <= b.dry ? a : b));
      const err = inError(x);
      // Kept with the inputs and what they did, as a target that did not build is: the run's log has only its first line.
      if (err) { store.reject(surfaces[t], `${x.name}.ran${x.measured}`, x.source, err); fix(t, x, err); continue; }
      // refuzz does not fuzz: the language's own engine (libFuzzer, Atheris, Jazzer, cargo-fuzz, go test -fuzz) does, on the
      // target refuzz wrote. refuzz's own driver only measures: a new target's seeds once, to see it builds, reaches its entry
      // points and is not broken; then each input the engine keeps, once, for the lines it ran.
      if (!x.session.native) { block(t, `${rt.language} has no fuzzing engine wired for its targets: refuzz writes the target, a language's own engine fuzzes it`); log(`  ${surface.id}: blocked: no fuzzing engine for ${rt.language} targets`); continue; }
      if (!probed.has(x.id)) {
        probed.add(x.id);
        const dict = [...dicts[t]].map((d) => Buffer.from(d, 'utf8'));
        const probe = seeds[t].length ? seeds[t].splice(0) : [Buffer.alloc(0), ...dict.slice(0, 31)];
        await runOn(t, x, probe, x.kept ? 'seeds' : 'trial');
        continue;
      }
      if (nextNative.get(x.name) === Infinity) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      {
        // The surface's targets share its time: each turn is the engine on one target, the whole corpus as its seeds.
        const seconds = Math.max(NATIVE_MIN_SECONDS, Math.floor(Math.min(budget / Math.max(1, live.length), until - Date.now()) / 1000));
        if (until - Date.now() < NATIVE_MIN_SECONDS * 1000) { await new Promise((r) => setTimeout(r, Math.max(0, until - Date.now()))); continue; }
        const corpus = [...seeds[t], ...corpora[t].map((c) => c.input)];
        const n = await x.session.native(x.id, corpus, [...dicts[t]], seconds);
        execs += n.execs;
        x.execs += n.execs;
        states[t].execs += n.execs;
        for (const c of n.crashes) consider(t, x, c.report as InputReport, c.input, 'native');
        // What the engine kept for new coverage is measured once: inputs that reach new surface lines join the corpus and the
        // store, the junk is dropped.
        const grown = n.corpus.filter((b) => !corpus.some((y) => y.equals(b)));
        if (grown.length) await runOn(t, x, grown, 'native');
        // An engine that ran nothing is the target's error, with the engine's own account: rewritten, never routed around.
        if (!n.execs && !n.crashes.length) {
          const why = `the fuzzing engine ran no inputs on this target: ${(n.error ?? 'it gave no reason').split('\n').filter(Boolean).slice(-6).join('\n').slice(0, 1200)}`;
          log(`  ${surface.id}: ${x.name}: ${why.split('\n')[0].slice(0, 300)}`);
          nextNative.set(x.name, Infinity);
          store.reject(surfaces[t], `${x.name}.engine`, x.source, why);
          fix(t, x, why);
        }
      }
    }
    log(`  search: ${surface.id}: ${[...portfolio[t].values()].filter((y) => y.kept).length} targets, ${states[t].coveredNow.size} of ${surfaceLines(surface).total} surface lines reached (${states[t].covered.size} over all runs), entry points reached ${states[t].entriesHit.size} of ${surface.entries.length}${blocked.has(t) ? `; blocked by the environment: ${blocked.get(t)}` : ''}`);
  };

  await inParallel(all, Math.max(1, all.length), async (t) => {
    try { await runSurface(t); } catch (error) { log(`  search: ${surfaces[t].id} stopped: ${String((error as Error).stack ?? error).split('\n').slice(0, 3).join(' ')}`); } finally { done[t] = true; }
  });
  log(`  search: ${execs} inputs, ${junk} dropped as junk, ${allLines.size} project lines covered`);
  checkpoint('search');

  // Each distinct failure made smaller and run again alone; verification judges and tests them (src/verify.ts).
  const distinct = dedupe(raw);
  log(`  failures: ${raw.length}, ${distinct.length} distinct`);
  const happens = (f: Finding, r: InputReport | undefined) => !!r && (f.kind === 'hang' ? r.status === 'timeout' : f.kind === 'property' ? r.origin === 'assertion' && `Assertion ${r.type ?? ''}`.trim() === f.type : r.status === 'error' && r.type === f.type && (!f.where.includes(':') || `${r.frames?.at(-1)?.path}:${r.frames?.at(-1)?.line}` === f.where || !!r.native));
  const lift = async (f: Finding) => {
    const at = behind.get(f)!;
    const t = at.t, fn = at.live.inner!;
    const tops = [...portfolio[t].values()].filter((x) => !x.inner);
    const no = (why: string) => { f.reproduces = false; f.verdict = `found calling ${fn.qualifiedName} directly; ${why}`; log(`  ${surfaces[t].id}: ${f.type} via ${fn.qualifiedName} not lifted: ${why}`); };
    if (!tops.length) return no('the surface has no target of its own to reproduce it through the entry point');
    const fields = {
      plan: `How an input to the surface's own target reaches ${fn.qualifiedName} with the arguments the failing call had: what the target does with its bytes, and what the entry point does on the way.`,
      inputs: 'A JSON array of {"target": the name of one of the surface\'s targets listed, "input": one whole input for it, as it receives its bytes: text as it is, or "hex:" and the bytes in hex}, each driving that function into the failing state.',
    };
    const prompt = [
      `A FUZZ TARGET CALLING ${fn.qualifiedName} DIRECTLY FAILED. Reproduce the failure through the surface's entry point.`,
      `--- the failure\n${f.kind} ${f.type}: ${String(f.message ?? '').slice(0, 1500)}\n${(f.stack ?? []).slice(-12).join('\n')}`,
      `--- the part's target\n${at.live.source}\n--- its failing input\n${showInput(at.input).slice(0, 2000)}`,
      `--- ${fn.qualifiedName} (${fn.path})\n${sourceOf(p, fn)}`,
      `--- the entry point\n${sourceOf(p, subjects[t])}`,
      `--- the surface's own targets\n${tops.map((x) => `### ${x.name}\n${x.source}`).join('\n')}`,
    ].join('\n\n');
    let tries: { live: Live; input: Buffer }[] = [];
    try {
      const a = await models.text.generate(prompt, fields, 'fuzz-lift', `refuzz-${rt.language}`);
      const list = (() => { try { const v = JSON.parse((a.inputs ?? '[]').replace(/^```\w*\n|\n```\s*$/g, '')); return Array.isArray(v) ? v : []; } catch { return []; } })();
      tries = list.flatMap((y: { target?: unknown; input?: unknown }) => {
        const live = tops.find((x) => x.name === String(y?.target ?? '').trim()) ?? tops[0];
        if (typeof y?.input !== 'string') return [];
        return [{ live, input: /^hex:/i.test(y.input) ? Buffer.from(y.input.slice(4).replace(/[^0-9a-f]/gi, ''), 'hex') : Buffer.from(y.input, 'utf8') }];
      });
    } catch (e) { return no(`the writer failed: ${String((e as Error).message).split('\n')[0]}`); }
    if (!tries.length) return no('the writer gave no input for the entry point');
    // The same failure: a crash of the same type at the same place, a hang, or for a broken property any failure of the
    // surface's target with the inner function on the input's path.
    const passes = (r: InputReport | undefined) => !!r && (f.kind === 'property' ? r.status === 'error' && r.origin !== 'setup' && (r.lines ?? []).some(([path, line]) => path === fn.path && line >= fn.line && line <= fn.endLine) : happens(f, r));
    for (const x of tries) {
      if (Date.now() >= shrinkUntil) break;
      const [r] = await x.live.session.run(x.live.id, [x.input], callMs * 10, shrinkUntil);
      if (passes(r)) { f.lifted = showInput(x.input); log(`  ${surfaces[t].id}: ${f.type} via ${fn.qualifiedName} reproduced through the entry point by ${x.live.name}`); return; }
    }
    no(`none of ${tries.length} inputs to the surface's own targets reproduced it through the entry point`);
  };
  // Shrinking stops at the session's end like the search: a slow target makes every try cost its timeout. A hang is not
  // shrunk, since every try of it waits the whole timeout.
  const shrinkUntil = o.deadline ?? Infinity;
  for (const f of distinct.filter((x) => x.kind !== 'nondeterministic')) {
    const at = behind.get(f)!;
    // Smaller: chunks removed while the same failure happens, halving the chunk until single bytes.
    let best = at.input;
    for (let chunk = f.kind === 'hang' ? 0 : best.length >> 1; chunk >= 1 && Date.now() < shrinkUntil; chunk >>= 1) {
      for (let i = 0; i < best.length && Date.now() < shrinkUntil; ) {
        const tryIt = Buffer.concat([best.subarray(0, i), best.subarray(i + chunk)]);
        const [r] = await at.live.session.run(at.live.id, [tryIt], callMs, shrinkUntil);
        if (happens(f, r)) best = tryIt; else i += chunk;
      }
    }
    if (best !== at.input) { behind.set(f, { ...at, input: best }); f.input = showInput(best); }
    // Run again alone, while the session's time lasts; past it, verification's test is the check. A hang has no test to
    // check it: one never run again alone is a slow call on a busy machine as likely as a hang (ClickHouse's 31 such were all
    // targets that returned at once), so it is not a finding.
    if (Date.now() >= shrinkUntil) {
      if (f.kind === 'hang') { f.reproduces = false; f.verdict = 'not run again alone before the session ended'; }
      continue;
    }
    const [r] = await at.live.session.run(at.live.id, [behind.get(f)!.input], callMs * 10, shrinkUntil);
    if (!r) continue;
    // A hang that, given the time, ends in a crash was a slow input to a memory error (a row of 70,000 cells overflowing a
    // 16-bit count takes seconds to build first): that crash is the finding, with the same input.
    if (f.kind === 'hang' && r.status === 'error') {
      const g = flag(r, at.live.source, 'rerun', subjects[at.t], f.input);
      if (g) {
        Object.assign(g, { surface: f.surface, target: f.target, reproduces: true, ...(f.via ? { via: f.via } : {}) });
        raw.push(g);
        distinct.push(g);
        behind.set(g, behind.get(f)!);
        if (!causes.has(causeOf(g))) { causes.add(causeOf(g)); store.saveFinding(surfaces[at.t], g, behind.get(f)!.input, false, at.live.name); }
        log(`  ${surfaces[at.t].id}: a hang given ten times the time ended in ${g.type} at ${g.where}`);
      }
    }
    f.reproduces = happens(f, r);
    if (!f.reproduces) f.verdict = f.kind === 'hang' ? 'finished when run alone with ten times the time' : 'did not happen when run alone';
    else if (f.kind === 'hang' && !causes.has(causeOf(f))) { causes.add(causeOf(f)); store.saveFinding(surfaces[at.t], f, behind.get(f)!.input, false, at.live.name); }
  }
  // A part's failure is the project's only if it happens through the entry point: the writer turns the failing call into
  // inputs for the surface's own targets, which run them. One failing the same way, with the inner function on its path,
  // lifts it; none does, and the part gave that function what its callers never do.
  for (const f of distinct.filter((x) => x.via && x.reproduces !== false && x.kind !== 'nondeterministic')) {
    if (Date.now() >= shrinkUntil) { f.reproduces = false; f.verdict = `found calling ${f.via} directly; the session ended before it could be reproduced through the entry point`; continue; }
    await lift(f);
  }
  checkpoint('failures');

  clearInterval(timer);
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  // Pruning, one at a time so two that cover the same lines do not both go: a target that ran enough this run, covered
  // nothing another did not, found nothing and tests no promise another does not.
  for (const t of all) {
    for (;;) {
      const kept = [...portfolio[t].values()].filter((x) => x.kept);
      if (kept.length < 2) break;
      const idle = kept.filter((x) => x.execs >= PRUNE_AFTER && !x.findings && ![...x.lines].some((l) => !kept.some((y) => y !== x && y.lines.has(l))) && [...x.promises].every((s) => kept.some((y) => y !== x && y.promises.has(s))) && (!x.kind || kept.some((y) => y !== x && y.kind === x.kind)));
      if (!idle.length) break;
      const x = idle.sort((a, b) => a.lines.size - b.lines.size)[0];
      portfolio[t].delete(x.name);
      store.dropTarget(surfaces[t], x.name, x.source, `pruned: in ${x.execs} inputs it covered no surface line another target did not, and found nothing`);
      pruned[t].push(x.name);
      log(`  ${surfaces[t].id}: ${x.name} pruned: it covers nothing the other targets do not`);
    }
  }

  // Every surface's standing and findings, with confirmed defects written up.
  const summary: NonNullable<FuzzRun['surfaces']> = {};
  for (const t of all) {
    const surface = surfaces[t];
    const mine = distinct.filter((f) => behind.get(f)?.t === t);
    for (const f of mine) store.saveFinding(surface, f, behind.get(f)!.input, false, behind.get(f)!.live.name);
    states[t].defects = mine.length;
    save(t);
    const st = states[t], total = surfaceLines(surface).total;
    summary[surface.id] = { entries: surface.entries.map((e) => e.qualifiedName), sources: surface.sources.map((y) => `${y.kind} ${y.api} at ${y.path}:${y.line}`), covered: st.covered.size, total, entriesReached: [...st.entriesHit], targets: contribution(t), added: added[t].filter((n) => portfolio[t].get(n)?.kept), fixed: [...fixedNames[t]], pruned: pruned[t], folder: store.folder(surface) };
    log(`  store: ${surface.id}: ${st.covered.size} of ${total} surface lines covered over all runs (${st.coveredNow.size} this run), ${Object.keys(summary[surface.id].targets).length} targets, ${st.entriesHit.size} of ${surface.entries.length} entry points reached, ${states[t].defects} distinct failures → ${store.folder(surface)}`);
  }

  await Promise.allSettled([...pendingFixes]);
  for (const s of sessions) await s.close().catch(() => {});
  const loaded = all.reduce((n, t) => n + [...portfolio[t].values()].filter((x) => x.kept).length, 0);
  return {
    language: rt.language, targets: surfaces.flatMap((x) => x.entries.map((e) => e.qualifiedName)), probed: execs, execs, junk,
    // Working is a surface some target's inputs got into, as coverage shows; loaded counts the targets kept and running.
    coverage: allLines.size, harnesses: { written, working: Object.values(summary).filter((x) => x.entriesReached.length).length, loaded }, findings: distinct, firstInputSeconds: firstInput,
    unfuzzed: Object.fromEntries(all.filter((t) => !states[t].execs).map((t) => [surfaces[t].id, blocked.has(t) ? `environment: ${blocked.get(t)}` : broken[t][0]?.error.split('\n')[0].slice(0, 300) ?? 'no target built'])),
    weaknesses: Object.fromEntries([...byName].map(([name, ws]) => [name, ws.map((w) => w.id)])),
    surfaces: summary,
  };
}
