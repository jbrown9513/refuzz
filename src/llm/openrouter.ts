/**
 * The writer through OpenRouter's chat completions, for models other hosts serve, free ones included (`<model>:free`). The
 * prompt is the one src/openai.ts sends, fields answered as sections; OpenRouter's free models cost nothing and are limited
 * by requests a minute and a day instead.
 *
 * Cost, as on the OpenAI path:
 *   caching   the shared part (the fields and the guide every request of a kind repeats) is the first part of the message and
 *             the context after it, so providers that cache prefixes (DeepSeek's hosts, at a tenth or less of the input price)
 *             read it from cache. The providers are named in order, cheapest for what these requests are first: mostly
 *             input that a cache serves, then output. Left to OpenRouter's routing, requests move between providers or stick
 *             to one that does not cache, and almost never hit a cache.
 *   flex      a request nothing waits on asks for `service_tier: "flex"`: a slower endpoint at about half price where the
 *             model has one, the standard one otherwise. OpenRouter bills the tier that served it.
 */
import type { Ledger } from './ledger.ts';
import { fieldList, post, sections, type Writer } from './writer.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * The model's providers, cheapest first for a writer's request: about nine tenths of the input read from cache once a kind of
 * request has been sent, and a tenth as many tokens out as in. Providers without a cache price are left to the fallback.
 */
async function providersFor(model: string): Promise<string[]> {
  try {
    const r = await fetch(`https://openrouter.ai/api/v1/models/${model.replace(/:free$/, '')}/endpoints`, { signal: AbortSignal.timeout(30_000) });
    const endpoints: { tag?: string; pricing: Record<string, string> }[] = (await r.json()).data?.endpoints ?? [];
    const cost = (p: Record<string, string>) => 0.9 * Number(p.input_cache_read) + 0.1 * Number(p.prompt) + 0.1 * Number(p.completion);
    const ranked = endpoints.filter((e) => e.tag && Number(e.pricing.input_cache_read) > 0).sort((a, b) => cost(a.pricing) - cost(b.pricing));
    return [...new Set(ranked.map((e) => e.tag!.split('/')[0]))];
  } catch {
    return [];
  }
}

export class OpenRouterWriter implements Writer {
  readonly apiKey: string;
  readonly ledger: Ledger;
  readonly model: string;
  private order?: Promise<string[]>;

  constructor(apiKey: string, ledger: Ledger, model: string) {
    this.apiKey = apiKey;
    this.ledger = ledger;
    this.model = model;
  }

  async generate(context: string, fields: Record<string, string>, purpose: string, _cacheKey?: string, stable?: string, background = false): Promise<Record<string, string>> {
    const order = await (this.order ??= providersFor(this.model));
    const body = {
      model: this.model,
      ...(background ? { service_tier: 'flex' } : {}),
      ...(order.length ? { provider: { order, allow_fallbacks: true } } : {}),
      usage: { include: true },
      messages: [
        { role: 'system', content: `Answer every field below, in the order given, each as its own section: a line \`### <field name>\` and then that field's content and nothing else. Code is real, compilable code against the API shown, written as plain code with no markdown fence. Write nothing before the first section or after the last. The sections, in order: ${Object.keys(fields).join(', ')}.` },
        { role: 'user', content: [
          { type: 'text', text: `FIELDS TO ANSWER (after reading everything below them):\n${fieldList(fields)}${stable ? `\n\n${stable}` : ''}` },
          { type: 'text', text: context },
        ] },
      ],
    };
    const started = performance.now();
    let response: any;
    // OpenRouter reports an overloaded or rate-limited upstream inside a 200 answer: waited out as post() waits out a 429 or
    // a 5xx, until it has gone on for ten minutes. Free models are often overloaded.
    for (let attempt = 0, since = Date.now(); ; attempt++) {
      response = await post(ENDPOINT, this.apiKey, body, 'OpenRouter');
      const code = Number(response.error?.code);
      if (!response.error) break;
      if (![429, 502, 503, 504].includes(code) || Date.now() - since > 600_000) throw new Error(`OpenRouter: ${JSON.stringify(response.error).slice(0, 400)}`);
      await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt) * (0.5 + Math.random())));
    }
    const usage = response.usage ?? {};
    this.ledger.record({ provider: 'openrouter', model: response.model ?? this.model, purpose, ms: performance.now() - started, inputTokens: usage.prompt_tokens ?? 0, cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0, thinkingTokens: usage.completion_tokens ?? 0, usd: Number(usage.cost ?? 0) });
    const text = response.choices?.[0]?.message?.content ?? '';
    if (process.env.REFUZZ_DEBUG) console.error(`  [debug] writer ${purpose}: ${Math.round((performance.now() - started) / 1000)}s, ${usage.prompt_tokens ?? '?'} tokens in (${usage.prompt_tokens_details?.cached_tokens ?? 0} cached), ${usage.completion_tokens ?? '?'} out, ${response.provider ?? ''}${background ? ' flex' : ''}, ${(Number(usage.cost ?? 0) * 100).toFixed(3)}¢, ${response.choices?.[0]?.finish_reason ?? ''}`);
    return sections(text, fields);
  }
}
