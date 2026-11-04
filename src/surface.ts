/**
 * Attack surfaces, found from the code alone. A surface is one way data gets into the project and everything that data can
 * reach: the unit OSS-Fuzz and cargo-fuzz targets are written for, not a single function. Nothing here asks a model, reads
 * documentation or ranks by trust: a function the project calls internal still has a surface when data reaches it.
 *   sources    calls to the APIs data enters a program through (reads of files, sockets, stdin, requests, the environment,
 *              guest memory, deserializers), matched in every method's lines
 *   data flow  from each source, the variables it fills followed through assignments to the first project function they are
 *              handed to; returned data is followed up into the callers. That function is the surface's entry point.
 *   API        every public function that takes an argument is an entry point too, and so is every function that takes one
 *              and that nothing in the project calls (a handler, a trait implementation, a callback reached by dispatch)
 *   grouping   entry points whose reachable code is mostly the same code are one surface, its harness one way in to each
 * Whether a surface's input really gets in is confirmed by running it: the grammar engine measures which entry points and
 * which of the surface's lines its inputs ran.
 */
import { createHash } from 'node:crypto';
import type { FuzzOptions } from './engine.ts';
import { plainName, sourceOf, type Project } from './syntax.ts';
import type { Runtime, Target } from './types.ts';

/** Where outside data enters: the API, the method and line it is called at. */
export interface Source {
  kind: SourceKind;
  /** The call as written, trimmed: `read_exact(&mut buf)`, `request.get_json()`. */
  api: string;
  path: string;
  line: number;
  /** The method the call is in. */
  in: string;
}

export interface Surface {
  /** Stable across runs while its first entry point keeps its name and file: the folder it persists in. */
  id: string;
  language: string;
  /** The ways in: the first is the one with the most code behind it, or the one a source feeds. */
  entries: Target[];
  /** The source calls whose data reaches the entry points; empty for a surface that is public API only. */
  sources: Source[];
  /** Every project function reachable from an entry point, the entry points first. */
  reach: Target[];
  /**
   * The nearest public functions that hand data to the entry points. For an entry point a caller outside its module cannot
   * name (not exported, not public) they are the way a harness gets in; for a public one they are the wrapper a real caller
   * goes through, whose answer on the same input shows whether a failure inside is the program's failure (a truncated
   * packet the wrapper accepts) or a call no caller makes.
   */
  via: Target[];
}

export type SourceKind = 'stdin' | 'file' | 'network' | 'request' | 'environment' | 'memory' | 'deserialize';

/**
 * The source catalog, across languages. `fills`: the call writes the data into an argument (`read(fd, buf, n)`,
 * `read_exact(&mut buf)`), so the arguments carry it; otherwise its value does. Matched on a line with strings and comments
 * removed.
 */
