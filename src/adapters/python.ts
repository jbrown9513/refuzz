/**
 * Python: the project built and installed by its OSS-Fuzz build spec (src/build.ts) in the base-builder-python image, fuzz
 * targets as Atheris files run in that container by src/probes/python_fuzz.py (pythonFuzz below). The SWT-bench workspaces
 * run the same targets on this machine, in their own interpreter.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { signalOf } from '../session.ts';
import type { Adapter, FuzzRuntime, FuzzSession, Report, Runtime, Target } from '../types.ts';

/** Generated calls must not reach the network: outbound connections fail like a refused connection. */
const NO_NETWORK = `import socket as _s
def _refuse(*a, **k):
    raise ConnectionRefusedError('network disabled')
_s.socket.connect = _refuse
_s.socket.connect_ex = _refuse
_s.getaddrinfo = _refuse
_s.create_connection = _refuse
`;

/** The directory packages are imported from: `src/` when the project keeps them there. */
function importRoot(dir: string): string {
  for (const r of ['src', 'lib', 'python']) {
    const d = join(dir, r);
    if (existsSync(d) && !existsSync(join(dir, r, '__init__.py'))) return r;
  }
  return '';
}

/** The project's top-level packages: folders with an __init__.py under its import root, tests left out. */
function packagesOf(dir: string, root: string): string[] {
  try {
    return readdirSync(join(dir, root), { withFileTypes: true }).filter((e) => e.isDirectory() && !/^(tests?|testing|docs?|examples?|benchmarks?)$/.test(e.name) && existsSync(join(dir, root, e.name, '__init__.py'))).map((e) => e.name);
  } catch { return []; }
}

/** Exception types that say the environment is wrong, not the project: a missing package or file, a path of the wrong kind, an interrupted interpreter. */
const ENVIRONMENTAL = ['ImportError', 'ModuleNotFoundError', 'OptionError', 'FileNotFoundError', 'IsADirectoryError', 'NotADirectoryError', 'PermissionError', 'FileExistsError', 'KeyboardInterrupt', 'SystemExit', 'GeneratorExit'];

/**
 * A file's module name, as Python imports it once installed: named from the package it belongs to, the nearest folder above it
 * with a pyproject.toml, setup.py or setup.cfg (or that folder's src/, for a src layout). A monorepo's
 * `libs/langgraph/langgraph/graph/state.py` is `langgraph.graph.state` (a namespace package, with no __init__.py), and an
 * integration's `src/integrations/prefect-aws/prefect_aws/s3.py` is `prefect_aws.s3`. With no such folder, from the import root.
 */
const moduleOf = (path: string, root: string, dir: string) => {
  const parts = path.replace(/\.pyi?$/, '').split('/');
  let name = (root && path.startsWith(`${root}/`) ? parts.slice(root.split('/').length) : parts);
  for (let n = parts.length - 1; n >= 0; n--) {
    if (!['pyproject.toml', 'setup.py', 'setup.cfg'].some((f) => existsSync(join(dir, ...parts.slice(0, n), f)))) continue;
    name = parts[n] === 'src' && parts.length > n + 1 ? parts.slice(n + 1) : parts.slice(n);
    break;
  }
  return name.join('.').replace(/\.__init__$/, '');
};

/** Where the driver goes in the container. */
const DRIVER = '/tmp/refuzz/python_fuzz.py';
const ENV = { PYTHONDONTWRITEBYTECODE: '1', PYTHONWARNINGS: 'ignore' };

export const python: Adapter = {
  languages: ['python'],
  // The build installed the project: each of its packages imports from outside the checkout, the way a target imports it.
  async ready(b) {
    const packages = packagesOf(b.dir, importRoot(b.dir));
    if (!packages.length) return undefined;
    const r = await b.box.exec(`python3 -c ${JSON.stringify(packages.map((x) => `import ${x}`).join('; '))}`, { cwd: '/tmp', timeoutMs: 300_000 });
    return r.code === 0 ? undefined : `importing ${packages.join(', ')} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`;
  },
  async prepare(b, log) {
    const place = containerPlace(b.box);
    await place.put('/tmp/refuzz', { 'python_fuzz.py': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'python_fuzz.py')) });
    return pythonRuntime('python', importRoot(b.dir), pythonFuzz({ place, python: 'python3', driver: DRIVER, root: b.src, env: ENV, preamble: NO_NETWORK, log }), b.dir);
  },
};

