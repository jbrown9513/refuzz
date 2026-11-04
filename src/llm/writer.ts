/**
 * A model that writes text and code: grammars, harnesses and property checks for `refuzz`. Every field is a string, asked
 * in one call under a strict JSON schema, answered in the order given, so a plan field can come before the code it plans.
 */
export interface Writer {
  readonly model: string;
  /**
   * `stable`: the start every request of this kind shares, which the provider caches; `context` is what follows it.
   * `cacheKey` groups requests that share `stable`, so they are routed to where it is cached. `background`: nothing waits on
   * the answer (fuzzing goes on meanwhile), so it may be served more slowly at a lower price.
   */
  generate(context: string, fields: Record<string, string>, purpose: string, cacheKey?: string, stable?: string, background?: boolean): Promise<Record<string, string>>;
}

/** A request the model refused for its length: the caller can send less context and try again. */
export const tooLong = (error: unknown) => /context|too long|maximum.*tokens|token limit|length/i.test(String((error as Error)?.message ?? error));

/**
 * The answer as sections, one per field in the order asked: a line `### <field>`, then the field's text as written, code as
 * plain code. A section wrapped whole in a markdown fence is unwrapped. A field with no section is an empty answer.
 */
export function sections(text: string, fields: Record<string, string>): Record<string, string> {
  const names = Object.keys(fields);
  const found: Record<string, string> = {};
  // A heading run onto the end of the line before it (`…the end.### grammar`) goes on its own line.
  const esc = names.map((n) => n.replace(/[^\w]/g, '\\$&')).join('|');
  text = text.replace(new RegExp(`[ \\t]*(#{2,4}[ \\t]*\`?(?:${esc})\`?[ \\t]*:?[ \\t]*)$`, 'gim'), '\n$1');
  // A heading line naming a field: `### grammar`, `## Grammar:`, `**grammar**`, in any case.
  const heads = [...text.matchAll(/^(?:#{1,4}\s*|\*\*)`?([\w-]+)`?\s*:?\s*(?:\*\*)?\s*:?\s*$/gm)]
    .flatMap((m) => { const name = names.find((n) => n.toLowerCase() === m[1].toLowerCase()); return name ? [{ m, name }] : []; });
  heads.forEach(({ m, name }, i) => {
    const body = text.slice(m.index! + m[0].length, i + 1 < heads.length ? heads[i + 1].m.index : undefined).trim();
    // A model sometimes restates the field's instructions before answering: that paragraph is not the answer.
    const said = fields[name].trim();
    let answer = said.length >= 40 && body.includes(said) ? body.replace(said, '').trim() : body;
    if (said.length >= 40 && answer.startsWith(said.slice(0, 40))) answer = answer.slice(answer.search(/\n\s*\n|$/)).trim();
    found[name] = answer.replace(/^```[\w+-]*\n([\s\S]*?)\n```$/, '$1').trim();
  });
  return Object.fromEntries(names.map((k) => [k, found[k] ?? '']));
}

/** The strict JSON schema for string fields, each described by its instructions. */
export const schemaOf = (fields: Record<string, string>) => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(fields).map(([k, instructions]) => [k, { type: 'string', description: instructions }])),
  required: Object.keys(fields),
  additionalProperties: false,
});

/** What each field asks for, after the context: the schema carries it too, but not every host shows it to the model. */
export const fieldList = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n\n');

/** The answer's string fields; anything that did not parse is an empty answer, which the caller treats as nothing written. */
export function answers(text: string, fields: Record<string, string>): Record<string, string> {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch {}
  return Object.fromEntries(Object.keys(fields).map((k) => [k, typeof parsed[k] === 'string' ? (parsed[k] as string) : '']));
}

/**
 * POST with retries: a dropped connection a few times; a rate limit (429) for as long as it takes, waiting what the host asks
 * or backing off, since that is the host setting the pace, not a reason to lose the target; server errors until they have
 * gone on for ten minutes, a host that is down.
 */
/** A request for spare capacity (OpenAI's flex tier) that found none: send it again at the standard tier. Not charged. */
export class NoSpareCapacity extends Error {}

export async function post(url: string, apiKey: string, body: unknown, host: string, onRateLimit?: () => void): Promise<any> {
  let failingSince = 0;
  const flex = (body as { service_tier?: string }).service_tier === 'flex';
  for (let attempt = 0, dropped = 0; ; attempt++) {
    let response: Response;
    try {
      // Flex is served more slowly; OpenAI's guidance is a 15 minute timeout for it. A log cut mid-emoji leaves half a surrogate
      // pair, which Meta's API refuses as bad JSON, so strings are made well formed first.
      response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body, (_, v) => (typeof v === 'string' ? v.toWellFormed() : v)), signal: AbortSignal.timeout(flex ? 900_000 : 600_000) });
    } catch (error) {
      if (++dropped > 3) throw error;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** dropped));
      continue;
    }
    if (response.status >= 500) {
      failingSince ||= Date.now();
      if (Date.now() - failingSince > 600_000) throw new Error(`${host} HTTP ${response.status} for ten minutes: ${(await response.text()).slice(0, 400)}`);
    }
    if (response.status === 429 || response.status >= 500) {
      // An account out of credit answers 429 too, and no wait ends that: it fails now instead of holding the run forever.
      const text = response.status === 429 ? await response.clone().text() : '';
      // A free model's daily request limit (OpenRouter's free-models-per-day) does not lift by waiting either.
      if (/insufficient_quota|credit_balance_exhausted|billing_hard_limit|free-models-per-day/.test(text)) throw new Error(`${host} HTTP 429, the account has no credit left: ${text.slice(0, 300)}`);
      if (flex && response.status === 429) throw new NoSpareCapacity(`${host} has no spare capacity for a flex request`);
      if (response.status === 429) onRateLimit?.();
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, (retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 1000 * 2 ** attempt)) * (0.5 + Math.random())));
      continue;
    }
    if (!response.ok) throw new Error(`${host} HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
    return response.json();
  }
}