const SOURCES: { kind: SourceKind; pattern: RegExp; fills?: boolean; languages?: string[] }[] = [
  { kind: 'stdin', pattern: /\b(?:sys\.stdin|process\.stdin|io::stdin|os\.Stdin|System\.in|STDIN|\$stdin|Console\.In|readLine)\b/ },
  { kind: 'file', pattern: /\b(?:read_to_string|read_to_end|readFileSync|readFile|readAllBytes|readAllLines|ReadFile|ReadAll|file_get_contents|IO\.read|File\.read|fs::read|mmap|read_lines|readlines?)\s*\(/ },
  { kind: 'file', pattern: /\b(?:fread|fgets|getline|getdelim|fscanf|readinto|read_exact|read_exact_at|read_at|ReadAt|ReadFull|pread|preadv|readv)\s*\(/, fills: true },
  // A stream's `read()` with no arguments returns its data in these languages; in the others it is a lock's or a counter's.
  { kind: 'file', pattern: /\.(?:read|readAll|read_nonblock)\s*\(\s*\)/, languages: ['python', 'ruby', 'javascript', 'typescript', 'tsx', 'lua', 'php'] },
  { kind: 'file', pattern: /(?<![\w$])(?:read|Read)\s*\(\s*(?!(?:true|false)\s*\))[^)\s]/, fills: true },
  { kind: 'network', pattern: /\b(?:recv|recvfrom|recvmsg|recv_from|recv_vectored|peek_from|ReadFrom|ReadFromUDP|ReadMsgUDP)\s*\(/, fills: true },
  { kind: 'network', pattern: /\.on\(\s*(?:data|message|request|connection)\b|\b(?:accept|ReadMessage|NextReader)\s*\(/ },
  { kind: 'request', pattern: /\bevent\.body\b|\b(?:req|request|ctx|context|r)\.(?:body|json|form|args|query|params|files|get_json|get_data|data|values|cookies|headers|text|FormValue|PostFormValue|PostForm|Form|Body|URL\.Query|getParameter|getInputStream|getReader|getHeader|payload)\b/ },
  { kind: 'request', pattern: /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b/ },
  { kind: 'request', pattern: /\bparams\[/, languages: ['ruby'] },
  { kind: 'environment', pattern: /\b(?:getenv|env::var|env::var_os|env::args|env::args_os|os\.environ|process\.env|os\.Getenv|os\.LookupEnv|os\.Args|process\.argv|sys\.argv|ARGV|ENV\[|getopt|getopt_long)\b/ },
  { kind: 'memory', pattern: /\b(?:read_obj|read_slice|read_volatile|read_exact_volatile|read_from|read_obj_from_addr|get_slice|pop_descriptor_chain|ioctl|copy_from_user|get_user)\s*\(/, fills: true },
  { kind: 'deserialize', pattern: /\b(?:from_slice|from_str|from_reader|from_bytes|deserialize|deserialize_from|JSON\.parse|json\.loads?|yaml\.(?:safe_)?load|pickle\.loads?|marshal\.loads|Unmarshal|NewDecoder|ParseFromString|parseFrom|readValue|decode|loads|parse_from_bytes)\s*\(/ },
];

/** Paths that are not the project's own shipped code: tests, examples, vendored copies, build output, tooling. */
const NOT_SHIPPED = /(^|\/)(tests?|testing|testsuite|test_?suites?|testutils?|testdata|testhelpers?|spec|specs|__tests__|test_utils|examples?|conformance|docs?|benches|benchmarks?|_?vendor(ed|s)?|third_?party|3rd_?party|external|extern|node_modules|fuzz|fuzzing|fuzzers?|scripts?|tools|bin|perf|bench|build|dist|target|\.[^/]+)\//i;
const TEST_PATH = /(^|\/)[\w.-]*[.-](tests?|specs?|benchmarks?|samples?|examples?)\/|(^|\/)(test_[^/]*|[^/]*_test\.\w+|[^/]*\.(test|spec)\.\w+)$/i;
/** Whether a file is shipped code by its path alone: not a test, example, doc, script, vendored or build file. */
export const shippedPath = (path: string) => !NOT_SHIPPED.test(path) && !TEST_PATH.test(path) && !BUILD_FILE.test(path);
/** Build and configuration scripts: code a project runs to build itself, not code its users call. */
const BUILD_FILE = /(^|\/)([^/]+\.gradle(\.kts)?|setup\.py|conftest\.py|noxfile\.py|Rakefile|[^/]+\.gemspec|Gemfile|[^/]+\.config\.[cm]?[jt]s|Gruntfile\.js|Gulpfile\.js|build\.zig|Package\.swift|build\.rs|Makefile|CMakeLists\.txt|Dockerfile)$/i;

/** Words in an assignment's left side that are syntax or a type, not the name being bound. */
const NOT_NAMES = new Set('let mut const var auto my local val ref static final int char long short unsigned signed float double bool void size_t ssize_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t usize isize u8 u16 u32 u64 i8 i16 i32 i64 str String string byte bytes self this struct enum new await yield return if else for while in of range'.split(' '));

/** Entry points whose distinctive reachable code overlaps at least this much (Jaccard) are one surface. */
const SAME_SURFACE = 0.6;

const sha = (s: string) => createHash('sha1').update(s).digest('hex');

/** A line of code with string contents and comments taken out, so a word inside them is not read as a name or a call. */
function codeOf(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\\n]|\\.){2,}'|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\/.*$|(?<![$\w])#(?![[!{]|include|define|if|endif).*$|\/\*.*?\*\/|--\s.*$/g, '');
}

const names = (text: string) => (text.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((w) => !NOT_NAMES.has(w));

/** The first `=` that assigns: not part of `==`, `!=`, `<=`, `>=`, `=>`, `===`. */
function assignAt(code: string): number {
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '=') continue;
    const before = code[i - 1] ?? '', after = code[i + 1] ?? '';
    if (after === '=' || after === '>' || '=!<>'.includes(before)) { if (after === '=') i++; continue; }
    return before === ':' || '+-*/%|&^'.includes(before) ? i - (before === ':' ? 1 : 0) : i;
  }
  return -1;
}

/** The call a source match is: the one whose name the match starts in. */
const isAt = (c: { name: string; receiver: string; start: number }, hit: RegExpExecArray) => c.start <= hit.index && hit.index <= c.start + c.receiver.length + c.name.length + 1;

/** Each call on a line: the name called, the receiver before it, and its argument text (balanced to the closing paren). */
function callsOn(code: string): { name: string; receiver: string; args: string; start: number }[] {
  const out: { name: string; receiver: string; args: string; start: number }[] = [];
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*(?:(?:\.|->|::)[A-Za-z_$][\w$]*)*)\s*(?:::<[^>]*>)?\s*!?\(/g)) {
    const parts = m[1].split(/\.|->|::/);
    const name = parts.at(-1)!;
    if (/^(if|for|while|switch|return|match|catch|sizeof|typeof|function|fn|def|func)$/.test(name)) continue;
    let depth = 0, end = code.length;
    const open = m.index! + m[0].length - 1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) { end = i; break; }
    }
    out.push({ name, receiver: parts.slice(0, -1).join('.'), args: code.slice(open + 1, end), start: m.index! });
  }
  return out;
}

interface Flow {
  /** Project functions the data was handed to first. */
  handed: Target[];
  /** The method returns the data to its callers. */
  returned: boolean;
}

/**
 * Follows data from `start` (a line matching `at`) to the end of method `m`: what the matching call fills or returns is
 * tainted, an assignment from a tainted value taints what it binds, and a call that is given a tainted value, or is called on
 * one, hands the data to the project function it resolves to.
 */
function follow(p: Project, m: Target, at: RegExp, fills: boolean, resolve: (m: Target, name: string) => Target[]): Flow {
  const lines = p.read(m.path).split('\n');
  const tainted = new Set<string>();
  const handed = new Map<string, Target>();
  let returned = false, started = false;
  const mentions = (text: string) => names(text).some((w) => tainted.has(w));
  const last = lines.slice(m.bodyStart - 1, m.endLine).map((l) => codeOf(l).trim()).filter((l) => l && !/^[})\]]+;?$/.test(l)).at(-1);
  for (let n = Math.max(m.line, m.bodyStart - 1); n <= m.endLine; n++) {
    const code = codeOf(lines[n - 1] ?? '');
    const hit = at.exec(code);
    if (!started && !hit) continue;
    started = true;
    const eq = assignAt(code);
    const lhs = eq >= 0 ? code.slice(0, eq) : '';
    const rhs = eq >= 0 ? code.slice(eq + 1).replace(/^=/, '') : code;
    if (hit) {
      // The source's value goes to what the line binds; a filling read's data goes to its arguments too.
      if (eq >= 0 && eq < hit.index) for (const w of names(lhs)) tainted.add(w);
      const call = callsOn(code).find((c) => isAt(c, hit));
      if (fills && call) for (const w of names(call.args)) tainted.add(w);
    }
    // `for x in data`, `for (const x of data)`, `for _, x := range data`.
    const loop = /\bfor\b\s*\(?\s*(.+?)\s+(?:in|of)\s+(.+)/.exec(code);
    if (loop && mentions(loop[2])) for (const w of names(loop[1])) tainted.add(w);
    if (eq >= 0 && (mentions(rhs) || (hit && hit.index > eq))) for (const w of names(lhs)) tainted.add(w);
    for (const c of callsOn(code)) {
      if (hit && isAt(c, hit)) continue;
      if (!mentions(c.args) && !mentions(c.receiver)) continue;
      for (const t of resolve(m, c.name)) if (t.id !== m.id) handed.set(t.id, t);
    }
    if (/\breturn\b/.test(code) && mentions(code.slice(code.search(/\breturn\b/)))) returned = true;
    // A Rust or Ruby body's last expression is its value.
    if (code.trim() === last && !/;\s*$/.test(code) && mentions(code)) returned = true;
  }
  return { handed: [...handed.values()], returned };
}

