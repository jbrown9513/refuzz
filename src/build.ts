/**
 * How a project is built for fuzzing: the way OSS-Fuzz builds it, from a build spec in OSS-Fuzz's own format.
 *   Dockerfile    FROM the language's OSS-Fuzz base image, then what the build needs that is not in the repository (packages,
 *                 sibling repositories), a clone of the project, WORKDIR its folder, COPY build.sh $SRC/
 *   build.sh      run in the project's folder with OSS-Fuzz's variables ($SRC, $OUT, $WORK, $CC, $CFLAGS, $LIB_FUZZING_ENGINE),
 *                 builds and installs the project so fuzz targets can use it; the targets' own build lines are added after it
 *   project.yaml  OSS-Fuzz's project description
 * The spec is the project's, kept in `.refuzz/<language>/build/` and committed with the surfaces. Where it comes from,
 * in order: that folder; OSS-Fuzz's own `projects/<name>/`, when the project is in OSS-Fuzz; or the writer, from the
 * project's CI configuration, README and build files. A spec is kept only once it has built the project, and one that does
 * not (a new spec, or a kept one the code has outgrown) goes back to the writer with the error, the way a target does.
 *
 * The base images are OSS-Fuzz's, rebuilt for this machine (src/images/base-<family>.Dockerfile: the same paths, variables
 * and helper commands, built for its architecture), so a spec's FROM names OSS-Fuzz's image and builds unchanged in both.
 * The checkout is copied over the project's folder before build.sh runs, as OSS-Fuzz's `--source-path` does, and the
 * container after the build is saved as an image: the next run on the same code starts from it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tooLong, type Writer } from './llm/writer.ts';
import { COVERAGE_TOOLS, setUpCoverage } from './coverage.ts';
import { errorClass } from './engine.ts';
import { EXT } from './store.ts';
import { containerPlace } from './place.ts';
import { Container, docker, run, shq } from './run.ts';
import type { Adapter, Built } from './types.ts';

export interface BuildSpec { dockerfile: string; build: string; project: string; from: 'stored' | 'oss-fuzz' | 'written' }

/**
 * Per refuzz language: the family of base image, the image a spec's FROM names (OSS-Fuzz's where OSS-Fuzz has the language,
 * refuzz's own name where it does not), and OSS-Fuzz's name for the language in project.yaml.
 */
const FAMILIES: Record<string, { family: string; from: string; oss?: string[] }> = {
  c: { family: 'c', from: 'gcr.io/oss-fuzz-base/base-builder', oss: ['c', 'c++'] },
  cpp: { family: 'c', from: 'gcr.io/oss-fuzz-base/base-builder', oss: ['c++', 'c'] },
  python: { family: 'python', from: 'gcr.io/oss-fuzz-base/base-builder-python', oss: ['python'] },
  java: { family: 'jvm', from: 'gcr.io/oss-fuzz-base/base-builder-jvm', oss: ['jvm'] },
  kotlin: { family: 'jvm', from: 'gcr.io/oss-fuzz-base/base-builder-jvm', oss: ['jvm'] },
  scala: { family: 'jvm', from: 'gcr.io/oss-fuzz-base/base-builder-jvm', oss: ['jvm'] },
  groovy: { family: 'jvm', from: 'gcr.io/oss-fuzz-base/base-builder-jvm', oss: ['jvm'] },
  go: { family: 'go', from: 'gcr.io/oss-fuzz-base/base-builder-go', oss: ['go'] },
  rust: { family: 'rust', from: 'gcr.io/oss-fuzz-base/base-builder-rust', oss: ['rust'] },
  javascript: { family: 'javascript', from: 'gcr.io/oss-fuzz-base/base-builder-javascript', oss: ['javascript'] },
  typescript: { family: 'javascript', from: 'gcr.io/oss-fuzz-base/base-builder-javascript', oss: ['javascript'] },
  tsx: { family: 'javascript', from: 'gcr.io/oss-fuzz-base/base-builder-javascript', oss: ['javascript'] },
  ruby: { family: 'ruby', from: 'gcr.io/oss-fuzz-base/base-builder-ruby', oss: ['ruby'] },
  swift: { family: 'swift', from: 'gcr.io/oss-fuzz-base/base-builder-swift', oss: ['swift'] },
  c_sharp: { family: 'csharp', from: 'refuzz/base-builder-csharp' },
  php: { family: 'php', from: 'refuzz/base-builder-php' },
  lua: { family: 'lua', from: 'refuzz/base-builder-lua' },
  zig: { family: 'zig', from: 'refuzz/base-builder-zig' },
  bash: { family: 'bash', from: 'refuzz/base-builder-bash' },
  solidity: { family: 'solidity', from: 'refuzz/base-builder-solidity' },
};

export const familyOf = (language: string) => {
  const f = FAMILIES[language];
  if (!f) throw new Error(`no OSS-Fuzz base image for ${language}`);
  return f;
};

const IMAGES = resolve(import.meta.dirname, 'images');
/** Where fuzz containers keep targets and binaries (mounted at /tmp/refuzz); a link to a bigger disk where Docker's is small. */
export const SCRATCH = resolve('.fuzz', 'scratch');

/** The base image for a family, built here from src/images: tagged by the content of its Dockerfile and support files. */
async function baseImage(family: string, log: (s: string) => void): Promise<string> {
  const file = join(IMAGES, `base-${family}.Dockerfile`);
  if (!existsSync(file)) throw new Error(`src/images/base-${family}.Dockerfile does not exist`);
  const h = createHash('sha1').update(readFileSync(file));
  const support = join(IMAGES, family);
  if (existsSync(support)) for (const f of readdirSync(support, { recursive: true }).map(String).sort()) if (statSync(join(support, f)).isFile()) h.update(f).update(readFileSync(join(support, f)));
  const tag = `refuzz-base-${family}:${h.digest('hex').slice(0, 12)}`;
  if ((await docker(['image', 'inspect', tag])).code === 0) return tag;
  log(`  build: base image ${tag}`);
  const r = await docker(['build', '-q', '-t', tag, '-f', file, IMAGES], { timeoutMs: 3_600_000 });
  if (r.code !== 0) throw new Error(`building the ${family} base image failed: ${(r.stderr || r.stdout).slice(-800)}`);
  return tag;
}

