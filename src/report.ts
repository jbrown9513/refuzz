/**
 * What a fuzzing session produced, in the form a dashboard reads: versioned JSON under `.refuzz/report/`, written after
 * every batch so a page shows a session while it runs.
 *
 *   latest.json            the newest session (`refuzz.fuzz.session/1`)
 *   sessions/<id>.json     every session
 *   bugs.json              every verified bug (`refuzz.fuzz.bugs/1`): when it was first and last seen, and when a later
 *                          commit fixed it, found by running its reproducer again each session
 *   bugs/<id>/report.md    a report ready to file, with the failing test and input.bin beside it
 *
 * A bug here has been verified (src/verify.ts): a test in the project's own suite, run with its own command, fails because
 * of it on the latest commit, and the judge found the failure breaks what the function documents. Everything the fuzzer flagged
 * that was not verified is in a session's `candidates`, never in `bugs`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SESSION_SCHEMA = 'refuzz.fuzz.session/1';
export const BUGS_SCHEMA = 'refuzz.fuzz.bugs/1';

export interface Site { function: string; path: string; line: number }

export interface Bug {
  id: string;
  title: string;
  /** One sentence: the mistake, in the code's terms. */
  cause: string;
  status: 'open' | 'fixed';
  /** Ordinary input handled wrongly (`bug`), or hostile or malformed input handled wrongly (`hardening`). */
  kind: 'bug' | 'hardening';
  cwe?: string;
  language: string;
  /** Every place the same mistake fails. */
  sites: Site[];
  /** What happens, and what the documentation promises instead. */
  observed: string;
  documented: string;
  /** The failing test that proves it: its path in the project, its source, the command that runs it, and the fuzzer's input. */
  reproducer: { file: string; source: string; command: string; inputHex: string };
  firstSeen: { at: string; commit: string };
  lastSeen: { at: string; commit: string };
  fixed?: { at: string; commit: string };
  /** Upstream issues the judge thought may report the same bug, from the duplicate check. */
  duplicates: { url: string; title: string; likely: number }[];
  /** report.md, relative to the report folder. */
  report: string;
}

/** A failure the fuzzer flagged and the judge rated a defect, and what verification made of it. */
export interface Candidate {
  key: string;
  language: string;
  function: string;
  where: string;
  type: string;
  message: string;
  verdict: 'bug' | 'not a bug' | 'not verified yet';
  why?: string;
  bug?: string;
  /** For a candidate that is not a bug: the last test the writer tried, its path and source, so what was tried can be read. */
  tried?: { path: string; source: string; output?: string };
}

export interface LanguageReport {
  coverage: { lines: number; total: number; new: number };
  surfaces: { total: number; fuzzed: number; changed: number; new: number; gaining: number; plateaued: number };
  inputs: number;
  targets: number;
  /**
   * The promises the surfaces' entry points make (src/fuzzer.ts), not counting those verification found are not promises:
   * how many some target's assertions check, how many a verified bug broke, and how many no fuzz target can check.
   */
  promises: { total: number; checked: number; broken: number; untestable: number };
}

export interface SessionReport {
  schema: typeof SESSION_SCHEMA;
  project: { name: string; repository?: string; commit: string };
  session: { id: string; startedAt: string; updatedAt: string; minutes: number | null; state: 'running' | 'finished' | 'stopped' };
  /** Bugs verified this session or re-checked in it: `new` is first seen this session. Full records are in bugs.json. */
  bugs: { id: string; title: string; status: Bug['status']; kind: Bug['kind']; new: boolean; fixedThisSession: boolean; sites: number }[];
  candidates: Candidate[];
  languages: Record<string, LanguageReport>;
  /** What the session's model calls cost, and its --cents limit (null with none). */
  money?: { modelCents: number; limitCents: number | null };
}

const atomic = (file: string, data: string) => { writeFileSync(`${file}.tmp`, data); renameSync(`${file}.tmp`, file); };

export class Reports {
  readonly root: string;
  private bugs: Map<string, Bug>;
  readonly session: SessionReport;

  constructor(projectDir: string, project: SessionReport['project'], minutes: number | null, root = join(projectDir, '.refuzz', 'report')) {
    this.root = root;
    mkdirSync(join(root, 'sessions'), { recursive: true });
    let saved: Bug[] = [];
    try { saved = existsSync(join(root, 'bugs.json')) ? JSON.parse(readFileSync(join(root, 'bugs.json'), 'utf8')).bugs ?? [] : []; } catch {}
    this.bugs = new Map(saved.map((b) => [b.id, b]));
    const at = new Date().toISOString();
    this.session = { schema: SESSION_SCHEMA, project, session: { id: at.replace(/[:.]/g, '-'), startedAt: at, updatedAt: at, minutes, state: 'running' }, bugs: [], candidates: [], languages: {} };
    // A session stopped by a signal is written as stopped.
    process.on('exit', () => { if (this.session.session.state === 'running') { this.session.session.state = 'stopped'; this.save(); } });
  }

  /** Open bugs in a language, to run their reproducers again on this commit. */
  open(language: string): Bug[] { return [...this.bugs.values()].filter((b) => b.language === language && b.status === 'open'); }

  /** The bug whose sites include this one: the same mistake found again. */
  bugAt(language: string, site: Site): Bug | undefined {
    return [...this.bugs.values()].find((b) => b.language === language && b.sites.some((s) => s.path === site.path && s.function === site.function));
  }

