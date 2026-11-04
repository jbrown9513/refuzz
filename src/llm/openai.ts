/**
 * The writer: a model behind an OpenAI-style Responses API (OpenAI's gpt-6-luna, or Meta's Muse models at api.meta.ai, which
 * take the same requests), every field answered in one call as plain-text sections, one per field in order, so code comes back
 * as code: no JSON escaping, no schema limits on what a field holds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Ledger } from './ledger.ts';
import { fieldList, NoSpareCapacity, post, sections, type Writer } from './writer.ts';

/** Where each provider serves the Responses API, and whether it has OpenAI's cheaper flex tier for background requests. */
const PROVIDERS = {
  openai: { endpoint: 'https://api.openai.com/v1/responses', flex: true, name: 'OpenAI' },
  meta: { endpoint: 'https://api.meta.ai/v1/responses', flex: false, name: 'Meta' },
} as const;
export type ResponsesProvider = keyof typeof PROVIDERS;

/**
 * Dollars per million tokens, standard tier, short context: OpenAI's from developers.openai.com/api/docs/pricing (2026-10-10),
 * Meta's from its Model API pricing (2026-10-27). The API returns token counts, not a cost, so each call is priced here. A
 * model missing from the list is costed at zero.
 */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-6-luna': { input: 0.10, cached: 0.01, output: 0.50 },
  'muse-wonder-1.0': { input: 4.00, cached: 0.20, output: 20.00 },
  'muse-spark-1.3': { input: 1.25, cached: 0.15, output: 4.25 },
  // The same model, discounted for letting Meta train on the prompts and answers.
  'muse-spark-1.3-contributor': { input: 0.10, cached: 0.002, output: 0.20 },
  'muse-spark-1.1': { input: 1.25, cached: 0.15, output: 4.25 },
};

/** A response's cost from its usage: cached input at the cached rate, the rest of the input and all output at theirs. */
export function costOf(model: string, usage: any): number {
  const price = PRICES[model] ?? PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!price || !usage) return 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return ((usage.input_tokens - cached) * price.input + cached * price.cached + usage.output_tokens * price.output) / 1e6;
}

/** The flex tier's price against the standard one: OpenAI prices flex at its Batch rates, half the standard. */
const FLEX = 0.5;

/**
 * Writer requests in flight at once, per tier, set by the account's rate limit instead of a fixed number: none until OpenAI
 * answers 429, then half of what was in flight, and one more with each request that completes. Background (flex) requests
 * have their own: one waited on is never queued behind slow ones nobody waits for.
 */
function pool() {
  let limit = Infinity, inFlight = 0;
  const waiting: (() => void)[] = [];
  return {
    async slot<T>(work: () => Promise<T>): Promise<T> {
      if (inFlight >= limit) await new Promise<void>((r) => waiting.push(r)); else inFlight++;
      try {
        const out = await work();
        if (Number.isFinite(limit)) limit++;
        return out;
      } finally {
        inFlight--;
        while (inFlight < limit && waiting.length) { inFlight++; waiting.shift()!(); }
      }
    },
    throttled: () => { limit = Math.max(1, Math.floor(inFlight / 2)); },
  };
}
const pools = { openai: { standard: pool(), flex: pool() }, meta: { standard: pool(), flex: pool() } };

export class OpenAIWriter implements Writer {
  readonly apiKey: string;
  readonly ledger: Ledger;
  readonly model: string;
  readonly provider: ResponsesProvider;

  constructor(apiKey: string, ledger: Ledger, model: string, provider: ResponsesProvider = 'openai') {
    this.apiKey = apiKey;
    this.ledger = ledger;
    this.model = model;
    this.provider = provider;
  }

  /**
   * The fields and `stable` (the guides every request of a kind shares) come first, in one block marked as a cache
   * breakpoint, and `context` after it. These models cache only at breakpoints: with none marked, the breakpoint is the end
   * of the whole prompt, so a request differing anywhere (every surface's own code does) never reads the cache. `cacheKey`
   * routes requests sharing the block to where it is cached.
   */
  async generate(context: string, fields: Record<string, string>, purpose: string, cacheKey?: string, stable?: string, background = false): Promise<Record<string, string>> {
    const body: Record<string, unknown> = {
      model: this.model,
      // A request nothing waits on is served at the flex tier, where there is one: Batch prices, slower.
      ...(background && PROVIDERS[this.provider].flex ? { service_tier: 'flex' } : {}),
      ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
      input: [
        { role: 'system', content: `Answer every field below, in the order given, each as its own section: a line \`### <field name>\` and then that field's content and nothing else. Code is real, compilable code against the API shown, written as plain code with no markdown fence. Write nothing before the first section or after the last. The sections, in order: ${Object.keys(fields).join(', ')}.` },
        { role: 'user', content: [
          { type: 'input_text', text: `FIELDS TO ANSWER (after reading everything below them):\n${fieldList(fields)}${stable ? `\n\n${stable}` : ''}`, prompt_cache_breakpoint: { mode: 'explicit' } },
          { type: 'input_text', text: context },
        ] },
      ],
    };
    let started = performance.now();
    const { endpoint, name } = PROVIDERS[this.provider], own = pools[this.provider];
    const tier = body.service_tier === 'flex' ? own.flex : own.standard;
    const response = await tier.slot(async () => {
      started = performance.now();
      try { return await post(endpoint, this.apiKey, body, name, tier.throttled); }
      // No spare capacity for flex: OpenAI's guidance is to send it again at the standard tier.
      catch (error) { if (!(error instanceof NoSpareCapacity)) throw error; delete body.service_tier; return post(endpoint, this.apiKey, body, name, own.standard.throttled); }
    });
    const model = response.model ?? this.model;
    this.ledger.record({ provider: this.provider, model, purpose, ms: performance.now() - started, inputTokens: response.usage?.input_tokens ?? 0, cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0, thinkingTokens: response.usage?.output_tokens ?? 0, usd: costOf(model, response.usage) * (response.service_tier === 'flex' ? FLEX : 1) });
    const text = response.output_text ?? (response.output ?? []).flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('');
    if (process.env.REFUZZ_DEBUG) console.error(`  [debug] writer ${purpose}: ${Math.round((performance.now() - started) / 1000)}s, ${response.usage?.input_tokens ?? '?'} tokens in, ${response.usage?.output_tokens ?? '?'} out (${response.usage?.output_tokens_details?.reasoning_tokens ?? 0} reasoning), ${response.status}${response.incomplete_details ? ` ${JSON.stringify(response.incomplete_details)}` : ''}`);
    const out = sections(text, fields);
    if (process.env.REFUZZ_DEBUG && Object.values(out).some((v) => !v)) {
      mkdirSync(resolve('.fuzz', 'rejects'), { recursive: true });
      writeFileSync(resolve('.fuzz', 'rejects', `writer-${purpose}-${Date.now()}.txt`), `${response.status ?? ''} ${JSON.stringify(response.incomplete_details ?? null)}\n${text}`);
    }
    return out;
  }
}
