/**
 * The two models of a `refuzz` run. The fuzzing model does the bulk work, thousands of calls a session: build specs,
 * surfaces and their scores, harnesses, grammars, property checks. The verifying model does the few calls that decide what
 * is reported: the reproducer tests, the test from an entry point, whether a failure is a bug, and grouping by cause. Each is
 * an OpenAI model by name (default gpt-6-luna), `meta:<model>` for a Muse model on Meta's Model API (MODEL_API_KEY), or
 * `openrouter:<model>` for one OpenRouter serves. `--model` or REFUZZ_MODEL picks the verifying model; `--fuzz-model` or
 * REFUZZ_FUZZ_MODEL the fuzzing one, the same as `--model` when unset. Every entry point (the CLI, the SWT-bench runner,
 * re-judging, re-verifying) takes them from here.
 */
import { requireKey } from './llm/env.ts';
import type { Ledger } from './llm/ledger.ts';
import type { DecisionModel } from './llm/models.ts';
import { OpenAIWriter } from './llm/openai.ts';
import { OpenRouterWriter } from './llm/openrouter.ts';
import type { Answer, Question } from './llm/questions.ts';
import type { Writer } from './llm/writer.ts';

const flag = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
export const MODEL = flag('--model') ?? process.env.REFUZZ_MODEL ?? 'gpt-6-luna';
export const FUZZ_MODEL = flag('--fuzz-model') ?? process.env.REFUZZ_FUZZ_MODEL ?? MODEL;

export const writerModel = (ledger: Ledger, model = MODEL): Writer => {
  const [, provider, name] = /^(openrouter|meta):(.+)$/.exec(model) ?? [];
  if (provider === 'openrouter') return new OpenRouterWriter(requireKey('OPENROUTER_API_KEY'), ledger, name);
  if (provider === 'meta') return new OpenAIWriter(requireKey('MODEL_API_KEY'), ledger, name, 'meta');
  return new OpenAIWriter(requireKey('OPENAI_API_KEY'), ledger, model);
};

const text = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x, null, 1));

/**
 * Typed questions over a state, answered by the run's model: each question one field of a single request. A choice is answered
 * as a probability per option (the fuzzer weighs harness kinds by them), a noul as the probability its statement is true, a
 * score as a position on its levels.
 */
export class ModelJudge implements DecisionModel {
  constructor(private readonly writer: Writer) {}

  get id() {
    return this.writer.model;
  }

  async ask(state: unknown, questions: Record<string, Question>, purpose: string): Promise<Record<string, Answer>> {
    const fields: Record<string, string> = {};
    for (const [name, q] of Object.entries(questions)) {
      if (q.type === 'choice') {
        fields[name] = `${text(q.instructions)}\nOptions:\n${Object.entries(q.criteria).map(([k, v]) => `- ${k}: ${text(v)}`).join('\n')}\nAnswer with a JSON object giving each option's probability, the probabilities summing to 1, e.g. {"${Object.keys(q.criteria)[0]}": 0.9, ...}.`;
      } else if (q.type === 'noul') {
        fields[name] = `${text(q.instructions)}${q.criteria ? `\nTrue: ${q.criteria.true}\nFalse: ${q.criteria.false}` : ''}\nAnswer with one number from 0 to 1: the probability the statement is true.`;
      } else {
        fields[name] = `${text(q.instructions)}\nLevels, low to high:\n${q.criteria.map((c, i) => `${i}: ${c}`).join('\n')}\nAnswer with one number from 0 to ${q.criteria.length - 1}: the level that fits.`;
      }
    }
    const got = await this.writer.generate(`Answer each question about this state. Judge only from what it shows.\n--- the state\n${text(state)}`, fields, purpose);
    const out: Record<string, Answer> = {};
    for (const [name, q] of Object.entries(questions)) {
      const raw = (got[name] ?? '').trim();
      const num = Number(/-?\d+(?:\.\d+)?/.exec(raw)?.[0]);
      if (q.type === 'choice') {
        const keys = Object.keys(q.criteria);
        let probabilities: Record<string, number> = {};
        try {
          const parsed = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '{}') as Record<string, unknown>;
          for (const k of keys) probabilities[k] = Math.max(0, Number(parsed[k]) || 0);
        } catch {}
        const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
        if (sum > 0) probabilities = Object.fromEntries(keys.map((k) => [k, probabilities[k] / sum]));
        else {
          // An answer naming one option, not a distribution.
          const named = keys.find((k) => new RegExp(`\\b${k.replace(/\W/g, '\\$&')}\\b`).test(raw));
          probabilities = Object.fromEntries(keys.map((k) => [k, k === named ? 1 : 0]));
        }
        const best = keys.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a), keys[0]);
        out[name] = { type: 'choice', choice: probabilities[best] > 0 ? best : undefined, probabilities, confidence: probabilities[best] };
      } else if (q.type === 'noul') {
        out[name] = { type: 'noul', noul: Number.isFinite(num) ? Math.min(1, Math.max(0, num)) : /\b(yes|true)\b/i.test(raw) ? 1 : 0 };
      } else {
        out[name] = { type: 'score', score: Number.isFinite(num) ? Math.min(q.criteria.length - 1, Math.max(0, num)) : 0 };
      }
    }
    return out;
  }
}

export const judgeModel = (ledger: Ledger, _root?: string): DecisionModel => new ModelJudge(writerModel(ledger));

/** The fuzzing model as `judge` and `text`, and the verifying model as `verify`. */
export const fuzzModels = (ledger: Ledger, _root?: string) => {
  const text = writerModel(ledger, FUZZ_MODEL), strong = writerModel(ledger, MODEL);
  return { judge: new ModelJudge(text), text, verify: { judge: new ModelJudge(strong), text: strong } };
};
