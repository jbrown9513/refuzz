/** The one interface every decision goes through, so the model behind the driver, the judge and the rules is a flag. */
import type { Answer, Question } from './questions.ts';

export type { Answer, Question };

export interface DecisionModel {
  id: string;
  /** Answers every question over one state in one request: `choice` as a distribution over options, `noul` as a probability. */
  ask(state: unknown, questions: Record<string, Question>, purpose: string): Promise<Record<string, Answer>>;
}

export interface TextModel {
  id: string;
  /** Writes one short string from a context and an instruction: a value to type, a key chord, a text to scroll to. */
  write(context: string, instructions: string, purpose: string): Promise<string>;
}
