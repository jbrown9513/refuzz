/**
 * Rust: the project built and its dependencies fetched by its OSS-Fuzz build spec (src/build.ts) in the base-builder-rust
 * image, fuzz targets as cargo-fuzz files built in that container against the project's crates (rustFuzz below): run
 * in-process by refuzz's session runtime for coverage, and by libFuzzer as the native engine.
 */
import { join, normalize, relative, dirname } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { shq } from '../run.ts';
import { containerPlace, type Place } from '../place.ts';
import type { Adapter, Built, Frame, FuzzRuntime, FuzzSession, InputReport, Report, Runtime, Target } from '../types.ts';

/** One package with a library target. Paths are repository-relative ('' is the root). */
interface Crate {
  dir: string;
  package: string;
  /** The name harnesses `use` it by. */
  lib: string;
  src: string;
  root: string;
  /** Where cargo runs rustc from: paths in panics and backtraces are relative to it. */
  workspace: string;
  testable: boolean;
  /** Features on by default: an item behind any other, or behind cfg(test), is not in the library a test links. */
  features: Set<string>;
  /** Features that expose the crate's test helpers (`test-utils`): harnesses build with them on, as the project's tests do. */
  testing: string[];
}

/** One section of a Cargo.toml, `[name]` up to the next header. */
const section = (toml: string, name: string) => new RegExp(`^\\[${name.replace('.', '\\.')}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(toml)?.[1] ?? '';
const key = (text: string, k: string) => new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm').exec(text)?.[1];

/** Traits from std a harness may call methods through, and what brings each into scope ('' for the prelude). Drop is never called. */
const STD_TRAITS: Record<string, string> = {
  FromStr: 'std::str::FromStr', Display: 'std::fmt::Display', Debug: 'std::fmt::Debug', Read: 'std::io::Read', Write: 'std::io::Write',
  Seek: 'std::io::Seek', BufRead: 'std::io::BufRead', Hash: 'std::hash::Hash', Deref: 'std::ops::Deref', Index: 'std::ops::Index', Error: 'std::error::Error',
  From: '', TryFrom: '', Into: '', TryInto: '', Default: '', Iterator: '', DoubleEndedIterator: '', IntoIterator: '', PartialEq: '', PartialOrd: '',
  Ord: '', Eq: '', AsRef: '', AsMut: '', Clone: '', ToString: '', Extend: '', FromIterator: '',
};

const TESTING = /^(test|test[-_]?util(s|ities)?|testing|test[-_]?helpers?|test[-_]?support)$/;

/**
 * The crate's own dependencies and dev-dependencies, as lines of the harness crate's [dependencies]: what its tests can
 * `use` (the types its API takes, the test context a generic API needs), the harness can too. An entry the workspace defines
 * (`workspace = true`) takes the workspace's entry with the crate's own keys over it; relative paths become paths under
 * `root`, the project's folder in the container. Optional dependencies are left out, as a test without that feature
 * has them out.
 */
export function inheritedDeps(read: (p: string) => string, c: Crate, dev: boolean, root: string): string[] {
  const table = (v: string): Record<string, string> => {
    if (/^"/.test(v)) return { version: v };
    const out: Record<string, string> = {};
    for (const m of v.matchAll(/([\w-]+)\s*=\s*("[^"]*"|\[[^\]]*\]|true|false|\{[^}]*\})/g)) out[m[1]] = m[2];
    return out;
  };
  // `name = "1.0"`, `name = { ... }` (an inline table may run over several lines) and dotted keys (`name.workspace = true`).
  const entries = (text: string) => {
    const out = new Map<string, Record<string, string>>();
    const s = text.replace(/#[^\n"]*$/gm, '');
    for (const m of s.matchAll(/^\s*([\w-]+)\.([\w-]+)\s*=\s*("[^"\n]*"|\[[^\]]*\]|true|false)/gm)) out.set(m[1], { ...out.get(m[1]), [m[2]]: m[3] });
    for (const m of s.matchAll(/^\s*([\w-]+)\s*=\s*("[^"\n]*"|\{)/gm)) {
      if (m[2] !== '{') { out.set(m[1], table(m[2])); continue; }
      let depth = 0, i = m.index! + m[0].length - 1;
      for (; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}' && --depth === 0) break; }
      out.set(m[1], table(s.slice(m.index! + m[0].length - 1, i + 1).replace(/\s+/g, ' ')));
    }
    return [...out];
  };
  const shared = new Map(entries(section(read(join(c.workspace, 'Cargo.toml')), 'workspace.dependencies')));
  const own = read(join(c.dir, 'Cargo.toml'));
  const out = new Map<string, string>();
  for (const [name, t0] of [...entries(section(own, 'dependencies')), ...(dev ? entries(section(own, 'dev-dependencies')) : [])]) {
    if (out.has(name) || t0.optional === 'true') continue;
    const fromWs = t0.workspace === 'true';
    if (fromWs && !shared.has(name)) continue;
    const t = { ...(fromWs ? shared.get(name) ?? {} : {}), ...t0 };
    // The crate's features add to the workspace's, as cargo merges them.
    if (fromWs && shared.get(name)?.features && t0.features) t.features = `[${[shared.get(name)!.features, t0.features].map((f) => f.slice(1, -1).trim()).filter(Boolean).join(', ')}]`;
    delete t.workspace;
    delete t.optional;
    if ((t.package ?? `"${name}"`) === `"${c.package}"`) continue;
    if (t.path) t.path = JSON.stringify(normalize(join(root, fromWs && !t0.path ? c.workspace : c.dir, JSON.parse(t.path))));
    if (!Object.keys(t).length) continue;
    out.set(name, `${name} = { ${Object.entries(t).map(([k, v]) => `${k} = ${v}`).join(', ')} }`);
  }
  return [...out.values()];
}

/**
 * The workspace's [patch.*] and [replace] sections, which a harness crate (a workspace of its own) would otherwise not see:
 * without them the project builds against the published crates it patched (a forked rocksdb, a pinned crossbeam). Relative
 * paths become paths under `root`.
 */
function workspacePatches(read: (p: string) => string, c: Crate, root: string): string[] {
  const toml = read(join(c.workspace, 'Cargo.toml'));
  return [...toml.matchAll(/^\[(patch\.[^\]]+|replace)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)].map(([, name, body]) =>
    `[${name}]\n${body.replace(/\bpath\s*=\s*"([^"]+)"/g, (_, p) => `path = ${JSON.stringify(normalize(join(root, c.workspace, p)))}`).trim()}\n`);
}

