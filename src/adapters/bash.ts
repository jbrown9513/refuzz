/**
 * Bash: the project built by its OSS-Fuzz build spec (src/build.ts) in refuzz's base-builder-bash image, which has the GNU
 * tools scripts are written against and whatever the spec installs. Fuzz targets are a `fuzz` function given the input's
 * bytes (bashFuzz below), sourced by src/probes/bash_fuzz.sh in a persistent bash per target, each running as an
 * unprivileged user of its own from the project's folder, which is read-only to it. xtrace (`+file:line:` per command) is
 * the line coverage; bash's own complaints on stderr (`file: line N: x: unbound variable`) are the failures. A function
 * returning non-zero is not one. Bash has no fuzzing engine.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { HARNESS_CWD, shq } from '../run.ts';
import type { Adapter, Built, Frame, FuzzRuntime, FuzzSession, InputReport, Report, Runtime, Target } from '../types.ts';

/** Where the driver goes in the container. */
const DRIVER = '/tmp/refuzz/bash_fuzz.sh';

/** Bash's own errors that mean the code is wrong, by what they end with, and the type each is reported as. */
const FAILURES: [RegExp, string][] = [
  [/division by 0/, 'DivisionByZero'],
  [/invalid arithmetic operator|value too great for base|operand expected|invalid number|arithmetic syntax error|attempted assignment to non-variable/, 'ArithmeticError'],
  [/unbound variable$/, 'UnboundVariable'],
  [/bad substitution$/, 'BadSubstitution'],
  [/syntax error|unexpected EOF/, 'SyntaxError'],
  [/command not found$/, 'CommandNotFound'],
  [/integer (expression )?expected|unary operator expected|binary operator expected|too many arguments$|conditional binary operator expected/, 'TestError'],
  [/bad array subscript$/, 'BadArraySubscript'],
  [/ambiguous redirect$/, 'AmbiguousRedirect'],
  [/maximum function nesting level exceeded|readonly variable$|not a valid identifier$/, 'BashError'],
];

const isImport = (l: string) => /^\s*(source|\.)\s+\S/.test(l);

/** The project's shell scripts in the checkout, three folders down, as paths from its root. */
function scriptsOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = readdirSync(join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 3) walk(path, depth + 1); } else if (/\.(sh|bash)$/.test(e.name)) out.push(path);
    }
  };
  walk('', 0);
  return out.slice(0, 500);
}