  /** A re-run of a stored reproducer: still failing, or fixed by this commit. */
  recheck(id: string, failing: boolean) {
    const b = this.bugs.get(id)!;
    const now = { at: new Date().toISOString(), commit: this.session.project.commit };
    if (failing) b.lastSeen = now;
    else { b.status = 'fixed'; b.fixed = now; }
    this.note(b, false, !failing);
    this.save();
  }

  /** A verified bug: a new one, or more sites and a fresh sighting of one already known. */
  add(bug: Omit<Bug, 'id' | 'status' | 'firstSeen' | 'lastSeen' | 'report'>, inputBytes: Buffer): Bug {
    const now = { at: new Date().toISOString(), commit: this.session.project.commit };
    const known = bug.sites.map((s) => this.bugAt(bug.language, s)).find(Boolean);
    if (known) {
      for (const s of bug.sites) if (!known.sites.some((k) => k.path === s.path && k.function === s.function)) known.sites.push(s);
      known.lastSeen = now;
      if (known.status === 'fixed') { known.status = 'open'; delete known.fixed; }
      this.write(known, inputBytes);
      this.note(known, false, false);
      this.save();
      return known;
    }
    const id = createHash('sha1').update(`${bug.language}|${bug.sites[0].path}|${bug.sites[0].function}`).digest('hex').slice(0, 12);
    const full: Bug = { ...bug, id, status: 'open', firstSeen: now, lastSeen: now, report: `bugs/${id}/report.md` };
    this.bugs.set(id, full);
    this.write(full, inputBytes);
    this.note(full, true, false);
    this.save();
    return full;
  }

  candidate(c: Candidate) {
    const i = this.session.candidates.findIndex((x) => x.key === c.key);
    if (i >= 0) this.session.candidates[i] = c; else this.session.candidates.push(c);
    this.soon();
  }

  /** Candidates change by the hundred: the files are written at most once a second for them. A bug and the end write at once. */
  private pending?: ReturnType<typeof setTimeout>;
  private soon() {
    this.pending ??= setTimeout(() => { this.pending = undefined; this.save(); }, 1000);
  }

  language(language: string, r: LanguageReport) { this.session.languages[language] = r; this.save(); }
  money(m: SessionReport['money']) { this.session.money = m; this.save(); }
  finish() { this.session.session.state = 'finished'; this.save(); }

  private note(b: Bug, isNew: boolean, fixedNow: boolean) {
    const entry = { id: b.id, title: b.title, status: b.status, kind: b.kind, new: isNew, fixedThisSession: fixedNow, sites: b.sites.length };
    const i = this.session.bugs.findIndex((x) => x.id === b.id);
    if (i >= 0) this.session.bugs[i] = { ...entry, new: this.session.bugs[i].new || isNew }; else this.session.bugs.push(entry);
  }

  private write(b: Bug, input: Buffer) {
    const dir = join(this.root, 'bugs', b.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, b.reproducer.file.split('/').pop()!), b.reproducer.source);
    writeFileSync(join(dir, 'input.bin'), input);
    atomic(join(dir, 'report.md'), markdown(b, this.session.project));
  }

  save() {
    if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
    this.session.session.updatedAt = new Date().toISOString();
    const body = JSON.stringify(this.session, null, 2);
    atomic(join(this.root, 'sessions', `${this.session.session.id}.json`), body);
    atomic(join(this.root, 'latest.json'), body);
    atomic(join(this.root, 'bugs.json'), JSON.stringify({ schema: BUGS_SCHEMA, project: this.session.project, bugs: [...this.bugs.values()] }, null, 2));
  }
}

/** A report a maintainer can read without knowing the fuzzer: what fails, how to see it, what the documentation says. */
function markdown(b: Bug, project: SessionReport['project']): string {
  const where = (s: Site) => (project.repository ? `[${s.path}:${s.line}](https://github.com/${project.repository}/blob/${b.lastSeen.commit}/${s.path}#L${s.line})` : `${s.path}:${s.line}`);
  return [
    `# ${b.title}`,
    '',
    b.cause,
    '',
    `Found at ${b.firstSeen.commit.slice(0, 12)}; still failing at ${b.lastSeen.commit.slice(0, 12)}.${b.status === 'fixed' ? ` Fixed by ${b.fixed!.commit.slice(0, 12)}.` : ''}`,
    '',
    '## Where',
    '',
    ...b.sites.map((s) => `- \`${s.function}\` at ${where(s)}`),
    '',
    '## What happens',
    '',
    b.observed,
    '',
    '## What the documentation says',
    '',
    b.documented,
    '',
    '## A failing test',
    '',
    `\`${b.reproducer.file}\`, run from the repository root with \`${b.reproducer.command}\`. It fails on ${b.lastSeen.commit.slice(0, 12)}${b.status === 'fixed' ? ' no longer' : ''}, and passes once the bug is fixed.`,
    '',
    '```',
    b.reproducer.source.trim(),
    '```',
    ...(b.duplicates.length ? ['', '## Possibly reported already', '', ...b.duplicates.map((d) => `- [${d.title}](${d.url}) (${Math.round(d.likely * 100)}% likely the same)`)] : []),
    '',
  ].join('\n');
}
