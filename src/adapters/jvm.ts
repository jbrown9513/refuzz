/**
 * Java, Kotlin, Scala and Groovy: the project built by its OSS-Fuzz build spec (src/build.ts) in the base-builder-jvm image,
 * whose build.sh leaves the project's jars and the jars it needs at run time in $OUT, as OSS-Fuzz's JVM projects do. Fuzz
 * targets are Jazzer targets (a class with a static `fuzzerTestOneInput`), each compiled on its own against those jars and
 * Jazzer's API, run in-process by src/probes/RefuzzDriver.java under the JaCoCo agent for line coverage, and by Jazzer.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { PARALLEL, pool, shq } from '../run.ts';
import { parse } from '../syntax.ts';
import type { Adapter, Built, Frame, FuzzRuntime, FuzzSession, InputReport, Report, Runtime, Target } from '../types.ts';

const EXT: Record<string, string> = { java: 'java', kotlin: 'kt', scala: 'scala', groovy: 'groovy' };
const SKIP_DIRS = new Set(['.git', 'build', 'target', 'node_modules', '.gradle', 'out', '.idea', '.bsp', '.fuzz', '.metals', '.bloop', '.refuzz']);

/** What the base image (src/images/base-jvm.Dockerfile) has: JDK 21, which runs what either of its JDKs built, Jazzer and JaCoCo. */
const JDK = '/usr/lib/jvm/java-21/bin';
const JAZZER = '/opt/refuzz/jazzer/lib';
const API = `${JAZZER}/jazzer-api-0.30.0.jar`;
/** Jazzer's FuzzedDataProvider's support classes: on the boot class path when Jazzer runs, on the in-process driver's class path. */
const BOOT = '/opt/refuzz/jazzer/bootstrap/jazzer_bootstrap.jar';
const JACOCO = '/opt/refuzz/jacoco';
const AGENT = `${JACOCO}/org.jacoco.agent-0.8.12-runtime.jar`;
/** Where the drivers are compiled in the container: RefuzzLines apart, in its own class loader with JaCoCo and ASM. */
const PROBE = '/tmp/refuzz/jvm-probe';
const LINES = '/tmp/refuzz/jvm-lines';
/** The package a source file declares; Scala may chain several `package` clauses. */
function packageOf(source: string): string {
  const parts: string[] = [];
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('@file:')) continue;
    const m = /^package\s+([\w.`]+)/.exec(t);
    if (!m) break;
    parts.push(m[1].replace(/`/g, '').replace(/;$/, ''));
  }
  return parts.join('.');
}

/** Every JVM source file of the project by `package/File.ext`, the key stack frames and JaCoCo name it by. Main code wins over tests. */
function sourceIndex(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    let entries;
    try { entries = readdirSync(join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path); continue; }
      if (!/\.(java|kt|scala|groovy)$/.test(e.name)) continue;
      const pkg = packageOf(readFileSync(join(dir, path), 'utf8'));
      const key = pkg ? `${pkg.replace(/\./g, '/')}/${e.name}` : e.name;
      const have = out.get(key);
      if (!have || (/(^|\/)(test|tests|it)\//.test(have) && !/(^|\/)(test|tests|it)\//.test(path))) out.set(key, path);
    }
  };
  walk('');
  return out;
}

const TYPE_DECL = /^(class|interface|enum|record|object|trait|annotation_type|enum_class)_(declaration|definition)$/;

/** The type declarations around a line, outermost first, with their names and modifiers. */
function enclosing(source: string, language: string, line: number): { kind: string; name: string; head: string }[] {
  // The Groovy grammar reads a class as a generic command, so its declarations are found by their lines, nested by indentation.
  if (language === 'groovy') {
    const stack: { kind: string; name: string; head: string; indent: number }[] = [];
    source.split('\n').slice(0, line).forEach((l) => {
      const m = /^(\s*)((?:(?:public|private|protected|abstract|final|static)\s+)*)(class|interface|enum|trait)\s+(\w+)/.exec(l);
      if (!m) return;
      while (stack.length && stack.at(-1)!.indent >= m[1].length) stack.pop();
      stack.push({ kind: `${m[3]}_declaration`, name: m[4], head: m[0], indent: m[1].length });
    });
    return stack;
  }
  const root = parse(source, language);
  if (!root) return [];
  const out: { kind: string; name: string; head: string }[] = [];
  for (const n of root.walk()) {
    if (!TYPE_DECL.test(n.type) || n.startPosition.row + 1 > line || n.endPosition.row + 1 < line) continue;
    const name = n.childForFieldName('name') ?? n.namedChildren.find((c: any) => /identifier/.test(c.type));
    // Modifiers come before the name; what follows it (a Kotlin primary constructor's `private val`) is not the type's.
    const head = Buffer.from(source).subarray(n.startIndex, name ? name.endIndex : n.startIndex).toString('utf8');
    if (name) out.push({ kind: n.type, name: name.text, head });
  }
  return out;
}

