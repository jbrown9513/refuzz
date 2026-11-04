/**
 * What the project's own tests run and what they check, measured by `perch coverage` (perch's mutation testing) in the
 * project's built image: for each method in the files asked about, the tests that run it, and the mutants of it (one-line
 * edits) that every test running it lets through and that a caller could see. The fuzzer reads it two ways:
 *
 *   where    a surface whose code the tests leave unchecked is fuzzed before one whose code they check (gapOf), since a bug
 *            there is one nothing has caught yet;
 *   how      a target starts from a test that really runs the surface (testsRunning): its setup and order of calls are how
 *            the project calls that code, so the target's inputs go in the way a caller's do.
 *
 * perch coverage runs the project's tests itself, in copies of a git commit. The built image's tree is committed first, the
 * files the build generated included (a version file, compiled assets), so a copy is the project as built. Only the test files
 * named run, the others removed from that commit: perch coverage runs every test its runner finds, and a whole suite is hours. The map is kept with the store by commit, files
 * and tests, and a run that fails or runs out of time leaves no map: the fuzzer then ranks and writes as before.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { docker } from './run.ts';
import type { Built } from './types.ts';

/** The perch release that measures, installed once into a Docker volume with the Node that runs it. */
const PERCH_VERSION = '0.4.9';
const VOLUME = `perch-cli-${PERCH_VERSION}`;

export interface MethodTests {
  path: string;
  name: string;
  line: number;
  endLine: number;
  /** The tests that ran it, by perch coverage's test id. */
  tests: string[];
  /** Its mutants, not counting those that broke the build or that no caller could tell apart. */
  mutants: number;
  /** Mutants every test running it let through that a caller could see (the model's probability at least a half). */
  survived: { line: number; original: string; mutated: string; matters: number | null }[];
  /** Mutants no test reaches. */
  uncovered: number;
}

export interface TestMap {
  revision: string;
  methods: MethodTests[];
  tests: Map<string, { id: string; path: string; name: string; line: number; endLine: number }>;
}

/** The script the image runs: commit the built tree, name the tests to run, and run perch coverage over the files asked. */
const SCRIPT = String.raw`set -e
git config --global --add safe.directory '*'; git config --global user.email refuzz@localhost; git config --global user.name refuzz
cd "$REFUZZ_SRC"
[ -d .git ] || git init -q
# Every test file but those named is removed from the commit: perch coverage runs the whole suite its runner finds. A Go
# test file shares its package's test helpers with the others in its folder, so a named Go test keeps its whole folder's.
cp "$REFUZZ_KEEP" /tmp/refuzz-keep
grep '_test\.go$' "$REFUZZ_KEEP" | sed -E 's#(^|/)[^/]*$##' | sort -u > /tmp/refuzz-keep-dirs || true
git ls-files -co --exclude-standard | grep '_test\.go$' | while read -r f; do grep -qx -F "$(dirname "$f" | sed 's#^\.$##')" /tmp/refuzz-keep-dirs && echo "$f"; done >> /tmp/refuzz-keep || true
git ls-files -z -co --exclude-standard | grep -z -E '(^|/)(test_[^/]*\.py|[^/]*_test\.(py|go)|[^/]*\.(test|spec)\.[cm]?[jt]sx?)$' | grep -z -v -x -F -f /tmp/refuzz-keep | xargs -0 -r rm -f
git add -A
# What the build generated and .gitignore hides (a version module, compiled assets) is part of the project as built.
git ls-files -z -o -i --exclude-standard | grep -z -v -E '(^|/)(\.venv|venv|node_modules|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|target|build|dist|[^/]*\.egg-info|\.git)(/|$)' | xargs -0 -r git add -f
git commit -q --allow-empty -m "refuzz: the project as built"
[ -f /src/refuzz-services.sh ] && bash /src/refuzz-services.sh >/dev/null 2>&1 || true
set -a; [ -f /src/refuzz-test.env ] && . /src/refuzz-test.env; set +a
# The Python that runs the project's tests, first on PATH: in a monorepo with an environment per package, the environment of
# the package holding most of the tests to run (the nearest .venv above each), then any other. One with pytest-cov is taken
# over one without; with none, pytest-cov goes into the first with pytest, since perch coverage needs it.
venvs=$( { while read -r t; do d=$(dirname "$t"); while [ "$d" != . ] && [ ! -x "$d/.venv/bin/python" ]; do d=$(dirname "$d"); done; [ -x "$d/.venv/bin/python" ] && echo "$d/.venv/bin/python"; done < /tmp/refuzz-keep | sort | uniq -c | sort -rn | awk '{print $2}'; ls -d .venv/bin/python */.venv/bin/python */*/.venv/bin/python 2>/dev/null; } | awk '!seen[$0]++')
chosen=""
for py in $venvs; do "$py" -c 'import pytest, pytest_cov' 2>/dev/null && { chosen=$py; break; }; done
if [ -z "$chosen" ]; then
  for py in $venvs; do "$py" -c 'import pytest' 2>/dev/null && { chosen=$py; break; }; done
  [ -n "$chosen" ] && { "$chosen" -m pip install -q pytest-cov 2>/dev/null || { command -v uv >/dev/null && uv pip install -q --python "$chosen" pytest-cov; } || true; }
fi
[ -n "$chosen" ] && export PATH="$(cd "$(dirname "$chosen")" && pwd):$PATH"
if [ -z "$chosen" ] && command -v python >/dev/null && python -c 'import pytest' 2>/dev/null && ! python -c 'import pytest_cov' 2>/dev/null; then
  python -m pip install -q pytest-cov 2>/dev/null || { command -v uv >/dev/null && uv pip install -q --python "$(command -v python)" pytest-cov; } || true
fi
exec /opt/perch/node /opt/perch/node_modules/@lakeday/perch/bin/perch.mjs coverage --paths "$REFUZZ_PATHS" --out /out --all --verbose
`;