/** A repository URL as a key: host and path, lower case, without scheme, user, `.git` or a trailing slash. */
const repoKey = (url: string) => url.trim().toLowerCase().replace(/^git@([^:]+):/, '$1/').replace(/^[a-z+]+:\/\/([^@/]+@)?/, '').replace(/\.git$/, '').replace(/\/+$/, '');

const OSS_FUZZ = resolve('.fuzz', 'oss-fuzz');

/** OSS-Fuzz's projects, as a sparse checkout of their project.yaml files, fetched once a day. */
async function ossFuzzIndex(log: (s: string) => void): Promise<string | undefined> {
  const fresh = existsSync(join(OSS_FUZZ, '.git', 'FETCH_HEAD')) && Date.now() - statSync(join(OSS_FUZZ, '.git', 'FETCH_HEAD')).mtimeMs < 86_400_000;
  if (!existsSync(join(OSS_FUZZ, '.git'))) {
    log('  build: fetching the OSS-Fuzz project list');
    const c = await run('git', ['clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', 'https://github.com/google/oss-fuzz', OSS_FUZZ], { timeoutMs: 600_000 });
    if (c.code !== 0) { log(`  build: could not fetch OSS-Fuzz: ${c.stderr.trim().split('\n').at(-1)}`); return undefined; }
    await run('git', ['-C', OSS_FUZZ, 'sparse-checkout', 'set', '--no-cone', '/projects/*/project.yaml'], { timeoutMs: 120_000 });
    await run('git', ['-C', OSS_FUZZ, 'checkout', '-q'], { timeoutMs: 600_000 });
  } else if (!fresh) {
    await run('git', ['-C', OSS_FUZZ, 'pull', '-q', '--depth', '1'], { timeoutMs: 600_000 });
  }
  return existsSync(join(OSS_FUZZ, 'projects')) ? OSS_FUZZ : undefined;
}

/** The project's spec in OSS-Fuzz, when OSS-Fuzz builds this repository in this language. */
async function fromOssFuzz(dir: string, language: string, log: (s: string) => void): Promise<{ spec: BuildSpec; name: string } | undefined> {
  const remote = (await run('git', ['-C', dir, 'remote', 'get-url', 'origin'])).stdout.trim();
  const oss = familyOf(language).oss;
  if (!remote || !oss) return undefined;
  const index = await ossFuzzIndex(log);
  if (!index) return undefined;
  const key = repoKey(remote);
  for (const name of readdirSync(join(index, 'projects'))) {
    const yaml = join(index, 'projects', name, 'project.yaml');
    if (!existsSync(yaml)) continue;
    const text = readFileSync(yaml, 'utf8');
    const main = /^main_repo:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
    const lang = /^language:\s*['"]?([\w+]+)/m.exec(text)?.[1] ?? 'c++';
    if (!main || repoKey(main) !== key || !oss.includes(lang)) continue;
    await run('git', ['-C', index, 'sparse-checkout', 'add', `/projects/${name}/`], { timeoutMs: 300_000 });
    const read = (f: string) => (existsSync(join(index, 'projects', name, f)) ? readFileSync(join(index, 'projects', name, f), 'utf8') : '');
    if (!read('Dockerfile') || !read('build.sh')) return undefined;
    log(`  build: OSS-Fuzz builds this project as ${name}; using its Dockerfile and build.sh`);
    return { spec: { dockerfile: read('Dockerfile'), build: read('build.sh'), project: text, from: 'oss-fuzz' }, name };
  }
  return undefined;
}

/** The project's folder in the image: the Dockerfile's last WORKDIR, under $SRC (OSS-Fuzz's helper reads it the same way). */
function workdirOf(dockerfile: string, name: string): string {
  const w = [...dockerfile.matchAll(/^\s*WORKDIR\s+(\S+)/gim)].at(-1)?.[1];
  if (!w) return `/src/${name}`;
  const path = w.replace(/^\$\{?SRC\}?/, '/src');
  return path.startsWith('/') ? path.replace(/\/+$/, '') : `/src/${path.replace(/\/+$/, '')}`;
}

/** Files a build is decided by: build systems' files, CI configuration, the README's build section. */
const BUILD_FILES = /^(CMakeLists\.txt|Makefile|GNUmakefile|configure\.ac|meson\.build|setup\.py|setup\.cfg|pyproject\.toml|requirements[\w.-]*\.txt|tox\.ini|package\.json|Gemfile|[\w.-]+\.gemspec|Rakefile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|[\w.-]+\.(csproj|sln)|composer\.json|[\w.-]+\.rockspec|build\.zig(\.zon)?|foundry\.toml|Package\.swift|Dockerfile|docker-compose\.ya?ml|justfile|\.gitmodules)$/;

/** What the writer reads to write a spec: the file tree, the build files, CI configuration and the README's build section. */
function projectContext(dir: string): string {
  const files = filesOf(dir);
  const tree = files.filter((f) => f.replace(/\/$/, '').split('/').length <= 2).slice(0, 300);
  let room = 30_000;
  const take = (f: string, cap: number) => {
    let text = '';
    try { text = readFileSync(join(dir, f), 'utf8').slice(0, cap); } catch { return ''; }
    if ((room -= text.length) < 0) return '';
    return `--- ${f}\n${text}`;
  };
  const build = files.filter((f) => !f.endsWith('/') && f.split('/').length <= 3 && BUILD_FILES.test(basename(f))).slice(0, 25).map((f) => take(f, 4000)).filter(Boolean);
  const ci = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$|^\.gitlab-ci\.yml$|^\.travis\.yml$|^\.circleci\/config\.yml$/.test(f)).slice(0, 8).map((f) => take(f, 6000)).filter(Boolean);
  const readmeFile = files.find((f) => /^readme(\.\w+)?$/i.test(f));
  let readme = '';
  if (readmeFile) {
    const text = readFileSync(join(dir, readmeFile), 'utf8');
    const at = text.search(/^#+.*\b(build|install|compil|getting started|setup|develop)/im);
    readme = text.slice(at >= 0 ? at : 0, (at >= 0 ? at : 0) + 6000);
  }
  return [`FILES (two levels):\n${tree.join('\n')}`, build.length ? `BUILD FILES:\n${build.join('\n\n')}` : '', ci.length ? `CI CONFIGURATION:\n${ci.join('\n\n')}` : '', readme ? `README (from its build section):\n${readme}` : ''].filter(Boolean).join('\n\n');
}

/** The checkout's files and folders (a folder ends in `/`) three levels down, without version control, dependencies or refuzz's state. */
function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries;
    try { entries = readdirSync(join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.refuzz' || (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.gitlab-ci.yml' && e.name !== '.travis.yml' && e.name !== '.circleci' && e.name !== '.gitmodules')) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out.push(`${path}/`); if (depth < 3) walk(path, depth + 1); } else out.push(path);
      if (out.length > 4000) return;
    }
  };
  walk('', 1);
  return out;
}

