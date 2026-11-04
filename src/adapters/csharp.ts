/**
 * C#: the project built by its build spec (src/build.ts) in refuzz's base-builder-csharp image, whose build.sh publishes the
 * project's libraries into $OUT. Coverage comes from those assemblies rewritten once, before any target runs, to record each
 * line they reach (src/images/csharp/Instrument.cs, built into the image). Fuzz targets are SharpFuzz's: a static class with
 * `public static void Fuzz(ReadOnlySpan<byte> data)`, built with src/probes/csharp_fuzz.cs into a driver that references
 * $OUT's assemblies and run in-process by it, and natively by libFuzzer through SharpFuzz (the image's compile_dotnet_fuzzer).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { containerPlace } from '../place.ts';
import { shq } from '../run.ts';
import { parse } from '../syntax.ts';
import type { Adapter, Built, FuzzRuntime, FuzzSession, Report, Runtime, Target } from '../types.ts';

/** What the base image (src/images/base-csharp.Dockerfile) has: the framework the driver targets, and the coverage instrumenter. */
const TFM = 'net10.0';
const INSTRUMENT = '/opt/refuzz/instrument/Instrument.dll';
/** Where things go in the container: the instrumented assemblies with map.tsv, and the driver's project. */
const INSTRUMENTED = '/tmp/refuzz/cs-instrumented';
const DRIVER = '/tmp/refuzz/cs-driver';

/** Build properties for the driver: the targets' warnings are not errors, and nothing is fetched. */
const PROPS = [
  '-nologo', '-p:TreatWarningsAsErrors=false', '-p:WarningsAsErrors=', '-p:NuGetAudit=false', '-p:RunAnalyzers=false',
  '-p:GenerateDocumentationFile=false', '-p:DebugType=portable', '-p:DebugSymbols=true',
].map(shq).join(' ');

/** The assemblies in $OUT the driver references: all of them but those the runtime has its own copy of. */
const REFERENCES = 'fw=$(ls -d /usr/share/dotnet/shared/Microsoft.NETCore.App/*/ | sort -V | tail -n 1); for d in "$OUT"/*.dll; do [ -f "$d" ] && [ ! -f "$fw$(basename "$d")" ] && echo "$d"; done; true';

/** The driver's project: the targets with csharp_fuzz.cs and csharp_common.cs, referencing $OUT's assemblies. */
const driverProject = (refs: string[]) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>${TFM}</TargetFramework>
    <AssemblyName>RefuzzHarness</AssemblyName>
    <LangVersion>latest</LangVersion>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <NoWarn>$(NoWarn);CS0105;CS0168;CS0219;CS1998;CS0618;CS0612;CS8600;CS8601;CS8602;CS8603;CS8604;CS8618;CS8625;MSB3277</NoWarn>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
  </PropertyGroup>
  <ItemGroup>
${refs.map((r) => `    <Reference Include="${r}" />`).join('\n')}
  </ItemGroup>
