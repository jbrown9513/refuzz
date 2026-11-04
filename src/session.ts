/**
 * A long-running harness process that takes inputs on stdin (u32 LE length, wire-format bytes) and answers each with one JSON
 * line, the way every language's grammar driver speaks. It starts with a `{"ready": true}` or `{"fatal": …}` line. When the
 * process dies on an input (a segfault, an abort, a sanitizer), that input is reported as a native crash and the process is
 * started again for the rest; one that stops answering is killed and its input reported as a timeout.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { killTree, own } from './run.ts';
import type { InputReport } from './types.ts';

export class LineDriver {
  private child?: ChildProcessWithoutNullStreams;
  /** No input has been answered by this process yet: its first call also pays for the target's one-time setup. */
  private fresh = true;
  private lines: string[] = [];
  private waiting?: (line: string | null) => void;
  private stderr = '';
  /** The last fatal message: the harness did not load. */
  fatal?: string;
  readonly cmd: string;
  readonly args: string[];
  readonly opts: { cwd?: string; env?: NodeJS.ProcessEnv };

  constructor(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    this.cmd = cmd;
    this.args = args;
    this.opts = opts;
  }

  private next(timeoutMs: number): Promise<string | null> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    return new Promise((done) => {
      const timer = setTimeout(() => { this.waiting = undefined; done(null); }, timeoutMs);
      this.waiting = (line) => { clearTimeout(timer); this.waiting = undefined; done(line); };
    });
  }

  /** Starts the process and waits for its first line. False when the harness does not load. */
  async start(): Promise<boolean> {
    this.stop();
    this.lines = [];
    this.stderr = '';
    const child = spawn(this.cmd, this.args, { cwd: this.opts.cwd, env: this.opts.env ?? process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child, this.cmd);
    this.child = child;
    this.fresh = true;
    let buf = '';
    child.stdout.on('data', (d) => {
      // A killed process's answer can still be in the pipe: read as the next input's answer, every report after it would
      // belong to the input before.
      if (this.child !== child) return;
      buf += d;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (this.waiting) this.waiting(line); else this.lines.push(line);
      }
    });
    child.stderr.on('data', (d) => { if (this.child === child) this.stderr = (this.stderr + d).slice(-32000); });
    child.on('close', () => { if (this.child === child) { this.child = undefined; this.waiting?.(null); } });
    child.stdin.on('error', () => {});
    // A project that prints while it loads writes lines before the driver's first: they are skipped.
    let first = await this.next(120_000);
    while (first !== null && parseLine(first) === null) first = await this.next(120_000);
    if (!first) { this.fatal = `the harness process exited before it was ready: ${this.stderr.slice(-1500)}`; return false; }
    const msg = parseLine(first);
    if (msg.fatal) { this.fatal = `${msg.fatal}\n${msg.trace ?? ''}`.trim(); this.stop(); return false; }
    this.fatal = undefined;
    return true;
  }

  stop() {
    if (this.child) { killTree(this.child); this.child = undefined; }
  }

  /**
   * Runs inputs in order, restarting the process after any that kill it. Stops early, returning fewer reports than inputs,
   * past `deadline` or after three timeouts in one batch: a hanging input is found, the rest can wait for the next batch.
   */
  async run(inputs: Buffer[], timeoutMs: number, deadline = Infinity): Promise<InputReport[]> {
    const out: InputReport[] = [];
    let hangs = 0;
    for (let i = 0; i < inputs.length; i++) {
      if (Date.now() > deadline || hangs >= 3) break;
      if (!this.child && !(await this.start())) {
        for (; i < inputs.length; i++) out.push({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: this.fatal ?? 'the harness did not load' });
        break;
      }
      const head = Buffer.alloc(4);
      head.writeUInt32LE(inputs[i].length);
      this.child!.stdin.write(Buffer.concat([head, inputs[i]]));
      // Lines that are not the protocol's (a project printing to stdout) are skipped until the report arrives.
      // A new process's first input gets ten times the time, as the driver gives it (src/probes/c_fuzz.h): ClickHouse
      // registers its formats and functions on the first call, seconds under ASan and more on a busy machine.
      const allowed = (this.fresh ? timeoutMs * 10 : timeoutMs) + 3_000;
      this.fresh = false;
      let line = await this.next(allowed);
      while (line !== null && parseLine(line) === null) line = await this.next(allowed);
      // A driver that says the call returned (`{"returned":true}`) before it reports: the input's time was the call's, and the
      // report (a C driver turning a big binary's new coverage into source lines) gets what it takes, not counted as a hang.
      if (line !== null && parseLine(line)?.returned) {
        line = await this.next(REPORT_MS);
        while (line !== null && parseLine(line) === null) line = await this.next(REPORT_MS);
      }
      // A driver about to run the input's property checks says how many, with the input's report so far: each check gets the
      // input's own time, and if they hang or kill the process, that report stands without them.
      const progress = line !== null ? parseLine(line) : null;
      if (progress?.checking) {
        line = await this.next(timeoutMs * progress.checking + 3_000);
        while (line !== null && parseLine(line) === null) line = await this.next(timeoutMs * progress.checking + 3_000);
        if (line === null) {
          // A hang in the checks counts like any other: without it, a batch whose every input hangs there waits out each one.
          this.stop();
          hangs++;
          out.push({ ...progress.report, features: progress.report?.features?.map(String) });
          continue;
        }
      }
      if (line === null) {
        // No answer: the process died on this input, or hung past its own timer.
        const died = !this.child;
        // Whole: a C driver's crash line carries the sanitizer's account of whose memory the address was, after the stack.
        const tail = this.stderr;
        this.stop();
        if (!died) hangs++;
        out.push(died ? { status: 'error', origin: 'library', native: true, type: signalOf(tail), message: tail.trim().split('\n').slice(-6).join('\n') } : { status: 'timeout', origin: 'library', type: 'Timeout' });
        continue;
      }
      const r = parseLine(line);
      // A driver that answered a hang may be on its way out: the next input goes to a fresh process, not a dying one.
      if (r.status === 'timeout') { hangs++; this.stop(); }
      out.push({ ...r, features: r.features?.map(String) });
    }
    return out;
  }
}

/** How long a driver that said its call returned has to report it. */
const REPORT_MS = 300_000;

/** A protocol line, or null for anything else the process printed to stdout (a project's own output). */
function parseLine(line: string): any {
  if (!line.startsWith('{')) return null;
  try { return JSON.parse(line); } catch { return null; }
}

/** The kind of a native crash from what the process printed last: a sanitizer's kind or a signal. */
export function signalOf(stderr: string): string {
  return /ERROR: (\w+Sanitizer): ([\w-]+)/.exec(stderr)?.slice(1).join(': ') ?? /^fatal error: ([^\n]+)/m.exec(stderr)?.[1]?.slice(0, 60) ?? (/^panic: /m.test(stderr) ? 'panic' : null) ?? /(SIG[A-Z]+)/.exec(stderr)?.[1] ?? /Fatal Python error: (\w+)/.exec(stderr)?.[1] ?? 'NativeCrash';
}
