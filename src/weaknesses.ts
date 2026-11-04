/**
 * Weakness classes, read from src/weaknesses.json when it exists: what kind of function each lives in and the invariant a
 * correct function keeps. The judge picks the classes a target is exposed to; the writer checks their invariants in the target's
 * use cases; the judge attributes each finding to one or to none, and findings with a class rank above robustness noise.
 *
 * src/weaknesses.json is a list of { id, name, where, invariant, oracle, languages?, static? }:
 *   id         a CWE id, `CWE-22`
 *   where      the kind of function it lives in, for the judge to match targets against
 *   invariant  what a correct function keeps for every input it accepts, as the writer's property checks state it
 *   oracle     how a run shows a break: `property` (a check on the result), `crash` or `hang` (the shared oracle)
 *   languages  the languages it occurs in, when not every language
 *   static     found by reading code, not running it: never selected
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DecisionModel } from './llm/models.ts';
import { noul } from './llm/questions.ts';
import type { Runtime, Target } from './types.ts';

export interface Weakness {
  id: string;
  name: string;
  where: string;
  invariant: string;
  oracle: 'property' | 'crash' | 'hang';
  languages?: string[];
  static?: boolean;
  /** Input shapes that break this class's invariant, the class's standard review checklist, fed to the attack-case writer. */
  attacks?: string[];
}

export const WEAKNESSES_FILE = resolve(import.meta.dirname, 'weaknesses.json');

/** The catalog, or none when the file is missing. A malformed entry is an error, not a silent skip. */
export function loadWeaknesses(path = WEAKNESSES_FILE): Weakness[] | undefined {
  if (!existsSync(path)) return undefined;
  const list = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(list)) throw new Error(`${path}: expected a list of weakness classes`);
  for (const w of list) {
    for (const k of ['id', 'name', 'where', 'invariant', 'oracle'] as const) if (typeof w?.[k] !== 'string' || !w[k]) throw new Error(`${path}: an entry has no ${k}: ${JSON.stringify(w).slice(0, 200)}`);
    if (!['property', 'crash', 'hang'].includes(w.oracle)) throw new Error(`${path}: ${w.id} has oracle ${w.oracle}`);
  }
  return list;
}

/**
 * The judge's part: for each target, which classes it is exposed to, read from its header, documentation and source. One request
 * per target, the target as the state and a question per class. Every class it scores at or above a half is kept: a cap
 * here dropped the class the bug actually was (a comparison that does not mean what it says, kept out by a limit of four).
 */
/** A class's question is named by the class, not its place in the catalog, so the answer Perch Cloud keeps for it is found again. */
const qid = (w: Weakness) => w.id.replace(/\W/g, '_');

export async function exposure(targets: Target[], rt: Runtime, all: Weakness[], judge: DecisionModel, source: (t: Target) => string, describe: (t: Target) => string): Promise<Map<string, Weakness[]>> {
  const usable = all.filter((w) => !w.static && (!w.languages || w.languages.includes(rt.language)));
  const out = new Map<string, Weakness[]>();
  if (!usable.length) return out;
  await Promise.all(targets.map(async (t) => {
    const questions = Object.fromEntries(usable.map((w) => [qid(w), noul({ question: 'Is this function the kind of code this weakness class lives in, so that a wrong answer, output or cost from it on some input would be an instance of the class?', weakness: `${w.id} ${w.name}`, lives_in: w.where, invariant: w.invariant }, {
      true: 'The function does what the class describes (or hands its input straight to code that does), so its inputs can break the invariant.',
      false: 'The function does nothing the class describes; its inputs cannot reach that kind of code.',
    })]));
    const answers = await judge.ask({ language: rt.language, function: describe(t), source: source(t).slice(0, 20_000) }, questions, 'fuzz-weaknesses');
    const picked = usable.map((w) => ({ w, p: answers[qid(w)]?.noul ?? 0 })).filter((x) => x.p >= 0.5).sort((a, b) => b.p - a.p).map((x) => x.w);
    if (picked.length) out.set(t.qualifiedName, picked);
  }));
  return out;
}

/** The weakness a property check is named for: `check_cwe22_…` → CWE-22. */
export const cweOfCheck = (name: string) => {
  const m = /cwe[_-]?(\d+)/i.exec(name);
  return m ? `CWE-${m[1]}` : undefined;
};

/**
 * The invariants to include when asking the writer for attack cases: from the target's exposed classes, the ones a vetted
 * check is named for (its CWE id, cweOfCheck), or all of them when no check name carries one. Empty when there is no
 * catalog (no weaknesses.json, so nothing populated `exposed`): the attack step adds this to its prompt only when it is
 * non-empty, so it never depends on the catalog existing.
 */
export function invariantsForChecks(checkNames: Iterable<string>, exposed: Weakness[] | undefined): Weakness[] {
  if (!exposed?.length) return [];
  const cwes = new Set([...checkNames].map(cweOfCheck).filter((x): x is string => !!x));
  const named = exposed.filter((w) => cwes.has(w.id));
  return named.length ? named : exposed;
}
