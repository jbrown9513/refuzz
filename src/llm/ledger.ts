/** Every model call, with its tokens, latency and cost, so a run can say what the judgment layer cost. */

export type Provider = 'jev' | 'typellm' | 'openai' | 'meta' | 'decisions' | 'openrouter';

/** List prices as published: the judge input $0.042 per million, output free; TypeLLM input $0.05 and thinking $0.50 per million, answers free. */
export const RATES: Record<Provider, { inputPerM: number; thinkingPerM: number }> = {
  jev: { inputPerM: 0.042, thinkingPerM: 0 },
  typellm: { inputPerM: 0.05, thinkingPerM: 0.5 },
  // The fuzz writer, gpt-6-luna: priced per call in src/openai.ts from OpenAI's published rates.
  openai: { inputPerM: 0, thinkingPerM: 0 },
  // A Muse model on Meta's Model API (`--model meta:<model>`): priced per call in src/openai.ts from Meta's published rates.
  meta: { inputPerM: 0, thinkingPerM: 0 },
  // The OpenAI Decisions API as the judge (`--judge decisions`): priced per call in src/decisions.ts, $0.10 per million input.
  decisions: { inputPerM: 0, thinkingPerM: 0 },
  // A writer through OpenRouter: priced per call from the cost OpenRouter reports, nothing for a free model.
  openrouter: { inputPerM: 0, thinkingPerM: 0 },
};

export interface Call {
  provider: Provider;
  model: string;
  purpose: string;
  ms: number;
  inputTokens: number;
  /** Of the input, tokens the provider served from its prompt cache, billed at the cached rate. */
  cachedTokens?: number;
  thinkingTokens: number;
  usd: number;
}

export class Ledger {
  calls: Call[] = [];

  /** A call's cost: `usd` when the caller priced it (a model with its own price list), the provider's rates otherwise. */
  record(call: Omit<Call, 'usd'> & { usd?: number }): Call {
    const rate = RATES[call.provider];
    const usd = call.usd ?? (call.inputTokens * rate.inputPerM + call.thinkingTokens * rate.thinkingPerM) / 1e6;
    const full = { ...call, usd };
    this.calls.push(full);
    return full;
  }

  /** Totals since `from` (an index into calls), so a step can report only its own calls. */
  summary(from = 0) {
    const calls = this.calls.slice(from);
    const by: Record<string, { calls: number; ms: number; inputTokens: number; cachedTokens: number; thinkingTokens: number; usd: number }> = {};
    for (const call of calls) {
      const row = (by[call.provider] ??= { calls: 0, ms: 0, inputTokens: 0, cachedTokens: 0, thinkingTokens: 0, usd: 0 });
      row.calls++;
      row.ms += call.ms;
      row.inputTokens += call.inputTokens;
      row.cachedTokens += call.cachedTokens ?? 0;
      row.thinkingTokens += call.thinkingTokens;
      row.usd += call.usd;
    }
    const total = calls.reduce((sum, c) => sum + c.usd, 0);
    const ms = calls.reduce((sum, c) => sum + c.ms, 0);
    return { calls: calls.length, ms, usd: total, cents: total * 100, by };
  }
}
