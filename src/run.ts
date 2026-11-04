/**
 * Process plumbing every adapter shares: running a command with a time limit, a bounded number at once, and long-lived
 * Docker containers (src/build.ts builds the project in one, with the network on, and cuts it off before any target runs).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * What this process started that outlives it unless removed: process groups (every child runs in its own, with whatever it
 * forks) and containers. All of it is removed when the process exits, however it exits short of SIGKILL, and is listed in
 * .fuzz/owned/<pid>.json so the next run removes what a killed one left: a run that leaves its containers and process trees
 * behind fills the machine's file table within days.
 */
const OWNED = resolve('.fuzz', 'owned');
const groups = new Map<number, string>();
const containers = new Set<string>();
const record = () => {
  mkdirSync(OWNED, { recursive: true });
  writeFileSync(join(OWNED, `${process.pid}.json`), JSON.stringify({ groups: [...groups].map(([pgid, cmd]) => ({ pgid, cmd })), containers: [...containers] }));
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** Kills a process group, if its leader is still the command started: a reused process id is someone else's. */
const killGroup = (pgid: number, cmd: string) => {
  const now = spawnSync('ps', ['-o', 'args=', '-p', String(pgid)], { encoding: 'utf8' }).stdout.trim();
  if (now && now.startsWith(cmd)) try { process.kill(-pgid, 'SIGKILL'); } catch {}
};
const removeContainers = (names: string[]) => { if (names.length) spawnSync('docker', ['rm', '-f', ...names], { env: { ...process.env, DOCKER_CONFIG: resolve('.fuzz', 'docker-config') }, stdio: 'ignore' }); };

export function own(child: ChildProcess, cmd: string) {
  const pgid = child.pid;
  if (!pgid) return;
  groups.set(pgid, cmd);
  record();
  child.once('exit', () => { groups.delete(pgid); record(); });
}

/** Kills a child's whole process group: what it forked (a multiprocessing pool, a fuzzer's workers) goes with it. */
export function killTree(child: ChildProcess) {
  try { process.kill(-child.pid!, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}

function cleanup() {
  for (const pgid of groups.keys()) try { process.kill(-pgid, 'SIGKILL'); } catch {}
  removeContainers([...containers]);
  groups.clear();
  containers.clear();
  rmSync(join(OWNED, `${process.pid}.json`), { force: true });
}
process.on('exit', cleanup);
// A signal with no other handler ends the process through exit, so cleanup runs; one that has a handler (the fuzzer's save
// on SIGINT) exits itself, the same way.
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) process.on(sig, () => { if (process.listenerCount(sig) === 1) process.exit(code); });

// What earlier runs that were killed outright left behind.
for (const f of existsSync(OWNED) ? readdirSync(OWNED) : []) {
  const pid = Number(f.replace(/\.json$/, ''));
  if (!pid || pid === process.pid || alive(pid)) continue;
  try {
    const left = JSON.parse(readFileSync(join(OWNED, f), 'utf8')) as { groups: { pgid: number; cmd: string }[]; containers: string[] };
    for (const g of left.groups) killGroup(g.pgid, g.cmd);
    removeContainers(left.containers);
  } catch {}
  rmSync(join(OWNED, f), { force: true });
}

export interface Ran {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs a command to completion or until `timeoutMs`, then kills its process group. Never throws for a non-zero exit. */
export function run(cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string; maxBytes?: number } = {}): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child, cmd);
    const max = o.maxBytes ?? 4 * 1024 * 1024;
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (d) => { if (stdout.length < max) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < max) stderr += d; });
    const timer = o.timeoutMs ? setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, o.timeoutMs) : undefined;
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, signal: null, stdout, stderr: `${stderr}${e.message}`, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr, timedOut }); });
    if (o.input !== undefined) child.stdin.end(o.input); else child.stdin.end();
  });
}

/** The repository's HEAD commit. */
export async function head(dir: string): Promise<string> {
  const r = await run('git', ['-C', dir, 'rev-parse', 'HEAD']);
  if (r.code !== 0) throw new Error(`git rev-parse HEAD in ${dir} failed: ${r.stderr.slice(-200)}`);
  return r.stdout.trim();
}

/** Runs `fn` over `items`, at most `n` at a time, keeping order. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  }));
  return out;
}

/** Harness processes run at once. */
/** Cores a run uses: all but two, or `REFUZZ_CORES` when several runs share the machine. */
export const PARALLEL = Number(process.env.REFUZZ_CORES) || Math.max(2, availableParallelism() - 2);

/** Docker without the desktop credential helper, which can hang pulls of public images. */
const DOCKER_ENV = { ...process.env, DOCKER_CONFIG: resolve('.fuzz', 'docker-config') };

export const docker = (args: string[], o: { timeoutMs?: number; input?: string } = {}) => run('docker', args, { env: DOCKER_ENV, ...o });

/**
 * A container's memory: the Docker VM's share for the cores a run uses. Unlimited, a run's harnesses and builds took the
 * whole VM on 2026-10-30 (six runs at once) and Docker Desktop died with every other container on it; limited, the kernel
 * kills a process inside the one container that ran out.
 */
