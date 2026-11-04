/**
 * Solidity: the project built by its OSS-Fuzz build spec (src/build.ts) in refuzz's base-builder-solidity image, which has
 * Foundry: its dependencies fetched and `forge build` run by the spec's build.sh while the network is on, then cut off.
 * Fuzz targets are Foundry fuzz tests taking the raw input as `bytes` (solidityFuzz below), compiled and run by forge in the
 * project's folder in that container, in Foundry's in-process EVM. Nothing reaches a chain or an RPC endpoint.
 *
 * A revert from `require`, `revert` or a custom error is the contract rejecting its input, Solidity's error value: it is
 * reported as a result (`reverted: <reason>`), not a failure. A Panic (assert, overflow, division by zero, bad enum, array
 * bounds) is a failure, located from Foundry's debugger dump of that one input.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import type { Adapter, Built, Frame, FuzzRuntime, FuzzSession, InputReport, Report, Runtime, Target } from '../types.ts';

/** forge reads the project's foundry.toml under this profile, which adds reading the sessions' input files from refuzz/. */
const ENV = { FOUNDRY_PROFILE: 'refuzz' };
/** Above this much gas a failing test's debugger dump (every step's stack and memory) is too large to read. */
const DUMP_GAS = 3_000_000;
/** Debugger dumps a fuzz target may take to locate its Panics: each is a `forge test` of its own. */
const DUMPS = 48;

/** The contract, library or interface a line of a Solidity file is in. */
function containerAt(source: string, line: number): { kind: string; name: string; abstract: boolean } | undefined {
  let found: { kind: string; name: string; abstract: boolean } | undefined;
  source.split('\n').slice(0, line).forEach((l) => {
    const m = /^\s*(abstract\s+)?(contract|library|interface)\s+(\w+)/.exec(l);
    if (m) found = { kind: m[2], name: m[3], abstract: !!m[1] };
  });
  return found;
}

/** A function declared at file level, outside any contract: imported by its own name. */
const freeFunction = (source: string, line: number) => /^function\s/.test(source.split('\n')[line - 1] ?? '');

/** A function's definition up to its body: refuzz's header for Solidity is only the keyword. */
const definition = (source: string, line: number) => source.split('\n').slice(line - 1, line + 8).join(' ').split('{')[0];