const isImport = (l: string) => /^\s*import\s/.test(l);

const GUIDES: Record<string, string> = {
  java: 'Java statements of one method body, one per item; the method is static, returns nothing else and may throw anything (checked exceptions need no handling). `import a.b.C;` and `import static a.b.C.m;` lines bring names into scope. No class or method declarations; lambdas and anonymous classes are fine. Build the arguments, then the last line calls the target and binds what it returns: `var result = Version.parse(input);`, a void method too (`var result = printer.print(x);` runs it and binds null). Arrays: `new byte[] {1, 2}`.',
  kotlin: 'Kotlin statements of one function body, one per item. `import a.b.C` lines bring classes into scope; a top-level function or extension is imported by its own name (`import a.b.parseThing`). Object and companion members are called through the class: `C.parse(x)`. No declarations other than local vals. Build the arguments, then the last line calls the target and binds what it returns, a Unit function too: `val result = C.parse(input)`.',
  scala: 'Scala statements of one method body, one per item. `import a.b.C` lines bring names into scope; members of an `object` are called through it: `C.parse(x)`. Supply implicit arguments explicitly or import them. Build the arguments, then the last line calls the target and binds what it returns, a Unit method too: `val result = C.parse(input)`.',
  groovy: 'Groovy statements of one static method body, one per item. `import a.b.C` lines bring classes into scope. A method not declared static is called on an instance. Build the arguments, then the last line calls the target and binds what it returns, a void method too: `def result = C.parse(input)`.',
};

const BINDS: Record<string, RegExp> = {
  java: /(^|;)\s*(final\s+)?([\w.$<>[\]?, ]+\s+)?result\s*=(?!=)/,
  kotlin: /(^|;)\s*(val|var)\s+result\b[^=]*=(?!=)/,
  scala: /(^|;)\s*(val|var)\s+result\b[^=]*=(?!=)/,
  groovy: /(^|;)\s*(def|final|var|[\w.$<>[\]]+)\s+result\s*=(?!=)/,
};

/** libFuzzer's dictionary format: one quoted token per line, bytes outside printable ASCII escaped. */
function dictionary(terms: string[]): string {
  const esc = (t: string) => [...Buffer.from(t, 'utf8')].map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('');
  return [...new Set(terms.filter((t) => t.length > 0 && t.length <= 64))].slice(0, 2000).map((t) => `"${esc(t)}"`).join('\n') + '\n';
}

/** The project's packages, as folders (`com/example/parse`): those of its main sources, tests left out. */
function projectPackages(dir: string): Set<string> {
  return new Set([...sourceIndex(dir).entries()].filter(([, path]) => !/(^|\/)(test|tests|it|testFixtures)\//.test(path)).map(([key]) => key.split('/').slice(0, -1).join('/')).filter(Boolean));
}

/** The jars build.sh left in $OUT (Jazzer's own left out), each with the folders of the classes it holds. */
async function jarsOf(b: Built): Promise<Map<string, string[]>> {
  const r = await b.box.exec(`for j in "$OUT"/*.jar; do case "$(basename "$j")" in jazzer*) continue;; esac; [ -f "$j" ] || continue; echo "JAR $j"; unzip -Z1 "$j" '*.class' 2>/dev/null | sed 's|/[^/]*$||' | sort -u; done`, { timeoutMs: 300_000 });
  const out = new Map<string, string[]>();
  let jar = '';
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('JAR ')) out.set((jar = line.slice(4)), []);
    else if (jar && line) out.get(jar)!.push(line);
  }
  return out;
}

/** A language's standard library, by a folder of its classes, which targets in that language need on the class path. */
const STDLIB: Record<string, { folder: string; name: string }> = { kotlin: { folder: 'kotlin', name: 'kotlin-stdlib' }, scala: { folder: 'scala', name: 'scala-library' }, groovy: { folder: 'groovy/lang', name: 'Groovy' } };

/**
 * The command that compiles one target file in the language, reading $CP (the class path) and $DEST (the class folder). The
 * Kotlin and Scala compilers are the base image's, chosen and set by the standard library on the class path; Groovy compiles
 * with the project's own Groovy.
 */