/** Everything but running harnesses: shared by `refuzz` and the SWT-bench workspaces, which run them their own way. */
/**
 * Names a public module re-exports from a private one (`from _pytest.python_api import approx` in pytest/__init__.py):
 * module → names. A project that keeps its code in `_impl` modules and exports it from a public package is public there.
 */
function reexports(dir: string, root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const base = join(dir, root);
  const walk = (at: string, mod: string[]) => {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!e.name.startsWith('_') && !e.name.startsWith('.') && !/^(tests?|testing|docs?)$/.test(e.name)) walk(join(at, e.name), [...mod, e.name]); continue; }
      if (!e.name.endsWith('.py') || (e.name.startsWith('_') && e.name !== '__init__.py')) continue;
      const text = readFileSync(join(at, e.name), 'utf8');
      for (const m of text.matchAll(/^from\s+([\w.]+)\s+import\s+(\([^)]*\)|[^\n]+)/gm)) {
        const from = m[1].startsWith('.') ? [...mod.slice(0, mod.length - (m[1].match(/^\.+/)![0].length - 1)), m[1].replace(/^\.+/, '')].filter(Boolean).join('.') : m[1];
        const set = out.get(from) ?? out.set(from, new Set()).get(from)!;
        for (const n of m[2].replace(/[()]/g, '').split(',')) { const name = n.trim().split(/\s+as\s+/)[0].trim(); if (/^\w+$/.test(name)) set.add(name); }
      }
    }
  };
  walk(base, []);
  return out;
}

export const pythonRuntime = (language: string, root: string, fuzz: FuzzRuntime, dir: string, probe?: Runtime['probe']): Runtime => {
  let exported: Map<string, Set<string>> | undefined;
  return {
  language,
  guide: 'Python statements at module level, one per item. `import` and `from … import …` lines bring names into scope. Build the arguments, then the last line calls the target and binds what it returns: `result = target(...)`.',
  importFor: (t: Target) => `from ${moduleOf(t.path, root, dir)} import ${t.qualifiedName.split('.')[0]}`,
  isImport: (l) => /^(import|from)\s/.test(l),
  bindsResult: (l) => /^result\s*=(?!=)/.test(l),
  parseWrap: (code) => ({ source: code, offset: 0 }),
  isPublic(t) {
    const parts = t.qualifiedName.split('.');
    if (parts.length > 2 || parts.some((x) => x.startsWith('_'))) return false;
    const mod = moduleOf(t.path, root, dir);
    if (!mod.split('.').some((m) => m.startsWith('_') && m !== '__init__')) return true;
    // A private module's name a public one re-exports is public under that name.
    exported ??= reexports(dir, root);
    return exported.get(mod)?.has(parts[0]) ?? false;
  },
  errorsAreValues: false,
  rejections: ['ValueError', 'TypeError', 'KeyError', 'IndexError', 'LookupError', 'NotImplementedError', 'AttributeError', 'OverflowError', 'ZeroDivisionError', 'UnicodeError', 'UnicodeDecodeError', 'UnicodeEncodeError'],
  // A missing package or file, or a path of the wrong kind: what is on this machine, not what the function does.
  environmental: (r) => ENVIRONMENTAL.includes(r.type ?? '') || /network disabled/.test(r.message ?? ''),
  probe,
  fuzz,
  };
};

/** The `if __name__ == "__main__":` block every Atheris target ends with, for a target written without it. */
const MAIN = `

if __name__ == "__main__":
    import sys
    import atheris
    atheris.instrument_all()
    atheris.Setup(sys.argv, TestOneInput)
    atheris.Fuzz()
`;

/** A libFuzzer dictionary entry: the token quoted, its quote, backslash and non-printable bytes escaped. */
const dictEntry = (t: string) => `"${[...Buffer.from(t, 'utf8')].map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('')}"`;

/**
 * OSS-Fuzz targets for Python: Atheris files defining `TestOneInput(data)`, run in-process by python_fuzz.py (at `driver` in
 * the place) with coverage edges from sys.monitoring (a tracer before 3.12), one process per target kept running between
 * batches, and by real Atheris for the native engine when the interpreter has it. `root` is the project's folder in the
 * place: what runs from an installed copy of it is mapped back there.
 */