/** Strips generic arguments, which may nest: `Foo<Bar<u8>>` → `Foo`. */
function noGenerics(s: string): string {
  let out = '', depth = 0;
  for (const c of s) {
    if (c === '<') depth++;
    else if (c === '>' && depth) depth--;
    else if (!depth) out += c;
  }
  return out;
}

/** Brackets balance outside strings, chars and comments: a harness that does not would break every harness after it in the file. */
function balanced(code: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '"') { for (i++; i < code.length && code[i] !== '"'; i++) if (code[i] === '\\') i++; continue; }
    // A char literal, not a lifetime: 'a' or '\n'.
    if (c === "'" && /^'(\\.[^']*|[^\\'])'/.test(code.slice(i, i + 12))) { i = code.indexOf("'", i + 2); continue; }
    if ('([{'.includes(c)) stack.push(c);
    else if (pairs[c] && stack.pop() !== pairs[c]) return false;
  }
  return stack.length === 0;
}

/** Whether a cfg predicate holds for a library linked into an integration test: `test` is off, features as given, anything
 * about the platform assumed on. */
function cfgOn(cond: string, feature: (f: string) => boolean): boolean {
  let i = 0;
  const expr = (): boolean => {
    while (/\s/.test(cond[i] ?? '')) i++;
    const name = /^[\w]+/.exec(cond.slice(i))?.[0] ?? '';
    i += name.length;
    while (/\s/.test(cond[i] ?? '')) i++;
    if (cond[i] === '(') {
      i++;
      const args: boolean[] = [];
      while (i < cond.length && cond[i] !== ')') {
        const from = i;
        args.push(expr());
        while (/[\s,]/.test(cond[i] ?? '')) i++;
        if (i === from) i++;
      }
      i++;
      return name === 'not' ? !args[0] : name === 'any' ? args.some(Boolean) : args.every(Boolean);
    }
    if (cond[i] === '=') {
      const value = /^=\s*"([^"]*)"/.exec(cond.slice(i));
      i += value?.[0].length ?? 1;
      return name === 'feature' ? feature(value?.[1] ?? '') : true;
    }
    return name !== 'test';
  };
  return expr();
}

/**
 * RUSTFLAGS for the project's crates and the target binary, per build: trace-pc-guard for the session's own edge counter,
 * libFuzzer's for native. `--cfg fuzzing` is not here: it goes to every crate through RUSTFLAGS (buildEnv), as cargo-fuzz
 * sets it, so cargo also resolves the project's `[target.'cfg(fuzzing)'.dependencies]` (zip's `arbitrary`).
 */
const SANCOV = {
  session: '-C passes=sancov-module -C llvm-args=-sanitizer-coverage-level=3 -C llvm-args=-sanitizer-coverage-trace-pc-guard -C llvm-args=-sanitizer-coverage-pc-table',
  native: '-C passes=sancov-module -C llvm-args=-sanitizer-coverage-level=4 -C llvm-args=-sanitizer-coverage-inline-8bit-counters -C llvm-args=-sanitizer-coverage-pc-table -C llvm-args=-sanitizer-coverage-trace-compares',
};

/** The `arbitrary` a target may derive its input type with, as cargo-fuzz's template depends on it. */
const ARBITRARY = 'arbitrary = { version = "1", features = ["derive"] }';

/** A libFuzzer dictionary entry: printable ASCII as is, anything else as \xNN. */
const dictEntry = (t: string) => `"${[...Buffer.from(t, /^[\x00-\xff]*$/.test(t) ? 'latin1' : 'utf8')].map((b) => (b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('')}"`;

/** Macros a target states a property with: a panic they raise on one of the target's lines is its assertion failing. */
const ASSERTS = /(?<![\w!])(?:debug_)?assert(?:_eq|_ne)?!|(?<![\w!])(?:panic|unreachable)!/;

/**
 * What a panic printed (`thread '…' panicked at file:line:col:`, the message, then with RUST_BACKTRACE=1 the backtrace)
 * says about whose failure it was: the innermost frame in the project or the target decides, and a panic raised on a line of
 * the target that asserts is the target's assertion. `repo` maps a path to the project's, `target` says a path is the
 * target's, `source` is its text. Undefined when nothing panicked.
 */
function panicReport(stderr: string, repo: (p: string) => string | null, target: (p: string) => boolean, source: string): Report | undefined {
  const p = /thread '[^']*'(?: \(\d+\))? panicked at ([^\n]+?):(\d+):\d+:\n([\s\S]*?)(?=\nnote: |\nstack backtrace:|\n==\d+==|$)/.exec(stderr);
  if (!p) return undefined;
  const trace: { path: string; line: number; name: string }[] = [{ path: p[1], line: Number(p[2]), name: '' }];
  const bt = stderr.split('\nstack backtrace:\n')[1]?.split('\n') ?? [];
  for (let i = 0; i < bt.length; i++) {
    const sym = /^\s*\d+:\s+(.+)$/.exec(bt[i]);
    const at = sym && /^\s+at\s+(.+):(\d+):\d+$/.exec(bt[i + 1] ?? '');
    if (sym && at) trace.push({ path: at[1], line: Number(at[2]), name: sym[1].replace(/::h[0-9a-f]{16}$/, '') });
  }
  const frames: Frame[] = [];
  let origin: Report['origin'];
  for (const f of trace) {
    if (target(f.path)) { origin ??= ASSERTS.test(source.split('\n')[f.line - 1]?.split('//')[0] ?? '') && f === trace[0] ? 'assertion' : 'setup'; break; }
    const path = repo(f.path);
    if (!path) continue;
    origin ??= 'library';
    const prev = frames.at(-1);
    if (!prev || prev.path !== path || prev.line !== f.line) frames.push({ path, line: f.line, name: f.name });
    else if (!prev.name) prev.name = f.name;
  }
  return { status: 'error', origin: origin ?? 'setup', type: origin === 'assertion' ? 'assertion' : 'panic', message: p[3].trim().slice(0, 1200), frames: frames.reverse() };
}

/**
 * The rustc wrapper for target builds: the project's crates (sources under `src`) and the fuzz targets (targets/*.rs, where
 * the project's generic code is monomorphized) get REFUZZ_SAN_FLAGS; refuzz_rt, dependencies, build scripts and proc macros
 * stay plain.
 */