async function compilerFor(b: Built, jars: string[]): Promise<string> {
  const language = b.language;
  if (language === 'java') return 'javac -nowarn -encoding UTF-8 -proc:none -cp "$CP" -d "$DEST"';
  if (language === 'groovy') return 'java -cp "$CP" org.codehaus.groovy.tools.FileSystemCompiler -cp "$CP" -d "$DEST"';
  const listing = `for j in ${jars.map(shq).join(' ')}; do unzip -Z1 "$j" 2>/dev/null; done`;
  if (language === 'kotlin') {
    const r = await b.box.exec(`for j in ${jars.map(shq).join(' ')}; do if unzip -Z1 "$j" kotlin/Unit.class >/dev/null 2>&1; then unzip -p "$j" META-INF/MANIFEST.MF | sed -n 's/^Implementation-Version: *//p'; break; fi; done`, { timeoutMs: 120_000 });
    const v = /^(\d+)\.(\d+)/.exec(r.stdout.trim());
    // Code compiled for the standard library the project ships, so it calls nothing newer than that library has.
    const api = v && Number(v[1]) * 100 + Number(v[2]) >= 108 && Number(v[1]) * 100 + Number(v[2]) < 201 ? ` -api-version ${v[1]}.${v[2]} -language-version ${v[1]}.${v[2]}` : '';
    return `kotlinc -no-stdlib -no-reflect -nowarn${api} -cp "$CP" -d "$DEST"`;
  }
  const r = await b.box.exec(`${listing} | grep -E -m1 '^scala/quoted/Expr\\.class$|^scala/collection/immutable/LazyList\\.class$'`, { timeoutMs: 300_000 });
  const scalac = /quoted/.test(r.stdout) ? 'scalac-3' : /LazyList/.test(r.stdout) ? 'scalac-2.13' : 'scalac-2.12';
  return `${scalac} -nowarn -classpath "$CP" -d "$DEST"`;
}