export const solidity: Adapter = {
  languages: ['solidity'],
  // Targets are compiled by forge in the project's folder with the network off: the build left a foundry.toml there, and
  // the project compiles offline (solc and the dependencies already fetched).
  async ready(b) {
    const r = await b.box.exec('test -f foundry.toml || { echo "there is no foundry.toml in the project\'s folder: forge compiles the targets there"; exit 1; }; mkdir -p refuzz/none && FOUNDRY_TEST=refuzz/none forge build --offline --no-lint >/tmp/refuzz-ready.log 2>&1; s=$?; tail -n 30 /tmp/refuzz-ready.log; exit $s', { cwd: b.src, timeoutMs: 1_800_000 });
    return r.code === 0 ? undefined : `forge build --offline in ${b.src} failed: ${(r.stdout + r.stderr).trim()}`;
  },
  async prepare(b) {
    const place = containerPlace(b.box);
    const sh: Sh = (script, timeoutMs = 1_800_000, env = {}) => b.box.exec(script, { cwd: b.src, env: { ...ENV, ...env }, timeoutMs });
    // The project's settings, plus reading the fuzz sessions' input files from refuzz/ (fs_permissions has no env form).
    await sh(`grep -q '^\\[profile.refuzz\\]' foundry.toml || printf '\\n[profile.refuzz]\\nfs_permissions = [{ access = "read", path = "./refuzz" }]\\n' >> foundry.toml`);
    // The compilers the build fetched: with the network off, a target's pragma must accept one of them.
    const solcs = (await sh('ls "$HOME/.svm"', 60_000)).stdout.split('\n').map((v) => v.trim()).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
    const source = (path: string) => { try { return readFileSync(join(b.dir, path), 'utf8'); } catch { return ''; } };
    const rt: Runtime = {
      language: b.language,
      guide: 'Solidity statements only, one per item: they are placed inside a test function for you, so write no `function`, `contract` or `pragma` lines and no closing braces of your own. `import {Name} from "path/File.sol";` lines bring contracts and libraries into scope (paths from the project root). Deploy a contract with `new Name(args)`, call library functions as `Lib.fn(args)`. Build the arguments, then the last line calls the target and declares `result` with the type it returns: `uint256 result = Lib.fn(x);` or `(uint256 result, ) = c.fn(x);`. No cheatcodes, no console.',
      importFor(t: Target) {
        const text = source(t.path);
        const owner = freeFunction(text, t.line) ? undefined : containerAt(text, t.line);
        return `import {${owner ? owner.name : t.name}} from "${t.path}";`;
      },
      isImport: (l) => /^\s*import\s/.test(l),
      bindsResult(l) {
        const at = l.search(/(?<![=!<>])=(?!=)/);
        if (at < 0) return false;
        const lhs = l.slice(0, at).trim();
        return !/[;{}]/.test(lhs) && /(^|[\s(,])result\s*\)?$|(^|[\s(,])result\s*,/.test(lhs);
      },
      // The `string` type keyword parses as a node named like a string literal; an identifier of the same length keeps it from
      // being mutated as one, and keeps every column where it was.
      parseWrap: (code) => ({ source: `contract H {\nfunction test_h() public {\n${code.replace(/\bstring\b/g, 'strin_')}\n}\n}\n`, offset: 2 }),
      isPublic(t, text) {
        if (t.name.startsWith('_')) return false;
        if (freeFunction(text, t.line)) return true;
        const owner = containerAt(text, t.line);
        if (!owner || owner.kind === 'interface' || (owner.abstract && owner.kind === 'contract')) return false;
        const def = definition(text, t.line);
        if (/\bprivate\b/.test(def)) return false;
        // A library's internal functions are its API: they are compiled into whoever imports it.
        return /\b(public|external)\b/.test(def) || (owner.kind === 'library' && /\binternal\b/.test(def)) || /^\s*constructor\b/.test(def);
      },
      errorsAreValues: true,
      rejections: [],
      environmental: (r) => r.type === 'NoReport',
      fuzz: solidityFuzz(b, place, sh, solcs),
    };
    return rt;
  },
};

function compileErrors(stdout: string): { file?: string; start: number; type: string; message: string }[] {
  try {
    const j = JSON.parse(stdout.slice(stdout.indexOf('{')));
    return (j.errors ?? []).filter((e: any) => e.severity === 'error').map((e: any) => ({ file: e.sourceLocation?.file, start: e.sourceLocation?.start ?? -1, type: e.type ?? 'Error', message: String(e.message ?? '') }));
  } catch {
    return [];
  }
}

/** A project source: not the harness, not a dependency, not a test. */
const projectPath = (path: string, rel: string) => !!path && !path.startsWith(`${rel}/`) && !/^(lib|node_modules|refuzz)\//.test(path) && !/(^|\/)(test|tests)\//.test(path) && !/\.t\.sol$/.test(path);

/**
 * Where a failing test failed, from Foundry's debugger dump: the innermost call that reverted, walked back from its last step
 * to the last one that maps to a source file (a Panic's revert is inside a compiler-generated helper), then each call it
 * reverted through. Innermost last, the harness's frames dropped.
 */
function locate(dump: any, rel: string): { frames: Frame[]; inHarness: boolean } | undefined {
  const S = dump.contracts?.sources;
  const names = dump.contracts?.identified_contracts ?? {};
  const arena: any[] = dump.debug_arena ?? [];
  const lineCache = new Map<string, number[]>();
  const mapping = (entry: any, step: any) => {
    const art = S?.artifacts_by_name?.[names[entry.address]]?.[0];
    if (!art) return undefined;
    const create = /^CREATE/.test(entry.kind);
    const ic = (create ? art.pc_ic_map : art.pc_ic_map_runtime)?.[String(step.pc)];
    const m = ic === undefined ? undefined : (create ? art.source_map : art.source_map_runtime)?.[ic];
    return m ? { art, m } : undefined;
  };
  const where = (entry: any, step: any): Frame | undefined => {
    const { art, m } = mapping(entry, step) ?? {};
    const src = m ? S.sources_by_id?.[art.build_id]?.[String(m.index)] : undefined;
    if (!src?.path || typeof src.source !== 'string') return undefined;
    const key = `${art.build_id}:${m.index}`;
    if (!lineCache.has(key)) {
      const starts = [0];
      const bytes = Buffer.from(src.source);
      for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) starts.push(i + 1);
      lineCache.set(key, starts);
    }
    const starts = lineCache.get(key)!;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= m.offset) lo = mid; else hi = mid - 1; }
    return { path: src.path, line: lo + 1, name: names[entry.address] ?? '' };
  };
  const reverted = (e: any) => [0xfd, 0xfe].includes(e.steps?.at(-1)?.op);
  const first = arena.findIndex(reverted);
  if (first < 0) return undefined;
  // Each call the failure reverted through, innermost first; a call's steps can be split around the calls it made.
  const nodes: string[] = [];
  for (const e of arena.slice(first)) if (reverted(e) && !nodes.includes(String(e.trace_node_idx))) nodes.push(String(e.trace_node_idx));
  const perNode = nodes.map((node) => {
    // Internal calls from the source map's jump markers (0 into a function, 1 out of it): the call sites still open at the end.
    const open: Frame[] = [];
    let last: Frame | undefined;
    for (const e of arena.filter((x) => String(x.trace_node_idx) === node)) {
      for (const step of e.steps ?? []) {
        const f = where(e, step);
        if (f) last = f;
        const jump = mapping(e, step)?.m?.jump;
        if (jump === 0 && last) open.push(last);
        else if (jump === 1) open.pop();
      }
    }
    return last ? [...open.filter((f, i) => i === 0 || f.path !== open[i - 1].path || f.line !== open[i - 1].line), last] : [];
  });
  const innermost = perNode[0]?.at(-1);
  if (!innermost) return undefined;
  const frames = perNode.reverse().flat().filter((f, i, all) => projectPath(f.path, rel) && !(i > 0 && f.path === all[i - 1].path && f.line === all[i - 1].line));
  return { frames: frames.slice(-12), inHarness: innermost.path.startsWith(`${rel}/`) };
}