/**
 * Fixes to the installed perch, applied to its bundle each time (each is a no-op once applied). perch's pytest mutant server
 * asks every loaded module for `__file__`, and on a lazily loaded module (PEP 562's __getattr__) that imports it: prefect's
 * environment then imported tkinter, which its image lacks, and the server stopped. The module's own dictionary does not import,
 * and neither does asking only functions for their code.
 */
const PATCHES = [
  String.raw`s/getattr(module, '__file__', None)/(getattr(module, '__dict__', None) or {}).get('__file__')/`,
  // The same in its index of live functions, which asked every object in memory for `__code__` before checking it is a function.
  String.raw`s/code = getattr(item, '__code__', None)$/code = item.__code__ if type(item).__name__ == 'function' else None/`,
];

/** The Docker volume holding Node and perch, made once from the official Node image. */
async function perchVolume(log: (s: string) => void): Promise<boolean> {
  const patch = () => docker(['run', '--rm', '-v', `${VOLUME}:/opt/perch`, 'node:22', 'sed', '-i', ...PATCHES.flatMap((x) => ['-e', x]), '/opt/perch/node_modules/@lakeday/perch/dist/cli.mjs']);
  if ((await docker(['volume', 'inspect', VOLUME])).code === 0) return (await patch()).code === 0;
  log(`  tests: installing perch ${PERCH_VERSION} for measuring the project's tests`);
  await docker(['volume', 'create', VOLUME]);
  const r = await docker(['run', '--rm', '-v', `${VOLUME}:/opt/perch`, 'node:22', 'bash', '-c',
    `cp /usr/local/bin/node /opt/perch/node && cd /opt/perch && npm install --no-audit --no-fund --loglevel=error @lakeday/perch@${PERCH_VERSION}`], { timeoutMs: 600_000 });
  if (r.code !== 0) { await docker(['volume', 'rm', VOLUME]); log(`  tests: perch could not be installed: ${r.stderr.slice(-300)}`); return false; }
  return (await patch()).code === 0;
}

/** A saved report (perch coverage's latest.jsonl): a header line, then one `[list, item]` line per file, method, test and problem. */
function readReport(text: string, min: number): TestMap {
  const [header, ...rows] = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const methods: MethodTests[] = [], tests: TestMap['tests'] = new Map();
  for (const [list, item] of rows) {
    if (list === 'tests') tests.set(item.id, { id: item.id, path: item.path, name: item.name, line: item.line, endLine: item.end_line });
    if (list !== 'methods') continue;
    const counted = (item.mutants ?? []).filter((m: any) => !m.invalid && !m.equivalent && !m.skipped);
    methods.push({
      path: item.path, name: item.name, line: item.line, endLine: item.end_line,
      tests: (item.tests ?? []).map((t: any) => (typeof t === 'string' ? t : t.id)),
      mutants: counted.length,
      survived: counted.filter((m: any) => m.survives === 1 && (m.matters === null || m.matters >= min)).map((m: any) => ({ line: m.line, original: m.original, mutated: m.mutated, matters: m.matters })),
      uncovered: counted.filter((m: any) => m.no_coverage).length,
    });
  }
  return { revision: header?.revision ?? '', methods, tests };
}