export function pythonFuzz(o: { place: Place; python: string; driver: string; root: string; env: Record<string, string>; preamble?: string; log?: (s: string) => void }): FuzzRuntime {
  const log = o.log ?? (() => {});
  let engine: Promise<boolean> | undefined;
  const atheris = () => engine ??= o.place.run([o.python, '-c', 'import atheris'], { timeoutMs: 60_000 }).then((r) => {
    if (r.code !== 0) log('  python: the interpreter has no Atheris; fuzzing in-process only');
    return r.code === 0;
  });

  return {
    guide: [
      'An Atheris fuzz target, the file OSS-Fuzz runs: `import sys`, `import atheris`, plain imports of the project, then `def TestOneInput(data):` at module level, then the standard block `if __name__ == "__main__":` / `    atheris.instrument_all()` / `    atheris.Setup(sys.argv, TestOneInput)` / `    atheris.Fuzz()`.',
      'The project is installed in the interpreter: import it as its users do, by its package name (a module at `src/pkg/mod.py` or `pkg/mod.py` is `pkg.mod`).',
      'data is the fuzzer\'s raw bytes, any length and any content. Build the target\'s arguments from them: when the target takes bytes or text, pass data itself, or text from `data.decode("utf-8", "surrogateescape")` or `fdp.ConsumeUnicodeNoSurrogates(n)`; otherwise `fdp = atheris.FuzzedDataProvider(data)` and take each argument from it in turn (`fdp.ConsumeIntInRange(lo, hi)`, `fdp.ConsumeBool()`, `fdp.ConsumeUnicodeNoSurrogates(n)`, `fdp.ConsumeBytes(n)`, `fdp.ConsumeFloat()`, `fdp.PickValueInList([...])`, and `fdp.ConsumeBytes(fdp.remaining_bytes())` for the rest). Objects the project makes are made through its own constructors and factories, as its tests make them.',
      'Catch only the exceptions the project documents for invalid input, by their exact classes, around the call that raises them, and return: `try: doc = parse(text)` / `except (ValueError, ParseError): return`. Never a bare `except:`, `except Exception` or `except BaseException`: anything else the project raises is what the fuzzer is looking for.',
      'State what must hold of the result as `assert` statements inside TestOneInput, after the call: a round trip (parse what it printed, decode what it encoded), the result\'s type, size or range, agreement with another function of the project that should agree, an output path staying inside its base. Each assert carries a message showing the values it compared: `assert again == doc, f"round trip changed {doc!r} into {again!r}"`. A failing assert is a finding; assert only what the project promises for every input it accepts, never exact values you would compute by hand.',
      'No network, no subprocesses, no printing, and no files written outside a `tempfile.TemporaryDirectory()`.',
    ].join(' '),
    async session(targets) {
      const dir = await o.place.folder('py');
      const preamble = o.preamble ? `${dir}/preamble.py` : '';
      const files: Record<string, string> = o.preamble ? { 'preamble.py': o.preamble } : {};
      const errors: Record<string, string> = {};
      for (const [name, code] of Object.entries(targets)) {
        if (/^\w+$/.test(name)) files[`fuzz_${name}.py`] = code;
        else errors[name] = `${name} is not a name a Python module can take`;
      }
      await o.place.put(dir, files);
      const file = (name: string) => `${dir}/fuzz_${name}.py`;
      const make = (name: string, timeoutMs: number) => o.place.driver([o.python, o.driver, file(name), o.root, String(timeoutMs), preamble], { cwd: dir, env: o.env });
      const drivers = new Map<string, { d: ReturnType<typeof make>; timeout: number }>();
      await Promise.all(Object.keys(targets).filter((n) => !errors[n]).map(async (name) => {
        const d = make(name, 5_000);
        if (await d.start()) drivers.set(name, { d, timeout: 5_000 });
        else errors[name] = d.fatal ?? 'did not load';
      }));
      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          let h = drivers.get(name);
          if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'TargetLoad', message: errors[name] ?? 'no such target' }));
          // The driver's own timer is set when it starts; a different allowance needs a new process.
          if (h.timeout !== timeoutMs) { h.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
          return h.d.run(inputs, timeoutMs, deadline);
        },
        release(name) {
          drivers.get(name)?.d.stop();
          drivers.delete(name);
        },
        async close() {
          for (const h of drivers.values()) h.d.stop();
          await o.place.remove(dir);
        },
      };
      if (await atheris()) session.native = (name, corpus, dict, seconds) => runAtheris(dir, file(name), preamble, name, corpus, dict, seconds);
      return { session, errors };
    },
    // The target is already the OSS-Fuzz file; one written without the `__main__` block gets it. OSS-Fuzz's
    // compile_python_fuzzer turns it into $OUT/<name>.
    oss(name, source) {
      const file = `${name}.py`;
      return { file, compile: [`compile_python_fuzzer $SRC/refuzz/${file}`], source: /^if\s+__name__\s*==\s*["']__main__["']\s*:/m.test(source) ? source : `${source.trimEnd()}${MAIN}`};
    },
  };

  /**
   * Real Atheris on one target for `seconds`, seeded with `corpus` and `dict`: python_fuzz.py --native records every failure
   * with its input and goes on, so the crashes are those records plus what libFuzzer itself kept (a native crash, a hang, a
   * blown memory limit).
   */
  async function runAtheris(dir: string, file: string, preamble: string, name: string, corpus: Buffer[], dict: string[], seconds: number) {
    const base = `${dir}/${name}-atheris`;
    await o.place.remove(base);
    await o.place.put(base, {
      ...Object.fromEntries((corpus.length ? corpus : [Buffer.from([0])]).map((c, i) => [`corpus/seed${i}`, c])),
      'artifacts/.keep': '',
      dict: [...new Set(dict)].filter((t) => t.length && t.length <= 64).map(dictEntry).join('\n') + '\n',
      'crashes.jsonl': '',
    });
    const r = await o.place.run([o.python, o.driver, '--native', file, o.root, `${base}/crashes.jsonl`, preamble, `-max_total_time=${seconds}`, '-timeout=5', '-rss_limit_mb=4096', `-dict=${base}/dict`, `-artifact_prefix=${base}/artifacts/`, '-print_final_stats=1', `${base}/corpus`], { cwd: base, env: o.env, timeoutMs: (seconds + 120) * 1000 });
    const output = `${r.stdout}\n${r.stderr}`;
    const execs = Number(/stat::number_of_executed_units:\s*(\d+)/.exec(output)?.[1] ?? [...output.matchAll(/^#(\d+)/gm)].at(-1)?.[1] ?? 0);
    if (/refuzz: the target did not load/.test(output)) log(`  atheris ${name}: ${/refuzz: the target did not load: .*/.exec(output)![0].slice(0, 300)}`);
    else if (!execs) log(`  atheris ${name}: did not run: ${output.trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`);
    else log(`  atheris ${name}: ${execs} execs, ${Math.max(0, ...[...output.matchAll(/\bcov: (\d+)/g)].map((m) => Number(m[1])))} coverage counters`);
    const files = await o.place.get(base);
    await o.place.remove(base);
    const crashes: { input: Buffer; report: Report }[] = (files['crashes.jsonl']?.toString('utf8') ?? '').split('\n').filter(Boolean).map((l) => {
      const c = JSON.parse(l);
      return { input: Buffer.from(c.input, 'base64'), report: c.report as Report };
    });
    for (const [f, input] of Object.entries(files)) {
      if (!f.startsWith('artifacts/')) continue;
      const leaf = f.slice('artifacts/'.length);
      if (leaf.startsWith('timeout-')) crashes.push({ input, report: { status: 'timeout', origin: 'library', type: 'Timeout', message: 'Atheris: ran longer than 5s' } });
      else if (leaf.startsWith('crash-') || leaf.startsWith('oom-')) crashes.push({ input, report: { status: 'error', origin: 'library', native: true, type: leaf.startsWith('oom-') ? 'OutOfMemory' : signalOf(output), message: output.trim().split('\n').slice(-8).join('\n').slice(-600) } });
    }
    const grown = Object.entries(files).filter(([f]) => f.startsWith('corpus/')).map(([, b]) => b);
    return { crashes, corpus: grown, execs };
  }
}

/** The probe's report, in the shape every adapter returns. */
export function toReport(r: any): Report {
  return {
    status: r.status,
    origin: r.origin === 'library' ? 'library' : r.status === 'ok' ? undefined : 'setup',
    type: r.exception?.type ?? r.error_type,
    message: r.exception?.message ?? r.error,
    frames: (r.stack ?? []).map((f: any) => ({ path: f.path, line: f.line, name: f.name })),
    native: r.error_type === 'NativeCrash',
    hits: r.hits,
    result: r.observation?.repr ?? r.result,
  };
}