/**
 * Files that are copies of another file of the project with the names changed: one template instantiated per type (gVisor's
 * segment sets, `addrSet` and `FileRangeSet` and forty more, written out by go_generics with no "generated" header). Each
 * function body is compared with its names renamed in order of first use, so two instantiations of the same template match
 * and two files that merely look alike do not; a file is a copy when most of its bodies are already in a file kept before it.
 * Only the first of each kind is fuzzed: a bug in the template is in every copy, and it is one bug.
 */
const copiedFiles = new WeakMap<Project, Map<string, Set<string>>>();
export function copies(p: Project, language: string): Set<string> {
  let byLanguage = copiedFiles.get(p);
  if (!byLanguage) copiedFiles.set(p, (byLanguage = new Map()));
  const have = byLanguage.get(language);
  if (have) return have;
  const shapes = new Map<string, string[]>();
  for (const t of p.targets) {
    if (t.test || t.language !== language || t.endLine - t.line < 3) continue;
    const body = p.read(t.path).split('\n').slice(t.line, t.endLine).join('\n');
    const names = new Map<string, number>();
    const renamed = (body.match(/[A-Za-z_]\w*|\S/g) ?? []).map((x) => (/^[A-Za-z_]/.test(x) ? `#${names.get(x) ?? names.set(x, names.size).get(x)}` : x)).join(' ');
    shapes.set(t.path, [...(shapes.get(t.path) ?? []), createHash('sha1').update(renamed).digest('hex')]);
  }
  const kept = new Set<string>(), out = new Set<string>();
  for (const [path, hashes] of [...shapes].sort(([a], [b]) => a.localeCompare(b))) {
    if (hashes.length >= 8 && hashes.filter((h) => kept.has(h)).length >= 0.8 * hashes.length) out.add(path);
    else for (const h of hashes) kept.add(h);
  }
  byLanguage.set(language, out);
  return out;
}

