/** Typed questions over a state, answered with probabilities: a noul (is this statement true), a choice, or a score on levels. */
export type NoulQuestion = { type: 'noul'; instructions: unknown; criteria?: { true: string; false: string } };
export type ChoiceQuestion = { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> };
/** A position on a rubric: `criteria` are the levels, low to high (two to ten); the answer's `score` runs from 0 to the top level. */
export type ScoreQuestion = { type: 'score'; instructions: unknown; criteria: string[] };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface Answer {
  type: string;
  /** Probability the statement is true, for a noul. */
  noul?: number;
  /** The picked option and the distribution over options, for a choice. */
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  /** The position on the levels, for a score: each level number times its probability, summed. */
  score?: number;
  legend?: Record<string, string>;
}

export const noul = (instructions: unknown, criteria?: { true: string; false: string }): NoulQuestion =>
  criteria ? { type: 'noul', instructions, criteria } : { type: 'noul', instructions };
export const choice = (instructions: unknown, criteria: Record<string, unknown>): ChoiceQuestion => ({ type: 'choice', instructions, criteria });
export const score = (instructions: unknown, criteria: string[]): ScoreQuestion => ({ type: 'score', instructions, criteria });

/**
 * A score question asked as a choice over its levels, which gives the answer as a distribution over the levels. `scoreOf`
 * reads it, scaled to 0..1 so scores with different numbers of levels compare (divide by the number of levels less one).
 */
export const scoreFor = (_judge: { id: string }, instructions: unknown, levels: string[]): Question =>
  choice(instructions, Object.fromEntries(levels.map((l, i) => [String(i), l])));
export function scoreOf(a: Answer | undefined, levels: number): number | undefined {
  if (!a) return undefined;
  if (typeof a.score === 'number') return Math.max(0, Math.min(1, a.score / (levels - 1)));
  if (a.probabilities) return Math.max(0, Math.min(1, Object.entries(a.probabilities).reduce((n, [k, p]) => n + Number(k) * p, 0) / (levels - 1)));
  return undefined;
}

/** Characters of JSON per request, about a quarter of the model's token limit in English and code. */
export const MAX_BODY_CHARS = 60_000;