let limit: Promise<string[]> | undefined;
const memoryLimit = () => (limit ??= docker(['info', '--format', '{{.MemTotal}} {{.NCPU}}']).then((r) => {
  const [bytes, cpus] = r.stdout.trim().split(' ').map(Number);
  if (!(bytes > 0 && cpus > 0)) return [];
  const m = `${Math.max(4, Math.floor((bytes * Math.min(1, PARALLEL / cpus)) / 2 ** 30))}g`;
  return ['--memory', m, '--memory-swap', m];
}));

/**
 * The working directory harness processes run in, inside the container: not the project. The code being fuzzed writes
 * wherever its inputs say, often relative to the working directory (a copy folder, a driver file, a cache).
 */
export const HARNESS_CWD = '/tmp';

/**
 * A container started from an image, kept running so each target run is a `docker exec`, not a container start. Nothing
 * from this machine is mounted into it: a project is copied in (copyIn), so the container never holds files open through
 * Docker's file sharing and never writes into the checkout.
 */
export class Container {
  readonly name: string;
  readonly image: string;
  /** A folder on the machine mounted at /tmp/refuzz, where targets and their binaries go; removed with the container. */
  scratch?: string;
  constructor(image: string, label: string) {
    this.image = image;
    // The process id is in the name: two runs must not share a container, since each removes its own at the end.
    this.name = `refuzz-${label.replace(/[^\w.-]/g, '_')}-${createHash('sha1').update(`${image}|${label}|${process.pid}|${Math.random()}`).digest('hex').slice(0, 10)}`;
  }

  /** Starts the container if it is not running, with the network on for the build. */
  async start(extra: string[] = []): Promise<void> {
    const state = await docker(['inspect', '-f', '{{.State.Running}}', this.name]);
    if (state.stdout.trim() === 'true') return;
    if (state.code === 0) await docker(['rm', '-f', this.name]);
    const pulled = await docker(['image', 'inspect', this.image]);
    if (pulled.code !== 0) {
      const pull = await docker(['pull', this.image], { timeoutMs: 1_200_000 });
      if (pull.code !== 0) throw new Error(`docker pull ${this.image} failed: ${pull.stderr.slice(-400)}`);
    }
    const r = await docker(['run', '-d', '--name', this.name, ...(await memoryLimit()), ...extra, this.image, 'sleep', 'infinity']);
    if (r.code !== 0) throw new Error(`docker run ${this.image} failed: ${r.stderr.slice(-400)}`);
    containers.add(this.name);
    record();
  }

  /** Cuts the container off the network: harnesses run with no way out. */
  async offline(): Promise<void> {
    await docker(['network', 'disconnect', '-f', 'bridge', this.name]);
  }

  async online(): Promise<void> {
    await docker(['network', 'connect', 'bridge', this.name]);
  }

  exec(script: string, o: { timeoutMs?: number; cwd?: string; env?: Record<string, string>; input?: string } = {}): Promise<Ran> {
    const env = Object.entries(o.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    // `timeout` inside the container kills the harness itself; the outer limit only catches a stuck `docker exec`.
    const inner = o.timeoutMs ? `timeout -s KILL ${Math.ceil(o.timeoutMs / 1000)} sh -c ${shq(script)}` : script;
    return docker(['exec', '-i', ...env, ...(o.cwd ? ['-w', o.cwd] : []), this.name, 'sh', '-c', inner], { timeoutMs: o.timeoutMs ? o.timeoutMs + 30_000 : undefined, input: o.input });
  }

  /**
   * Copies a folder of this machine into the container at `to`, replacing what is there; `exclude` names paths left out
   * (tar patterns, relative to the folder).
   */
  async copyIn(from: string, to: string, exclude: string[] = []): Promise<void> {
    await this.exec(`rm -rf ${shq(to)} && mkdir -p ${shq(to)}`);
    const tar = `tar -C ${shq(from)} ${exclude.map((e) => `--exclude=${shq(e)}`).join(' ')} -cf - . | docker exec -i ${this.name} tar -C ${shq(to)} -xf -`;
    // COPYFILE_DISABLE: macOS tar would add an AppleDouble `._name` file beside each file, which builds choke on.
    const r = await run('sh', ['-c', tar], { env: { ...DOCKER_ENV, COPYFILE_DISABLE: '1' }, timeoutMs: 1_800_000 });
    if (r.code !== 0) throw new Error(`copying ${from} into ${this.name}:${to} failed: ${r.stderr.slice(-400)}`);
  }

  /** Saves the container's filesystem as an image, so the next run starts from what was built in it. */
  async commit(tag: string): Promise<void> {
    const r = await docker(['commit', this.name, tag], { timeoutMs: 1_800_000 });
    if (r.code !== 0) throw new Error(`docker commit ${this.name} failed: ${r.stderr.slice(-400)}`);
  }

  async stop(): Promise<void> {
    await docker(['rm', '-f', this.name]);
    if (this.scratch) rmSync(this.scratch, { recursive: true, force: true });
    containers.delete(this.name);
    record();
  }
}

export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Exit status 124/137 from `timeout`, or a killed process: the harness ran out of time. */
export const timedOut = (r: Ran) => r.timedOut || r.code === 137 || r.code === 124 || r.signal === 'SIGKILL';
