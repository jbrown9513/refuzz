/**
 * Lua: the project built by its build spec (src/build.ts) in refuzz's base-builder-lua image, its rocks installed in the
 * image's Lua tree by the spec's build.sh. Fuzz targets are luzer's (luaFuzz below), run in that container by
 * src/probes/lua_fuzz.lua, which records the project lines a line hook sees and the frames of what failed, and by luzer itself
 * for the native engine.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { shq } from '../run.ts';
import type { LineDriver } from '../session.ts';
import type { Adapter, Built, FuzzRuntime, FuzzSession, Runtime, Target } from '../types.ts';
import { libFuzzerNative } from './ruby.ts';

/** Where the driver goes in the container. */
const DRIVER = '/tmp/refuzz/lua_fuzz.lua';
const LUAROCKS = 'luarocks --lua-version 5.4';

export const isImport = (l: string) => /^\s*(local\s+[\w\s,]+=\s*)?require\s*[("']/.test(l);

/** The project's rockspecs: in its folder and the folder beside it that keeps them (`rockspecs/`), relative to it. */
function rockspecs(dir: string): string[] {
  const out: string[] = [];
  const list = (rel: string) => { try { return readdirSync(join(dir, rel), { withFileTypes: true }); } catch { return []; } };
  for (const e of list('')) {
    if (e.isFile() && e.name.endsWith('.rockspec')) out.push(e.name);
    else if (e.isDirectory() && !e.name.startsWith('.')) for (const f of list(e.name)) if (f.isFile() && f.name.endsWith('.rockspec')) out.push(`${e.name}/${f.name}`);
  }
  // The newest version first: a `scm`/`dev` rockspec, then by name.
  return out.sort((a, b) => Number(/-(scm|dev)-/.test(b)) - Number(/-(scm|dev)-/.test(a)) || b.localeCompare(a));
}

/**
 * Prints each rockspec's package and the Lua modules it installs, from its `build.modules` and `build.install.lua`: a line
 * `package <name>`, then `<module>\t<file>` per module whose source is a Lua file.
 */
const MODULES = `
for _, path in ipairs(arg) do
  local env = {}
  local chunk = loadfile(path, "t", env)
  if chunk and pcall(chunk) then
    print("package " .. tostring(env.package))
    local b = env.build or {}
    for _, t in ipairs({ b.modules or {}, (b.install or {}).lua or {} }) do
      for name, file in pairs(t) do
        if type(name) == "string" and type(file) == "string" and file:match("%.lua$") then print(name .. "\\t" .. file) end
      end
    end
  end
end
`;

/** What the project's rockspecs say: its packages and module → file. */
async function modulesOf(b: Built): Promise<{ packages: string[]; modules: Map<string, string> }> {
  const specs = rockspecs(b.dir);
  const modules = new Map<string, string>();
  const packages: string[] = [];
  if (!specs.length) return { packages, modules };
  const r = await b.box.exec(`lua5.4 -e ${shq(MODULES)} ${specs.map((s) => shq(s)).join(' ')}`, { cwd: b.src, timeoutMs: 60_000 });
  for (const l of r.stdout.split('\n')) {
    if (l.startsWith('package ')) { packages.push(l.slice(8)); continue; }
    const [name, file] = l.split('\t');
    if (name && file && !modules.has(name)) modules.set(name, file.replace(/^\.\//, ''));
  }
  return { packages, modules };
}

/** The Lua search path targets run with: the tree the build installed into, then the project's folder. */
async function searchPath(b: Built): Promise<string> {
  const r = await b.box.exec(`${LUAROCKS} path --lr-path`, { timeoutMs: 60_000 });
  return `${r.stdout.trim()};${b.src}/?.lua;${b.src}/?/init.lua`;
}

/** Requires each module, printing the ones that do not load because something they need is not installed. */
const REQUIRE = `
for _, m in ipairs(arg) do
  local ok, err = pcall(require, m)
  if not ok and tostring(err):match("module '[^']+' not found") then print(m .. ": " .. tostring(err):gsub("\\n.*", "")) end
end
`;

export const lua: Adapter = {
  languages: ['lua'],
  // The build installed the project: each module its rockspec lists, and what it requires, loads; a rockspec with no Lua
  // modules (a make or cmake build) is an installed rock.
  async ready(b) {
    const { packages, modules } = await modulesOf(b);
    if (!packages.length) return undefined;
    if (modules.size) {
      const r = await b.box.exec(`LUA_PATH=${shq(`${await searchPath(b)};;`)} lua5.4 -e ${shq(REQUIRE)} ${[...modules.keys()].map(shq).join(' ')}`, { cwd: '/tmp', timeoutMs: 120_000 });
      const missing = r.stdout.trim();
      return r.code === 0 && !missing ? undefined : `the project's modules do not load: ${(missing || r.stderr).split('\n').slice(0, 6).join('\n')}`;
    }
    const r = await b.box.exec(`${LUAROCKS} show ${shq(packages[0])}`, { timeoutMs: 60_000 });
    return r.code === 0 ? undefined : `the rock ${packages[0]} is not installed: ${(r.stderr || r.stdout).trim().split('\n').slice(-4).join('\n')}`;
  },
  async prepare(b, log) {
    const place = containerPlace(b.box);
    await place.put('/tmp/refuzz', { 'lua_fuzz.lua': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'lua_fuzz.lua')) });
    const { modules } = await modulesOf(b);
    const byFile = new Map([...modules].map(([m, f]) => [f, m]));
    // A module the rockspec installs by its name; any other file by its path from the project's folder, which is on the path.
    const moduleOf = (path: string) => byFile.get(path) ?? path.replace(/\.lua$/, '').replace(/\/init$/, '').split('/').join('.');
    const path = await searchPath(b);
    const asan = (await b.box.exec(`lua5.4 -e 'io.write(require("luzer_impl").path.asan)'`, { timeoutMs: 60_000 })).stdout.trim();
    if (!asan) throw new Error('luzer does not load in the built image');
    if (!modules.size) log('  lua: no rockspec modules; targets require files by their path from the project folder');
    const rt: Runtime = {
      language: b.language,
      guide: 'Lua 5.4 statements at chunk level, one per item. `local name = require("module")` lines load the project (installed as its rockspec says, so a module is required by the name its users require; a file it does not install is required by its path from the project folder, dots for slashes). Build the arguments, then the last line calls the target and binds what it returns: `local result = mod.fn(...)`, or `local result = obj:method(...)` for a method.',
      importFor(t: Target) {
        const head = t.qualifiedName.split(/[.:]/)[0];
        const qualified = /[.:]/.test(t.qualifiedName) && /^[A-Za-z_]\w*$/.test(head);
        return `${qualified ? `local ${head} = ` : ''}require("${moduleOf(t.path)}")${qualified ? `  -- defines ${t.qualifiedName}` : ''}`;
      },
      isImport,
      bindsResult: (l) => /^(local\s+)?result\s*=(?!=)/.test(l),
      parseWrap: (code) => ({ source: code, offset: 0 }),
      isPublic(t, source) {
        const def = source.split('\n')[t.line - 1] ?? '';
        // `local function f` and `local f = function` are not reachable from outside the file.
        if (/^\s*local\b/.test(def)) return false;
        return !t.qualifiedName.split(/[.:]/).some((p) => p.startsWith('_'));
      },
      errorsAreValues: false,
      rejections: ['error'],
      fuzz: luaFuzz(place, b, path, asan, log),
      environmental: (r) => r.type === 'Exit' || /module '[^']+' not found/.test(r.message ?? ''),
    };
    return rt;
  },
};

/**
 * luzer targets: a file defining `TestOneInput(buf)` and calling `luzer.Fuzz(TestOneInput, nil, args)`, loaded once by
 * src/probes/lua_fuzz.lua (with a stand-in luzer that keeps TestOneInput) in a long-running lua5.4 in the container, with
 * line edges from a line hook as coverage. One process per target, kept running between batches. The native engine is luzer
 * itself on the same file. Both run with luzer's sanitizer runtime preloaded, as the image's compile_lua_fuzzer runs a target,
 * so a C module the build instrumented loads.
 */
function luaFuzz(place: Place, b: Built, path: string, asan: string, log: (s: string) => void): FuzzRuntime {
  return {
    guide: [
      'A luzer fuzz target, the libFuzzer engine for Lua: `local luzer = require("luzer")`, `local name = require("module")` lines for the project (installed as its rockspec says: require a module by the name its users require), then `local function TestOneInput(buf)` … `end`, and last `luzer.Fuzz(TestOneInput, nil, {})`.',
      'buf is the input\'s raw bytes, a Lua string. Hand it on as it is to a target that parses a string; to build several arguments, read them off one provider: `local fdp = luzer.FuzzedDataProvider(buf)`, then fdp:consume_string(max_len), fdp:consume_integer(min, max), fdp:consume_number(min, max), fdp:consume_boolean(), fdp:consume_probability(), fdp:oneof(list), fdp:remaining_bytes().',
      'Call the target. Use pcall only around a call the project documents as raising an error for invalid input, and only when the message tells that error apart; pass anything else on with `error(err, 0)`: an error from the project is the finding.',
      'State what the result must satisfy with `assert(condition, "what broke")` in TestOneInput (a round trip, a range, an invariant the function promises): a failing assert, or an `error("…")` the target raises itself, is reported as the target\'s assertion; any other error in the target\'s own lines (indexing nil, calling a missing function) is a bug in the target. Do not print.',
    ].join(' '),
    async session(targets) {
      const dir = await place.folder('lua');
      const errors: Record<string, string> = {};
      const files: Record<string, string> = {};
      for (const [n, code] of Object.entries(targets)) {
        if (/^\w+$/.test(n)) files[`${n}.lua`] = code;
        else errors[n] = `${n} is not a name a file can take`;
      }
      await place.put(dir, files);
      const file = (n: string) => `${dir}/${n}.lua`;
      const make = (n: string, timeoutMs: number) => place.driver(['env', `LD_PRELOAD=${asan}`, 'ASAN_OPTIONS=detect_leaks=0', 'lua5.4', DRIVER, file(n), b.src, path, String(timeoutMs)], { cwd: '/tmp' });
      const drivers = new Map<string, { d: LineDriver; timeout: number }>();
      await Promise.all(Object.keys(targets).filter((n) => !errors[n]).map(async (n) => {
        const d = make(n, 1_000);
        if (await d.start()) drivers.set(n, { d, timeout: 1_000 });
        else errors[n] = d.fatal ?? 'did not load';
      }));
      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          let h = drivers.get(name);
          if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'TargetLoad', message: errors[name] ?? 'no such target' }));
          // The driver's own timer is set when it starts; a different allowance needs a new process.
          if (h.timeout !== timeoutMs) { h.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
          return h.d.run(inputs, timeoutMs, deadline);
        },
        async native(name, corpus, dict, seconds) {
          if (!drivers.has(name)) return { crashes: [], corpus: [], execs: 0 };
          return libFuzzerNative(place, ['lua5.4', file(name)], { LUA_PATH: `${path};;`, LD_PRELOAD: asan, ASAN_OPTIONS: 'detect_leaks=0' }, corpus, dict, seconds, async (input) => (await session.run(name, [input], 5_000))[0], (s) => log(`  luzer ${name}: ${s}`));
        },
        release(name) {
          drivers.get(name)?.d.stop();
          drivers.delete(name);
        },
        async close() {
          for (const h of drivers.values()) h.d.stop();
          await place.remove(dir);
        },
      };
      return { errors, session };
    },
    // The target is already the file luzer runs; the image's compile_lua_fuzzer turns it into $OUT/<name>, with the project's
    // folder on the path after what the build installed.
    oss(name, source) {
      const file = `${name}.lua`;
      return { file, source, compile: [`compile_lua_fuzzer $SRC/refuzz/${file} ${b.src.replace(/^\/src(?=\/|$)/, '$SRC')}`] };
    },
  };
}