export const jvm: Adapter = {
  languages: ['java', 'kotlin', 'scala', 'groovy'],
  // The build left the project's classes in jars in $OUT, with the standard library of a language that has one.
  async ready(b) {
    const jars = await jarsOf(b);
    const how = 'build.sh copies the project\'s jars and every jar it needs at run time (its runtime dependencies and its language\'s standard library) into $OUT, flat, as OSS-Fuzz\'s JVM projects do';
    if (!jars.size) return `there are no jars in $OUT: ${how}`;
    const folders = new Set([...jars.values()].flat());
    const pkgs = [...projectPackages(b.dir)];
    if (pkgs.length && !pkgs.some((p) => folders.has(p))) return `no jar in $OUT holds the project's classes (packages ${pkgs.slice(0, 6).map((p) => p.replace(/\//g, '.')).join(', ')}): ${how}`;
    const std = STDLIB[b.language];
    if (std && !folders.has(std.folder)) return `no jar in $OUT holds the ${std.name} the project's ${b.language} code runs on: ${how}`;
    return undefined;
  },
  async prepare(b, log) {
    const language = b.language;
    const place = containerPlace(b.box);
    const jars = await jarsOf(b);
    const pkgs = projectPackages(b.dir);
    // The project's own jars first, ahead of any older copy of the same classes among its dependencies.
    const own = [...jars].filter(([, folders]) => folders.some((f) => pkgs.has(f))).map(([jar]) => jar);
    const runCp = [...own, ...[...jars.keys()].filter((j) => !own.includes(j))];
    const probes = ['RefuzzRunner.java', 'RefuzzCoverage.java', 'RefuzzDriver.java', 'RefuzzLines.java'];
    await place.put('/tmp/refuzz/jvm-src', Object.fromEntries(probes.map((f) => [f, readFileSync(resolve(import.meta.dirname, '..', 'probes', f))])));
    const javac = `${JDK}/javac -nowarn -cp '${JACOCO}/*'`;
    const comp = await place.run(['sh', '-c', `rm -rf ${PROBE} ${LINES} && mkdir -p ${PROBE} ${LINES} && cd /tmp/refuzz/jvm-src && ${javac} -d ${PROBE} RefuzzRunner.java RefuzzCoverage.java RefuzzDriver.java && ${javac} -d ${LINES} RefuzzLines.java RefuzzCoverage.java`], { timeoutMs: 300_000 });
    if (comp.code !== 0) throw new Error(`compiling the JVM driver failed: ${(comp.stdout + comp.stderr).slice(-400)}`);
    const compile = await compilerFor(b, runCp);
    log(`  jvm: ${runCp.length} jars in $OUT, ${own.length} with the project's classes; targets compiled by ${compile.split(' ')[0]}`);

    const index = sourceIndex(b.dir);
    const rt: Runtime = {
      language,
      guide: GUIDES[language],
      importFor(t: Target) {
        const source = readFileSync(join(b.dir, t.path), 'utf8');
        const pkg = packageOf(source);
        const top = enclosing(source, t.language, t.line)[0]?.name ?? t.qualifiedName.split('.').at(-1)!;
        const mine = pkg ? [`import ${pkg}.${top}${language === 'java' ? ';' : ''}`] : [];
        // The file's own imports of the types its header names, so a target builds arguments from the right packages.
        const used = source.split('\n').filter((l) => /^import\s+(static\s+)?[\w.]+\.(\w+);?\s*$/.test(l) && new RegExp(`\\b${/\.(\w+);?\s*$/.exec(l)![1]}\\b`).test(t.header));
        return [...mine, ...used.map((l) => l.trim())].join('\n');
      },
      isImport,
      bindsResult: (l) => BINDS[language].test(l),
      parseWrap(code) {
        const head = { java: 'class RefuzzParse { void refuzzRun() throws Throwable {', kotlin: 'fun refuzzRun() {', scala: 'object RefuzzParse { def refuzzRun() = {', groovy: 'class RefuzzParse { static Object refuzzRun() {' }[language]!;
        const tail = language === 'kotlin' ? '}' : '}}';
        // Imports cannot sit in a method body: commented out in place, so every other line keeps its row.
        return { source: `${head}\n${code.split('\n').map((l) => (isImport(l) ? `// ${l}` : l)).join('\n')}\n${tail}`, offset: 1 };
      },
      isPublic(t, source) {
        const types = enclosing(source, t.language, t.line);
        const hidden = /\b(private|internal|protected)\b/;
        if (language === 'java') {
          const inInterface = /interface/.test(types.at(-1)?.kind ?? '');
          if (!/\bpublic\b/.test(t.header) && !(inInterface && !/\bprivate\b/.test(t.header))) return false;
          return types.every((d, i) => /\bpublic\b/.test(d.head) || (i > 0 && /interface/.test(types[i - 1].kind)));
        }
        return !hidden.test(t.header) && !types.some((d) => hidden.test(d.head));
      },
      errorsAreValues: false,
      rejections: ['java.lang.IllegalArgumentException', 'java.lang.IllegalStateException', 'java.lang.UnsupportedOperationException', 'java.lang.NumberFormatException', 'java.lang.IndexOutOfBoundsException', 'java.util.NoSuchElementException', 'java.lang.ArithmeticException', 'java.lang.NullPointerException', 'java.text.ParseException', 'java.io.IOException', 'java.io.UncheckedIOException', 'java.time.DateTimeException', 'java.time.format.DateTimeParseException', 'java.util.InputMismatchException', 'kotlin.NotImplementedError', 'scala.NotImplementedError'],
      environmental: (r) => /^java\.lang\.(NoClassDefFoundError|ClassNotFoundException|UnsatisfiedLinkError|NoSuchMethodError|NoSuchFieldError|IncompatibleClassChangeError|AbstractMethodError|LinkageError|ClassFormatError|UnsupportedClassVersionError)$|^java\.net\.|^java\.awt\.HeadlessException$|^SystemExit$/.test(r.type ?? ''),
      fuzz: jvmFuzz({ place, dir: b.dir, language, compile, runCp, classJars: own, index }),
    };
    return rt;
  },
};

/** A fuzz target's class and its source lines, for telling its own assertions from its mistakes. */
interface TargetClass { cls: string; lines: string[] }

/** Exceptions that state a broken property: assertion errors (Groovy's power assert and JUnit's among them) and Jazzer's findings. */
const ASSERTION = /(^|\.)(\w*AssertionError|AssertionFailedError|ComparisonFailure|FuzzerSecurityIssue\w+)$/;
/** Frames of the JDK and the languages' own runtimes: an exception raised in them on the target's behalf is the target's. */
const RUNTIME = /^(java|javax|jdk|sun|kotlin|scala|groovy|org\.codehaus\.groovy|org\.apache\.groovy|com\.code_intelligence\.jazzer)\./;

/**
 * A runner's error report as a Report. The stack is innermost first; the frames above the first harness frame are what the
 * call went through. Any of them in the project's sources makes it the project's failure; none makes it the harness's own,
 * except, for a fuzz target, an assertion: an assertion error, or an exception the target throws on a line of its own (a
 * `throw`, Kotlin's check or error), straight from its code or through its language's runtime.
 */
function fromError(raw: any, offset: number, index: Map<string, string>, dir: string, target?: TargetClass): Report {
  const stack: { cls: string; method: string; file: string | null; line: number; inlined?: string; inlinedLine?: number; callLine?: number }[] = raw.stack ?? [];
  // A harness frame running code Kotlin inlined from the project (a reified `inline fun`) counts as the project's.
  const projectInlined = (f: (typeof stack)[number]) => f.inlinedLine !== undefined && !!f.inlined && index.has(f.inlined);
  const harness = (f: (typeof stack)[number]) => (target ? f.cls === target.cls || f.cls.startsWith(`${target.cls}$`) : /^Refuzz_\d+(\$|$)/.test(f.cls));
  const harnessAt = stack.findIndex((f) => harness(f) && !projectInlined(f));
  const above = harnessAt >= 0 ? stack.slice(0, harnessAt) : stack;
  const lengths = LENGTHS;
  const frames: Frame[] = [];
  for (const f of above) {
    if (harness(f)) {
      frames.push({ path: index.get(f.inlined!)!, line: f.inlinedLine!, name: `${f.inlined!.split('/').pop()} (inlined)` });
      continue;
    }
    if (!f.file || f.line <= 0) continue;
    const pkg = f.cls.includes('.') ? f.cls.slice(0, f.cls.lastIndexOf('.')) : '';
    const path = index.get(pkg ? `${pkg.replace(/\./g, '/')}/${f.file}` : f.file);
    if (!path) continue;
    const name = `${f.cls.split('.').pop()}.${f.method}`;
    // Code Kotlin inlined has lines past the end of the file; the runner read the class's SMAP for where the code was written
    // (an inline function of the project, or one of the standard library's, like `require`) and the line that called it.
    if (f.inlinedLine !== undefined && f.inlined !== undefined && (f.inlinedLine !== f.line || index.get(f.inlined) !== path)) {
      const body = index.get(f.inlined);
      if (body) frames.push({ path: body, line: f.inlinedLine, name: `${name} (inlined)` });
      if (f.callLine !== undefined) frames.push({ path, line: f.callLine, name });
      continue;
    }
    const full = join(dir, path);
    if (!lengths.has(full)) lengths.set(full, readFileSync(full, 'utf8').split('\n').length);
    if (f.line > lengths.get(full)!) continue;
    frames.push({ path, line: f.line, name });
  }
  frames.reverse();
  // javac puts a multi-line `throw new E(\n a,\n b)` at the line of its last argument: the throw's own line is the one to read.
  const inner = frames.at(-1);
  if (inner) inner.line = throwLine(join(dir, inner.path), inner.line);
  const own = harnessAt >= 0 ? stack[harnessAt] : undefined;
  if (target && !frames.length && own) {
    const at = own.callLine ?? own.line;
    const raised = above.every((f) => RUNTIME.test(f.cls)) && (ASSERTION.test(raw.type ?? '') || (!above.length || above.every((f) => /^kotlin\./.test(f.cls))) && /\b(throw|check|checkNotNull|error|assert|fail)\b/.test(target.lines[at - 1] ?? ''));
    if (raised) return { status: 'error', origin: 'assertion', type: /FuzzerSecurityIssue/.test(raw.type ?? '') ? raw.type : 'assertion', message: raw.message ?? '', frames: [] };
  }
  const where = !frames.length && own && own.line > 0 ? ` (${target ? 'target' : 'harness'} line ${(own.callLine ?? own.line) - offset})` : '';
  return { status: 'error', origin: frames.length ? 'library' : 'setup', type: raw.type, message: `${raw.message ?? ''}${where}`, frames: frames.slice(-40) };
}

const THROW_LINES = new Map<string, number>();
const LENGTHS = new Map<string, number>();

/** The first line of the throw statement a line is inside, or the line itself. Cached: a fuzz session asks thousands of times. */
function throwLine(file: string, line: number): number {
  const key = `${file}:${line}`;
  if (!THROW_LINES.has(key)) THROW_LINES.set(key, findThrowLine(file, line));
  return THROW_LINES.get(key)!;
}

function findThrowLine(file: string, line: number): number {
  const source = readFileSync(file, 'utf8');
  const language = { java: 'java', kt: 'kotlin', scala: 'scala', groovy: 'groovy' }[file.split('.').pop()!] ?? 'java';
  const root = parse(source, language);
  if (!root) return line;
  for (const n of root.walk()) {
    if (n.startPosition.row > line - 1) break;
    if (n.endPosition.row >= line - 1 && /^(throw_statement|throw_expression|throw)$/.test(n.type)) return n.startPosition.row + 1;
  }
  return line;
}

const FUZZ_SHARED = [
  'Split the bytes with the FuzzedDataProvider (com.code_intelligence.jazzer.api.FuzzedDataProvider): data.consumeInt(0, 10), data.consumeBoolean(), data.consumeString(64), data.consumeBytes(16), data.pickValue(list), and data.consumeRemainingAsString() for the last argument; or take byte[] and slice it yourself.',
  'Build objects the way the project\'s own tests do, through its constructors and factories. Catch only the exceptions the called method documents for bad input (an IllegalArgumentException from a parser, its own checked exception) and return; let everything else out.',
  'Assert properties of each result in the target: a round trip (parse what it printed), a size or order, two methods that should agree. A failed property throws an AssertionError with what broke and the values, never on a documented rejection. Do not print.',
].join(' ');

const FUZZ_GUIDES: Record<string, string> = {
  java: `A Jazzer fuzz target as OSS-Fuzz builds it: one complete Java file, its imports (the project's classes by their packages, \`import com.code_intelligence.jazzer.api.FuzzedDataProvider;\`), then one public class with \`public static void fuzzerTestOneInput(FuzzedDataProvider data)\` (or \`(byte[] data)\`), and optionally \`public static void fuzzerInitialize()\` for setup done once. No package clause needed. ${FUZZ_SHARED} Throw it with \`throw new AssertionError("toString() = " + s + " for " + input);\`; Java's assert statement is off under Jazzer.`,
  kotlin: `A Jazzer fuzz target as OSS-Fuzz builds it: one complete Kotlin file, its imports (the project's classes and functions by their packages, \`import com.code_intelligence.jazzer.api.FuzzedDataProvider\`), then \`object ParseFuzzer { @JvmStatic fun fuzzerTestOneInput(data: FuzzedDataProvider) { … } }\` (or \`data: ByteArray\`), optionally with a @JvmStatic fuzzerInitialize(). ${FUZZ_SHARED} Throw it with \`throw AssertionError("…")\` or check(cond) { "…" }; Kotlin's assert() is off under Jazzer.`,
  scala: `A Jazzer fuzz target as OSS-Fuzz builds it: one complete Scala file, its imports (the project's members by their packages, \`import com.code_intelligence.jazzer.api.FuzzedDataProvider\`), then \`object ParseFuzzer { def fuzzerTestOneInput(data: FuzzedDataProvider): Unit = { … } }\` (or \`data: Array[Byte]\`); an object's methods are static to Jazzer. Supply implicit arguments explicitly or import them. ${FUZZ_SHARED} assert(cond, "…") throws an AssertionError in Scala.`,
  groovy: `A Jazzer fuzz target as OSS-Fuzz builds it: one complete Groovy file, its imports (the project's classes by their packages, \`import com.code_intelligence.jazzer.api.FuzzedDataProvider\`), then \`class ParseFuzzer { static void fuzzerTestOneInput(FuzzedDataProvider data) { … } }\` (or \`byte[] data\`). A method not declared static is called on an instance. ${FUZZ_SHARED} Groovy's assert is always on and throws an AssertionError.`,
};

/** The class a target declares fuzzerTestOneInput in: the last top-level class or object before the method, with its package. */
function targetClass(source: string): { name: string; fqn: string } | string {
  const at = source.search(/\bfuzzerTestOneInput\b/);
  if (at < 0) return 'no fuzzerTestOneInput: the target is a class with a static fuzzerTestOneInput(FuzzedDataProvider data) or fuzzerTestOneInput(byte[] data)';
  const decls = [...source.slice(0, at).matchAll(/^([ \t]*)(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|final|abstract|open|internal|data|sealed|static)\s+)*(?:class|object)\s+(\w+)/gm)];
  const top = decls.filter((d) => !d[1]).at(-1) ?? decls.at(-1);
  if (!top) return 'no class around fuzzerTestOneInput: declare it in a top-level class (an object in Kotlin and Scala)';
  const pkg = packageOf(source);
  return { name: top[2], fqn: pkg ? `${pkg}.${top[2]}` : top[2] };
}