const SAN_RUSTC = (src: string) => [
  '#!/bin/sh',
  'proj=',
  'target=',
  'for a in "$@"; do',
  `  case "$a" in --target|--target=*) target=1;; ${src}/*.rs|targets/*.rs) proj=1;; esac`,
  'done',
  'if [ -n "$proj" ] && [ -n "$target" ]; then exec "$@" $REFUZZ_SAN_FLAGS; fi',
  'exec "$@"', '',
].join('\n');

/** Where target crates are built in the container. */
const WORK = '/work/refuzz-rust';

/**
 * Fuzz targets for Rust: cargo-fuzz files, built outside the project in a crate of their own per project crate, which depends
 * on it by path (`src`, the project's folder in the container), so nothing is written into the project. A session builds
 * them in WORK/g-<crate> against refuzz-rt standing in for libfuzzer-sys (src/probes/rust_session.rs, whose fuzz_target!
 * makes the binary refuzz's in-process driver); native() builds the same file in WORK/n-<crate> against the real
 * libfuzzer-sys. The project's crates and the target binary are instrumented (SAN_RUSTC): generic project code is
 * monomorphized in the binary that instantiates it. refuzz-rt (its sanitizer callbacks, the serve loop, panic reports),
 * dependencies, build scripts and proc macros stay plain: target crates build with an explicit --target, so anything that
 * runs on the host, including a project crate a build script depends on, reaches SAN_RUSTC without one and is never linked
 * against a coverage runtime it does not have. Everything builds offline from what the build spec fetched and
 * the base image's libfuzzer-sys and arbitrary.
 */