/** The project's shipped, non-test code of the runtime's language: what a surface can be made of. */
export function shipped(p: Project, rt: Runtime): (t: Target) => boolean {
  const made = new Map<string, boolean>();
  // Code a generator wrote (OpenAPI clients, protobuf, parser tables) says so at its top: its bugs belong to the generator.
  const generated = (path: string) => {
    if (!made.has(path)) made.set(path, /\b(auto-?generated|generated by|do not edit|@generated)\b/i.test(p.read(path).slice(0, 1500)));
    return made.get(path)!;
  };
  // Rust's unit tests live beside the code, in a `#[cfg(test)]` module whose helpers carry no #[test] of their own.
  const testBlocks = new Map<string, [number, number][]>();
  const inTestModule = (t: Target) => {
    if (!testBlocks.has(t.path)) {
      const lines = p.read(t.path).split('\n');
      const blocks: [number, number][] = [];
      lines.forEach((l, i) => {
        if (!/^\s*#\[cfg\((?:[^\]]*\b)?test\b/.test(l)) return;
        const open = lines.slice(i + 1, i + 4).findIndex((x) => /^\s*(pub(\([^)]*\))?\s+)?mod\s+\w+\s*\{/.test(x));
        if (open < 0) return;
        let depth = 0;
        for (let j = i + 1 + open; j < lines.length; j++) {
          depth += (codeOf(lines[j]).match(/\{/g)?.length ?? 0) - (codeOf(lines[j]).match(/\}/g)?.length ?? 0);
          if (depth <= 0) { blocks.push([i + 1, j + 1]); break; }
        }
      });
      testBlocks.set(t.path, blocks);
    }
    return testBlocks.get(t.path)!.some(([a, b]) => t.line >= a && t.line <= b);
  };
  return (t) => !t.test && t.language === rt.language && !inTestModule(t) && !NOT_SHIPPED.test(t.path) && !TEST_PATH.test(t.path) && !BUILD_FILE.test(t.path) && !/^test/i.test(t.name) && !generated(t.path) && !copies(p, rt.language).has(t.path);
}

/** Every shipped project function reachable from `roots` through perch's call graph, the roots first. */
export function reachFrom(p: Project, roots: Target[], ok: (t: Target) => boolean): Target[] {
  const seen = new Set(roots.map((r) => r.id));
  const out = [...roots];
  for (let i = 0; i < out.length; i++) for (const c of p.callees(out[i].id)) {
    const t = p.byId.get(c);
    if (!t || seen.has(c) || !ok(t)) continue;
    seen.add(c);
    out.push(t);
  }
  return out;
}

/**
 * The functions below a surface's entry points that have a branch, in depth-first order from them through refuzz's call
 * graph: each caller before the functions it calls, and each call followed all the way down before the next.
 */
export function crawlOrder(p: Project, s: Surface): Target[] {
  const inReach = new Set(s.reach.map((t) => t.id));
  const entries = new Set(s.entries.map((e) => e.id));
  const seen = new Set<string>();
  const out: Target[] = [];
  const stack = [...s.entries].reverse().map((e) => e.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = p.byId.get(id);
    if (!t) continue;
    if (!entries.has(id) && t.complexity > 1) out.push(t);
    stack.push(...p.callees(id).filter((c) => inReach.has(c) && !seen.has(c)).reverse());
  }
  return out;
}

/** A target picked by name, as `--only` names it: `Name`, `Type.method`, `Type` for all its methods, or `path#qualified`. */
export function named(t: Target, only: string[]): boolean {
  const q = plainName(t.qualifiedName);
  return only.some((n) => n === `${t.path}#${t.qualifiedName}` || (!n.includes('#') && (q === n || t.name === n || q.endsWith(`.${n}`) || q.startsWith(`${n}.`))));
}

/**
 * Every surface of the project in the runtime's language, in the order they are worth fuzzing: surfaces outside data
 * reaches through a source first, then by how much code they reach. `o.only` makes the named functions the entry points;
 * `o.changed` keeps the surfaces whose code a change touched; `o.skip` drops the ones whose first entry an earlier run fuzzed;
 * `o.surfaces` (`--surfaces`) keeps the first few.
 */
export function discoverSurfaces(p: Project, rt: Runtime, o: Pick<FuzzOptions, 'only' | 'changed' | 'skip' | 'surfaces'>): Surface[] {
  const ok = shipped(p, rt);
  const code = p.targets.filter(ok);
  const byName = new Map<string, Target[]>();
  for (const t of code) (byName.get(t.name) ?? byName.set(t.name, []).get(t.name)!).push(t);
  // A call's name, resolved: the callee refuzz's graph shows from this method, or, for a call the graph could not resolve,
  // the project's functions of that name nearest the caller: in its file, else in its folder, else anywhere.
  const resolve = (m: Target, name: string) => {
    const graph = p.callees(m.id).map((id) => p.byId.get(id)).filter((t): t is Target => !!t && t.name === name && ok(t));
    if (graph.length) return graph;
    const all = byName.get(name) ?? [];
    const folder = m.path.slice(0, m.path.lastIndexOf('/') + 1);
    const file = all.filter((t) => t.path === m.path);
    const near = all.filter((t) => t.path.startsWith(folder) && !t.path.slice(folder.length).includes('/'));
    return file.length ? file : near.length ? near : all;
  };
  const fedBy = new Map<string, Source[]>();
  const entries = new Map<string, Target>();
  const feed = (t: Target, s: Source) => { entries.set(t.id, t); const list = fedBy.get(t.id) ?? fedBy.set(t.id, []).get(t.id)!; if (!list.some((x) => x.path === s.path && x.line === s.line)) list.push(s); };

  for (const m of code) {
    const lines = p.read(m.path).split('\n');
    for (let n = m.bodyStart; n <= m.endLine; n++) {
      const text = codeOf(lines[n - 1] ?? '');
      for (const s of SOURCES) {
        if (s.languages && !s.languages.includes(m.language)) continue;
        const hit = s.pattern.exec(text);
        if (!hit) continue;
        // A call refuzz's graph resolves to the project's own method (its `read`, its `decode`) is project code, not a way in.
        const called = callsOn(text).find((c) => isAt(c, hit));
        if (called && p.callees(m.id).some((id) => p.byId.get(id)?.name === called.name)) continue;
        const source: Source = { kind: s.kind, api: text.slice(hit.index).trim().slice(0, 80), path: m.path, line: n, in: m.qualifiedName };
        const at = new RegExp(hit[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        // Data the method hands on enters the project at the function it is handed to; data it returns, wherever its callers
        // hand it; data it uses itself, at the method.
        let flow = follow(p, m, at, !!s.fills, resolve);
        let from = m;
        const climbed = new Set([m.id]);
        while (!flow.handed.length && flow.returned) {
          const callers = p.callers(from.id).map((id) => p.byId.get(id)).filter((t): t is Target => !!t && ok(t) && !climbed.has(t.id));
          if (!callers.length) break;
          const name = new RegExp(`(?<![\\w$])${from.name.replace(/[$]/g, '\\$')}\\s*\\(`);
          const next = callers.map((c) => ({ c, f: follow(p, c, name, false, resolve) }));
          for (const x of next) climbed.add(x.c.id);
          const handing = next.filter((x) => x.f.handed.length);
          if (handing.length) { for (const x of handing) for (const t of x.f.handed) feed(t, source); flow = { handed: handing.flatMap((x) => x.f.handed), returned: false }; break; }
          const returning = next.find((x) => x.f.returned);
          if (!returning) { for (const x of next) feed(x.c, source); flow = { handed: next.map((x) => x.c), returned: false }; break; }
          from = returning.c;
          flow = returning.f;
        }
        if (flow.handed.length) for (const t of flow.handed) feed(t, source);
        else feed(from, source);
        break;
      }
    }
  }

  const callersOf = (t: Target) => p.callers(t.id).filter((id) => { const c = p.byId.get(id); return !!c && ok(c); });
  if (o.only) {
    entries.clear();
    // A function named by `path#name` is the caller's pick whatever it is; one named by name alone is the project's shipped,
    // public function of that name, not a test's or a header's declaration of it.
    // A static or private function named is a surface too: a target reaches it the way the language lets a test in (C: the
    // target #includes its source file). Where a public function has the name, that one is meant.
    const picked = p.targets.filter((t) => !t.test && t.language === rt.language && named(t, o.only!) && (o.only!.includes(`${t.path}#${t.qualifiedName}`) || ok(t)));
    const publicNames = new Set(picked.filter((t) => rt.isPublic(t, p.read(t.path))).map((t) => t.name));
    for (const t of picked) if (o.only.includes(`${t.path}#${t.qualifiedName}`) || !publicNames.has(t.name) || rt.isPublic(t, p.read(t.path))) entries.set(t.id, t);
  } else {
    for (const t of code) {
      if (!t.params.length || entries.has(t.id)) continue;
      if (rt.isPublic(t, p.read(t.path)) || !callersOf(t).length) entries.set(t.id, t);
    }
  }

  // Reachable code per entry; an entry with nothing to explore (no branch, no call) is no surface.
  const reachOf = new Map<string, Target[]>();
  for (const e of entries.values()) reachOf.set(e.id, reachFrom(p, [e], ok));
  const weight = (id: string) => reachOf.get(id)!.reduce((n, t) => n + t.complexity, 0);
  const list = [...entries.values()].filter((e) => o.only || fedBy.has(e.id) || weight(e.id) > 1 || reachOf.get(e.id)!.length > 1);
  list.sort((a, b) => Number(fedBy.has(b.id)) - Number(fedBy.has(a.id)) || weight(b.id) - weight(a.id) || a.id.localeCompare(b.id));

  // Helpers nearly everything reaches (logging, allocation, error wrapping) say nothing about which entries belong together.
  const freq = new Map<string, number>();
  for (const e of list) for (const t of reachOf.get(e.id)!) freq.set(t.id, (freq.get(t.id) ?? 0) + 1);
  const common = Math.max(5, Math.ceil(list.length * 0.05));
  const distinct = (id: string) => new Set(reachOf.get(id)!.filter((t) => t.id === id || freq.get(t.id)! <= common).map((t) => t.id));
  const groups: { entries: Target[]; key: Set<string> }[] = [];
  const holding = new Map<string, number[]>();
  for (const e of list) {
    const mine = distinct(e.id);
    const shared = new Map<number, number>();
    for (const id of mine) for (const g of holding.get(id) ?? []) shared.set(g, (shared.get(g) ?? 0) + 1);
    let best = -1, bestScore = 0;
    for (const [g, n] of shared) {
      if (groups[g].entries[0].language !== e.language) continue;
      const score = n / (mine.size + groups[g].key.size - n);
      if (score >= SAME_SURFACE && score > bestScore) { best = g; bestScore = score; }
    }
    if (best >= 0) { groups[best].entries.push(e); continue; }
    groups.push({ entries: [e], key: mine });
    for (const id of mine) (holding.get(id) ?? holding.set(id, []).get(id)!).push(groups.length - 1);
  }

  let surfaces: Surface[] = groups.map((g) => surfaceOf(p, rt, g.entries, g.entries.flatMap((e) => fedBy.get(e.id) ?? []), ok));
  // Parsers first, since a run with --surfaces fuzzes the first few: a surface that takes outside data and decodes it is
  // where malformed input does its damage. Read from the code: what feeds the surface, what its entry points take, what
  // they reach.
  const rank = new Map(surfaces.map((x) => [x.id, parserRank(x, reachOf)]));
  const prior = new Map(surfaces.map((x) => [x.id, Math.round(priorWorth(x) * 20)]));
  surfaces.sort((a, b) => {
    const ra = rank.get(a.id)!, rb = rank.get(b.id)!;
    return prior.get(b.id)! - prior.get(a.id)! || rb.weight - ra.weight || a.id.localeCompare(b.id);
  });
  if (o.changed) surfaces = surfaces.filter((s) => s.reach.some((t) => { const ls = o.changed!.get(t.path); return !!ls && [...ls].some((l) => l >= t.line && l <= t.endLine); }));
  if (o.skip) surfaces = surfaces.filter((s) => !o.skip!.has(`${s.entries[0].path}#${s.entries[0].qualifiedName}`));
  return surfaces.slice(0, o.surfaces);
}

/**
 * A surface from its entry points: their public callers, nearest first, breadth-first up the whole call graph (the way a
 * private entry point is reached, and the wrapper a real caller goes through), and everything they reach.
 */
export function surfaceOf(p: Project, rt: Runtime, entries: Target[], sources: Source[] = [], ok = shipped(p, rt)): Surface {
  const isPublic = (t: Target) => rt.isPublic(t, p.read(t.path));
  const via: Target[] = [];
  const seen = new Set(entries.map((e) => e.id));
  let frontier = entries;
  while (frontier.length) {
    const next: Target[] = [];
    for (const f of frontier) for (const id of p.callers(f.id)) {
      const c = p.byId.get(id);
      if (!c || seen.has(id) || !ok(c)) continue;
      seen.add(id);
      if (isPublic(c)) via.push(c); else next.push(c);
    }
    frontier = next;
  }
  const first = entries[0];
  return { id: `${plainName(first.qualifiedName).replace(/[^\w.-]+/g, '_').slice(0, 60)}-${sha(first.id).slice(0, 8)}`, language: first.language, entries, sources, via, reach: reachFrom(p, entries, ok) };
}

/** How strongly each kind of source says outside data arrives: a decoder's or a peer's bytes most, the environment least. */
const SOURCE_RANK: Record<SourceKind, number> = { deserialize: 3, network: 3, request: 3, stdin: 3, file: 2, memory: 1, environment: 1 };
/** A parameter that carries data to decode: by its type (bytes, text, a buffer, a stream) or, untyped, by its name. */
const DATA_TYPE = /\b(bytes|bytearray|memoryview|str|string|String|&str|\[\]byte|&\[u8\]|Vec<u8>|Buffer|Uint8Array|ArrayBuffer|InputStream|Reader|BufRead|Read|char\s*\*|uint8_t\s*\*|ByteBuffer|byte\[\]|ReadOnlySpan<byte>|Stream|TextIO|BinaryIO|IO)\b/;
const DATA_NAME = /^(data|buf|buffer|raw|bytes|text|input|payload|packet|frame|msg|message|line|lines|src|source|doc|document|json|xml|yaml|toml|content|contents|body|stream|blob|encoded|serialized|s|string|value|tle|record)$/i;
const PARSE_NAME = /^(parse|decode|deserial|unpack|unmarshal|load|loads|read|from|scan|lex|tokeni[sz]e|unserial|ingest|import)/i;

function parserRank(s: Surface, reachOf: Map<string, Target[]>) {
  const takesData = s.entries.some((e) => e.params.some((x) => (x.type ? DATA_TYPE.test(x.type) : DATA_NAME.test(x.name))));
  const decodes = s.sources.some((x) => x.kind === 'deserialize');
  return {
    parser: Number(takesData) + Number(decodes),
    source: Math.max(0, ...s.sources.map((x) => SOURCE_RANK[x.kind])),
    named: Number(s.entries.some((e) => PARSE_NAME.test(e.name))),
    weight: s.entries.reduce((n, e) => Math.max(n, (reachOf.get(e.id) ?? []).reduce((k, t) => k + t.complexity, 0)), 0),
  };
}

/**
 * What fuzzing a surface looks worth from the code alone, 0..1, before the judge has scored it (src/fuzzer.ts
 * scoreSurfaces): a source of outside data feeding it counts most (a peer's or a decoder's bytes more than a file, a file
 * more than the environment), then entry points that take data, then names that say they parse.
 */
export function priorWorth(s: Surface): number {
  const r = parserRank(s, new Map());
  return Math.min(1, (r.source / 3) * 0.6 + Math.min(1, r.parser) * 0.25 + r.named * 0.15);
}

/** A surface's lines, function by function, for asking whether a project line is in it. */
export function surfaceLines(s: Surface): { has(path: string, line: number): boolean; total: number; entry(path: string, line: number): Target | undefined } {
  const byPath = new Map<string, Target[]>();
  for (const t of s.reach) (byPath.get(t.path) ?? byPath.set(t.path, []).get(t.path)!).push(t);
  const inside = (list: Target[] | undefined, line: number) => list?.find((t) => line >= t.line && line <= t.endLine);
  const entries = new Map<string, Target[]>();
  for (const t of s.entries) (entries.get(t.path) ?? entries.set(t.path, []).get(t.path)!).push(t);
  return {
    has: (path, line) => !!inside(byPath.get(path), line),
    total: s.reach.reduce((n, t) => n + (t.endLine - t.line + 1), 0),
    entry: (path, line) => inside(entries.get(path), line),
  };
}

/** A hash of the surface's code: every reachable function's source. A harness is kept while it does not change. */
export function sourceHash(p: Project, s: Surface): string {
  return sha([...s.reach].sort((a, b) => a.id.localeCompare(b.id)).map((t) => `${t.id}\n${sourceOf(p, t)}`).join('\n\n'));
}

/** What the writer is told about how a surface's data arrives, so the harness injects it there, and how to reach it. */
export function describeSources(s: Surface, importFor: (t: Target) => string, isPublic: (t: Target) => boolean): string {
  const hidden = s.entries.filter((e) => !isPublic(e));
  const callers = s.via.length ? s.via.map((v) => `${importFor(v)}\n    ${v.header}`).join('\n') : '';
  const way = hidden.length
    ? `THESE ENTRY POINTS CANNOT BE IMPORTED (not exported or not public): ${hidden.map((e) => e.qualifiedName).join(', ')}. ${callers ? `Reach them through the public functions that call them, importing those:\n${callers}\nUse cases build the input those functions take so that it reaches the entry points; never import a name the module does not export.` : 'No public function calls them: reach them through whatever the module does export that leads to them, and never import a name the module does not export.'}`
    : callers ? `PUBLIC FUNCTIONS THAT HAND THEIR INPUT TO THIS SURFACE, the way real callers reach it:\n${callers}\nWrite use cases that send the same data through these as well as through the entry points, and checks on what they return: an input the entry point rejects or crashes on must not be accepted by the wrapper as if it were valid (a truncated message decoded with fields read from past its end, a checksum read as data), and a crash inside shows as a defect only when the wrapper, which real callers use, crashes or accepts it too.` : '';
  if (!s.sources.length) return way;
  return `${way ? `${way}\n\n` : ''}WHERE THIS SURFACE'S INPUT COMES FROM (found in the code, not documentation): ${s.sources.slice(0, 8).map((x) => `${x.kind} \`${x.api}\` at ${x.path}:${x.line} in ${x.in}`).join('; ')}. The harness delivers the grammar's data the way that source delivers it: as the bytes or text the source returns, handed to the entry point the source feeds; when an entry point reads the source itself, through that source (a temporary file it opens, a stream or reader it reads, a request object, an environment variable set for the call).`;
}