const SPEC_RULES = (from: string, name: string, base: string) => `An OSS-Fuzz build spec for this project, in OSS-Fuzz's own format, so the files could be submitted to OSS-Fuzz as they are.
Dockerfile: \`FROM ${from}\` (it already has the language's toolchain and fuzzing engine: ${base}). Then RUN lines installing what the project's build needs that is not in its repository: system packages (apt-get install -y), and other repositories its build expects beside it (a framework the code is a component or plugin of, a bundle it is built inside), cloned with git clone --depth 1 into $SRC at the branch or tag its CI uses. Then \`RUN git clone --depth 1 <the project's repository> ${name}\`, \`WORKDIR ${name}\`, and \`COPY build.sh $SRC/\`, in that order and last. The checkout under test replaces $SRC/${name} before build.sh runs.
build.sh: bash, run in $SRC/${name} with OSS-Fuzz's variables set ($SRC, $OUT, $WORK; $CC, $CXX, $CFLAGS and $CXXFLAGS instrumented with AddressSanitizer and libFuzzer's coverage; $LIB_FUZZING_ENGINE). It builds and installs the project the way its CI or README does, with those compilers and flags for any native code, so code in another folder can import or link it: a Python or Ruby package installed into the interpreter (with the extras or gems its users need, and its native extensions built), a JavaScript package's dependencies installed, a C or C++ library built static with its headers where the build puts them, a JVM project's classes and dependency jars, a Go or Rust module's dependencies fetched. Where the base image's description says fuzz targets compile against what is in $OUT (JVM jars, .NET assemblies), it puts the project's libraries and their dependencies there, as OSS-Fuzz's projects in that language do. It does not build or run fuzz targets or the test suite: fuzz targets are added after it. It skips the build's formatting, linting, style, license and API-compatibility checks (spotless, prettier, checkstyle, enforcer, rat, eslint and the like): they need tools of their own and change nothing that is built. A parent, sibling module or dependency at a version no registry has (a SNAPSHOT parent POM, an unreleased workspace package) is built and installed from its own repository first, at the branch or tag matching that version. Members of the project's own workspace (a uv workspace, npm, pnpm or yarn workspaces, a Cargo workspace, a go.work) come from this checkout, installed with the workspace's own tool where a plain install would look for them in a registry: Airflow's airflow-core needs its task-sdk and devel-common, so it is \`uv pip install --system -e ./task-sdk -e ./airflow-core -e ./devel-common\`, not pip. It may use the network.`;

/**
 * A few of the project's own test files in a language, smallest first, what the one-file test runner is checked on: files
 * named as tests (`x_test.go`, `test_x.py`, `x.test.ts`, `x.spec.rb`) before files that merely sit in a tests folder, since
 * a runner only runs the former.
 */