function rustFuzz(o: { place: Place; src: string; dir: string; crateOf: (path: string) => Crate | null; crates: Crate[]; repoPath: (p: string, c: Crate) => string | null; log: (s: string) => void }): FuzzRuntime {
  const { place, src } = o;
  let ids = 0;

  const locked = new Set<string>();
  /** The crate each target source was built in, for oss(). */
  const homes = new Map<string, Crate>();
  /** Crates whose target crate builds without their dev-dependencies, after one of them would not build. */
  const noDev = new Set<string>();
  const read = (p: string) => { try { return readFileSync(join(o.dir, p), 'utf8'); } catch { return ''; } };
  /** The crate a target names (`mycrate::` or `use mycrate`), else the first of `crates`. */
  const home = (code: string, crates: Crate[]) => crates.find((k) => new RegExp(`(?<![\\w:])${k.lib}::|\\buse\\s+${k.lib}\\b`).test(code)) ?? crates[0];
  /**
   * A target crate's manifest: the project crate by path under `src` (with its test-helper features), `own` dependencies,
   * the crate's own (dev-)dependencies, one [[bin]] per target (`names`, sources under `path`), the release profile the
   * targets build with, and the workspace's patches.
   */
  const manifest = (c: Crate, own: string[], names: string[], path: string) => {
    const features = c.testing.length ? `, features = [${c.testing.map((f) => `"${f}"`).join(', ')}]` : '';
    return [
      '[package]', 'name = "refuzz"', 'version = "0.0.0"', 'edition = "2021"', 'publish = false', '',
      '[dependencies]', `"${c.package}" = { path = "${join(src, c.dir)}"${features} }`, ...own,
      ...inheritedDeps(read, c, !noDev.has(c.lib), src).filter((l) => !/^(refuzz-rt|libfuzzer-sys|arbitrary) =/.test(l)), '',
      ...names.flatMap((n) => ['[[bin]]', `name = "${n}"`, `path = "${path}/${n}.rs"`, 'test = false', 'doc = false', 'bench = false', '']),
      // Fast enough to fuzz, with the checks a debug build has: overflow and debug assertions panic as they would in tests.
      '[profile.release]', 'opt-level = 1', 'debug = "line-tables-only"', 'debug-assertions = true', 'overflow-checks = true', 'panic = "unwind"', 'lto = false', 'codegen-units = 16', 'incremental = true', '',
      '[workspace]', '',
      ...workspacePatches(read, c, src),
    ].join('\n');
  };
  /** The project's lockfile as the build left it in the container, so dependencies resolve to the versions it fetched. */
  const lockOf = async (c: Crate) => {
    const r = await place.run(['cat', join(src, c.workspace, 'Cargo.lock')]);
    return r.code === 0 ? r.stdout : undefined;
  };
  /**
   * The target crate for one project crate and build mode, with `sources` as its targets: its manifest, the targets, the
   * project's lockfile, and for a session refuzz-rt (rt/) as the libfuzzer-sys it depends on.
   */
  const crateDir = async (c: Crate, mode: 'session' | 'native', sources: Record<string, string>) => {
    const g = `${WORK}/${mode === 'session' ? 'g' : 'n'}-${c.lib}`;
    await place.remove(`${g}/targets`);
    const files: Record<string, string | Buffer> = {};
    for (const [n, code] of Object.entries(sources)) files[`targets/${n}.rs`] = code;
    files['Cargo.toml'] = manifest(c, [mode === 'session' ? 'libfuzzer-sys = { package = "refuzz-rt", path = "rt" }' : 'libfuzzer-sys = "0.4"', ARBITRARY], Object.keys(sources), 'targets');
    if (mode === 'session') {
      files['rt/Cargo.toml'] = ['[package]', 'name = "refuzz-rt"', 'version = "0.0.0"', 'edition = "2021"', 'publish = false', '', '[lib]', 'name = "refuzz_rt"', 'path = "src/lib.rs"', '', '[dependencies]', 'arbitrary = "1"', ''].join('\n');
      files['rt/src/lib.rs'] = '//! libfuzzer-sys as a session target sees it: fuzz_target!, Corpus and arbitrary.\n#![allow(warnings)]\npub mod refuzz;\npub mod session;\npub use session::Corpus;\npub use arbitrary;\n';
      files['rt/src/refuzz.rs'] = readFileSync(join(import.meta.dirname, '..', 'probes', 'rust_value.rs'));
      files['rt/src/session.rs'] = readFileSync(join(import.meta.dirname, '..', 'probes', 'rust_session.rs'));
    }
    // The project's lockfile, once per target crate: after that the target crate's own lockfile carries on from it.
    if (!locked.has(g)) {
      const lock = await lockOf(c);
      if (lock) files['Cargo.lock'] = lock;
      locked.add(g);
    }
    await place.put(g, files);
    return g;
  };
  /** The environment target builds run in: offline, instrumented by SAN_RUSTC, C code built plain (no ASan runtime is linked). */
  const buildEnv = (mode: 'session' | 'native') => ({ CARGO_TARGET_DIR: `${WORK}/target-${mode}`, CARGO_TERM_COLOR: 'never', RUSTC_WRAPPER: `${WORK}/san-rustc.sh`, RUSTFLAGS: '--cfg fuzzing', REFUZZ_SAN_FLAGS: SANCOV[mode], CFLAGS: '', CXXFLAGS: '' });

  /** The target a rustc error is in: the file of its spans, or of the macro calls they were expanded from. */
  const blamed = (m: any, live: string[]): string | undefined => {
    const files = (spans: any[]): string[] => spans.flatMap((x: any) => [x.file_name, ...(x.expansion?.span ? files([x.expansion.span]) : [])]);
    const all = files(m.message?.spans ?? []);
    for (const f of all) { const n = /(?:^|\/)targets\/(\w+)\.rs$/.exec(f)?.[1]; if (n && live.includes(n)) return n; }
  };

  /** One build at a time in each target crate: a build rewrites the crate's targets and manifest. */
  const building = new Map<string, Promise<unknown>>();
  const build = (c: Crate, mode: 'session' | 'native', sources: Record<string, string>, errors: Record<string, string>): Promise<Map<string, string> | null> => {
    const key = `${mode}|${c.dir}`;
    const next = (building.get(key) ?? Promise.resolve()).then(() => buildOnce(c, mode, sources, errors));
    building.set(key, next.catch(() => {}));
    return next;
  };

  /** Builds targets as binaries of the target crate, dropping the ones rustc blames until the rest build. */
  async function buildOnce(c: Crate, mode: 'session' | 'native', sources: Record<string, string>, errors: Record<string, string>): Promise<Map<string, string> | null> {
    let live = Object.keys(sources).filter((n) => balanced(sources[n]) || ((errors[n] = 'unbalanced brackets in the target'), false));
    for (let attempt = 0; attempt < 12 && live.length; attempt++) {
      const g = await crateDir(c, mode, Object.fromEntries(live.map((n) => [n, sources[n]])));
      const r = await place.run(['sh', '-c', `touch targets/*.rs && cargo build --release --offline --bins --message-format=json --target "$(rustc -vV | sed -n 's/^host: //p')"`], { cwd: g, env: buildEnv(mode), timeoutMs: 3_600_000 });
      const msgs = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const exes = new Map<string, string>(msgs.filter((m) => m.reason === 'compiler-artifact' && m.target?.kind?.includes('bin') && live.includes(m.target.name) && m.executable).map((m) => [m.target.name, m.executable]));
      if (r.code === 0 && live.every((n) => exes.has(n))) return exes;
      const errs = new Map<string, string[]>();
      for (const m of msgs) {
        if (m.reason !== 'compiler-message' || m.message?.level !== 'error') continue;
        const at = blamed(m, live);
        if (at) errs.set(at, [...(errs.get(at) ?? []), String(m.message.rendered ?? m.message.message)]);
      }
      if (!errs.size) {
        const why = msgs.filter((m) => m.reason === 'compiler-message' && m.message?.level === 'error').map((m) => m.message.rendered).join('\n') || r.stderr.trim().split('\n').slice(-12).join('\n');
        // Failing outside every target: a dev-dependency that cannot build here (one whose build script compiles contracts
        // for another target, say). The target crate goes on with the crate's own dependencies only.
        if (!noDev.has(c.lib)) { o.log(`  rust fuzz: building without ${c.package}'s dev-dependencies: ${why.split('\n')[0].slice(0, 200)}`); noDev.add(c.lib); continue; }
        for (const n of live) errors[n] = why.slice(0, 1500);
        return null;
      }
      for (const [n, e] of errs) errors[n] = e.join('\n').replaceAll(`targets/${n}.rs`, `${n}.rs`).slice(0, 1500);
      live = live.filter((n) => !errs.has(n));
    }
    return null;
  }

  return {
    guide: [
      'A cargo-fuzz target, the file a project keeps in src/fuzz_targets/: `#![no_main]`, `use libfuzzer_sys::fuzz_target;`, `use` lines naming the project by its crate name (`use mycrate::module::Item;`, never `crate::`), then `fuzz_target!(|data: &[u8]| { ... });`, whose body runs once per input with the raw bytes.',
      'The crate\'s public items are reachable, with its test-helper features (test-utils) on, and its dependencies, std and `arbitrary`.',
      'Split the bytes into arguments by slicing with explicit length checks (`if data.len() < 4 { return; } let (head, rest) = data.split_at(4); let n = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);`); take text with `let Ok(s) = std::str::from_utf8(rest) else { return };` when the target takes &str. Or derive the input: `#[derive(Debug, arbitrary::Arbitrary)] struct Input { … }` and `fuzz_target!(|input: Input| { … });`.',
      'Build objects the way the project\'s own tests do. Write files only under std::env::temp_dir(); a file the target reads back must be opened readable (File::create is write-only: write the bytes, then std::fs::OpenOptions::new().read(true).write(true).open(path)). No unsafe, no threads, do not catch panics, do not print.',
      'A documented `Err` or `None` is the project\'s answer: match it and go on or return, never unwrap or `?` the target\'s result; `.unwrap()` only what cannot fail.',
      'State what the project promises for every input it accepts with `assert!(cond, "what it promises: {:?}", value)` or `assert_eq!(a, b, "what it promises")`, inside the branch where the promise holds: `if let Ok(v) = Version::parse(s) { assert_eq!(Version::parse(&v.to_string()).ok(), Some(v.clone()), "what Display printed parses back"); }`. A round trip, a bound on a result\'s size or range, agreement with another function of the project that must agree. A failed assertion on a line of the target is reported as a finding with its message; a panic in the project as the project\'s; any other panic in the target\'s lines (an unwrap, an index) as the target\'s mistake.',
    ].join(' '),
    async session(targets, project) {
      const errors: Record<string, string> = {};
      const crates = [...new Map(project.map((t) => o.crateOf(t.path)).filter((c): c is Crate => !!c).map((c) => [c.dir, c])).values()];
      const groups = new Map<Crate, Record<string, string>>();
      for (const [n, code] of Object.entries(targets)) {
        if (!/^\w+$/.test(n)) { errors[n] = `${n} is not a name a binary can take`; continue; }
        const c = home(code, crates.length ? crates : o.crates);
        if (!c) { errors[n] = 'the project has no library crate'; continue; }
        homes.set(code, c);
        groups.set(c, { ...(groups.get(c) ?? {}), [n]: code });
      }
      // Each session keeps its own copies of the binaries and the target sources: a later session rebuilds the crate's.
      const id = `s${++ids}-${Date.now().toString(36)}`;
      const live = new Map<string, { c: Crate; dir: string; source: string }>();
      for (const [c, sources] of groups) {
        const built = await build(c, 'session', sources, errors);
        if (!built) continue;
        const d = `${WORK}/g-${c.lib}/${id}`;
        await place.put(d, Object.fromEntries([...built.keys()].map((n) => [`${n}.rs`, sources[n]])));
        // Guard n's source line is line n of <target>.lines: the guards' addresses, through addr2line, once per build.
        const r = await place.run(['sh', '-c', [...built].map(([n, exe]) => `cp ${shq(exe)} ${n} && ./${n} --pcs > ${n}.pcs && addr2line -e ${n} < ${n}.pcs > ${n}.lines`).join(' && ')], { cwd: d, timeoutMs: 600_000 });
        if (r.code !== 0) o.log(`  rust fuzz: no line map (${r.stderr.trim().slice(-200)})`);
        for (const n of built.keys()) live.set(n, { c, dir: d, source: sources[n] });
      }
      const make = (n: string, timeoutMs: number) => {
        const h = live.get(n)!;
        const tmp = `/tmp/refuzz-g/${id}/${n}`;
        return place.driver(['sh', '-c', `mkdir -p ${tmp} && cd ${tmp} && ulimit -v 8388608 && TMPDIR=${tmp} exec ${h.dir}/${n} ${timeoutMs} ${h.dir}/${n}.lines ${h.dir}/${n}.rs`], { env: { REFUZZ_ROOT: src } });
      };
      const drivers = new Map<string, { d: ReturnType<typeof make>; timeout: number }>();
      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          if (!live.has(name)) return inputs.map((): InputReport => ({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: errors[name] ?? 'no such target' }));
          let h = drivers.get(name);
          // The process's own limit is set when it starts; a different allowance needs a new one.
          if (!h || h.timeout !== timeoutMs) { h?.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
          return h.d.run(inputs, timeoutMs, deadline);
        },
        release(name) {
          drivers.get(name)?.d.stop();
          drivers.delete(name);
        },
        close: async () => {
          for (const h of drivers.values()) h.d.stop();
          for (const d of new Set([...live.values()].map((x) => x.dir))) await place.remove(d);
          await place.remove(`/tmp/refuzz-g/${id}`);
        },
      };
      session.native = async (name, corpus, dict, seconds) => {
        const h = live.get(name);
        const none = { crashes: [], corpus: [], execs: 0 };
        if (!h) return none;
        const errs: Record<string, string> = {};
        const built = await build(h.c, 'native', { [name]: h.source }, errs);
        if (!built) { o.log(`  rust native: ${name} did not build: ${(errs[name] ?? '').slice(0, 300)}`); return none; }
        const ndir = `${WORK}/n-${h.c.lib}/${id}-${name}`;
        await place.remove(ndir);
        await place.put(ndir, {
          ...Object.fromEntries(corpus.map((b, i) => [`corpus/seed-${i}`, b])),
          'dict.txt': `${dict.filter((t) => t.length && t.length <= 128).map(dictEntry).join('\n')}\n`,
        });
        await place.run(['sh', '-c', `mkdir -p corpus art && cp ${shq(built.get(name)!)} fuzzer`], { cwd: ndir });
        const target = (p: string) => !p.startsWith('/') || p.startsWith(`${WORK}/`);
        const crashes: { input: Buffer; report: Report }[] = [];
        const seenCause = new Set<string>();
        let execs = 0;
        const end = Date.now() + seconds * 1000;
        // libFuzzer in fork mode, ignoring crashes, timeouts and out-of-memory: it keeps fuzzing past every failure it has
        // found, for the whole slot, and leaves each failing input in art/. Run plainly, it stops at its first crash, and a
        // shallow one found again at once after every restart ends native fuzzing for the slot.
        {
          const left = Math.max(1, Math.round((end - Date.now()) / 1000));
          const tmp = `/tmp/refuzz-n/${id}-${name}`;
          const r = await place.run(['sh', '-c', `mkdir -p ${tmp} && TMPDIR=${tmp} RUST_BACKTRACE=1 ./fuzzer -fork=1 -ignore_crashes=1 -ignore_timeouts=1 -ignore_ooms=1 -max_total_time=${left} -timeout=10 -rss_limit_mb=4096 -malloc_limit_mb=2048 -dict=dict.txt -artifact_prefix=art/ -print_final_stats=1 -close_fd_mask=1 corpus < /dev/null 2> ${tmp}.log; tail -c 200000 ${tmp}.log >&2; rm -rf ${tmp} ${tmp}.log`], { cwd: ndir, timeoutMs: left * 1000 + 120_000 });
          const err = r.stderr;
          if (process.env.REFUZZ_DEBUG) o.log(`  [debug] rust native: ${err.split('\n').filter((l) => !/^#\d/.test(l)).slice(-12).join('\n')}`);
          execs += Number(/stat::number_of_executed_units:\s*(\d+)/.exec(err)?.[1] ?? [...err.matchAll(/^#(\d+)[:\s]/gm)].at(-1)?.[1] ?? 0);
          const art = await place.get(`${ndir}/art`);
          // Each failing input run once more on its own, for its panic and frames.
          for (const f of Object.keys(art).filter((f) => /(crash|timeout|oom|slow-unit)-/.test(f) && art[f].length).slice(0, 40)) {
            const one = await place.run(['sh', '-c', `mkdir -p ${tmp} && TMPDIR=${tmp} RUST_BACKTRACE=1 ./fuzzer -runs=1 -timeout=10 -rss_limit_mb=4096 -malloc_limit_mb=2048 ${shq(`art/${f}`)} < /dev/null 2>&1 | tail -c 60000`], { cwd: ndir, timeoutMs: 120_000 });
            const out = one.stdout + one.stderr;
            const report = panicReport(out, (p) => o.repoPath(p, h.c), target, h.source) ?? nativeReport(f, out);
            // One assertion is one cause whatever values its message shows.
            const cause = `${report.type}|${report.frames?.at(-1)?.path}:${report.frames?.at(-1)?.line}|${report.origin === 'assertion' ? report.message?.replace(/\d+/g, '#') : ''}`;
            if (seenCause.has(cause)) continue;
            seenCause.add(cause);
            crashes.push({ input: art[f], report });
          }
        }
        const grown = Object.values(await place.get(`${ndir}/corpus`));
        await place.remove(ndir);
        return { crashes, corpus: grown, execs };
      };
      return { session, errors };
    },
    /**
     * cargo-fuzz's layout under $SRC/refuzz/<name>: a package of its own (cargo-fuzz = true) depending on the target's
     * crate by path, libfuzzer-sys and arbitrary, with the target as fuzz_targets/<name>.rs and the project's lockfile beside
     * it. `cargo fuzz build -O` builds it the way OSS-Fuzz builds Rust targets, and the binary goes to $OUT/<name>.
     */
    oss(name, source) {
      const c = homes.get(source) ?? home(source, o.crates);
      if (!c) throw new Error(`${name}: the project has no library crate`);
      const fuzz = `$SRC/refuzz/${name}`;
      const toml = `${manifest(c, ['libfuzzer-sys = "0.4"', ARBITRARY], [name], 'fuzz_targets').trimEnd()}\n\n[package.metadata]\ncargo-fuzz = true\n`;
      return {
        file: `${name}.rs`,
        source: source.endsWith('\n') ? source : `${source}\n`,
        compile: [
          `mkdir -p ${fuzz}/fuzz_targets && cp $SRC/refuzz/${name}.rs ${fuzz}/fuzz_targets/${name}.rs`,
          `cat > ${fuzz}/Cargo.toml <<'REFUZZ_EOF'`, ...toml.trimEnd().split('\n'), 'REFUZZ_EOF',
          `[ -f ${join(src, c.workspace, 'Cargo.lock')} ] && cp ${join(src, c.workspace, 'Cargo.lock')} ${fuzz}/Cargo.lock`,
          `(cd ${fuzz} && cargo fuzz build -O --fuzz-dir . ${name})`,
          `cp ${fuzz}/target/$(rustc -vV | sed -n 's/^host: //p')/release/${name} $OUT/${name}`,
        ],
      };
    },
  };
}

/** What libFuzzer's crash artifact `file` was when no panic says: a timeout, an OOM, a stack overflow, a signal. */
function nativeReport(file: string, stderr: string): Report {
  if (file.startsWith('timeout-')) return { status: 'timeout', origin: 'library', type: 'Timeout', message: /ERROR: libFuzzer: (timeout after \d+ seconds)/.exec(stderr)?.[1] ?? 'timeout' };
  const line = stderr.split('\n').find((l) => /overflowed its stack|out-of-memory|memory allocation of|deadly signal|ERROR: libFuzzer/.test(l))?.trim() ?? '';
  const type = /overflowed its stack/.test(stderr) ? 'StackOverflow' : file.startsWith('oom-') || /out-of-memory|memory allocation of/.test(stderr) ? 'OutOfMemory' : /(SIG[A-Z]+)/.exec(stderr)?.[1] ?? 'NativeCrash';
  return { status: 'error', origin: 'library', type, message: line || stderr.trim().split('\n').slice(-4).join('\n'), native: true, frames: [] };
}

/**
 * The project's crates, read from its checkout: each package with a library target, found by the nearest Cargo.toml above
 * a file, and the library crates of the workspaces that hold targets (fuzz, example and bench workspaces hold none).
 */
function cratesOf(dir: string) {
  const read = (p: string) => { try { return readFileSync(join(dir, p), 'utf8'); } catch { return ''; } };
  const crates = new Map<string, Crate | null>();
  const crateAt = (d: string): Crate | null => {
    if (crates.has(d)) return crates.get(d)!;
    const toml = read(join(d, 'Cargo.toml'));
    let c: Crate | null = null;
    const pkg = section(toml, 'package');
    if (pkg) {
      const name = key(pkg, 'name')!;
      const lib = section(toml, 'lib');
      const root = normalize(join(d, key(lib, 'path') ?? 'src/lib.rs'));
      let ws = d;
      if (!/^\[workspace\]/m.test(toml)) {
        for (let up = d; up; ) {
          up = dirname(up) === '.' ? '' : dirname(up);
          if (/^\[workspace\]/m.test(read(join(up, 'Cargo.toml')))) { ws = up; break; }
        }
      }
      c = existsSync(join(dir, root)) && !/proc-macro\s*=\s*true/.test(lib)
        ? { dir: d, package: name, lib: (key(lib, 'name') ?? name).replace(/-/g, '_'), src: dirname(root), root, workspace: ws, testable: !/^\s*autotests\s*=\s*false/m.test(pkg), features: new Set(/^\s*default\s*=\s*\[([^\]]*)\]/m.exec(section(toml, 'features'))?.[1].match(/[\w-]+/g) ?? []), testing: [...section(toml, 'features').matchAll(/^\s*([\w-]+)\s*=/gm)].map((m) => m[1]).filter((f) => TESTING.test(f)) }
        : null;
    }
    crates.set(d, c);
    return c;
  };
  const crateOf = (path: string): Crate | null => {
    for (let d = dirname(path); ; d = dirname(d)) {
      const here = d === '.' ? '' : d;
      if (existsSync(join(dir, here, 'Cargo.toml'))) return section(read(join(here, 'Cargo.toml')), 'package') ? crateAt(here) : null;
      if (!here) return null;
    }
  };
  const tomls: string[] = [];
  const find = (d: string, depth: number) => {
    if (depth > 6) return;
    for (const e of readdirSync(join(dir, d), { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && !/^(target|node_modules|vendor|third_party)$/.test(e.name)) find(join(d, e.name), depth + 1);
      else if (e.name === 'Cargo.toml') tomls.push(d);
    }
  };
  find('', 0);
  const workspaces = [...new Set(tomls.map(crateAt).filter((c): c is Crate => !!c).map((c) => c.workspace))].filter((w) => !/(^|\/)(fuzz|examples?|benches|tests?)(\/|$)/.test(w));
  const libs = tomls.map(crateAt).filter((c): c is Crate => !!c && workspaces.includes(c.workspace));
  return { read, crateOf, libs };
}

export const rust: Adapter = {
  languages: ['rust'],
  // Every library crate checks offline with what the build fetched: all of each workspace's dependencies, dev-dependencies
  // too (a target crate depends on them), and the system libraries its build scripts look for.
  async ready(b) {
    const { libs } = cratesOf(b.dir);
    if (!libs.length) return 'the project has no library crate';
    const byWorkspace = new Map<string, Crate[]>();
    for (const c of libs) byWorkspace.set(c.workspace, [...(byWorkspace.get(c.workspace) ?? []), c]);
    // Usable when a workspace builds offline, the one with the most library crates tried first: a tool or benchmark nested
    // in the repository with its own workspace never holds the build back, and its targets fail to build on their own.
    const failed: string[] = [];
    for (const [w, cs] of [...byWorkspace].sort((x, y) => y[1].length - x[1].length)) {
      const r = await b.box.exec(`cargo fetch --offline && cargo check --offline --lib ${cs.map((c) => `-p ${shq(c.package)}`).join(' ')}`, { cwd: join(b.src, w), env: { CARGO_TARGET_DIR: `${WORK}/target-ready`, CARGO_TERM_COLOR: 'never', CFLAGS: '', CXXFLAGS: '' }, timeoutMs: 3_600_000 });
      if (r.code === 0) { await b.box.exec(`rm -rf ${WORK}/target-ready`); return undefined; }
      failed.push(`in ${w || 'the root workspace'}, cargo fetch --offline and cargo check --offline failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-12).join('\n')}`);
    }
    await b.box.exec(`rm -rf ${WORK}/target-ready`);
    return failed.join('\n\n');
  },
  async prepare(b, log) {
    const dir = b.dir;
    const { read, crateOf, libs } = cratesOf(dir);
    log(`  rust: ${libs.length} library crates (${libs.map((c) => c.package).slice(0, 8).join(', ')}${libs.length > 8 ? ', …' : ''}) in ${b.src}`);

    // Per crate, where each type and trait is defined and whether it is `pub`.
    const indexes = new Map<string, Map<string, { file: string; pub: boolean; kind: string }>>();
    const indexOf = (c: Crate) => {
      let idx = indexes.get(c.dir);
      if (idx) return idx;
      idx = new Map();
      const walk = (d: string) => {
        for (const e of readdirSync(join(dir, d), { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.rs')) {
            for (const m of read(p).matchAll(/^[ \t]*(pub(?:\([^)]*\))?\s+)?(struct|enum|union|type|trait)\s+(\w+)/gm)) {
              const pub = m[1]?.trim() === 'pub';
              const have = idx!.get(m[3]);
              if (!have || (pub && !have.pub)) idx!.set(m[3], { file: p, pub, kind: m[2] });
            }
          }
        }
      };
      if (existsSync(join(dir, c.src))) walk(c.src);
      indexes.set(c.dir, idx);
      return idx;
    };

    // The module path an item defined in `file` is importable at: through `pub mod`s from the crate root, or from the deepest
    // public module that re-exports it (`pub use parser::{QcowHeader}`). Null when nothing outside the crate can name it.
    const moduleFile = (c: Crate, segs: string[]) => {
      if (!segs.length) return c.root;
      const base = join(c.src, ...segs);
      return existsSync(join(dir, `${base}.rs`)) ? `${base}.rs` : join(base, 'mod.rs');
    };
    const importPath = (c: Crate, file: string, item: string): string | null => {
      const rel = relative(c.src, file).replace(/\.rs$/, '').replace(/(^|\/)mod$/, '');
      if (file === c.root || rel === 'lib') return `${c.lib}::${item}`;
      if (rel.startsWith('..') || rel === 'main' || rel.startsWith('bin/')) return null;
      const segs = rel.split('/');
      const pubChain = (k: number) => segs.slice(0, k).every((s, i) => new RegExp(`^\\s*pub\\s+mod\\s+${s}\\s*;`, 'm').test(read(moduleFile(c, segs.slice(0, i)))));
      if (pubChain(segs.length)) return [c.lib, ...segs, item].join('::');
      for (let k = segs.length - 1; k >= 0; k--) {
        if (!pubChain(k)) continue;
        const uses = [...read(moduleFile(c, segs.slice(0, k))).matchAll(/pub\s+use\s+([^;]+);/g)].map((m) => m[1]);
        // A re-export through the module toward the file, under the name it is given there (`Error as DurationError`).
        for (const u of uses.filter((u) => new RegExp(`\\b${segs[k]}\\b`).test(u))) {
          const named = new RegExp(`\\b${item}\\b(?!\\s*::)(?:\\s+as\\s+(\\w+))?`).exec(u);
          if (named || new RegExp(`\\b${segs[k]}::\\*`).test(u)) return [c.lib, ...segs.slice(0, k), named?.[1] ?? item].join('::');
        }
      }
      return null;
    };

    /** An item compiled out of the library a fuzz target links: behind cfg(test), or a feature that is off by default. */
    const cfgOut = (c: Crate, lines: string[], at: number) => {
      let pre = '';
      for (let i = at - 1; i >= 0 && !/[;{}]\s*$/.test(lines[i]) && lines[i].trim(); i--) pre = `${lines[i]}\n${pre}`;
      return [...pre.matchAll(/#\[cfg\(([\s\S]*?)\)\]/g)].some(([, cond]) => !cfgOn(cond, (f) => c.features.has(f) || c.testing.includes(f)));
    };

    // What a target is and how a fuzz target names it, worked out once per target.
    const plans = new Map<string, { use: string[] } | null>();
    const plan = (t: Target, source: string): { use: string[] } | null => {
      if (plans.has(t.id)) return plans.get(t.id)!;
      const out = (() => {
        const c = crateOf(t.path);
        if (!c || !c.testable) return null;
        const lines = source.split('\n');
        const indent = (s: string) => /^\s*/.exec(s)![0].length;
        const own = indent(lines[t.line - 1] ?? '');
        let opener = -1;
        for (let i = t.line - 2; i >= 0 && own > 0; i--) {
          if (lines[i].trim() && indent(lines[i]) < own && /^\s*(pub(\([^)]*\))?\s+)?(unsafe\s+)?(impl|mod|trait|fn)\b/.test(lines[i])) { opener = i; break; }
        }
        const header = t.header.replace(/^(\s*#\[[^\]]*\]\s*)+/, '');
        const isPub = /^\s*pub\s+(?:(?:const|async|extern\s+"[^"]*")\s+)*fn\b/.test(header);
        if (cfgOut(c, lines, t.line - 1)) return null;
        if (opener < 0) {
          if (own > 0 || !isPub) return null;
          const at = importPath(c, t.path, t.name);
          return at ? { use: [`use ${at};`] } : null;
        }
        // Inside an inline module, a trait's default body or another fn: not reachable by a path this adapter can name.
        if (!/^\s*(unsafe\s+)?impl\b/.test(lines[opener])) return null;
        const impl = noGenerics(lines.slice(opener, opener + 3).join(' ').split('{')[0]);
        const type = noGenerics(t.qualifiedName.split('.')[0]).trim();
        // The type defined in the impl's own file wins over a same-named one elsewhere in the crate.
        const local = new RegExp(`^[ \\t]*(pub(?:\\([^)]*\\))?\\s+)?(struct|enum|union|type)\\s+${type}\\b`, 'm').exec(source);
        const def = local ? { file: t.path, pub: local[1]?.trim() === 'pub', kind: local[2] } : indexOf(c).get(type);
        if (!def?.pub || def.kind === 'trait') return null;
        if (def.file === t.path && local && cfgOut(c, lines, source.slice(0, local.index).split('\n').length - 1)) return null;
        const typeAt = importPath(c, def.file, type);
        if (!typeAt) return null;
        const trait = /\bimpl\s+(?:unsafe\s+)?!?([\w:]+)\s+for\b/.exec(impl)?.[1]?.split('::').pop();
        if (!trait) return isPub && !/\bunsafe\s+fn\b/.test(header) ? { use: [`use ${typeAt};`] } : null;
        if (trait === 'Drop') return null;
        if (trait in STD_TRAITS) return { use: [`use ${typeAt};`, ...(STD_TRAITS[trait] ? [`use ${STD_TRAITS[trait]};`] : [])] };
        const td = indexOf(c).get(trait);
        const traitAt = td?.pub && td.kind === 'trait' ? importPath(c, td.file, trait) : null;
        return traitAt ? { use: [`use ${typeAt};`, `use ${traitAt};`] } : null;
      })();
      plans.set(t.id, out);
      return out;
    };

    const place = containerPlace(b.box);
    await place.put(WORK, { 'san-rustc.sh': SAN_RUSTC(b.src) });
    await place.run(['chmod', '+x', `${WORK}/san-rustc.sh`]);

    /**
     * A path from rustc, a backtrace or addr2line, as a repository path, or null when it is outside the project: absolute
     * under the project's folder, or relative to the workspace cargo ran rustc in.
     */
    const repoPath = (p: string, c: Crate): string | null => {
      if (p.startsWith(`${b.src}/`)) return p.slice(b.src.length + 1);
      if (p.startsWith('/')) return null;
      for (const base of [c.workspace, c.dir]) {
        const r = normalize(join(base, p));
        if (!r.startsWith('..') && existsSync(join(dir, r))) return r;
      }
      return null;
    };

    const rt: Runtime = {
      language: 'rust',
      guide: 'Rust statements in the body of a fuzz target, one per item. `use` lines bring items into scope by the crate\'s name (`use mycrate::module::Item;`, never `crate::`); only the crate\'s public items are reachable, with its test-helper features (test-utils) on, and its dependencies and dev-dependencies. Build the arguments (files under std::env::temp_dir(); File::create is write-only, so open a file the target reads with OpenOptions read(true).write(true)), then the last line calls the target once and binds what it returns: `let result = target(...);`. Do not unwrap or `?` the target\'s result; `.unwrap()` only setup steps. No `unsafe`.',
      importsOfTest(test) {
        const c = crateOf(test.path);
        if (!c) return [];
        const lines = read(test.path).split('\n');
        // The module the test sits in: the nearest `mod … {` above it with less indentation.
        const own = /^\s*/.exec(lines[test.line - 1] ?? '')![0].length;
        let at = -1;
        for (let i = test.line - 2; i >= 0; i--) if (/^\s*(pub\s+)?mod\s+\w+\s*\{/.test(lines[i]) && /^\s*/.exec(lines[i])![0].length < own) { at = i; break; }
        if (at < 0) return [];
        // Its `use` statements, which can span lines, with crate:: and super:: paths named from outside the crate.
        const body = lines.slice(at + 1, test.line - 1).join('\n');
        const rel = relative(c.src, test.path).replace(/\.rs$/, '').replace(/(^|\/)(mod|lib)$/, '');
        const parent = [c.lib, ...rel.split('/').filter(Boolean)].join('::');
        return [...body.matchAll(/^\s*use\s+([\s\S]*?);/gm)].map((m) => `use ${m[1].replace(/\bcrate::/g, `${c.lib}::`).replace(/\bsuper::/g, `${parent}::`).replace(/\s+/g, ' ')};`);
      },
      importFor: (t) => {
        const c = crateOf(t.path);
        const uses = plan(t, read(t.path))?.use ?? [`use ${c?.lib ?? 'crate'}::${noGenerics(t.qualifiedName.split('.')[0]).trim()};`];
        // The crate's dependencies by the names `use` takes (a renamed one by its key, not its package), as its tests have them.
        const deps = c ? inheritedDeps(read, c, true, b.src).map((l) => l.split(' ')[0].replace(/-/g, '_')) : [];
        return [...uses, ...(deps.length ? [`// other crates the target can use, by these names: ${deps.join(', ')}`] : [])].join('\n');
      },
      isImport: (l) => /^\s*(pub\s+)?use\s/.test(l),
      bindsResult: (l) => /^\s*let\s+(mut\s+)?result\s*(:[^=]+)?=(?!=)/.test(l),
      parseWrap: (code) => ({ source: `fn main() {\n${code}\n}\n`, offset: 1 }),
      isPublic: (t, source) => !!plan(t, source),
      fuzz: rustFuzz({ place, src: b.src, dir, crateOf, crates: libs, repoPath, log }),
      errorsAreValues: true,
      rejections: [],
      // Calls the container does not allow (devices, io_uring, privileged syscalls) and the cut network.
      environmental: (r) => /os error (1|6|13|19|38|95|101)\b|Operation not permitted|Permission denied|Function not implemented|Network is unreachable|failed to lookup address/.test(r.message ?? '')
        // A path the target named that is not there, or not a file (an unwrapped io::Error, by Display or Debug): the
        // sandbox's filesystem, not the project.
        || /os error (2|17|20|21)\b|\bcode: (2|17|20|21), kind: |kind: (NotFound|AlreadyExists|NotADirectory|IsADirectory|PermissionDenied)\b|No such file or directory|Not a directory|Is a directory/.test(r.message ?? ''),
    };
    return rt;
  },
};
