/**
 * A fuzzing session: one run of `refuzz` against a time limit (`--minutes`) and a limit on what its model calls cost
 * (`--cents`), picking up where the last one stopped. It can be stopped at any moment and started again with the same
 * command. Prices and margins are the cloud's business; the fuzzer keeps to the two limits it is given.
 *
 *   money     verification first: writing spends only what is left after the money verifying the failures is measured to
 *             need (Budget). Fuzzing costs no model calls and goes on when the money is spent.
 *   order     each batch of surfaces is picked by what a minute of fuzzing is most likely to find: code that changed since
 *             it was last fuzzed; then surfaces never fuzzed; then surfaces still
 *             gaining coverage, by lines gained a minute; then plateaued ones, least recently fuzzed first.
 *   rounds    a surface's round length, plateau count and rounds so far are kept with its coverage (src/store.ts), so the
 *             next session continues its improvement loop instead of starting it again. Changed code starts it again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Ledger } from './llm/ledger.ts';
import type { DecisionModel } from './llm/models.ts';
import type { Writer } from './llm/writer.ts';

/** A model call refused because the session's money is spent. */
export class OutOfBudget extends Error {}

/**
 * Model calls admitted against a limit with the calls still in flight counted: a call's cost reaches the ledger only when it
 * is answered, so calls sent together would all pass a check of the ledger alone. Each call in flight counts at the cost of
 * the dearest call answered so far (a writer's call costs many judge calls, so an average lets writer calls through); before
 * any is answered nothing is known of the cost, and calls go one at a time. A call
 * that would pass the limit waits for one in flight to be answered and is checked again; one refused is refused because the
 * answered calls alone have reached it.
 */
export class Spender {
  /** Calls in flight, by kind (a writer's and a judge's cost differ a hundredfold). */
  private inFlight = new Map<string, number>();
  private waiting: (() => void)[] = [];
  private readonly ledger: Ledger;
  private readonly from: number;

  constructor(ledger: Ledger) {
    this.ledger = ledger;
    this.from = ledger.calls.length;
  }

  spent(): number { return this.ledger.summary(this.from).cents; }
  /** What the calls of one kind (their purpose starting with `prefix`) have cost so far, in cents. */
  spentOn(prefix: string): number { return this.ledger.calls.slice(this.from).filter((c) => c.purpose.startsWith(prefix)).reduce((n, c) => n + c.usd * 100, 0); }
  /** The dearest call answered so far, in cents: of one provider's calls, or of all. */
  dearest(provider?: string): number { return Math.max(0, ...this.ledger.calls.slice(this.from).filter((c) => !provider || c.provider === provider).map((c) => c.usd * 100)); }

  /**
   * Sends `call`, a call to `provider`, once the spending with it counted stays under `limit` cents, or refuses it with
   * `refuse`. Each provider's calls in flight count at the dearest of its calls answered; a provider none of whose calls has
   * been answered has one call in flight at a time.
   */
  async run<T>(provider: string, limit: () => number, refuse: () => Error, call: () => Promise<T>): Promise<T> {
    for (;;) {
      if (this.spent() >= limit()) throw refuse();
      const answered = this.ledger.calls.slice(this.from);
      const known = answered.some((c) => c.provider === provider);
      const pending = [...this.inFlight].reduce((n, [k, m]) => n + m * this.dearest(k), 0);
      const mine = this.inFlight.get(provider) ?? 0;
      const fits = known ? this.spent() + pending + this.dearest(provider) < limit() : mine === 0;
      if (fits) break;
      // With nothing in flight, nothing will be answered to change the count: a call that does not fit now never will.
      if (![...this.inFlight.values()].some((m) => m > 0)) throw refuse();
      await new Promise<void>((r) => this.waiting.push(r));
    }
    this.inFlight.set(provider, (this.inFlight.get(provider) ?? 0) + 1);
    try { return await call(); } finally { this.inFlight.set(provider, this.inFlight.get(provider)! - 1); this.waiting.splice(0).forEach((r) => r()); }
  }
}

/** The provider a model client's calls are recorded under in the ledger, from its class. */
export function providerOf(client: object): string {
  const name = client.constructor?.name ?? '';
  // The run's model judging (src/models.ts) is the same provider as its writing.
  if (name === 'ModelJudge') return providerOf((client as { writer: object }).writer);
  // One writer class serves more than one provider (OpenAI and Meta both take Responses API requests).
  if (typeof (client as { provider?: unknown }).provider === 'string') return (client as { provider: string }).provider;
  return ({ OpenAIWriter: 'openai', OpenRouterWriter: 'openrouter', Decisions: 'decisions', TypeLLM: 'typellm' } as Record<string, string>)[name] ?? name;
}

/**
 * What a session keeps between runs, in `.refuzz/session.json`: a line per session for the dashboard. Files written
 * when perch scan steered the fuzzer also have a `scanned` key, which is ignored and dropped on the next save.
 */
interface SessionFile {
  sessions: { at: string; stopped?: boolean; commit: string; minutes: number | null; limitCents: number | null; modelCents: number; covered: Record<string, number>; bugs: number }[];
}

/**
 * A session's two limits: `--minutes` and `--cents`, the most its model calls may cost. Verification comes first: writing
 * (targets, fixes, improvement moves, new surfaces) may spend only what is left after the reserve, the money verifying the
 * failures found and those still to come is measured to need (fuzzer.ts sets it). Verification and judging may spend to the
 * limit. Fuzzing costs no model calls, so a session whose money is spent goes on fuzzing with the targets it has.
 */