interface JvmContext {
  place: Place;
  /** The checkout on this machine, which sources and stack frames are read from. */
  dir: string;
  language: string;
  /** The command compiling one target file, reading $CP and $DEST. */
  compile: string;
  /** $OUT's jars, the project's own first. */
  runCp: string[];
  /** The jars with the project's classes, which coverage reads class files from. */
  classJars: string[];
  index: Map<string, string>;
}

/**
 * Jazzer fuzz targets: each target file compiled on its own (two may declare the same class) against $OUT's jars and Jazzer's
 * API, run in its own JVM by RefuzzDriver under the JaCoCo agent, and by Jazzer itself for native().
 */
function jvmFuzz(c: JvmContext): FuzzRuntime {
  const { place, language } = c;
  const ext = EXT[language];
  /** A target's compiler messages, its file named by its own name. */
  const messages = (output: string, folder: string) => output.split(`${folder}/`).join('').split('\n').filter((l) => l.trim() && !/^\s*(warning|Note):|: warning:|^warning:/.test(l)).slice(0, 30).join('\n').slice(0, 1500) || 'the target did not compile';
  return {
    guide: FUZZ_GUIDES[language],
    async session(targets, project) {
      const dir = await place.folder('jvm');
      const errors: Record<string, string> = {};
      const compiled = new Map<string, { i: number; fqn: string; file: string; lines: string[] }>();
      const files: Record<string, string> = { 'cp.txt': c.runCp.join(':') };
      Object.keys(targets).forEach((n, i) => {
        const t = targetClass(targets[n]);
        if (typeof t === 'string') { errors[n] = t; return; }
        const file = `t${i}/${t.name}.${ext}`;
        files[file] = targets[n];
        compiled.set(n, { i, fqn: t.fqn, file, lines: targets[n].split('\n') });
      });
      await place.put(dir, files);
      await pool([...compiled], Math.min(PARALLEL, 6), async ([n, t]) => {
        const r = await place.run(['sh', '-c', `export PATH=${JDK}:$PATH CP=${API}:$(cat ${dir}/cp.txt) DEST=${dir}/t${t.i}/classes; mkdir -p $DEST && ${c.compile} ${dir}/${t.file}`], { timeoutMs: 900_000 });
        if (r.code !== 0) { errors[n] = messages(r.stdout + r.stderr, `${dir}/t${t.i}`); compiled.delete(n); }
      });

      // One JVM per target under the JaCoCo agent, instrumenting the project's packages; RefuzzLines reads lines from them.
      const sources = project.length ? project.map((t) => t.path) : [...c.index.values()].filter((p) => !/(^|\/)(test|tests|it)\//.test(p));
      const pkgs = [...new Set(sources.map((p) => packageOf(readFileSync(join(c.dir, p), 'utf8'))))];
      const includes = pkgs.some((p) => !p) ? '*' : pkgs.map((p) => `${p}.*`).join(':');
      const classpath = (i: number) => `${dir}/t${i}/classes:${PROBE}:${c.runCp.join(':')}:${JAZZER}/*:${BOOT}`;
      const make = (i: number, fqn: string, timeoutMs: number) => place.driver([`${JDK}/java`, '-Djava.security.manager=allow', '-XX:+UseSerialGC', '-Xmx1g', '-Xss4m',
        `-javaagent:${AGENT}=output=none,includes=${includes},inclbootstrapclasses=false,jmx=false`, '-cp', classpath(i), 'RefuzzDriver', fqn, String(timeoutMs),
        LINES, JACOCO, c.classJars.join(':'), pkgs.map((p) => p.replace(/\./g, '/')).join(':')], { cwd: '/tmp' });
      const drivers = new Map<string, { i: number; fqn: string; lines: string[]; d: ReturnType<typeof make>; timeout: number }>();
      await pool([...compiled], Math.min(PARALLEL, 8), async ([n, t]) => {
        const d = make(t.i, t.fqn, 5_000);
        if (await d.start()) drivers.set(n, { ...t, d, timeout: 5_000 });
        else errors[n] = (d.fatal ?? 'did not load').slice(0, 1500);
      });
      const convert = (h: { fqn: string; lines: string[] }, r: any): InputReport => {
        const lines = (r.lines ?? []).map(([k, l]: [string, number]) => [c.index.get(k), l]).filter((x: any) => x[0]) as [string, number][];
        if (r.status === 'error' && r.stack) return { ...fromError(r, 0, c.index, c.dir, { cls: h.fqn, lines: h.lines }), features: r.features, lines };
        return { status: r.status, origin: r.status === 'ok' ? undefined : r.origin ?? 'library', type: r.type, message: r.message, native: r.native, features: r.features, lines };
      };
      const runOn = async (name: string, inputs: Buffer[], timeoutMs: number, deadline?: number): Promise<InputReport[]> => {
        let h = drivers.get(name);
        if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'HarnessLoad', message: errors[name] ?? 'no such target' }));
        // The driver's timer is set when it starts; a different allowance needs a new process.
        if (h.timeout !== timeoutMs) { h.d.stop(); h = { ...h, d: make(h.i, h.fqn, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
        const at = h;
        return (await at.d.run(inputs, timeoutMs, deadline)).map((r) => convert(at, r));
      };
      const session: FuzzSession = {
        run: runOn,
        release(name) {
          drivers.get(name)?.d.stop();
          drivers.delete(name);
        },
        async close() {
          for (const h of drivers.values()) h.d.stop();
          // Killing `docker exec` leaves its process running in the container: the JVMs go by their folder.
          await place.run(['sh', '-c', `pkill -9 -f ${shq(dir)} || true`], { timeoutMs: 30_000 });
          await place.remove(dir);
        },
      };
      session.native = async (name, corpus, dict, seconds) => {
        const h = drivers.get(name);
        if (!h) return { crashes: [], corpus, execs: 0 };
        const base = `${dir}/jazzer-${h.i}-${Date.now().toString(36)}`;
        await place.put(base, { ...Object.fromEntries((corpus.length ? corpus : [Buffer.from([0])]).map((b, k) => [`corpus/seed-${k}`, b])), dict: dictionary(dict) });
        // keep_going: a rejection the oracle will discard must not end the run; Jazzer reports each stack once.
        const r = await place.run(['sh', '-c', `cd ${base} && ${JDK}/java -Xmx2g -cp "${JAZZER}/*:${dir}/t${h.i}/classes:$(cat ${dir}/cp.txt)" com.code_intelligence.jazzer.Jazzer --target_class=${h.fqn} --instrumentation_includes=${pkgs.map((p) => (p ? `${p}.**` : '**')).join(':')} --keep_going=500 -max_total_time=${seconds} -timeout=${Math.max(1, Math.ceil(h.timeout / 1000))} -rss_limit_mb=4096 -print_final_stats=1 -artifact_prefix=${base}/ -dict=${base}/dict ${base}/corpus`], { timeoutMs: (seconds + 180) * 1000 });
        const said = r.stdout + r.stderr;
        if (process.env.REFUZZ_DEBUG) { mkdirSync(resolve('.fuzz', 'debug'), { recursive: true }); writeFileSync(resolve('.fuzz', 'debug', `jazzer-${h.i}.log`), said); }
        // With keep_going, stats are printed at every finding as well as at the end: the last count is the run's.
        const execs = Number([...said.matchAll(/stat::number_of_executed_units:\s*(\d+)/g)].at(-1)?.[1] ?? [...said.matchAll(/^#(\d+)\s/gm)].at(-1)?.[1] ?? 0);
        const got = await place.get(base);
        await place.remove(base);
        const crashes: { input: Buffer; report: Report }[] = [];
        for (const [f, input] of Object.entries(got).filter(([f]) => /^(crash|timeout|oom|leak)-/.test(f)).slice(0, 50)) {
          if (f.startsWith('timeout-')) { crashes.push({ input, report: { status: 'timeout', origin: 'library', type: 'Timeout' } }); continue; }
          // Each crash input run again in-process, for the report every other input gets. A finding only Jazzer's hooks make
          // (a sanitizer's) does not fail there: Jazzer's own exception names it.
          const [again] = await runOn(name, [input], h.timeout);
          crashes.push({ input, report: again && again.status !== 'ok' ? again : { status: 'error', origin: 'library', type: /== Java Exception: ([\w.$]+)/.exec(said)?.[1] ?? (f.startsWith('oom') ? 'OutOfMemory' : 'JazzerCrash'), message: said.slice(-600) } });
        }
        const grown = Object.entries(got).filter(([f]) => f.startsWith('corpus/')).map(([, b]) => b);
        return { crashes, corpus: grown, execs };
      };
      return { session, errors };
    },
    /**
     * The target file, and build.sh lines that compile it against $OUT's jars and Jazzer's API into $OUT/<name>.classes and
     * write $OUT/<name>, the wrapper OSS-Fuzz's JVM projects write, running jazzer_driver on its class. OSS-Fuzz has no helper
     * command for this; the target is copied to its class's name first, which javac requires.
     */
    oss(name, source) {
      const t = targetClass(source);
      if (typeof t === 'string') throw new Error(`${name}: ${t}`);
      const file = `${name}.${ext}`;
      const named = `$WORK/${name}/${t.name}.${ext}`;
      const jars = (at: string) => `$(find ${at} -maxdepth 1 -name '*.jar' ! -name 'jazzer*' | sort | tr '\\n' :)`;
      return {
        file,
        source,
        compile: [
          `mkdir -p $WORK/${name} $OUT/${name}.classes && cp $SRC/refuzz/${file} ${named}`,
          `CP=${jars('$OUT')}$JAZZER_API_PATH DEST=$OUT/${name}.classes; ${c.compile} ${named}`,
          `cat > $OUT/${name} << EOF`,
          '#!/bin/bash',
          'this_dir=\\$(dirname "\\$0")',
          `cp=${jars('"\\$this_dir"').replace(/\$\(/, '\\$(')}\\$this_dir/${name}.classes`,
          `LD_LIBRARY_PATH="$JVM_LD_LIBRARY_PATH":\\$this_dir \\$this_dir/jazzer_driver --agent_path=\\$this_dir/jazzer_agent_deploy.jar --cp="\\$cp" --target_class=${t.fqn} --jvm_args="-Xmx2048m:-Xss1024k" "\\$@"`,
          'EOF',
          `chmod +x $OUT/${name}`,
        ],
      };
    },
  };
}