async function sampleTests(dir: string, language: string): Promise<string[]> {
  const ext = EXT[language];
  if (!ext) return [];
  const named = (f: string) => /(^|\/)test_[^/]+$|_test\.\w+$|\.(test|spec)\.\w+$|(^|\/)[^/]*_spec\.\w+$|(^|\/)Test[A-Z]\w*\.\w+$/.test(f);
  const files = (await run('git', ['-C', dir, 'ls-files'])).stdout.split('\n').filter((f) => f.endsWith(`.${ext}`) && (named(f) || /(^|\/)(tests?|__tests__|spec)\//.test(f)));
  const sized = files.map((f) => { try { return { f, n: statSync(join(dir, f)).size }; } catch { return { f, n: Infinity }; } }).filter((x) => x.n > 200);
  return sized.sort((a, b) => Number(named(b.f)) - Number(named(a.f)) || a.n - b.n).map((x) => x.f).slice(0, 3);
}

/** What test.sh is: the project's test suite, runnable offline, as its CI runs it. */
const TEST_RULES = `test.sh: bash, run after build.sh in the project's folder in the same image, with the network; nothing else in the image changes after it, and the tests then run offline. It installs everything the project's test suite needs, read from its CI configuration: the test runner and the test or dev dependencies (pip's test extras or requirements files, npm or yarn dev dependencies, go test modules fetched with go mod download, cargo's dev-dependencies fetched, bundle with the test group, maven or gradle test dependencies resolved offline), and test data the suite downloads. Where CI starts a service beside the tests (a database, a cache, a queue), it installs that service in the image and writes /src/refuzz-services.sh, which starts it and waits until it accepts connections, with the environment variables CI gives the tests exported from /src/refuzz-test.env. It ends by writing /src/refuzz-test-one.sh: a bash script that takes one test file's path, relative to the project's root, as $1, runs that file's tests and nothing else from the project's root the way CI runs tests (for Go, the package's directory with -run limited to the file's test functions, or the package), and exits non-zero when a test fails. That script does not change directory: it is called from the project's root and runs there. It does not run the test suite.`;

const RUN_RULES = `run.sh: only for a project that deploys a long-running server of its own; a library, a command-line tool or a framework has none, so service is none and there is no run.sh, never a script that only says so. run.sh: bash, run from the project's root in the built image after build.sh and test.sh, with the network. The project's root is the working directory it is run from, $(pwd); the script never changes directory away from it (no cd to its own location: the script lives in /src, beside refuzz's other scripts, not in the project), and every path to the project is relative to that root. Facts of the container: it has no git metadata, so a Go build takes -buildvcs=false; the services and database test.sh set up may already be running and initialised, so it starts only what is not running and makes every initialisation step idempotent (a role, database, schema or extension that exists is skipped; migrations already applied are skipped); it runs as root; there is no systemd and no docker. It starts the project's own service the way it is deployed, read from its Dockerfile CMD or entrypoint, its compose file, its Procfile, its CI end-to-end job and its README: builds the server binary or app if the build did not, starts the services it needs (reuse /src/refuzz-services.sh and /src/refuzz-test.env when test.sh wrote them, else start them here), applies migrations, then starts the server in the background with nohup. The server and the migrations connect to the database as the role and with the URL the project's own test and init scripts use (DATABASE_URL in its test env, the role its init SQL creates and configures, with that role's search path and grants), never as a superuser or a default the project does not use, since a deployment depends on that role's settings. It starts the server in the background with nohup, its output to /src/refuzz-run.log, listening on 127.0.0.1 on its usual port with the configuration a local deployment uses: every secret, key and URL the server needs set to a working local value. For a Go server, build it with \`go build -cover\` and run it with GOCOVERDIR=/src/refuzz-covdata (mkdir -p it first). It waits, up to 120 seconds, until a health or root URL answers with a 2xx, and fails (exit 1, with the log's tail) if it does not. It ends by writing /src/refuzz-run.env, one KEY=value per line: REFUZZ_RUN_URL (the base URL clients use), REFUZZ_RUN_HEALTH (the URL that answered), and every credential or setting a client needs to call the API as an administrator and as a user (the admin or service key, the JWT secret, API tokens, a test account and password), named the way the project's configuration names them. It also writes /src/refuzz-run-restart.sh, which stops the server and runs run.sh's start step again. It does not run the test suite and does not fuzz.`;

/**
 * Before a failed setup script is rewritten, the writer finds out why it failed: it names a few read-only commands to run in
 * the container (read a log, list a folder, query the database, fetch a URL), sees their output, and the rewrite gets that
 * with the error. A rewrite from the error's last lines alone repeats the same mistake; the cause is usually in a log or in
 * the state the script left behind.
 */
const UNSAFE = /\b(rm|mv|cp|dd|mkfs|chmod|chown|kill|pkill|killall|reboot|shutdown|apt|apk|yum|pip|npm|go\s+(build|install|get)|cargo|make|git\s+(reset|checkout|clean|push)|docker|sed\s+-i|tee|truncate|shred|wget|curl\s+[^|]*-(o|O)\b)\b|>>?\s*\S|\|\s*(sh|bash)\b/;
async function investigate(box: Container, src: string, name: string, language: string, writer: Writer, what: string, script: string, error: string): Promise<string> {
  const fields = {
    plan: `Why ${what} may have failed, from its error: the two or three most likely causes.`,
    commands: 'A JSON array of up to 6 shell commands, each read-only, to run from the project\'s root in the container to tell those causes apart: cat or tail a log, ls a folder, cat a config file, env, a database query with the client the project uses, curl of a URL. Nothing that changes files, processes or data.',
  };
  let out = '';
  try {
    const a = await writer.generate([`PROJECT: ${name} (${language}). ${what} FAILED.\n--- the script\n${script}\n--- its error\n${error}`].join('\n\n'), fields, `fuzz-${what.replace(/\W/g, '')}-inspect`, `refuzz-build-${familyOf(language).family}`);
    let list: unknown = [];
    try { list = JSON.parse((a.commands ?? '[]').replace(/^```\w*\n|\n```\s*$/g, '')); } catch {}
    const commands = (Array.isArray(list) ? list : []).filter((c): c is string => typeof c === 'string' && c.trim().length > 0 && !UNSAFE.test(c)).slice(0, 6);
    for (const c of commands) {
      const r = await box.exec(`bash -c ${shq(`set -a; [ -f /src/refuzz-test.env ] && . /src/refuzz-test.env; [ -f /src/refuzz-run.env ] && . /src/refuzz-run.env; set +a; cd ${shq(src)} && timeout 60 ${c} 2>&1 | tail -n 60`)}`, { timeoutMs: 90_000 });
      out += `\n$ ${c}\n${(r.stdout + r.stderr).trim().slice(0, 4000)}\n`;
    }
    if (a.plan) out = `likely causes: ${a.plan.slice(0, 600)}\n${out}`;
  } catch (e) {
    out += `\n(inspection failed: ${String((e as Error).message).split('\n')[0]})`;
  }
  return out ? `\n--- what an inspection of the container found\n${out}` : '';
}

/** The service's setup (RUN_RULES), or a rewrite of the last one from its error. */
async function writeRunSetup(dir: string, language: string, name: string, writer: Writer, last?: { script: string; error: string }): Promise<{ script: string } | string> {
  const fields = {
    plan: 'How the project is deployed and started: its server entrypoint and port, the services and migrations it needs, the configuration a local deployment uses, and the URL that says it is up.',
    service: "'none' when the project is a library, a command-line tool or a framework with no long-running server of its own to start (nothing in its Dockerfile CMD, compose file, Procfile, CI or README runs a server); otherwise 'yes'.",
    run_sh: 'The run.sh, complete, starting with `#!/bin/bash -eu`; empty when service is none.',
  };
  for (let budget = 1; ; budget /= 2) {
    const context = projectContext(dir);
    const prompt = [`PROJECT: ${name}, written in ${language}`, context.slice(0, Math.floor(context.length * budget)), last ? `THE LAST run.sh FAILED. Fix what the error names and keep the rest.\n--- the run.sh\n${last.script}\n--- its error\n${last.error}` : ''].filter(Boolean).join('\n\n');
    try {
      const a = await writer.generate(prompt, fields, last ? 'fuzz-run-setup-fix' : 'fuzz-run-setup', `refuzz-build-${familyOf(language).family}`, RUN_RULES);
      const script = (a.run_sh ?? '').replace(/^```\w*\n|\n```\s*$/g, '').trim();
      if (/^\W*none\b/i.test(a.service ?? '') || !script) return `no service to start: ${(a.plan ?? '').split('\n')[0].trim().slice(0, 200) || 'the writer returned no run.sh'}`;
      return { script: `${script}\n` };
    } catch (error) {
      if (tooLong(error) && budget > 0.1) continue;
      return `the writer failed: ${String((error as Error).message).split('\n')[0]}`;
    }
  }
}

/** The test suite's setup (TEST_RULES), or a rewrite of the last one from its error. */
async function writeTestSetup(dir: string, language: string, name: string, writer: Writer, last?: { script: string; error: string }): Promise<{ script: string } | string> {
  const fields = {
    plan: 'How the project\'s CI runs its tests: the test runner, the dependencies and extras it installs for them, the services it starts beside them and their settings.',
    test_sh: 'The test.sh, complete, starting with `#!/bin/bash -eu`.',
  };
  for (let budget = 1; ; budget /= 2) {
    const context = projectContext(dir);
    const prompt = [`PROJECT: ${name}, tested in ${language}`, context.slice(0, Math.floor(context.length * budget)), last ? `THE LAST test.sh FAILED. Fix what the error names and keep the rest.\n--- test.sh\n${last.script}\n--- the error\n${last.error.slice(-4000)}` : ''].filter(Boolean).join('\n\n');
    try {
      const a = await writer.generate(prompt, fields, last ? 'fuzz-test-setup-fix' : 'fuzz-test-setup', `refuzz-build-${familyOf(language).family}`, TEST_RULES);
      const script = (a.test_sh ?? '').replace(/^```\w*\n|\n```\s*$/g, '').trim();
      return script ? { script: `${script}\n` } : 'the writer returned no test.sh';
    } catch (error) {
      if (tooLong(error) && budget > 0.1) continue;
      return `the writer failed: ${String((error as Error).message).split('\n')[0]}`;
    }
  }
}

/** The spec the writer writes, or rewrites from what went wrong when the last one built. */
async function writeSpec(dir: string, language: string, name: string, writer: Writer, log: (s: string) => void, last?: { spec: BuildSpec; error: string }): Promise<BuildSpec | string> {
  const { from, family } = familyOf(language);
  const baseFile = join(IMAGES, `base-${family}.Dockerfile`);
  const base = (existsSync(baseFile) ? readFileSync(baseFile, 'utf8') : '').split('\n').filter((l) => l.startsWith('#')).map((l) => l.replace(/^#\s?/, '')).join(' ').slice(0, 1500);
  const remote = (await run('git', ['-C', dir, 'remote', 'get-url', 'origin'])).stdout.trim() || `https://github.com/<owner>/${name}`;
  const fields = {
    plan: 'How the project is built, read from its CI configuration first, then its build files and README: the toolchain and system packages, the repositories it needs beside it, and the commands, in order.',
    dockerfile: 'The Dockerfile, complete.',
    build_sh: 'The build.sh, complete, starting with `#!/bin/bash -eu`.',
  };
  for (let budget = 1; ; budget /= 2) {
    const context = projectContext(dir);
    const prompt = [`PROJECT: ${name} (${remote}), fuzzed in ${language}`, context.slice(0, Math.floor(context.length * budget)), last ? `THE LAST SPEC DID NOT BUILD THE PROJECT. Fix what the error names and keep the rest.\n--- Dockerfile\n${last.spec.dockerfile}\n--- build.sh\n${last.spec.build}\n--- the error\n${last.error.slice(-4000)}` : ''].filter(Boolean).join('\n\n');
    try {
      const a = await writer.generate(prompt, fields, last ? 'fuzz-build-fix' : 'fuzz-build', `refuzz-build-${family}`, SPEC_RULES(from, name, base));
      const strip = (x: string | undefined) => (x ?? '').replace(/^```\w*\n|\n```\s*$/g, '').trim();
      const dockerfile = strip(a.dockerfile), build = strip(a.build_sh);
      if (!dockerfile || !build) return 'the writer returned no Dockerfile or build.sh';
      return { dockerfile: `${dockerfile}\n`, build: `${build}\n`, project: `homepage: "${remote.replace(/\.git$/, '')}"\nlanguage: ${familyOf(language).oss?.[0] ?? language}\nmain_repo: "${remote}"\nsanitizers:\n  - address\nfuzzing_engines:\n  - libfuzzer\n`, from: 'written' };
    } catch (error) {
      if (tooLong(error) && budget > 0.1) continue;
      return `the writer failed: ${String((error as Error).message).split('\n')[0]}`;
    }
  }
}

/** The checkout's state: its commit and, when it has uncommitted changes, their content, so a changed checkout builds again. */
async function revision(dir: string): Promise<string> {
  const head = (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
  const dirty = (await run('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'])).stdout;
  const diff = dirty.trim() ? (await run('git', ['-C', dir, 'diff', 'HEAD'], { maxBytes: 64 * 1024 * 1024 })).stdout : '';
  return createHash('sha1').update(`${head}|${diff}`).digest('hex');
}

/**
 * A Go project built with the Go its go.mod names (its `toolchain` line, else its `go` line) when the base image's is newer:
 * what its CI builds with, and a dependency may refuse a newer Go (cockroachdb/swiss builds only before go1.27, which inngest
 * needs). Set with `go env -w`, which the image keeps, so its tests and fuzz targets use it too; the toolchain is fetched now,
 * while the build has the network.
 */
async function pinGo(box: Container, dir: string, log: (s: string) => void): Promise<void> {
  const mod = existsSync(join(dir, 'go.mod')) ? readFileSync(join(dir, 'go.mod'), 'utf8') : '';
  const wanted = /^toolchain\s+go(\d+\.\d+(?:\.\d+)?)/m.exec(mod)?.[1] ?? /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(mod)?.[1];
  const have = /go(\d+)\.(\d+)/.exec((await box.exec('go version')).stdout);
  if (!wanted || !have) return;
  const [major, minor] = wanted.split('.').map(Number);
  if (major !== Number(have[1]) || minor >= Number(have[2]) || minor < 21) return;
  const version = `go${wanted.split('.').length === 2 ? `${wanted}.0` : wanted}`;
  const r = await box.exec(`bash -c ${shq(`go env -w GOTOOLCHAIN=${version} && go version`)}`, { timeoutMs: 600_000 });
  log(`  build: ${r.code === 0 ? `Go ${version.slice(2)} as go.mod names it, not the image's go${have[1]}.${have[2]}` : `could not use go.mod's ${version}: ${(r.stderr || r.stdout).trim().split('\n').at(-1)}`}`);
  if (r.code !== 0) await box.exec('go env -u GOTOOLCHAIN');
}

/** Folders of the checkout not copied into the image: refuzz's own state and dependencies a build installs again. */
const NOT_COPIED = ['./.refuzz', './.fuzz', './node_modules'];

/**
 * The fuzzing image compiles C with coverage instrumentation, so a Python extension built during the build (PyGObject for
 * targetcli) needs the `__sancov_*` symbols Atheris provides: it imports while fuzzing and not under plain pytest. When an
 * installed or project extension has them undefined, every test run preloads Atheris's runtime, which defines them.
 */
const SANCOV_PRELOAD = (src: string) => `rt=$(python3 -c 'import atheris; print(atheris.path())' 2>/dev/null)/asan_with_fuzzer.so; [ -f "$rt" ] || exit 0
dirs="$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["purelib"], sysconfig.get_paths()["platlib"])') ${shq(src)}"
found=$(find $dirs -name '*.so' -type f 2>/dev/null | while read -r f; do nm -D --undefined-only "$f" 2>/dev/null | grep -q __sancov && { echo "$f"; break; }; done)
[ -n "$found" ] || exit 0
printf 'LD_PRELOAD=%s\nASAN_OPTIONS=detect_leaks=0:allocator_may_return_null=1\n' "$rt" >> /src/refuzz-test.env`;

/** Tests compile with gcc and no sanitizer flags (the image's CFLAGS have clang-only ones) unless test.sh set a compiler. */
const TEST_COMPILER = `command -v gcc > /dev/null || exit 0
grep -qE '^(export )?(CC|CXX|CFLAGS|CXXFLAGS)=' /src/refuzz-test.env 2>/dev/null && exit 0
printf '%s\\n' CC=gcc CXX=g++ "CFLAGS='-O1 -g'" "CXXFLAGS='-O1 -g'" >> /src/refuzz-test.env`;

/** Builds the project with one spec; returns the built project, or what went wrong. */
async function attempt(spec: BuildSpec, b: { dir: string; language: string; name: string; adapter: Adapter; testSetup: string; testsTried: boolean; setUpTests: (box: Container, src: string) => Promise<void>; inspect: (box: Container, src: string, error: string) => Promise<string> }, log: (s: string) => void): Promise<Built | string> {
  const { family, from } = familyOf(b.language);
  const base = await baseImage(family, log);
  const specHash = createHash('sha1').update(`${spec.dockerfile}\0${spec.build}\0${base}`).digest('hex').slice(0, 12);
  const src = workdirOf(spec.dockerfile, b.name);
  const built = `refuzz-built-${family}:${createHash('sha1').update(`${specHash}|${await revision(b.dir)}|${b.testSetup}|${COVERAGE_TOOLS}`).digest('hex').slice(0, 12)}`;
  // An image built before passed `ready` when it was built (one that does not is removed), so only a new build is checked.
  // An image whose test suite was never set up (built before test.sh, or its writer failed) is built again, once.
  const fresh = (await docker(['image', 'inspect', built])).code !== 0 || (!b.testSetup && !b.testsTried);
  if (fresh) {
    // The spec's image, its FROM line pointed at the base image built here, OSS-Fuzz's or refuzz's name alike.
    const ctx = resolve('.fuzz', 'build', specHash);
    mkdirSync(ctx, { recursive: true });
    writeFileSync(join(ctx, 'Dockerfile'), spec.dockerfile.replace(/^(\s*FROM\s+)(\S+)/im, (m, pre, image) => (image === from || /^gcr\.io\/oss-fuzz-base\/base-builder/.test(image) || /^refuzz\/base-builder/.test(image) ? `${pre}${base}` : m)));
    writeFileSync(join(ctx, 'build.sh'), spec.build);
    writeFileSync(join(ctx, 'project.yaml'), spec.project);
    const image = `refuzz-spec-${family}:${specHash}`;
    if ((await docker(['image', 'inspect', image])).code !== 0) {
      log(`  build: building the spec's image`);
      const r = await docker(['build', '-q', '-t', image, ctx], { timeoutMs: 3_600_000 });
      if (r.code !== 0) return `the Dockerfile did not build:\n${(r.stderr || r.stdout).trim().split('\n').slice(-60).join('\n')}`;
    }
    const box = new Container(image, `build-${family}`);
    try {
      await box.start();
      await box.copyIn(b.dir, src, NOT_COPIED);
      if (family === 'go') await pinGo(box, b.dir, log);
      log(`  build: running build.sh in ${src}`);
      const r = await box.exec(`bash -c ${shq('set -o pipefail; bash -eu $SRC/build.sh 2>&1 | tail -n 150')}`, { timeoutMs: 3_600_000 });
      if (r.code !== 0) {
        const error = `build.sh failed (exit ${r.code}):\n${(r.stdout + r.stderr).trim().split('\n').slice(-80).join('\n')}`;
        return error + (await b.inspect(box, src, error));
      }
      // The project's test suite made runnable offline, for findings proved with a failing test (src/verify.ts).
      await b.setUpTests(box, src);
      // Coverage tools for the verifier's measurement (src/coverage.ts), installed now: tests run without the network.
      if (!(await setUpCoverage(containerPlace(box), b.language, src))) log(`  build: ${b.language} coverage tools could not be installed; findings will not be measured`);
      await box.commit(built);
    } finally {
      await box.stop();
    }
  }
  const box = new Container(built, b.language);
  // Targets and their binaries in .fuzz/scratch, which can be a link to a bigger disk than Docker's: a big project's targets
  // are gigabytes each (ClickHouse's filled Docker's disk twice).
  mkdirSync(SCRATCH, { recursive: true });
  box.scratch = join(realpathSync(SCRATCH), box.name);
  mkdirSync(box.scratch, { recursive: true });
  await box.start(['-v', `${box.scratch}:/tmp/refuzz`]);
  await box.offline();
  const ready: Built = { box, src, dir: b.dir, name: b.name, language: b.language, ...(b.testSetup ? { testSetup: b.testSetup } : {}) };
  const wrong = fresh ? await b.adapter.ready?.(ready) : undefined;
  if (wrong) {
    const error = `build.sh ran, but the project is not usable by fuzz targets: ${wrong}`;
    const found = await b.inspect(box, src, error);
    await box.stop();
    await docker(['rmi', built]);
    return error + found;
  }
  return ready;
}

/**
 * The project built for one language: by its stored spec, OSS-Fuzz's, or one the writer writes, each repaired from its error
 * while the repairs make progress. A spec that builds is stored. Throws with the last error when none builds.
 */
export async function buildProject(o: { dir: string; language: string; adapter: Adapter; writer: Writer; specDir: string }, log: (s: string) => void): Promise<Built> {
  const read = (f: string) => (existsSync(join(o.specDir, f)) ? readFileSync(join(o.specDir, f), 'utf8') : '');
  let name = basename(o.dir).replace(/^[^_]*__/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  let spec: BuildSpec | string | undefined;
  if (read('Dockerfile') && read('build.sh')) {
    spec = { dockerfile: read('Dockerfile'), build: read('build.sh'), project: read('project.yaml'), from: 'stored' };
    name = /^#\s*project:\s*(\S+)/m.exec(read('project.yaml'))?.[1] ?? name;
    log('  build: the stored build spec');
  } else {
    const oss = await fromOssFuzz(o.dir, o.language, log);
    if (oss) { spec = oss.spec; name = oss.name; }
    else { log('  build: no build spec; writing one from the CI configuration and build files'); spec = await writeSpec(o.dir, o.language, name, o.writer, log); }
  }
  // test.sh: beside the OSS-Fuzz spec, which builds for fuzzing only. It installs what the project's test suite needs and runs
  // after build.sh, with the network; a finding is proved by a failing test in that suite. Written once from the project's CI
  // configuration, and repaired from its error while the repairs make progress. A suite that cannot be set up leaves the
  // project fuzzed, its findings unproved.
  const setUpTests = async (box: Container, src: string) => {
    const place = containerPlace(box);
    let script = /refuzz-test-one\.sh/.test(read('test.sh')) ? read('test.sh') : '', error = '', stuck = 0;
    for (;;) {
      if (!script) {
        const w = await writeTestSetup(o.dir, o.language, name, o.writer, error ? { script: read('test.sh.failed'), error: error + (await investigate(box, src, name, o.language, o.writer, 'test.sh', read('test.sh.failed'), error)) } : undefined);
        if (typeof w === 'string') { mkdirSync(o.specDir, { recursive: true }); writeFileSync(join(o.specDir, 'test.sh.failed'), `# ${w}\n`); log(`  build: test setup: ${w}`); return; }
        script = w.script;
      }
      await place.put('/src', { 'refuzz-test.sh': script });
      log('  build: running test.sh: the test suite, for proving findings');
      const r = await box.exec(`bash -c ${shq(`set -o pipefail; cd ${src} && bash -eu /src/refuzz-test.sh 2>&1 | tail -n 150`)}`, { timeoutMs: 3_600_000 });
      if (o.language === 'python' && r.code === 0) await box.exec(`bash -c ${shq(SANCOV_PRELOAD(src))}`, { timeoutMs: 600_000 });
      // Code compiled while tests run (cgo, Rust build scripts, native Node addons) builds with gcc, as Linux CI does: the
      // fuzzing image's clang is set up for instrumented builds, and its version can be too old for the project (Ollama's
      // bf16 headers on arm64). Left alone when test.sh chose a compiler.
      if (r.code === 0) await box.exec(`bash -c ${shq(TEST_COMPILER)}`, { timeoutMs: 60_000 });
      mkdirSync(o.specDir, { recursive: true });
      // test.sh must leave the script that runs one test file, and that script must run one of the project's own tests from
      // the project's root and pass, as CI does: verification runs every test through it.
      let failed = r.code === 0 ? '' : (r.stdout + r.stderr).trim().split('\n').slice(-60).join('\n');
      if (!failed && (await box.exec('test -s /src/refuzz-test-one.sh')).code !== 0) failed = 'test.sh ran but did not write /src/refuzz-test-one.sh, the script that runs one test file';
      // Checked on the project's own tests, a few in turn: one passing is proof; a sample that is not really a test (no
      // test functions in it) is not held against the runner.
      const samples = failed ? [] : await sampleTests(o.dir, o.language);
      let lastFail = '';
      for (const sample of samples) {
        const started = Date.now();
        const t = await box.exec(`bash -c ${shq(`set -o pipefail; [ -f /src/refuzz-services.sh ] && bash /src/refuzz-services.sh >/dev/null 2>&1; set -a; [ -f /src/refuzz-test.env ] && . /src/refuzz-test.env; set +a; export NO_COLOR=1 FORCE_COLOR=0 TERM=dumb CI=1; cd ${shq(src)} && timeout -s KILL 900 bash /src/refuzz-test-one.sh ${shq(sample)} 2>&1 | tail -n 60`)}`, { timeoutMs: 1_000_000 });
        // How long the project's own test of one file takes, compile included: a reproducer test's time limit is set from it.
        if (t.code === 0) { lastFail = ''; mkdirSync(o.specDir, { recursive: true }); writeFileSync(join(o.specDir, 'test-seconds'), String(Math.ceil((Date.now() - started) / 1000))); break; }
        lastFail = `/src/refuzz-test-one.sh ${sample}, run from the project's root (${src}) to check it on one of the project's own tests, failed (exit ${t.code}):\n${(t.stdout + t.stderr).trim()}`;
      }
      if (lastFail) failed = lastFail;
      if (!failed) { writeFileSync(join(o.specDir, 'test.sh'), script); return; }
      stuck = errorClass(failed) === errorClass(error) ? stuck + 1 : 0;
      error = failed;
      writeFileSync(join(o.specDir, 'test.sh.failed'), script);
      log(`  build: test.sh failed: ${failed.split('\n').at(-1)?.slice(0, 200)}`);
      if (stuck >= 2) { log('  build: the test suite could not be set up; findings are fuzzed but not proved with a test'); return; }
      script = '';
    }
  };
  // run.sh: the project's own service, started in the container as it is deployed, so targets for request handlers can
  // drive it over its API. Written once from the project's deployment files and repaired from its error while the repairs
  // make progress; run at every session, since a process does not outlive the container. A service that cannot be started
  // leaves the project fuzzed in-process only.
  const setUpRun = async (r: Built) => {
    const place = containerPlace(r.box);
    let script = read('run.sh'), error = '', stuck = 0, attempts = 0;
    for (;;) {
      if (!script) {
        if (++attempts > 4) { log('  run: the service could not be started in four attempts; targets fuzz the code in-process only'); return; }
        const w = await writeRunSetup(o.dir, o.language, name, o.writer, error ? { script: read('run.sh.failed'), error: error + (await investigate(r.box, r.src, name, o.language, o.writer, 'run.sh', read('run.sh.failed'), error)) } : undefined);
        if (typeof w === 'string') { mkdirSync(o.specDir, { recursive: true }); writeFileSync(join(o.specDir, 'run.sh.failed'), `# ${w}\n`); log(`  run: service setup: ${w}`); return; }
        script = w.script;
      }
      await place.put('/src', { 'refuzz-run.sh': script });
      log('  run: starting the project\'s service as deployed (run.sh)');
      const x = await r.box.exec(`bash -c ${shq(`set -o pipefail; cd ${r.src} && bash -eu /src/refuzz-run.sh 2>&1 | tail -n 120`)}`, { timeoutMs: 1_800_000 });
      mkdirSync(o.specDir, { recursive: true });
      let failed = x.code === 0 ? '' : (x.stdout + x.stderr).trim().split('\n').slice(-60).join('\n');
      const envText = failed ? '' : (await r.box.exec('cat /src/refuzz-run.env 2>/dev/null')).stdout;
      const env = Object.fromEntries(envText.split('\n').map((l) => l.trim()).filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
      if (!failed && !env.REFUZZ_RUN_URL) failed = 'run.sh ran but /src/refuzz-run.env has no REFUZZ_RUN_URL';
      if (!failed) {
        const h = await r.box.exec(`bash -c ${shq(`curl -fsS -o /dev/null -w '%{http_code}' ${env.REFUZZ_RUN_HEALTH ?? env.REFUZZ_RUN_URL}`)}`, { timeoutMs: 60_000 });
        if (h.code !== 0) failed = `the service did not answer at ${env.REFUZZ_RUN_HEALTH ?? env.REFUZZ_RUN_URL} after run.sh: ${(h.stdout + h.stderr).trim().slice(-300)}\n--- /src/refuzz-run.log\n${(await r.box.exec('tail -n 60 /src/refuzz-run.log 2>/dev/null')).stdout}`;
      }
      if (!failed) {
        writeFileSync(join(o.specDir, 'run.sh'), script);
        r.runSetup = script;
        r.service = { url: env.REFUZZ_RUN_URL, env };
        log(`  run: the service is up at ${env.REFUZZ_RUN_URL} (${Object.keys(env).length} settings in /src/refuzz-run.env)`);
        return;
      }
      stuck = errorClass(failed) === errorClass(error) ? stuck + 1 : 0;
      error = failed;
      writeFileSync(join(o.specDir, 'run.sh.failed'), script);
      log(`  run: run.sh failed: ${failed.split('\n').filter(Boolean).at(-1)?.slice(0, 200)}`);
      if (stuck >= 2) { log('  run: the service could not be started; targets fuzz the code in-process only'); return; }
      script = '';
    }
  };
  let error = '', stuck = 0;
  for (let round = 0; ; round++) {
    if (typeof spec === 'string') { error = spec; break; }
    const script = spec.build;
    const r = await attempt(spec, { dir: o.dir, language: o.language, name, adapter: o.adapter, testSetup: /refuzz-test-one\.sh/.test(read('test.sh')) ? read('test.sh') : '', testsTried: !!read('test.sh.failed') && /refuzz-test-one\.sh/.test(read('test.sh.failed')), setUpTests, inspect: (box, src, e) => investigate(box, src, name, o.language, o.writer, 'build.sh', script, e) }, log);
    if (typeof r !== 'string') {
      // The test setup this build ran, or the one an earlier build ran into the image it reused.
      if (/refuzz-test-one\.sh/.test(read('test.sh'))) r.testSetup = read('test.sh'); else delete r.testSetup;
      if (Number(read('test-seconds')) > 0) r.testSeconds = Number(read('test-seconds'));
      if (spec.from !== 'stored' || round > 0) {
        mkdirSync(o.specDir, { recursive: true });
        writeFileSync(join(o.specDir, 'Dockerfile'), spec.dockerfile);
        writeFileSync(join(o.specDir, 'build.sh'), spec.build);
        writeFileSync(join(o.specDir, 'project.yaml'), spec.project.includes('# project:') ? spec.project : `# project: ${name}\n${spec.project}`);
        log(`  build: built; spec kept in ${o.specDir}`);
      }
      if (!read('run.sh.failed') || read('run.sh')) await setUpRun(r);
      return r;
    }
    // Repaired while the repairs make progress: two in a row that end in the error they were given means the writer is stuck.
    // Stuck is judged on the error alone: the inspection after it differs every time.
    const own = (x: string) => x.split('\n--- what an inspection of the container found')[0];
    stuck = errorClass(own(r)) === errorClass(own(error)) ? stuck + 1 : 0;
    error = r;
    log(`  build: ${r.split('\n')[0]}`);
    if (stuck >= 2) break;
    spec = await writeSpec(o.dir, o.language, name, o.writer, log, { spec, error: r });
  }
  throw new Error(`no build spec built the project: ${error.split('\n').slice(-12).join('\n')}`);
}