export class Budget {
  /** The most the session's model calls may cost, in cents; Infinity with no `--cents`. */
  readonly limit: number;
  readonly minutes: number | null;
  readonly spender: Spender;
  private reserve: () => number = () => 0;
  private recorded = false;
  private told = new Set<string>();
  private readonly state: SessionFile;
  private readonly file: string;
  private readonly log: (s: string) => void;

  constructor(file: string, ledger: Ledger, limit: number, minutes: number | null, log: (s: string) => void) {
    this.file = file;
    this.limit = limit;
    this.minutes = minutes;
    this.log = log;
    let saved: Partial<SessionFile> = {};
    try { saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; } catch {}
    this.state = { sessions: saved.sessions ?? [] };
    this.spender = new Spender(ledger);
    // A session stopped by a signal still leaves its line in the history.
    process.on('exit', () => { if (!this.recorded) this.record({ commit: '', covered: {}, bugs: 0, stopped: true }); });
  }

  spent(): number { return this.spender.spent(); }
  /** The money writing may spend to: the limit less what verifying is measured to need. */
  writeLimit(): number { return this.limit - this.reserve(); }
  canWrite(): boolean { return this.spent() < this.writeLimit(); }
  /** Set by the search: what verifying the failures found and still to come is measured to cost, in cents. */
  reserveFor(estimate: () => number) { this.reserve = estimate; }

  /** Says once that writing or verifying has stopped, and why. */
  refused(what: string): OutOfBudget {
    if (!this.told.has(what)) {
      this.told.add(what);
      this.log(`  budget: ${what} stopped: ${this.spent().toFixed(1)}¢ of ${this.limit}¢ spent${what === 'writing' ? `, ${this.reserve().toFixed(1)}¢ held for verifying what is found` : ''}; fuzzing goes on with the targets there are`);
    }
    return new OutOfBudget(`the session's --cents ${this.limit} is spent (${what})`);
  }

  /** The session's line in the history, written when it ends. */
  record(entry: { commit: string; covered: Record<string, number>; bugs: number; stopped?: boolean }) {
    this.recorded = true;
    this.state.sessions.push({ at: new Date().toISOString(), ...(entry.stopped ? { stopped: true } : {}), commit: entry.commit, minutes: this.minutes, limitCents: Number.isFinite(this.limit) ? this.limit : null, modelCents: Math.round(this.spent() * 100) / 100, covered: entry.covered, bugs: entry.bugs });
    this.state.sessions = this.state.sessions.slice(-365);
    this.save();
  }

  summary(): string {
    return `budget: ${this.spent().toFixed(1)}¢ spent on models${Number.isFinite(this.limit) ? ` of ${this.limit}¢` : ''}`;
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }
}

/** The writer, refusing once the session may no longer write. */
export function budgetedWriter(writer: Writer, budget: Budget): Writer {
  return new Proxy(writer, {
    get(target, key, receiver) {
      if (key !== 'generate') return Reflect.get(target, key, receiver);
      return (...args: Parameters<Writer['generate']>) => {
        // Verifying a finding is the deliverable: it may spend the reserve writing leaves.
        const verifying = args[2].startsWith('fuzz-verify');
        return budget.spender.run(providerOf(target), () => (verifying ? budget.limit : budget.writeLimit()), () => budget.refused(verifying ? 'verifying' : 'writing'), () => target.generate(...args));
      };
    },
  });
}

/** The judge, refusing once the session's money is spent. */
export function budgetedJudge(judge: DecisionModel, budget: Budget): DecisionModel {
  return new Proxy(judge, {
    get(target, key, receiver) {
      if (key !== 'ask') return Reflect.get(target, key, receiver);
      return (...args: Parameters<DecisionModel['ask']>) => budget.spender.run(providerOf(target), () => budget.limit, () => budget.refused('judging'), () => target.ask(...args));
    },
  });
}

/** What the scheduler knows of a surface from the store. */
export interface Standing {
  /** No coverage stored: never fuzzed. */
  fresh: boolean;
  /** Fuzzed before, and its code has changed since. */
  changed: boolean;
  plateaued: boolean;
  /** Surface lines gained a minute in its last session (undefined until a session measured it), and when that was. */
  rate?: number;
  lastAt: string;
  /** Has a stored target: it can be fuzzed without the writer. */
  targets: number;
  /**
   * What fuzzing it is worth, 0..1: the judge's score of how directly outside data reaches it and what a bug there does
   * (src/fuzzer.ts scoreSurfaces), or until the judge has scored it, the prior read from the code (surface.ts priorWorth).
   */
  worth: number;
}

/**
 * The order surfaces are fuzzed in this session: within a tier, by what fuzzing each is worth, where its input comes from
 * and what a bug there does, so a request handler or a decoder of outside bytes goes before an exported method only the
 * program's own code calls; then, among those still gaining, one no session has measured, then by lines gained a minute. A surface with no target needs the writer, so once writing has stopped only
 * surfaces with targets are left.
 */
export function rank(standings: Standing[], canWrite: boolean): number[] {
  const tier = (s: Standing) => (s.changed ? 0 : s.fresh ? 1 : !s.plateaued ? 2 : 3);
  // Two worths within a twentieth are the same band; the exact worth then decides between them.
  const band = (s: Standing) => Math.round(s.worth * 20);
  return standings
    .map((s, i) => ({ s, i }))
    // Once writing has stopped, only surfaces with targets are left.
    .filter(({ s }) => canWrite || s.targets > 0)
    .sort((a, b) => tier(a.s) - tier(b.s) || band(b.s) - band(a.s) || b.s.worth - a.s.worth || (b.s.rate ?? Infinity) - (a.s.rate ?? Infinity) || a.s.lastAt.localeCompare(b.s.lastAt))
    .map(({ i }) => i);
}