export const bash: Adapter = {
  languages: ['bash'],
  // The build left the project's scripts in its folder, where targets source them by their paths from it.
  async ready(b) {
    const scripts = scriptsOf(b.dir);
    if (!scripts.length) return undefined;
    const r = await b.box.exec(`cd ${shq(b.src)} && for f in ${scripts.map(shq).join(' ')}; do [ -r "$f" ] || echo "$f"; done`, { timeoutMs: 120_000 });
    const missing = r.stdout.trim().split('\n').filter(Boolean);
    if (r.code !== 0) return `${b.src} is not the project's folder: ${(r.stderr || r.stdout).trim().slice(-300)}`;
    return missing.length ? `the project's scripts are not in ${b.src}: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? `, and ${missing.length - 20} more` : ''}` : undefined;
  },
  async prepare(b, log) {
    const place = containerPlace(b.box);
    // Targets run as users of their own: the project is theirs to read and run, not to change.
    const locked = await b.box.exec(`chmod -R a+rX,go-w ${shq(b.src)}`, { timeoutMs: 600_000 });
    if (locked.code !== 0) log(`  bash: could not make ${b.src} read-only to targets: ${locked.stderr.trim().slice(-200)}`);
    await place.put('/tmp/refuzz', { 'bash_fuzz.sh': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'bash_fuzz.sh')) });
    const sources = new Map<string, string[]>();
    const lines = (path: string) => {
      if (!sources.has(path)) sources.set(path, existsSync(join(b.dir, path)) ? readFileSync(join(b.dir, path), 'utf8').split('\n') : []);
      return sources.get(path)!;
    };
    /** The function a line of a project file is in: the nearest definition above it. */
    const fnAt = (path: string, line: number) => {
      const src = lines(path);
      for (let i = Math.min(line, src.length) - 1; i >= 0; i--) {
        const m = /^\s*(?:function\s+([^\s(){}]+)|([^\s(){}=$]+)\s*\(\s*\))/.exec(src[i]);
        if (m) return m[1] ?? m[2];
      }
      return '';
    };
    const relative = (p: string) => (p.startsWith(`${b.src}/`) ? p.slice(b.src.length + 1) : p.replace(/^\.\//, ''));
    /** Bash's first complaint on stderr that means the code is wrong, as a report: the target's lines, or the project's. */
    const failure = (stderr: string, target: string): Report | undefined => {
      for (const line of stderr.split('\n')) {
        const m = /^([^:]+)(?:: [^:]+)*?: line (\d+): (.*)$/.exec(line);
        if (!m) continue;
        const type = FAILURES.find(([re]) => re.test(m[3]))?.[1];
        if (!type) continue;
        const message = m[3].slice(0, 400);
        if (m[1] === target) return { status: 'error', origin: 'setup', type, message: `target line ${m[2]}: ${message}` };
        const path = relative(m[1]), at = Number(m[2]);
        const frames: Frame[] = [{ path, line: at, name: fnAt(path, at) }];
        // A tool the project's source names that this image does not have is the environment, not the code.
        const missing = type === 'CommandNotFound' && /^(\S+): command not found$/.exec(m[3])?.[1];
        const environmental = !!missing && /^[\w.+-]+$/.test(missing) && new RegExp(`(^|[\\s;|&(\`])${missing.replace(/[.+]/g, '\\$&')}(?![\\w.-])`).test(lines(path)[at - 1] ?? '');
        return { status: 'error', origin: 'library', type: environmental ? 'MissingTool' : type, message, frames };
      }
      return undefined;
    };

    const rt: Runtime = {
      language: b.language,
      guide: 'Bash lines, one per item. `source path/to/file.sh` lines load the project\'s functions; paths are relative to the project root, which is the working directory and read-only. Build the arguments as quoted words or variables, then the last line calls the target and captures what it prints: `result=$(fn "arg1" "arg2")`. Write files only under "$TMPDIR".',
      importFor: (t: Target) => `source ${t.path}`,
      isImport,
      bindsResult: (l) => /^result=/.test(l),
      parseWrap: (code) => ({ source: code, offset: 0 }),
      isPublic: (t) => !t.qualifiedName.includes('.') && !t.name.startsWith('_'),
      errorsAreValues: true,
      rejections: [],
      environmental: (r) => r.type === 'MissingTool',
      fuzz: bashFuzz(b, place, failure, relative),
    };
    return rt;
  },
};

/** The input's bytes escaped for `printf %b`, on one line: backslash doubled, anything outside printable ASCII as `\xNN`. */
function escaped(b: Buffer): string {
  let out = '';
  for (const x of b) out += x === 0x5c ? '\\\\' : x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : `\\x${x.toString(16).padStart(2, '0')}`;
  return out;
}

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return String(h); };

/**
 * One persistent bash process running src/probes/bash_fuzz.sh for one target in the built project's container, as a user
 * of its own, and the session's coverage so far: each input is one subshell call, and its trace's line edges are the
 * features. Its answers are sections of lines, not session.ts's protocol, so it is a `docker exec` of its own.
 */
class BashDriver {
  private child?: ChildProcessWithoutNullStreams;
  private buf = '';
  private lines: string[] = [];
  private waiting?: () => void;
  private limit = 0;
  private seen = new Set<string>();
  fatal?: string;
  readonly container: string;
  readonly root: string;
  readonly uid: number;
  readonly harness: string;
  private failure: (stderr: string, harness: string) => Report | undefined;
  private relative: (p: string) => string;
  constructor(container: string, root: string, uid: number, harness: string, failure: (stderr: string, harness: string) => Report | undefined, relative: (p: string) => string) {
    this.container = container;
    this.root = root;
    this.uid = uid;
    this.harness = harness;
    this.failure = failure;
    this.relative = relative;
  }