/**
 * The tests' map over `files`, running only `tests`, measured in the built image (in a container of its own: the fuzzing
 * container is offline, and perch coverage asks Perch Cloud about the survivors). Kept under `cacheDir`, keyed by the
 * commit, the files and the tests. Undefined when perch cannot run there or the run fails or takes longer than `timeoutMs`.
 */
export async function mapTests(o: { built: Built; revision: string; files: string[]; tests: string[]; cacheDir: string; timeoutMs: number; log: (s: string) => void }): Promise<TestMap | undefined> {
  if (!o.files.length || !o.tests.length) return undefined;
  const key = createHash('sha1').update(JSON.stringify([o.revision, [...o.files].sort(), [...o.tests].sort()])).digest('hex').slice(0, 16);
  const saved = join(o.cacheDir, `${key}.jsonl`);
  if (existsSync(saved)) return readReport(readFileSync(saved, 'utf8'), 0.5);
  if (!(await perchVolume(o.log))) return undefined;
  const work = resolve('.fuzz', 'testmap', key);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, 'out'), { recursive: true });
  writeFileSync(join(work, 'run.sh'), SCRIPT);
  writeFileSync(join(work, 'keep'), `${o.tests.join('\n')}\n`);
  const started = Date.now();
  o.log(`  tests: measuring what ${o.tests.length} test files run and check in ${o.files.length} files (perch coverage)`);
  const r = await docker(['run', '--rm', '--name', `refuzz-testmap-${key}`, '--cpus', '8',
    '-v', `${VOLUME}:/opt/perch:ro`, '-v', `${join(homedir(), '.perch')}:/root/.perch`, '-v', `${join(work, 'out')}:/out`, '-v', `${work}:/refuzz-in:ro`,
    '-e', `REFUZZ_SRC=${o.built.src}`, '-e', 'REFUZZ_KEEP=/refuzz-in/keep', '-e', `REFUZZ_PATHS=${o.files.join(',')}`,
    '--entrypoint', 'bash', o.built.box.image, '/refuzz-in/run.sh'], { timeoutMs: o.timeoutMs });
  const latest = join(work, 'out', 'coverage', 'latest.jsonl');
  writeFileSync(join(work, 'log.txt'), `${r.stdout}\n${r.stderr}`);
  // Exit 3 is perch coverage listing problems, which is what it is for.
  if ((r.code !== 0 && r.code !== 3) || !existsSync(latest)) {
    await docker(['rm', '-f', `refuzz-testmap-${key}`]);
    o.log(`  tests: perch coverage did not finish (${r.code ?? 'timed out'} after ${Math.round((Date.now() - started) / 60_000)} min): ${`${r.stderr}`.trim().split('\n').at(-1)?.slice(0, 200) ?? ''}; see ${join(work, 'log.txt')}`);
    return undefined;
  }
  mkdirSync(o.cacheDir, { recursive: true });
  writeFileSync(saved, readFileSync(latest, 'utf8'));
  const map = readReport(readFileSync(saved, 'utf8'), 0.5);
  o.log(`  tests: ${map.tests.size} tests run ${map.methods.filter((m) => m.tests.length).length} of ${map.methods.length} methods; ${map.methods.reduce((n, m) => n + m.survived.length, 0)} mutants a caller could see survive them (${Math.round((Date.now() - started) / 60_000)} min)`);
  return map;
}

/** The methods of the map inside a function's lines: perch names methods its own way, so they are matched by place. */
export const methodsIn = (map: TestMap, t: { path: string; line: number; endLine: number }) => map.methods.filter((m) => m.path === t.path && m.line >= t.line && m.endLine <= t.endLine);

/**
 * How much of a surface's code its tests leave unchecked, from 0 (every mutant caught) to 1 (none caught, or no test runs
 * it): the share of its mutants that a caller could see and no test catches, or that no test reaches. Undefined when the map
 * holds none of its code.
 */
export function gapOf(map: TestMap, code: { path: string; line: number; endLine: number }[]): number | undefined {
  let all = 0, open = 0;
  for (const t of code) for (const m of methodsIn(map, t)) { all += m.mutants; open += m.survived.length + m.uncovered; }
  return all ? open / all : undefined;
}

/** The tests that ran a function, those running most of its lines' methods first. */
export function testsRunning(map: TestMap, t: { path: string; line: number; endLine: number }): { id: string; path: string; name: string; line: number; endLine: number }[] {
  const count = new Map<string, number>();
  for (const m of methodsIn(map, t)) for (const id of m.tests) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).map(([id]) => map.tests.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
}