</Project>
`;

/** libFuzzer's dictionary format: one quoted token per line, bytes outside printable ASCII escaped. */
function dictionary(terms: string[]): string {
  const esc = (t: string) => [...Buffer.from(t, 'utf8')].map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('');
  return [...new Set(terms.filter((t) => t.length > 0 && t.length <= 64))].slice(0, 2000).map((t) => `"${esc(t)}"`).join('\n') + '\n';
}

/** A target's class (the last one declared before its Fuzz method) with its namespace. */
function targetClass(source: string): { fqn: string; name: string } | string {
  const at = source.search(/\bstatic\s+void\s+Fuzz\s*\(/);
  if (at < 0) return 'no Fuzz method: the target is a static class with `public static void Fuzz(ReadOnlySpan<byte> data)`';
  const name = [...source.slice(0, at).matchAll(/\bclass\s+(\w+)/g)].at(-1)?.[1];
  if (!name) return 'no class around Fuzz: declare it in a public static class';
  const ns = /^\s*namespace\s+([\w.]+)/m.exec(source)?.[1];
  return { fqn: ns ? `${ns}.${name}` : name, name };
}

const SKIP_DIR = /(^|\/)(tests?|testing|specs?|benchmarks?|samples?|examples?|demos?|docs?|tools?|build|artifacts|bin|obj|node_modules|\.[^/]+)(\/|$)/i;
const SKIP_NAME = /(\.|^)\w*(Tests?|Specs?|Benchmarks?|Samples?|Examples?|Demos?|TestUtils|Testing)\.csproj$/i;
/** Test and benchmark projects, and Roslyn analyzers or source generators, which a caller never calls. */
const NOT_A_LIBRARY = /Microsoft\.NET\.Test\.Sdk|<IsTestProject>\s*true|"xunit|"NUnit|"MSTest|BenchmarkDotNet|<IsRoslynComponent>\s*true|<EnforceExtendedAnalyzerRules>\s*true/i;
/** Target frameworks this Linux container cannot build or load from a modern .NET: Windows, mobile and .NET Framework only. */
const FOREIGN_TFM = /-(windows|android|ios|maccatalyst|macos|tvos|tizen)|^net[1-4]\d*$|^net4\d*$/;

const frameworksOf = (text: string) => [...text.matchAll(/<TargetFrameworks?>([^<]+)</g)].flatMap((m) => m[1].split(';')).map((s) => s.trim()).filter((s) => s && !s.includes('$('));

/** The project's library projects, by its records: every .csproj that is not a test, benchmark or sample, and can target modern .NET, with its assembly's name. */
function libraries(dir: string): { path: string; assembly: string }[] {
  const shared = existsSync(join(dir, 'Directory.Build.props')) ? frameworksOf(readFileSync(join(dir, 'Directory.Build.props'), 'utf8')) : [];
  const out: { path: string; assembly: string; text: string }[] = [];
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    if (!rel.endsWith('.csproj') || SKIP_DIR.test(dirname(rel)) || SKIP_NAME.test(rel)) continue;
    const text = readFileSync(join(dir, rel), 'utf8');
    if (NOT_A_LIBRARY.test(text)) continue;
    const own = frameworksOf(text);
    const tfms = own.length ? own : shared;
    if (tfms.length && tfms.every((t) => FOREIGN_TFM.test(t))) continue;
    out.push({ path: rel, assembly: /<AssemblyName>\s*([^<$\s]+)\s*<\/AssemblyName>/.exec(text)?.[1] ?? basename(rel, '.csproj'), text });
  }
  // A project that compiles another one's sources (a signed or platform twin) would declare every type twice.
  const dirs = new Set(out.map((l) => dirname(l.path).split('/').pop()));
  return out.filter((l) => ![...l.text.matchAll(/<Compile\s+Include="\.\.[\\/]([^\\/"]+)[\\/]/g)].some((m) => dirs.has(m[1]) && m[1] !== dirname(l.path).split('/').pop())).map(({ path, assembly }) => ({ path, assembly }));
}

const isImport = (l: string) => /^\s*using\s+(static\s+)?[A-Za-z_][\w.]*\s*;\s*$|^\s*using\s+[A-Za-z_]\w*\s*=\s*[\w.<>, ]+;\s*$/.test(l);
const bindsResult = (l: string) => /^\s*(var|[A-Za-z_][\w.<>\[\],? ]*)\s+result\s*=(?!=)/.test(l);
const safe = (name: string) => name.replace(/\W/g, '_');

const PUBLISH = 'build.sh publishes each library project into $OUT (`dotnet publish <lib>.csproj -c Release -o $OUT`), with its portable .pdb and every assembly it depends on';

/** The project's library projects whose assemblies build.sh left in $OUT. */
async function published(b: Built): Promise<{ path: string; assembly: string }[]> {
  const r = await b.box.exec('ls "$OUT"');
  const there = new Set(r.stdout.split('\n'));
  return libraries(b.dir).filter((l) => there.has(`${l.assembly}.dll`));
}

/** Rewrites $OUT's project assemblies to record the lines they run into `to`, with map.tsv: what it printed, or the error. */
const instrument = (b: Built, to: string) => b.box.exec(`rm -rf ${shq(to)} && dotnet ${INSTRUMENT} "$OUT" ${shq(`${b.src}/`)} ${shq(to)} && wc -l < ${shq(`${to}/map.tsv`)}`, { timeoutMs: 600_000 });

export const csharp: Adapter = {
  languages: ['c_sharp'],
  // The build published the project's libraries into $OUT with debug symbols that name the sources under its folder.
  async ready(b) {
    const libs = libraries(b.dir);
    if (!libs.length) return undefined;
    if (!(await published(b)).length) return `none of the project's assemblies (${libs.map((l) => `${l.assembly}.dll`).join(', ')}) is in $OUT: ${PUBLISH}`;
    const r = await instrument(b, '/tmp/refuzz/cs-ready');
    await b.box.exec('rm -rf /tmp/refuzz/cs-ready');
    if (r.code !== 0) return `reading the debug symbols of $OUT's assemblies failed: ${(r.stdout + r.stderr).trim().split('\n').slice(-6).join('\n')}`;
    if (Number(r.stdout.trim().split('\n').at(-1)) === 0) return `the debug symbols (.pdb) of $OUT's assemblies name no source under ${b.src}: ${PUBLISH}, built without ContinuousIntegrationBuild, DeterministicSourcePaths or a PathMap`;
    return undefined;
  },
  async prepare(b, log) {
    const language = b.language;
    const dir = b.dir;
    const place = containerPlace(b.box);
    const refs = (await published(b)).map((l) => l.path);
    if (!refs.length) throw new Error(`no C# library project's assembly is in $OUT: ${PUBLISH}`);
    const inst = await instrument(b, INSTRUMENTED);
    if (inst.code !== 0) throw new Error(`instrumenting the project for coverage failed: ${(inst.stdout + inst.stderr).slice(-600)}`);
    /** The project's own assemblies (the ones with its sources): what SharpFuzz instruments for libFuzzer. */
    const assemblies = (await place.run(['sh', '-c', `cd ${INSTRUMENTED} && ls *.dll`])).stdout.split('\n').filter(Boolean);
    log(`  c_sharp: ${inst.stdout.trim().split('\n').filter((l) => l.startsWith('instrumented')).join('; ')}`);
    const references = (await place.run(['sh', '-c', REFERENCES])).stdout.split('\n').filter(Boolean);
    await place.remove(DRIVER);
    await place.put(DRIVER, {
      'RefuzzHarness.csproj': driverProject(references),
      'Refuzz.cs': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'csharp_fuzz.cs')),
      'Common.cs': readFileSync(resolve(import.meta.dirname, '..', 'probes', 'csharp_common.cs')),
    });
    const restored = await place.run(['sh', '-c', `cd ${DRIVER} && dotnet restore RefuzzHarness.csproj ${PROPS}`], { timeoutMs: 600_000 });
    if (restored.code !== 0) throw new Error(`restoring the C# fuzz driver failed: ${(restored.stdout + restored.stderr).slice(-600)}`);
    const env = { REFUZZ_ROOT: b.src };
    const namespaces = new Map<string, string>();
    const trees = new Map<string, any>();
    let queue: Promise<unknown> = Promise.resolve();
    const run = (script: string, timeoutMs = 900_000) => place.run(['sh', '-c', script], { timeoutMs }).then((r) => ({ ok: r.code === 0, out: `${r.stdout}\n${r.stderr}` }));

    /**
     * Writes targets into the driver's project, compiles them, drops each one the compiler blames and compiles again; returns
     * why each dropped one failed. Then puts the instrumented project assemblies in its bin.
     */
    async function compile(names: Record<string, string>, targets: Record<string, string>): Promise<Map<string, string>> {
      await place.remove(`${DRIVER}/harness`);
      await place.put(`${DRIVER}/harness`, Object.fromEntries(Object.entries(targets).map(([n, code]) => [`G_${names[n]}.cs`, code])));
      const failed = new Map<string, string>();
      const bySafe = new Map(Object.entries(names).map(([n, s]) => [s, n]));
      const blame = new RegExp(`^\\s*${DRIVER}/harness/G_(\\w+)\\.cs\\((\\d+),\\d+\\): error (\\w+): (.*?)(?: \\[/.*\\])?$`, 'gm');
      let built = false, last = '';
      for (let i = 0; i < 6 && !built; i++) {
        const r = await run(`cd ${DRIVER} && dotnet build RefuzzHarness.csproj --no-restore -c Debug -clp:NoSummary ${PROPS}`, 600_000);
        built = r.ok;
        last = r.out;
        if (built) break;
        const blamed = new Map<string, string[]>();
        for (const m of r.out.matchAll(blame)) {
          const list = blamed.get(m[1]) ?? blamed.set(m[1], []).get(m[1])!;
          const msg = `line ${m[2]}: ${m[3]}: ${m[4]}`;
          if (!list.includes(msg)) list.push(msg);
        }
        if (!blamed.size) break;
        for (const [s, msgs] of blamed) {
          await place.remove(`${DRIVER}/harness/G_${s}.cs`);
          if (bySafe.has(s)) failed.set(bySafe.get(s)!, msgs.slice(0, 4).join('\n'));
        }
      }
      // Still not building, or failing outside any target: nothing may run against an earlier build.
      if (!built) for (const n of Object.keys(targets)) if (!failed.has(n)) failed.set(n, last.split('\n').filter((l) => /error/.test(l)).slice(0, 4).join('\n') || 'the targets did not build');
      // The build copies the project's assemblies over the instrumented ones; put those back.
      await run(`cp ${INSTRUMENTED}/*.dll ${INSTRUMENTED}/*.pdb ${DRIVER}/bin/Debug/${TFM}/ 2>/dev/null; true`);
      return failed;
    }

    /**
     * Fuzz targets: built together in rounds where no two declare the same class, each round's program copied for the
     * session, each target run by its own long-lived driver process in the container; natively, built alone by
     * compile_dotnet_fuzzer, its project assemblies instrumented by SharpFuzz, and run by libFuzzer.
     */
    const fuzz: FuzzRuntime = {
      guide: [
        'A SharpFuzz fuzz target as OSS-Fuzz runs it: one complete C# file, its `using` lines (System for ReadOnlySpan, the project\'s namespaces), then a public static class with `public static void Fuzz(ReadOnlySpan<byte> data)`, which SharpFuzz\'s Fuzzer.LibFuzzer.Run calls with each input. No Main.',
        'Split data into arguments yourself, checking lengths first: `if (data.Length < 2) return;`, a byte for a number or a flag (`int n = data[0];`), then the rest as text (`var s = Encoding.UTF8.GetString(data.Slice(1));`) or bytes (`data.Slice(1).ToArray()`). Build objects the way the project\'s own tests do.',
        'Catch only the exceptions the called method documents for bad input (a FormatException or ArgumentException from a parser, its own exception type) and return; let everything else out.',
        'Assert properties of each result in Fuzz: a round trip (parse what it printed), a range or order, two methods that should agree, with `if (!cond) throw new InvalidOperationException($"ToString() = {t} for {s}");`; Debug.Assert works only in a Debug build. Never throw on a documented rejection. Do not print.',
      ].join(' '),
      async session(targets) {
        const folder = await place.folder('cs');
        const all = Object.keys(targets);
        const names = Object.fromEntries(all.map((n, i) => [n, `${safe(n)}_${i}`]));
        const errors: Record<string, string> = {};
        const classes = new Map<string, { fqn: string; name: string; round: number }>();
        const rounds: string[][] = [];
        for (const n of all) {
          const t = targetClass(targets[n]);
          if (typeof t === 'string') { errors[n] = t; continue; }
          let round = rounds.findIndex((r) => !r.some((x) => classes.get(x)!.fqn === t.fqn));
          if (round < 0) round = rounds.push([]) - 1;
          rounds[round].push(n);
          classes.set(n, { ...t, round });
        }
        for (const [r, round] of rounds.entries()) {
          const failed = await (queue = queue.then(() => compile(names, Object.fromEntries(round.map((n) => [n, targets[n]])))).catch((e) => new Map(round.map((n) => [n, String(e)])))) as Map<string, string>;
          for (const [n, why] of failed) errors[n] = why;
          // Each session runs from its own copy: a later session's build must not change the program under a running one.
          // The driver reads each target's source from the copy, for the line an exception came from.
          await run(`cp -r ${DRIVER}/bin/Debug/${TFM} ${folder}/r${r}`);
          await place.put(`${folder}/r${r}/targets`, Object.fromEntries(round.map((n) => [`G_${names[n]}.cs`, targets[n]])));
        }
        const make = (name: string, timeoutMs: number) => {
          const c = classes.get(name)!, at = `${folder}/r${c.round}`;
          return place.driver(['dotnet', `${at}/RefuzzHarness.dll`, c.fqn, String(timeoutMs), `${INSTRUMENTED}/map.tsv`, `${at}/targets/G_${names[name]}.cs`], { cwd: '/tmp', env });
        };
        const drivers = new Map<string, { d: ReturnType<typeof make>; timeout: number }>();
        await Promise.all([...classes.keys()].filter((n) => !errors[n]).map(async (name) => {
          const d = make(name, 1_000);
          if (await d.start()) drivers.set(name, { d, timeout: 1_000 });
          else errors[name] = d.fatal ?? 'did not load';
        }));
        const session: FuzzSession = {
          async run(name, inputs, timeoutMs, deadline) {
            let h = drivers.get(name);
            if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: errors[name] ?? 'no such target' }));
            // The driver's timer is set when it starts; a different allowance needs a new process.
            if (h.timeout !== timeoutMs) { h.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
            return h.d.run(inputs, timeoutMs, deadline);
          },
          release(name) {
            drivers.get(name)?.d.stop();
            drivers.delete(name);
          },
          async close() {
            for (const h of drivers.values()) h.d.stop();
            // Killing `docker exec` leaves its process running in the container: the drivers go by their folder.
            await run(`pkill -9 -f ${shq(folder)} || true`, 30_000);
            await place.remove(folder);
          },
        };
        session.native = async (name, corpus, dict, seconds) => {
          const c = classes.get(name), h = drivers.get(name);
          if (!c || !h) return { crashes: [], corpus, execs: 0 };
          const fuzzer = `refuzz-${safe(folder.split('/').pop()!)}-${names[name]}`, base = `${folder}/${fuzzer}`;
          await place.put(base, { 'target.cs': targets[name], ...Object.fromEntries((corpus.length ? corpus : [Buffer.from([0])]).map((b, k) => [`corpus/seed-${k}`, b])), dict: dictionary(dict), 'found/.keep': '' });
          // Built the way the target's OSS-Fuzz build line builds it, into $OUT beside the project; builds take turns.
          const built = await (queue = queue.then(() => run(`compile_dotnet_fuzzer ${base}/target.cs ${fuzzer} ${c.fqn} ${assemblies.map(shq).join(' ')}`)).catch((e) => ({ ok: false, out: String(e) }))) as { ok: boolean; out: string };
          if (!built.ok) { log(`  c_sharp: ${name}: compile_dotnet_fuzzer failed: ${built.out.trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`); return { crashes: [], corpus, execs: 0 }; }
          // libFuzzer stops at the first crash: each one is kept, and the run started again for the time left.
          const crashes: { input: Buffer; report: Report }[] = [];
          const causes = new Set<string>();
          let execs = 0;
          const end = Date.now() + seconds * 1000;
          try {
            while (crashes.length < 8) {
              const left = Math.floor((end - Date.now()) / 1000);
              if (left < 3) break;
              const r = await run(`cd ${base} && "$OUT/${fuzzer}" -max_total_time=${left} -timeout=${Math.max(1, Math.ceil(h.timeout / 1000))} -rss_limit_mb=4096 -print_final_stats=1 -artifact_prefix=${base}/found/ -dict=${base}/dict ${base}/corpus 2>&1`, (left + 180) * 1000);
              const ran = Number([...r.out.matchAll(/stat::number_of_executed_units:\s*(\d+)/g)].at(-1)?.[1] ?? [...r.out.matchAll(/^#(\d+)\s/gm)].at(-1)?.[1] ?? 0);
              if (!ran) log(`  c_sharp: ${name}: libFuzzer did not run: ${r.out.trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`);
              execs += ran;
              const found = Object.entries(await place.get(`${base}/found`)).filter(([f]) => f !== '.keep');
              if (!found.length) break;
              for (const [f, input] of found) {
                await place.remove(`${base}/found/${f}`);
                const [again] = f.startsWith('timeout-') ? [] : await session.run(name, [input], h.timeout);
                const report: Report = f.startsWith('timeout-') ? { status: 'timeout', origin: 'library', type: 'Timeout' } : again && again.status !== 'ok' ? again : { status: 'error', origin: 'library', type: /^([\w.]+(?:Exception|Error)): /m.exec(r.out)?.[1] ?? 'LibFuzzerCrash', message: r.out.trim().slice(-600) };
                const cause = report.origin === 'assertion' ? `assertion|${report.message}` : `${report.type}|${report.frames?.at(-1)?.path}:${report.frames?.at(-1)?.line}`;
                if (causes.has(cause)) return { crashes, corpus: await grown(), execs };
                causes.add(cause);
                crashes.push({ input, report });
              }
            }
            return { crashes, corpus: await grown(), execs };
          } finally {
            await run(`rm -rf ${shq(base)} "$OUT/${fuzzer}" "$OUT/${fuzzer}.d" "$WORK/dotnet-${fuzzer}"`);
          }
          async function grown() { return Object.values(await place.get(`${base}/corpus`)); }
        };
        return { errors, session };
      },
      // The target as it is; the image's compile_dotnet_fuzzer builds it against $OUT into $OUT/<name>, SharpFuzz
      // instrumenting the project's assemblies, as OSS-Fuzz's helpers do for the languages it has.
      oss(name, source) {
        const t = targetClass(source);
        if (typeof t === 'string') throw new Error(`${name}: ${t}`);
        const file = `${name}.cs`;
        return { file, source, compile: [`compile_dotnet_fuzzer $SRC/refuzz/${file} ${name} ${t.fqn} ${assemblies.join(' ')}`] };
      },
    };

    const rt: Runtime = {
      language,
      guide: 'C# statements, the body of a method, one per item. `using Namespace;` lines bring namespaces into scope (System, System.Collections.Generic, System.IO, System.Linq, System.Text and System.Threading.Tasks already are). Build the arguments, then the last line calls the target and binds what it returns: `var result = Parser.Parse(text);`. For an instance method, construct the object first. For an async method, `var result = await obj.ReadAsync(...);`. For a method returning void, call it, then bind what it changed: `var result = list;`. No class declarations, no Main.',
      importFor(t: Target) {
        if (!namespaces.has(t.path)) {
          const src = existsSync(join(dir, t.path)) ? readFileSync(join(dir, t.path), 'utf8') : '';
          namespaces.set(t.path, /^\s*namespace\s+([\w.]+)/m.exec(src)?.[1] ?? '');
        }
        const ns = namespaces.get(t.path)!;
        return ns ? `using ${ns};` : '';
      },
      isImport,
      bindsResult,
      parseWrap: (code) => ({ source: code, offset: 0 }),
      isPublic(t, source) {
        // Only the projects the harness references can be called: not a test, benchmark or sample project's methods.
        if (!refs.some((r) => dirname(r) === '.' || t.path.startsWith(`${dirname(r)}/`))) return false;
        if (!/\bpublic\b/.test(t.header) || /\babstract\b/.test(t.header)) return false;
        let root = trees.get(t.path);
        if (!root) trees.set(t.path, (root = parse(source, 'c_sharp')));
        const row = t.line - 1;
        let enclosed = false;
        for (const n of root?.walk() ?? []) {
          if (!/^(class|struct|record\w*|interface)_declaration$/.test(n.type) || n.startPosition.row > row || n.endPosition.row < row) continue;
          enclosed = true;
          if (!n.namedChildren.some((c: any) => c.type === 'modifier' && c.text === 'public')) return false;
        }
        if (enclosed) return true;
        // A file tree-sitter could not fully parse loses the type around the method: the nearest type declared above it decides.
        const above = source.split('\n').slice(0, row).reverse().find((l) => /\b(class|struct|record|interface)\s+[A-Za-z_]/.test(l) && !/^\s*(\/\/|\*)/.test(l));
        return !above || /\bpublic\b/.test(above);
      },
      errorsAreValues: false,
      rejections: ['ArgumentException', 'ArgumentNullException', 'ArgumentOutOfRangeException', 'FormatException', 'InvalidOperationException', 'NotSupportedException', 'OverflowException', 'KeyNotFoundException', 'NotImplementedException', 'IndexOutOfRangeException', 'InvalidDataException', 'JsonException']
        .flatMap((t) => [t, t === 'KeyNotFoundException' ? `System.Collections.Generic.${t}` : t === 'InvalidDataException' ? `System.IO.${t}` : t === 'JsonException' ? `System.Text.Json.${t}` : `System.${t}`]),
      environmental: (r) => /^System\.(IO\.FileNotFoundException|IO\.FileLoadException|TypeLoadException|MissingMethodException|MissingFieldException|BadImageFormatException|DllNotFoundException|PlatformNotSupportedException|Net\.Sockets\.SocketException|Net\.Http\.HttpRequestException)$/.test(r.type ?? '') && (r.type !== 'System.IO.FileNotFoundException' || /assembly/i.test(r.message ?? '')),
      fuzz,
    };
    return rt;
  },
};
