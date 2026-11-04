/**
 * Where a language's fuzz targets run: inside the project's built container (`refuzz`), or on this machine (the SWT-bench
 * workspaces, which pin their own interpreter). A runtime written against a Place runs the same in both: it writes target
 * files and seed folders, starts long-lived drivers, runs the language's engine, and reads back what the engine wrote.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Container, docker, run, shq, type Ran } from './run.ts';
import { LineDriver } from './session.ts';

export interface Place {
  /** A new empty folder in this place. */
  folder(label: string): Promise<string>;
  /** Writes files (path relative to `dir` → content) into a folder in this place, creating folders on the way. */
  put(dir: string, files: Record<string, string | Buffer>): Promise<void>;
  /** Every file under a folder in this place, by path relative to it. */
  get(dir: string): Promise<Record<string, Buffer>>;
  remove(path: string): Promise<void>;
  /** Runs a command to completion. */
  run(argv: string[], o?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<Ran>;
  /** A long-running driver speaking session.ts's line protocol. */
  driver(argv: string[], o?: { cwd?: string; env?: Record<string, string> }): LineDriver;
}

/** COPYFILE_DISABLE: macOS tar would add an AppleDouble `._name` file beside each file it sends. */
const DOCKER_ENV = () => ({ ...process.env, DOCKER_CONFIG: resolve('.fuzz', 'docker-config'), COPYFILE_DISABLE: '1' });
const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** This machine: folders under .fuzz/place. */
export const hostPlace = (): Place => ({
  async folder(label) {
    const dir = resolve('.fuzz', 'place', `${label}-${id()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  },
  async put(dir, files) {
    for (const [rel, data] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), data);
    }
  },
  async get(dir) {
    const out: Record<string, Buffer> = {};
    try { for (const f of readdirSync(dir, { recursive: true }).map(String)) { try { out[f] = readFileSync(join(dir, f)); } catch {} } } catch {}
    return out;
  },
  async remove(path) { rmSync(path, { recursive: true, force: true }); },
  run: (argv, o = {}) => run(argv[0], argv.slice(1), { cwd: o.cwd, env: { ...process.env, ...o.env }, timeoutMs: o.timeoutMs }),
  driver: (argv, o = {}) => new LineDriver(argv[0], argv.slice(1), { cwd: o.cwd, env: { ...process.env, ...o.env } }),
});

/**
 * A running container: folders under /tmp/refuzz in it. Files go in and out as one tar stream per call, never a `docker exec`
 * per file. A driver is a `docker exec -i` that kills the one it replaces, so a restarted driver never leaves the old
 * process running in the container.
 */
export const containerPlace = (box: Container): Place => {
  const env = (e: Record<string, string> = {}) => Object.entries(e).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return {
    async folder(label) {
      const dir = `/tmp/refuzz/${label}-${id()}`;
      await box.exec(`mkdir -p ${shq(dir)}`);
      return dir;
    },
    async put(dir, files) {
      const local = resolve('.fuzz', 'place', id());
      try {
        for (const [rel, data] of Object.entries(files)) {
          mkdirSync(join(local, rel, '..'), { recursive: true });
          writeFileSync(join(local, rel), data);
        }
        await box.exec(`mkdir -p ${shq(dir)}`);
        const r = await run('sh', ['-c', `tar -C ${shq(local)} -cf - . | docker exec -i ${box.name} tar -C ${shq(dir)} -xf -`], { env: DOCKER_ENV(), timeoutMs: 600_000 });
        if (r.code !== 0) throw new Error(`copying into ${box.name}:${dir} failed: ${r.stderr.slice(-300)}`);
      } finally {
        rmSync(local, { recursive: true, force: true });
      }
    },
    async get(dir) {
      const local = resolve('.fuzz', 'place', id());
      mkdirSync(local, { recursive: true });
      try {
        await run('sh', ['-c', `docker exec ${box.name} tar -C ${shq(dir)} -cf - . 2>/dev/null | tar -C ${shq(local)} -xf -`], { env: DOCKER_ENV(), timeoutMs: 600_000 });
        return await hostPlace().get(local);
      } finally {
        rmSync(local, { recursive: true, force: true });
      }
    },
    async remove(path) { await box.exec(`rm -rf ${shq(path)}`); },
    run: (argv, o = {}) => docker(['exec', '-i', ...env(o.env), ...(o.cwd ? ['-w', o.cwd] : []), box.name, ...(o.timeoutMs ? ['timeout', '-s', 'KILL', String(Math.ceil(o.timeoutMs / 1000))] : []), ...argv], { timeoutMs: o.timeoutMs ? o.timeoutMs + 30_000 : undefined }),
    driver(argv, o = {}) {
      const pid = `/tmp/refuzz/driver-${id()}.pid`;
      const command = argv.map(shq).join(' ');
      return new LineDriver('docker', ['exec', '-i', ...env(o.env), ...(o.cwd ? ['-w', o.cwd] : []), box.name, 'sh', '-c', `mkdir -p /tmp/refuzz; [ -f ${pid} ] && kill -KILL $(cat ${pid}) 2>/dev/null; echo $$ > ${pid}; exec ${command}`], { env: DOCKER_ENV() });
    },
  };
};