  private line(timeoutMs: number): Promise<string | null> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (!this.child) return Promise.resolve(null);
    return new Promise((done) => {
      const timer = setTimeout(() => { this.waiting = undefined; done(null); }, timeoutMs);
      this.waiting = () => { clearTimeout(timer); this.waiting = undefined; done(this.lines.length ? this.lines.shift()! : null); };
    });
  }

  /** The lines up to `@@end`, or null when the process stops answering. */
  private async section(timeoutMs: number): Promise<string[] | null> {
    const out: string[] = [];
    const until = Date.now() + timeoutMs;
    for (;;) {
      const l = await this.line(Math.max(1, until - Date.now()));
      if (l === null) return null;
      if (l === '@@end') return out;
      out.push(l);
    }
  }

  async start(timeoutMs: number): Promise<boolean> {
    this.stop();
    this.limit = timeoutMs;
    const w = `${this.harness}.d`;
    const script = `pkill -KILL -U ${this.uid} 2>/dev/null; rm -rf ${shq(w)}; mkdir -p ${shq(w)}; chown ${this.uid}:${this.uid} ${shq(w)}; cd ${shq(this.root)} && exec tini -s -- setpriv --reuid=${this.uid} --regid=${this.uid} --clear-groups env -i PATH="$PATH" HOME=${shq(w)} TMPDIR=${shq(w)} bash ${DRIVER} ${shq(this.harness)} ${shq(w)} ${(timeoutMs / 1000).toFixed(3)} ${shq(this.root)}`;
    const child = spawn('docker', ['exec', '-i', '-w', HARNESS_CWD, this.container, 'sh', '-c', script], { env: { ...process.env, DOCKER_CONFIG: resolve('.fuzz', 'docker-config') }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.buf = '';
    this.lines = [];
    child.stdout.on('data', (d) => {
      this.buf += d;
      for (let i = this.buf.indexOf('\n'); i >= 0; i = this.buf.indexOf('\n')) {
        this.lines.push(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 1);
      }
      if (this.lines.length) this.waiting?.();
    });
    child.stderr.on('data', (d) => { if (process.env.REFUZZ_DEBUG) process.stderr.write(d); });
    child.stdin.on('error', () => {});
    child.on('close', () => { if (this.child === child) { this.child = undefined; this.waiting?.(); } });
    const first = await this.line(60_000);
    if (first === '@@ready') return true;
    this.fatal = first === '@@fatal' ? ((await this.section(10_000)) ?? []).join('\n').replaceAll(this.harness, '(target)').trim() : 'the target process exited before it was ready';
    this.stop();
    return false;
  }

  stop() {
    if (this.child) { try { this.child.kill('SIGKILL'); } catch {} this.child = undefined; }
  }

  async run(inputs: Buffer[], timeoutMs: number, deadline = Infinity): Promise<InputReport[]> {
    const out: InputReport[] = [];
    for (const input of inputs) {
      if (Date.now() > deadline) break;
      if ((!this.child || this.limit !== timeoutMs) && !(await this.start(timeoutMs))) {
        out.push({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: this.fatal });
        continue;
      }
      this.child!.stdin.write(`${escaped(input)}\n`);
      const s = await this.section(timeoutMs + 5_000);
      if (!s) { this.stop(); out.push({ status: 'timeout', origin: 'library', type: 'Timeout' }); continue; }
      out.push(this.report(s));
    }
    return out;
  }

  private report(s: string[]): InputReport {
    const status = Number(/^@@begin (\d+)$/.exec(s[0] ?? '')?.[1] ?? -1);
    const at = (tag: string) => s.indexOf(tag);
    const result = s.slice(1, at('@@stderr')).join('\n');
    const stderr = s.slice(at('@@stderr') + 1, at('@@last')).join('\n');
    const last = s.slice(at('@@last') + 1, at('@@trace')).join('\n');
    const features: string[] = [];
    const lines: [string, number][] = [];
    for (const edge of s.slice(at('@@trace') + 1)) {
      const f = fnv(edge);
      if (!this.seen.has(f)) { this.seen.add(f); features.push(f); }
      const here = edge.split('>')[1] ?? '';
      const m = /^(.*):(\d+)$/.exec(here);
      if (m) lines.push([this.relative(m[1]), Number(m[2])]);
    }
    const base = { features, lines };
    if (status === 137) return { status: 'timeout', origin: 'library', type: 'Timeout', ...base };
    const failed = this.failure(stderr, this.harness);
    if (failed) return { ...failed, ...base };
    if (status > 128) return { status: 'error', origin: 'library', type: `signal ${status - 128}`, message: `bash was killed by signal ${status - 128}`, native: true, frames: [], ...base };
    if (!result && status !== 0) {
      // Something called `exit` before fuzz returned: the target's own check line, a property that broke, or the project.
      const exit = /^\++([^:]*):(\d+): exit\b/.exec(last);
      const said = stderr.trim().split('\n').at(-1)?.trim();
      if (exit?.[1] === this.harness) return { status: 'error', origin: 'assertion', type: 'assertion', message: (said || `exit ${status} at target line ${exit[2]}`).slice(0, 400), ...base };
      const where = exit ? ` at ${this.relative(exit[1])}:${exit[2]}` : '';
      return { status: 'error', origin: 'setup', type: 'NoResult', message: `exit ${status}${where} before fuzz returned: ${stderr.trim().slice(-300)}`, ...base };
    }
    return { status: 'ok', result: (result || `[exit ${status}]`).slice(0, 300), ...base };
  }
}

/**
 * Bash fuzz targets: a script defining `fuzz() { local data="$1"; … }`, sourced once by src/probes/bash_fuzz.sh in a
 * persistent bash per target, each running as a user of its own; each input's bytes are "$1" of one call in a subshell.
 * Bash has no fuzzing engine, so there is no native run; in OSS-Fuzz's folder a target replays its inputs.
 */
function bashFuzz(b: Built, place: Place, failure: (stderr: string, target: string) => Report | undefined, relative: (p: string) => string): FuzzRuntime {
  let sessionNo = 0;
  return {
    guide: [
      'A Bash fuzz target: `source path/to/file.sh` lines (paths relative to the project root, which is the working directory and read-only), then a function `fuzz() { local data="$1"; … }`.',
      '"$1" is the input\'s raw bytes as one string (a NUL byte cannot be in a Bash string and is dropped). Hand it on as it is to a target that parses text, or cut the arguments from it yourself: `${data:0:8}` for a piece, `printf -v n \'%d\' "\'${data:0:1}"` for a byte as a number, `IFS=, read -r a b c <<<"$data"` to split on a byte.',
      'Call the target once, capturing what it prints and its status: `out=$(fn "$a" "$b")`, `st=$?`. A non-zero status is how a Bash function rejects its input, not a failure; a Bash error inside the project\'s function (an unbound variable, a bad substitution, a division by zero) is the finding.',
      'State what the result must satisfy as a check line in fuzz: `[[ $out == "$expected" ]] || { echo "what broke: $out" >&2; exit 1; }` (a round trip, a format, an invariant the function promises). An `exit` with a non-zero status from a line of fuzz is reported as the target\'s assertion, with the last line it wrote to stderr as the message; a Bash error in the target\'s own lines is a bug in the target.',
      'Bash runs with set -u: write "${2-}" for a variable that may be unset. Do not use set -e, and write files only under "$TMPDIR".',
    ].join(' '),
    async session(targets) {
      const dir = await place.folder('bash');
      const errors: Record<string, string> = {};
      for (const name of Object.keys(targets)) if (!/^[\w-]+$/.test(name)) errors[name] = `${name} is not a name a file can take`;
      const names = Object.keys(targets).filter((n) => !errors[n]);
      await place.put(dir, Object.fromEntries(names.map((n) => [`${n}.sh`, targets[n]])));
      await place.run(['chmod', '-R', 'a+rX', dir]);
      const drivers = new Map<string, BashDriver>();
      await Promise.all(names.map(async (n, i) => {
        const d = new BashDriver(b.box.name, b.src, 30_000 + (sessionNo++ % 10_000) * 50 + i, `${dir}/${n}.sh`, failure, relative);
        if (await d.start(5_000)) drivers.set(n, d);
        else errors[n] = d.fatal ?? 'did not load';
      }));
      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          const d = drivers.get(name);
          if (!d) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'TargetLoad', message: errors[name] ?? 'no such target' }));
          return d.run(inputs, timeoutMs, deadline);
        },
        release(name) {
          drivers.get(name)?.stop();
          drivers.delete(name);
        },
        async close() {
          for (const d of drivers.values()) d.stop();
          await b.box.exec(`for u in ${[...drivers.values()].map((d) => d.uid).join(' ') || '0'}; do pkill -KILL -U $u; done; rm -rf ${shq(dir)}`);
        },
      };
      return { session, errors };
    },
    // The target as written; compile_bash_fuzzer (src/images/bash/) makes $OUT/<name> replay inputs through it on the
    // project, copied to $OUT, since Bash has no engine to run it.
    oss(name, source) {
      const file = `${name}.sh`;
      return { file, source, compile: [`compile_bash_fuzzer ${b.src.replace(/^\/src\/+/, '')} $SRC/refuzz/${file}`] };
    },
  };
}