type Sh = (script: string, timeoutMs?: number, env?: Record<string, string>) => Promise<{ code: number | null; stdout: string; stderr: string }>;


const WORD = 32;
const word = (x: bigint) => { const b = Buffer.alloc(WORD); let v = BigInt.asUintN(256, x); for (let i = WORD - 1; i >= 0 && v; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
const big = (b: Buffer) => BigInt(`0x${b.toString('hex') || '0'}`);
const padded = (b: Buffer) => Buffer.concat([b, Buffer.alloc((WORD - (b.length % WORD)) % WORD)]);

/** A batch file: `abi.encode(uint256 gas, bytes[] inputs)`, what the runner's test_batch reads with a cheatcode. */
function batchFile(gas: bigint, inputs: Buffer[]): Buffer {
  const items = inputs.map((b) => Buffer.concat([word(BigInt(b.length)), padded(b)]));
  let at = inputs.length * WORD;
  const heads = items.map((x) => { const h = word(BigInt(at)); at += x.length; return h; });
  return Buffer.concat([word(gas), word(64n), word(BigInt(inputs.length)), ...heads, ...items]);
}

/** The `bytes` argument of a call to a `f(bytes)` function, from its calldata (selector, then the ABI encoding). */
function bytesArgument(calldata: Buffer): Buffer {
  const args = calldata.subarray(4);
  const at = Number(big(args.subarray(0, WORD)));
  const n = Number(big(args.subarray(at, at + WORD)));
  return Buffer.from(args.subarray(at + WORD, at + WORD + n));
}

/** The data of each `refuzz_out(uint256 i, bool ok, uint256 gas, bytes data)` log the batch test emitted. */
function batchOutputs(logs: any[]): Map<number, { ok: boolean; gas: number; data: Buffer }> {
  const out = new Map<number, { ok: boolean; gas: number; data: Buffer }>();
  for (const l of logs) {
    const d = Buffer.from(String(l?.data ?? l?.raw_log?.data ?? '').replace(/^0x/, ''), 'hex');
    if (d.length < 5 * WORD || d.readUInt32BE(3 * WORD + 28) !== 0x80) continue;
    const n = Number(big(d.subarray(4 * WORD, 5 * WORD)));
    out.set(Number(big(d.subarray(0, WORD))), { ok: d[2 * WORD - 1] === 1, gas: Number(big(d.subarray(2 * WORD, 3 * WORD))), data: d.subarray(5 * WORD, 5 * WORD + n) });
  }
  return out;
}

/** Error(string) revert data as its message, anything else as hex. */
function revertReason(d: Buffer): string {
  if (d.length >= 68 && d.readUInt32BE(0) === 0x08c379a0) {
    const n = Number(big(d.subarray(36, 68)));
    return d.subarray(68, 68 + n).toString('utf8');
  }
  return d.length ? `0x${d.toString('hex').slice(0, 200)}` : 'without a reason';
}

const PANICS: Record<number, string> = { 0x01: 'assertion failed', 0x11: 'arithmetic underflow or overflow', 0x12: 'division or modulo by zero', 0x21: 'invalid enum value', 0x22: 'invalid storage byte array', 0x31: 'pop on an empty array', 0x32: 'array out-of-bounds access', 0x41: 'out of memory', 0x51: 'call to an uninitialized function' };

/** The reason prefix of the target's own failed `require` or `assert`, as the session compiles them: nothing else carries it. */
const ASSERTION = 'refuzz-assertion: ';
/** forge-std's assertions (assertEq and the rest) fail through a cheatcode that reverts with this reason. */
const FORGE_ASSERTION = 'assertion failed';

const isComment = (l: string) => /^\s*(\/\/|\/\*|\*)/.test(l);
const TEST = /\bfunction\s+(testFuzz_\w+)\s*\(\s*bytes\s+(?:calldata|memory)\s+\w+\s*\)/;

/** The target's test function and the contract it is in, or why the file is not a target. */
function testOf(code: string): { fn: string; contract: string } | string {
  const m = TEST.exec(code);
  if (!m) return 'the target defines no `function testFuzz_<Name>(bytes calldata data) public`';
  const owners = [...code.slice(0, m.index).matchAll(/^\s*(abstract\s+)?contract\s+(\w+)/gm)];
  const owner = owners.at(-1);
  if (!owner) return `${m[1]} is not inside a contract`;
  if (owner[1]) return `${owner[2]}, the contract ${m[1]} is in, is abstract: the test contract must deploy`;
  return { fn: m[1], contract: owner[2] };
}

/**
 * The target as the session compiles it, line for line: its own `require` and `assert` call refuzz's, which revert with a
 * reason marking them as the target's assertions; then those functions, and a runner contract that inherits the test
 * contract (its setUp and state) and adds `test_batch`, which reads a batch of inputs from a file and calls the test function
 * on each in a try with a gas allowance, and `testFuzz_refuzz`, Foundry's own fuzzer's entry, which fails only on what is a
 * finding: a Panic or the target's assertion, not the project rejecting an input.
 */
function compiled(name: string, code: string, test: { fn: string; contract: string }, rel: string): string {
  const own = code.split('\n').map((l) => (/^\s*import\s/.test(l) || isComment(l) ? l : l.replace(/(?<![\w$.])require\s*\(/g, 'refuzzRequire(').replace(/(?<![\w$.])assert\s*\(/g, 'refuzzAssert(')));
  return [
    ...own,
    `function refuzzRequire(bool ok) pure { if (!ok) revert("${ASSERTION}requirement failed"); }`,
    `function refuzzRequire(bool ok, string memory m) pure { if (!ok) revert(string(abi.encodePacked("${ASSERTION}", m))); }`,
    `function refuzzAssert(bool ok) pure { if (!ok) revert("${ASSERTION}assertion failed"); }`,
    'function refuzzFinding(bytes memory r) pure returns (bool) {',
    '  if (r.length < 4) return false;',
    '  bytes4 s; assembly { s := mload(add(r, 32)) }',
    '  if (s == 0x4e487b71) return true;',
    '  if (s != 0x08c379a0 || r.length < 100) return false;',
    '  bytes32 w; assembly { w := mload(add(r, 100)) }',
    `  return bytes16(w) == bytes16("${ASSERTION.slice(0, 16)}") || bytes16(w) == bytes16("${FORGE_ASSERTION}");`,
    '}',
    'interface RefuzzVm { function readFileBinary(string calldata) external view returns (bytes memory); }',
    `contract RefuzzRun_${name} is ${test.contract} {`,
    '  event refuzz_out(uint256 i, bool ok, uint256 gas, bytes data);',
    '  function test_batch() public {',
    `    (uint256 limit, bytes[] memory ins) = abi.decode(RefuzzVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D).readFileBinary("${rel}/${name}.bin"), (uint256, bytes[]));`,
    '    for (uint256 i = 0; i < ins.length; i++) {',
    '      uint256 g = gasleft();',
    `      try this.${test.fn}{gas: limit}(ins[i]) { emit refuzz_out(i, true, g - gasleft(), ""); }`,
    '      catch (bytes memory r) { emit refuzz_out(i, false, g - gasleft(), r); }',
    '    }',
    '  }',
    `  function testFuzz_refuzz(bytes calldata data) public { try this.${test.fn}{gas: 1000000000}(data) {} catch (bytes memory r) { if (refuzzFinding(r)) { assembly { revert(add(r, 32), mload(r)) } } } }`,
    '}',
  ].join('\n') + '\n';
}

/**
 * Foundry fuzz tests as targets: a test contract with `function testFuzz_<Name>(bytes calldata data) public`, the raw input
 * as its one argument. A session compiles each target once (with a runner contract beside it, see `compiled`); each batch
 * of inputs is written to a file the runner's `test_batch` reads with a cheatcode and runs one by one, in one `forge test` of
 * the local EVM. Per-input coverage is the outcome and gas used (EVM fuzzers' signal); project lines come from a `forge
 * coverage` of a batch that found something new. A Panic is located from the debugger's dump of that one input. The native
 * engine is Foundry's own fuzzer, on the runner's `testFuzz_refuzz`, which calls the target's test function with its bytes.
 */
function solidityFuzz(b: Built, place: Place, sh: Sh, solcs: string[]): FuzzRuntime {
  const env = (sid: string) => ({ FOUNDRY_TEST: `refuzz/${sid}`, FOUNDRY_GAS_LIMIT: '9223372036854775807' });
  return {
    guide: [
      `A Foundry fuzz test: \`// SPDX-License-Identifier: UNLICENSED\`, a pragma${solcs.length ? ` an installed compiler satisfies (the compilers are ${solcs.join(', ')}, and no other can be fetched: \`pragma solidity ${solcs.at(-1)};\` or a range that includes it)` : ''}, import lines for the project (paths from the project root: \`import {Name} from "src/Name.sol";\`), then \`contract NameFuzz { function testFuzz_Name(bytes calldata data) public { … } }\`, a contract that deploys without constructor arguments.`,
      'data is the input\'s raw bytes. Hand it on to a target that takes bytes or a string (`string(data)`), or cut the arguments from it yourself: `uint256 x = data.length >= 32 ? uint256(bytes32(data[0:32])) : 0;`, `uint8 k = data.length > 0 ? uint8(data[0]) : 0;`, `data[1:]` for the rest. Do not abi.decode the input: most byte strings are not valid ABI and would only revert.',
      'Call the target (deploy a contract with `new`, call a library as `Lib.fn(...)`). A revert from the project (require, revert, a custom error) is its answer to an input, not a finding, and ends the run of that input; to check something after one, make the call through `try`. A Panic from the project (overflow, division by zero, array bounds, its assert) is the finding.',
      'State what the result must satisfy with `assert(condition)` or `require(condition, "what broke")` in the test function (a round trip, a range, an invariant the function promises): a failing one there is reported as the target\'s assertion; a Panic in the test contract\'s own code is a bug in the target. No cheatcodes, no console.',
    ].join(' '),
    async session(targets) {
      const sid = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const rel = `refuzz/${sid}`;
      const files: Record<string, string> = {};
      const errors: Record<string, string> = {};
      const tests = new Map<string, { fn: string; contract: string }>();
      for (const [name, code] of Object.entries(targets)) {
        const t = testOf(code);
        if (typeof t === 'string') { errors[name] = t; continue; }
        tests.set(name, t);
        files[`F_${name}.t.sol`] = compiled(name, code, t, rel);
      }
      await place.put(`${b.src}/${rel}`, files);
      // Debugger dumps and coverage reports, outside the project.
      const scratch = await place.folder('sol');
      // Build; drop each target solc rejects and rebuild the rest.
      for (let attempt = 0; attempt < 10 && tests.size; attempt++) {
        const r = await sh('forge build --json --no-lint --offline', 1_800_000, env(sid));
        const errs = compileErrors(r.stdout);
        if (r.code === 0 && !errs.length) break;
        const bad = new Set<string>();
        for (const e of errs) {
          const m = new RegExp(`^${rel}/F_(\\w+)\\.t\\.sol$`).exec(e.file ?? '');
          if (!m || !tests.has(m[1])) continue;
          bad.add(m[1]);
          const lines = targets[m[1]].split('\n').length;
          const line = e.start >= 0 ? Buffer.from(compiled(m[1], targets[m[1]], tests.get(m[1])!, rel)).subarray(0, e.start).toString().split('\n').length : 0;
          errors[m[1]] ??= `${e.type}: ${e.message}${line > lines ? ` (in the runner refuzz adds, which inherits ${tests.get(m[1])!.contract} and calls ${tests.get(m[1])!.fn} externally)` : line ? ` (target line ${line})` : ''}`.slice(0, 600);
        }
        if (!bad.size) { for (const n of tests.keys()) errors[n] = `the project does not build with this target: ${(errs.map((e) => e.message).join('; ') || (r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')).slice(0, 600)}`; tests.clear(); break; }
        for (const n of bad) { tests.delete(n); await sh(`rm -f ${rel}/F_${n}.t.sol`, 60_000); }
      }
      const frames = new Map<string, { frames: Frame[]; inHarness: boolean }>();
      const lastCoverage = new Map<string, number>();
      const match = (name: string) => `--match-path ${rel}/F_${name}.t.sol --match-contract RefuzzRun_${name}`;

      /** Writes a batch's input file into the container: the gas each call may use, then the inputs. */
      const writeBatch = async (name: string, inputs: Buffer[], gas: bigint) => {
        try {
          await place.put(`${b.src}/${rel}`, { [`${name}.bin`]: batchFile(gas, inputs) });
          return true;
        } catch {
          return false;
        }
      };

      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          if (!tests.has(name)) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'TargetLoad', message: errors[name] ?? 'no such target' }));
          if (deadline && Date.now() > deadline) return [];
          const gas = BigInt(Math.round(Math.min(1e9, Math.max(1e7, (timeoutMs / 1000) * 2e8))));
          if (!(await writeBatch(name, inputs, gas))) return [];
          const ran = await sh(`forge test --json -vv --offline --disable-block-gas-limit ${match(name)} --match-test test_batch`, 120_000 + inputs.length * 2_000, env(sid));
          let logs: any[] = [];
          try { logs = Object.values<any>(JSON.parse(ran.stdout.slice(ran.stdout.indexOf('{'))))[0]?.test_results?.['test_batch()']?.logs ?? []; } catch {}
          const outs = batchOutputs(logs);
          if (!outs.size) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'NoReport', message: (ran.stderr || ran.stdout).slice(-400) }));
          const reports: InputReport[] = [];
          for (let i = 0; i < inputs.length; i++) {
            const o = outs.get(i);
            // The batch stopped here (the test ran out of gas or time): the rest were not run.
            if (!o) break;
            const sel = o.data.length >= 4 ? o.data.readUInt32BE(0) : 0;
            const bucket = Math.round(Math.log2(o.gas + 1) * 4);
            const reason = sel === 0x08c379a0 ? revertReason(o.data) : '';
            let r: InputReport;
            if (o.ok) r = { status: 'ok', result: '', features: [`ok:${bucket}`] };
            else if (!o.data.length && o.gas >= Number(gas) * 0.95) r = { status: 'timeout', origin: 'library', type: 'OutOfGas', message: 'ran out of gas: an unbounded loop, or work too large for a transaction', features: [`gas:${bucket}`] };
            else if (sel === 0x4e487b71 && o.data.length >= 36) {
              const code = Number(big(o.data.subarray(4, 36)));
              r = { status: 'error', origin: 'library', type: `Panic(0x${code.toString(16).padStart(2, '0')})`, message: PANICS[code] ?? 'panic', clean: false, features: [`panic:${code}:${bucket}`] };
            } else if (reason.startsWith(ASSERTION) || reason.startsWith(FORGE_ASSERTION)) {
              r = { status: 'error', origin: 'assertion', type: 'assertion', message: reason.replace(ASSERTION, '').slice(0, 400), features: [`assert:${reason.slice(0, 40)}:${bucket}`] };
            } else {
              r = { status: 'ok', result: `reverted: ${revertReason(o.data)}`, features: [`revert:${sel.toString(16)}:${bucket}`] };
              // `require` with a message (Error(string)) or a custom error: the contract rejecting its input on purpose. A revert
              // with no data (a bare `require`, `revert()`, a failed abi.decode or call) cannot be told apart, so it is not marked.
              if (o.data.length >= 4) r.clean = true;
            }
            reports.push(r);
          }
          // Where each Panic happens, from the debugger, once per kind and exact gas used per target: the same Panic in the
          // project and in the target's own code (setup) differ only in where, and the deploys a test makes first swamp any
          // coarser measure. At most DUMPS dumps per target; a Panic past them stays unlocated, as the project's.
          for (const [i, r] of reports.entries()) {
            if (r.status !== 'error' || !r.type?.startsWith('Panic')) continue;
            const key = `${name}|${r.type}|${outs.get(i)?.gas}`;
            const dumped = [...frames.keys()].filter((k) => k.startsWith(`${name}|`)).length;
            if (!frames.has(key) && dumped < DUMPS && (outs.get(i)?.gas ?? Infinity) <= DUMP_GAS && (await writeBatch(name, [inputs[i]], gas))) {
              const at = `${scratch}/dump-${name}`;
              await sh(`mkdir -p ${at} && forge test --offline --disable-block-gas-limit --debug --dump ${at}/dump.json ${match(name)} --match-test test_batch >/dev/null 2>&1`, 300_000, env(sid));
              const got = await place.get(at);
              await place.remove(at);
              let where: { frames: Frame[]; inHarness: boolean } | undefined;
              try { if (got['dump.json']) where = locate(JSON.parse(got['dump.json'].toString('utf8')), rel); } catch {}
              frames.set(key, where ?? { frames: [], inHarness: false });
            }
            const where = frames.get(key);
            if (where) { r.frames = where.frames; if (where.inHarness) r.origin = 'setup'; }
          }
          // Project lines: a coverage run of a batch that found something new, at most every ten seconds per target.
          const fresh = reports.findIndex((r) => r.features?.length);
          if (fresh >= 0 && Date.now() - (lastCoverage.get(name) ?? 0) > 10_000 && (await writeBatch(name, inputs.slice(0, reports.length), gas))) {
            lastCoverage.set(name, Date.now());
            const lcov = `${scratch}/${name}.lcov`;
            const cov = await sh(`forge coverage --offline --disable-block-gas-limit --report lcov --report-file ${lcov} ${match(name)} --match-test test_batch >/dev/null 2>&1; grep -E '^(SF:|DA:[0-9]+,[1-9])' ${lcov}; rm -f ${lcov}`, 600_000, env(sid));
            // Every line the batch ran, not only those new to the session: the trial batches that ran first are not counted.
            const seen = new Set<string>();
            const lines: [string, number][] = [];
            let path = '';
            for (const l of cov.stdout.split('\n')) {
              if (l.startsWith('SF:')) path = l.slice(3).trim().replace(`${b.src}/`, '');
              else if (l.startsWith('DA:') && projectPath(path, rel)) {
                const line = Number(l.slice(3).split(',')[0]);
                if (!seen.has(`${path}:${line}`)) { seen.add(`${path}:${line}`); lines.push([path, line]); }
              }
            }
            reports[fresh].lines = lines;
          }
          return reports;
        },
        async native(name, _corpus, _dict, seconds) {
          const crashes: { input: Buffer; report: Report }[] = [];
          let execs = 0;
          if (!tests.has(name)) return { crashes, corpus: [], execs };
          const end = Date.now() + seconds * 1000;
          const kinds = new Set<string>();
          // Foundry stops a campaign at its first failure; a new seed starts another until the time is up.
          for (let seed = 1; Date.now() < end - 2_000 && seed <= 20; seed++) {
            const left = Math.max(1, Math.floor((end - Date.now()) / 1000));
            const r = await sh(`forge test --json --offline --disable-block-gas-limit ${match(name)} --match-test testFuzz_refuzz --fuzz-runs 1000000000 --fuzz-timeout ${left} --fuzz-seed ${seed}`, (left + 120) * 1000, env(sid));
            let t: any;
            try { t = Object.values<any>(JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))))[0]?.test_results?.['testFuzz_refuzz(bytes)']; } catch {}
            if (!t) break;
            execs += t.kind?.Fuzz?.runs ?? 0;
            const ce = t.counterexample?.Single;
            if (t.status !== 'Failure' || !ce?.calldata) break;
            const input = bytesArgument(Buffer.from(String(ce.calldata).replace(/^0x/, ''), 'hex'));
            const [report] = await session.run(name, [input], 5_000);
            const key = `${report?.origin}|${report?.type}|${report?.frames?.at(-1)?.path}:${report?.frames?.at(-1)?.line}`;
            if (report && !kinds.has(key)) {
              kinds.add(key);
              crashes.push({ input, report });
            }
          }
          return { crashes, corpus: [], execs };
        },
        release(name) {
          tests.delete(name);
        },
        async close() {
          await sh(`rm -rf ${rel} ${scratch}`, 120_000);
        },
      };
      return { errors, session };
    },
    /**
     * The test as written; compile_solidity_fuzzer (src/images/solidity/) puts it in the project's refuzz/ folder in $OUT
     * and makes $OUT/<name> run Foundry's fuzzer on its testFuzz_ function. Foundry takes neither a dictionary nor a seed
     * corpus of raw inputs, so those stay beside it unused.
     */
    oss(name, source) {
      const test = testOf(source);
      if (typeof test === 'string') throw new Error(`${name}: ${test}`);
      const file = `${name}.t.sol`;
      return { file, source, compile: [`compile_solidity_fuzzer ${b.src.replace(/^\/src\/+/, '')} $SRC/refuzz/${file} ${test.contract} ${test.fn}`] };
    },
  };
}
