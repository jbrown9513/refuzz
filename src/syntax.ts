/**
 * Everything the engine knows about source code, from perch's tree-sitter analysis, for any language perch scans: the methods
 * (perch's records), their headers, parameters and docs (the syntax tree), the branches inside them, the literals of the code
 * and of a harness, and which of the project's tests call each one (perch's call graph). No language is special here.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
// @ts-ignore: perch's analysis API, bundled from a perch checkout by scripts/build-analysis.mjs
import * as perch from '../vendor/perch/lib.mjs';
import type { BranchPoint, Param, Target } from './types.ts';

// Records are keyed by blob and path, so an unchanged file is parsed once across runs and projects.
const CACHE = resolve('.fuzz', 'records');

/** perch's records for every source file at `revision`, cached by blob: an unchanged file is parsed once. */
async function fileRecords(dir: string, revision: string): Promise<any[]> {
  mkdirSync(CACHE, { recursive: true });
  const tree = await perch.listTree(dir, revision);
  const sources = tree.filter(perch.createFileSelector(tree)).filter(perch.sourceFile);
  const key = (f: { sha: string; path: string }) => join(CACHE, `${f.sha}-${createHash('sha1').update(f.path).digest('hex').slice(0, 12)}.json`);
  const missing = sources.filter((f: any) => !existsSync(key(f)));
  if (missing.length) {
    const analysis = await perch.analyzeFiles(missing, { analyzer: perch.createSourceAnalyzer(), readSource: (f: any) => perch.readBlob(dir, f.sha) });
    const byPath = new Map(analysis.files.map((r: any) => [r.path, r]));
    for (const f of missing) writeFileSync(key(f), JSON.stringify(byPath.get(f.path) ?? null));
  }
  return sources.map((f: any) => JSON.parse(readFileSync(key(f), 'utf8'))).filter(Boolean);
}

/** The grammar perch parses a language with. */
const grammar = (language: string) => perch.normalizeLanguage(language) as string | null;

/** A parsed source: perch's Node over the language pack's tree. */
export function parse(source: string, language: string): any | null {
  const g = grammar(language);
  if (!g) return null;
  const bytes = Buffer.from(source);
  return new perch.Node(perch.downloading(() => perch.treeSitterPack.getParser(g)).parse(source).rootNode(), bytes);
}

/** Node types that start a branch, across the grammars perch ships. */
const BRANCHES = new Set([
  'if_statement', 'elif_clause', 'else_clause', 'else', 'if_expression', 'conditional_expression', 'ternary_expression', 'if', 'unless', 'elsif',
  'for_statement', 'for_in_statement', 'enhanced_for_statement', 'while_statement', 'do_statement', 'loop_expression', 'while_expression', 'for_expression', 'for', 'while', 'until', 'range_clause',
  'try_statement', 'except_clause', 'catch_clause', 'finally_clause', 'rescue', 'try_expression', 'catch_block',
  'switch_statement', 'switch_case', 'switch_expression', 'case_clause', 'expression_case', 'type_case', 'match_statement', 'match_expression', 'match_arm', 'switch_prong', 'when_entry', 'when', 'case_statement', 'switch_section',
  'with_statement', 'return_statement', 'raise_statement', 'throw_statement', 'throw_expression', 'guard_statement',
]);

/** The decision points between two lines of a parsed file. */
export function branchPoints(root: any, source: string, start: number, end: number): BranchPoint[] {
  const lines = source.split('\n');
  const out = new Map<number, BranchPoint>();
  for (const node of root.walk()) {
    const row = node.startPosition.row + 1;
    // Some grammars (Zig) name nodes in CamelCase: IfStatement, SwitchProng.
    const type = /[A-Z]/.test(node.type) ? node.type.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() : node.type;
    if (row < start || row > end || out.has(row) || !BRANCHES.has(type)) continue;
    out.set(row, { line: row, kind: type.replace(/_(statement|clause|expression)$/, ''), text: (lines[row - 1] ?? '').trim().slice(0, 100) });
  }
  return [...out.values()].sort((a, b) => a.line - b.line);
}

export type LiteralKind = 'number' | 'string' | 'char' | 'constant' | 'container';

/** A literal node's kind, by its type name, across grammars: integer_literal, int_literal, number, float, string_literal, nil… */
export function literalKind(raw: string): LiteralKind | null {
  // Some grammars (Zig) name nodes in capitals: STRINGLITERALSINGLE, INTEGER.
  const type = raw.toLowerCase();
  if (/^(true|false|boolean|boolean_literal|bool_literal|null|null_literal|nil|none|undefined)$/.test(type)) return 'constant';
  if (/(^|_)(char|rune|character)(_literal)?$/.test(type)) return 'char';
  if (/string|^encapsed_string$|^raw_string$/.test(type) && !/content|fragment|start|end|escape|interpolation/.test(type)) return 'string';
  if (/^(integer|float|number|real|decimal|hex|octal|binary)(_integer|_floating_point)?(_literal)?$|^(int|float|number|real|decimal_integer|hex_integer|octal_integer|binary_integer|decimal_floating_point|hex_floating_point|imaginary)_literal$/.test(type)) return 'number';
  return null;
}

export interface Literal {
  kind: LiteralKind;
  text: string;
  /** 0-based line and byte columns within the parsed source. */
  row: number;
  start: number;
  end: number;
}

/** The literals in a parsed tree: outermost only, so a string's content is not counted twice. */
export function literals(root: any): Literal[] {
  const out: Literal[] = [];
  let insideUntil = -1;
  for (const node of root.walk()) {
    // Unnamed nodes are keywords and punctuation: Solidity's `string` type keyword is not a literal.
    if (node.startIndex < insideUntil || !node.isNamed) continue;
    // A small one-line collection literal is a value to swap too; the literals inside it still count on their own.
    if (CONTAINER.test(node.type) && node.startPosition.row === node.endPosition.row && node.text.length <= 60) {
      out.push({ kind: 'container', text: node.text, row: node.startPosition.row, start: node.startPosition.column, end: node.endPosition.column });
      continue;
    }
    // An unquoted shell word is a number when it reads as one.
    const kind = literalKind(node.type) ?? (node.type === 'word' && /^-?\d+$/.test(node.text) ? 'number' : null);
    if (!kind) continue;
    // A literal spanning lines (a heredoc, a template) is not swapped: a line-based mutation could not put it back.
    if (node.startPosition.row !== node.endPosition.row) continue;
    out.push({ kind, text: node.text, row: node.startPosition.row, start: node.startPosition.column, end: node.endPosition.column });
    insideUntil = node.endIndex;
  }
  return out;
}

export interface Pool {
  number: string[];
  string: string[];
  char: string[];
  constant: string[];
  /** Small list, array, dict, set, tuple and table literals. */
  container: string[];
}

/** Collection literals across grammars: Python lists and dicts, JS arrays and objects, Ruby hashes, Lua tables, Go composites. */
const CONTAINER = /^(list|array|dictionary|tuple|set|object|hash|table_constructor|table|array_literal|collection_literal|array_creation_expression|array_expression|composite_literal|initializer_list|array_initializer|dictionary_literal|array_type_literal|vec_macro)$/;

/** Constants of the code under test, as written in its language, then a few generic ones. */
export function constantPool(sources: { source: string; language: string }[]): Pool {
  const pool: Pool = { number: [], string: [], char: [], constant: [], container: [] };
  const seen = new Set<string>();
  const add = (k: LiteralKind, v: string) => {
    if (seen.has(`${k}:${v}`) || pool[k].length >= 40 || v.length > 60 || /\n/.test(v)) return;
    seen.add(`${k}:${v}`);
    pool[k].push(v);
  };
  for (const { source, language } of sources) {
    const root = parse(source, language);
    if (root) for (const l of literals(root)) add(l.kind, l.text);
  }
  for (const v of ['0', '1', '-1', '2', '255', '256', '65535', '-2147483648', '4294967295', '0.5', '-0.0', '1e308']) add('number', v);
  for (const v of ['""', '"a"', '"\\x00"', '"%s%s%n"', '"../../.."', '"é"']) add('string', v);
  for (const v of ["'a'", "'\\0'"]) add('char', v);
  // Empty and non-empty collections where the syntax is the same in most of these languages.
  const language = sources[0]?.language ?? '';
  const generic: Record<string, string[]> = {
    python: ['[]', '[1, 2, 3]', '{}', "{'a': 1}", '()', '[0]', '[None]'],
    javascript: ['[]', '[1, 2, 3]', '{}', '{ a: 1 }', '[null]'], typescript: ['[]', '[1, 2, 3]', '{}', '{ a: 1 }'], tsx: ['[]', '[1, 2, 3]', '{}'],
    ruby: ['[]', '[1, 2, 3]', '{}', "{ 'a' => 1 }", '[nil]'], php: ['[]', '[1, 2, 3]', "['a' => 1]"], lua: ['{}', '{1, 2, 3}', '{a = 1}'],
    swift: ['[]', '[1, 2, 3]', '[:]'], groovy: ['[]', '[1, 2, 3]', '[:]', '[a: 1]'],
  };
  for (const v of generic[language] ?? []) add('container', v);
  return pool;
}

export interface Project {
  dir: string;
  revision: string;
  /** Every method perch found, as targets (test methods included, flagged). */
  targets: Target[];
  /** Methods per language, not counting tests: what the project is mostly written in. */
  languages: Map<string, number>;
  /** Every source file perch read, with its language. */
  files: Map<string, string>;
  callers(id: string): string[];
  callees(id: string): string[];
  byId: Map<string, Target>;
  /** The innermost method around a line. */
  at(path: string, line: number): Target | undefined;
  read(path: string): string;
  tree(path: string): any | null;
  /** Every error type the project declares (a class, struct, enum or record named …Error, …Exception, …Err or …Failure), with its file. */
  errorTypes: { name: string; path: string; language: string }[];
  /** Where each type the project declares is declared, by language: name → files (classes, structs, enums, interfaces, traits, aliases). */
  typesDeclared: Map<string, Map<string, string[]>>;
}

// Grammars name these in snake case, Zig's in Pascal case (ParamDeclList, IDENTIFIER).
const PARAMS = /^(parameters|parameter_list|formal_parameters|function_value_parameters|method_parameters|lambda_parameters|parameter_clause|function_parameters|params|param_?decl_?list)$/i;
const SELF = /^(self|&self|&mut self|mut self|cls|this|_self)$/;

/** The parameters of a definition: its parameter list's named children, without self, by name, type and default. */
function paramsOf(node: any, bodyStart: number): Param[] {
  let list: any = node.childForFieldName('parameters');
  if (!list) {
    for (const n of node.walk()) {
      if (n.startIndex >= bodyStart) break;
      if (PARAMS.test(n.type)) { list = n; break; }
    }
  }
  // Some grammars (Solidity) put parameters straight under the definition, with no list around them.
  const items = list ? list.namedChildren : node.namedChildren.filter((c: any) => c.type === 'parameter' && c.startIndex < bodyStart);
  // A function that declares none and reads positional parameters in its body (a shell function's $1, "$@") takes them.
  if (!list && !items.length) {
    const positional = new Set<string>();
    for (const n of node.walk()) if (n.startIndex >= bodyStart && /^(simple_expansion|expansion)$/.test(n.type)) { const v = /^\$\{?#?([1-9@*])\b/.exec(n.text)?.[1]; if (v) positional.add(v); }
    return [...positional].sort().map((v) => (v === '@' || v === '*' ? { name: `$${v}`, variadic: true } : { name: `$${v}` }));
  }
  const out: Param[] = [];
  for (const p of items) {
    if (/comment|attribute|annotation$/.test(p.type)) continue;
    if (/self_parameter|receiver/.test(p.type)) continue;
    const nameNode = p.childForFieldName('name') ?? p.childForFieldName('pattern') ?? p.childForFieldName('declarator') ?? [...p.walk()].find((n: any) => /identifier|variable_name|simple_identifier/i.test(n.type));
    const name = (nameNode?.text ?? p.text).replace(/^[*&$@]+/, '').split(/[\s:=]/)[0];
    if (!name || SELF.test(name) || SELF.test(p.text.trim())) continue;
    const def = p.childForFieldName('value') ?? p.childForFieldName('default_value') ?? p.childForFieldName('default');
    const type = p.childForFieldName('type');
    const variadic = /variadic|splat|rest|spread|list_splat|dictionary_splat|params_array/.test(p.type) || /^\.\.\.|^\*/.test(p.text.trim()) || /\.\.\.\s*\w*$/.test(p.text);
    out.push({ name, ...(type ? { type: type.text } : {}), ...(def ? { default: def.text } : /=/.test(p.text) && /default/.test(p.type) ? { default: p.text.split('=').slice(1).join('=').trim() } : {}), ...(variadic ? { variadic } : {}) });
  }
  return out;
}

/** Comments right above a definition, or a docstring as the body's first statement. */
function docOf(node: any, body: any | null, lines: string[]): string {
  const above: string[] = [];
  for (let i = node.startPosition.row - 1; i >= 0 && above.length < 12; i--) {
    const t = lines[i].trim();
    if (/^(\/\/\/?|#(?!\[|!|include|define|if|endif)|\/\*\*?|\*|--|;;|"""|''')/.test(t) || /^\*\/$/.test(t)) above.unshift(t.replace(/^(\/\/\/?!?|#|\/\*\*?|\*\/?|--|;;)\s?/, ''));
    else if (/^(@|#\[)/.test(t)) continue; // decorators and attributes between the comment and the definition
    else break;
  }
  if (above.length) return above.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  const first = body?.namedChildren?.[0];
  if (first && /expression_statement|string/.test(first.type) && /^[rRuU]?("""|''')/.test(first.text)) return first.text.replace(/^[rRuU]?("""|''')|("""|''')$/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
  return '';
}

/** Branch keywords in a method's lines, for grammars whose trees have no branch nodes. */
function keywordBranches(lines: string[], start: number, end: number): number {
  return lines.slice(start - 1, end).filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join('\n').match(/\b(if|else|for|while|case|catch|switch)\b|&&|\|\||\?:/g)?.length ?? 0;
}

/**
 * Function definitions in the tree that perch's records left out. perch drops a C definition written K&R style
 * (`int f(a, b) int a; int b; {`), and a macro tree-sitter cannot read (`int ZEXPORT inflate(strm, flush)`) turns the rest of
 * the file into one error node: zlib's `inflate.c` comes out of perch with one method of eighteen. A function declarator
 * named by a plain identifier and followed by a body is a definition: a `{` straight after it, or after parameter
 * declarations only (`;`-terminated, no parentheses or braces); a prototype is followed by `;`. A definition the tree kept
 * whole ends where its node ends, a broken one before the next definition in the file. `recorded` are perch's methods.
 */
function missedDefinitions(root: any, source: string, recorded: { name: string; line: number; endLine: number }[]): { name: string; line: number; endLine: number; header: string; doc: string; params: Param[]; bodyStart: number }[] {
  const bytes = Buffer.from(source);
  const lines = source.split('\n');
  const found: { name: string; line: number; endLine?: number; declarator: any; open: number }[] = [];
  const known = new Set(recorded.map((m) => m.name));
  for (const n of root.walk()) {
    if (n.type !== 'function_declarator') continue;
    const id = n.childForFieldName('declarator');
    if (id?.type !== 'identifier' || known.has(id.text)) continue;
    // A file-level definition, its line not indented: not a member of a class or struct body (a C++ header read as C), not a
    // constructor's initializer (`: m_fp(0)`), not a misread statement inside another function.
    let member = false;
    for (let a = n.parent; a && !member; a = a.parent) member = /^(field_declaration_list|class_specifier|struct_specifier|union_specifier)$/.test(a.type);
    const lineStart = bytes.lastIndexOf('\n', n.startIndex) + 1;
    if (member || /^\s/.test(bytes.subarray(lineStart, lineStart + 1).toString('utf8')) || /[:,]\s*$/.test(bytes.subarray(lineStart, n.startIndex).toString('utf8'))) continue;
    const line = n.startPosition.row + 1;
    if (recorded.some((m) => m.line <= line && line <= m.endLine)) continue;
    const open = bytes.indexOf('{', n.endIndex);
    if (open < 0) continue;
    const decls = bytes.subarray(n.endIndex, open).toString('utf8').trim();
    if (decls && (!decls.endsWith(';') || /[(){}=]/.test(decls))) continue;
    const whole = n.parent?.type === 'function_definition' ? n.parent : null;
    found.push({ name: id.text, line, endLine: whole ? whole.endPosition.row + 1 : undefined, declarator: n, open });
    known.add(id.text);
  }
  const starts = [...recorded.map((m) => m.line), ...found.map((f) => f.line)].sort((a, b) => a - b);
  return found.map((f) => {
    let end = f.endLine ?? (starts.find((s) => s > f.line) ?? lines.length + 1) - 1;
    // A broken definition ends before the comment and blank lines that open the next one.
    if (f.endLine === undefined) while (end > f.line && /^\s*($|\/\/|\/\*|\*)/.test(lines[end - 1])) end--;
    const lineStart = bytes.lastIndexOf('\n', f.declarator.startIndex) + 1;
    const openLine = bytes.subarray(0, f.open).toString('utf8').split('\n').length;
    return {
      name: f.name, line: f.line, endLine: end,
      header: bytes.subarray(lineStart, f.open).toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 400),
      doc: docOf(f.declarator, null, lines), params: paramsOf(f.declarator, f.open),
      // The `{` on a line of its own, as K&R definitions write it, or after the header: the statements start below it.
      bodyStart: openLine + 1,
    };
  });
}

/**
 * A test method in a source file: tests kept beside the code (Rust's #[test] in mod tests, a JUnit @Test, an xUnit [Fact]),
 * which perch's per-file test flag does not mark.
 */
function testMethod(lines: string[], line: number, name: string): boolean {
  const above = lines.slice(Math.max(0, line - 4), line - 1).join('\n');
  return /#\[(\w+::)*test\b|#\[cfg\([^\]]*\btest\b|@(Test|ParameterizedTest|Property)\b|\[(Fact|Theory|Test|TestMethod|TestCase)\b/.test(above) || /^Test[A-Z_]/.test(name);
}

/** Nodes declaring a type, across the grammars perch ships, and the look-alikes that are not declarations (a struct_type is a use). */
const TYPE_NODE = /class|struct|enum|interface|trait|type_spec|type_item|type_alias|exception|object_declaration|protocol|record/;
const NOT_TYPE_NODE = /body|expression|reference|parameter|_type$|instance|literal/;

/**
 * Gives the parsed trees no longer in use back to the system. A tree and every node handle taken from it live outside the
 * JavaScript heap, in the language pack's native memory, which V8 does not count: with the heap small nothing prompts a
 * collection, and the native finalizers that free a tree run only when the event loop turns. A loop that parses a project
 * file by file (3,000 Go files: 4.5 GB) therefore frees nothing until it ends, and neither does a long session. This
 * collects and lets the loop turn, which frees what the collection found.
 */
const collect: () => void = typeof (globalThis as any).gc === 'function' ? (globalThis as any).gc : (setFlagsFromString('--expose-gc'), runInNewContext('gc'));
export async function freeTrees(): Promise<void> {
  collect();
  await yieldToLoop();
}

/** Reads the project at `revision` through perch: methods with headers, parameters and docs, and perch's call graph. */
export async function readProject(dirIn: string, revision = 'HEAD'): Promise<Project> {
  const dir = resolve(dirIn);
  const records = await fileRecords(dir, revision);
  const graph = perch.buildGraph(records);
  const sources = new Map<string, string>();
  const recordByPath = new Map(records.map((r) => [r.path, r]));
  // Only the most recently used few trees are kept; a file is parsed again when it is needed again, in milliseconds.
  const trees = new Map<string, any>();
  const TREES = 48;
  const read = (path: string) => {
    if (!sources.has(path)) sources.set(path, existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '');
    return sources.get(path)!;
  };
  const tree = (path: string) => {
    if (trees.has(path)) { const root = trees.get(path); trees.delete(path); trees.set(path, root); return root; }
    const r = recordByPath.get(path);
    let root = null;
    try { root = r ? parse(read(path), r.language) : null; } catch {}
    trees.set(path, root);
    if (trees.size > TREES) trees.delete(trees.keys().next().value!);
    return root;
  };
  const targets: Target[] = [];
  const languages = new Map<string, number>();
  const files = new Map<string, string>(records.map((r) => [r.path, r.language]));
  const errorTypes: Project['errorTypes'] = [];
  const typesDeclared: Project['typesDeclared'] = new Map();
  let parsed = 0;
  for (const r of records) {
    if (++parsed % 64 === 0) await freeTrees();
    const methods = (r.methods ?? []).filter((m: any) => m.name !== '<top-level>' && m.name !== '<anonymous>');
    const source = read(r.path);
    const lines = source.split('\n');
    // Definitions by their start byte, as perch's `node` field names them (`function:620`).
    const starts = new Map<number, any>();
    const root = tree(r.path);
    // One walk of the file: the definitions, and the error types it declares (errorTypes in src/fuzzer.ts asks for them
    // on every surface's turn, and walking the project again for each turn is what filled the memory). Only named nodes: the
    // `function` keyword token starts at the same byte as its definition.
    if (root) for (const n of root.walk()) {
      if (!n.isNamed) continue;
      if (!starts.has(n.startIndex) || /function|method|constructor|definition|declaration/.test(n.type)) starts.set(n.startIndex, n);
      // Go declares a type as a `type_spec` (`type NotFoundError struct`); the other grammars as a class, struct, enum or record.
      if (TYPE_NODE.test(n.type) && !NOT_TYPE_NODE.test(n.type)) {
        const name = n.childForFieldName('name')?.text;
        if (name) {
          const byName = typesDeclared.get(r.language) ?? typesDeclared.set(r.language, new Map()).get(r.language)!;
          const at = byName.get(name) ?? byName.set(name, []).get(name)!;
          if (!at.includes(r.path)) at.push(r.path);
          if (/class|struct|enum|exception|record|^type_spec$/.test(n.type) && /(Error|Exception|Err|Failure)$/.test(name)) errorTypes.push({ name, path: r.path, language: r.language });
        }
      }
    }
    // A C file perch found no methods in may hold definitions only the tree has (missedDefinitions).
    if (!methods.length && r.language !== 'c') continue;
    // A grammar that yields no branch nodes for a whole file (perch's Groovy parses code as generic commands) is read by keywords.
    const fileBranches = root ? branchPoints(root, source, 1, lines.length) : [];
    const branchesIn = (start: number, end: number) => fileBranches.filter((b) => b.line >= start && b.line <= end).length;
    for (const m of methods) {
      const at = Number(String(m.node ?? '').split(':').pop());
      const node = Number.isFinite(at) ? starts.get(at) : undefined;
      const body = node ? node.childForFieldName('body') ?? node.namedChildren.find((c: any) => /block|body|compound_statement|statement_block/.test(c.type)) ?? null : null;
      const bodyStart = body ? body.startIndex : node?.endIndex ?? 0;
      const header = node ? Buffer.from(source).subarray(node.startIndex, bodyStart).toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 400) : (lines[m.line - 1] ?? '').trim();
      targets.push({
        id: m.id, path: r.path, language: r.language, name: m.name, qualifiedName: m.qualified_name, line: m.line, endLine: m.end_line,
        header, doc: node ? docOf(node, body, lines) : '', params: node ? paramsOf(node, bodyStart) : [],
        // A body that opens with a brace, `do` or `begin` has its statements on the next line; Python's starts on its own.
        bodyStart: body ? body.startPosition.row + 1 + (/^(\{|do\b|begin\b|=\s*\{?)\s*$/.test(lines[body.startPosition.row]?.slice(body.startPosition.column) ?? '') ? 1 : 0) : m.line + 1,
        // perch reports no complexity, or 1, for some grammars (Ruby, Lua, Bash, C#, Kotlin, Scala): the branches count too.
        complexity: Math.max(m.metrics?.cyclomatic_complexity ?? 1, fileBranches.length > 0 ? branchesIn(m.line, m.end_line) + 1 : keywordBranches(lines, m.line, m.end_line) + 1), test: !!r.test || testMethod(lines, m.line, m.name),
      });
      if (!r.test) languages.set(r.language, (languages.get(r.language) ?? 0) + 1);
    }
    const recorded = targets.filter((t) => t.path === r.path);
    if (root && r.language === 'c') for (const d of missedDefinitions(root, source, recorded)) {
      targets.push({
        id: `${r.path}::${d.name}`, path: r.path, language: r.language, name: d.name, qualifiedName: d.name, line: d.line, endLine: d.endLine,
        header: d.header, doc: d.doc, params: d.params, bodyStart: d.bodyStart,
        complexity: Math.max(1, fileBranches.length > 0 ? branchesIn(d.line, d.endLine) + 1 : keywordBranches(lines, d.line, d.endLine) + 1), test: !!r.test || testMethod(lines, d.line, d.name),
      });
      if (!r.test) languages.set(r.language, (languages.get(r.language) ?? 0) + 1);
    }
  }
  const byId = new Map(targets.map((t) => [t.id, t]));
  const byPath = new Map<string, Target[]>();
  for (const t of targets) (byPath.get(t.path) ?? byPath.set(t.path, []).get(t.path)!).push(t);
  return {
    dir, revision, targets, languages, files, byId, read, tree, errorTypes, typesDeclared,
    callers: (id) => graph.callers(id),
    callees: (id) => graph.callees(id),
    at: (path, line) => (byPath.get(path) ?? []).filter((t) => t.line <= line && line <= t.endLine).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0],
  };
}

/** The source of a method. */
export const sourceOf = (p: Project, t: Target) => p.read(t.path).split('\n').slice(t.line - 1, t.endLine).join('\n');

/** A qualified name without its generic parameters: `Deposit<M, DECIMALS>.execute` is `Deposit.execute`. */
export function plainName(name: string): string {
  let out = name;
  for (let was = ''; was !== out; ) { was = out; out = out.replace(/<[^<>]*>/g, ''); }
  return out;
}

/**
 * The project's tests that call a target, shortest first: perch's call graph, then any test whose source calls the name
 * (and names its type, for a method), for calls the graph could not resolve.
 */
export function testsCalling(p: Project, s: Target, k: number): Target[] {
  const tests = p.targets.filter((t) => t.test && t.language === s.language && t.endLine - t.line <= 40);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\w$])${esc(s.name)}\\s*[(!<]`);
  // A method's test must also name its type: `new(` alone matches every constructor in the project.
  // Generic parameters are not part of the type's name (`Deposit<M, DECIMALS>` is written `Deposit`); a test in the target's
  // own file is about its types whether it names them or not (`market.deposit(..)?.execute()`).
  const owner = s.qualifiedName.includes('.') ? plainName(s.qualifiedName).split('.').at(-2)! : '';
  const ownerPattern = owner ? new RegExp(`(?<![\\w$])${esc(owner)}\\b`) : null;
  const viaGraph = new Set(p.callers(s.id));
  const calls = (t: Target) => {
    if (viaGraph.has(t.id)) return true;
    const src = sourceOf(p, t);
    return pattern.test(src) && (!ownerPattern || t.path === s.path || ownerPattern.test(src));
  };
  return tests.filter(calls).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line)).slice(0, k);
}

/** The shortest test of the project that calls each target: how this codebase builds what the target needs. */
export function testExamples(p: Project, subjects: Target[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of subjects) {
    const best = testsCalling(p, s, 1)[0];
    if (best) out.set(s.id, sourceOf(p, best));
  }
  return out;
}

/** The smallest node on a line of a parsed file that throws, raises or panics on purpose, if the line is one. */
export function throwsOnPurpose(root: any, line: number): boolean {
  for (const n of root.walk()) {
    if (n.startPosition.row > line - 1) break;
    if (n.endPosition.row < line - 1) continue;
    if (n.startPosition.row !== line - 1) continue;
    if (/^(raise_statement|throw_statement|throw_expression|throw)$/.test(n.type)) return true;
    // Languages where raising is a call: Ruby's raise and fail, Lua's error, Kotlin's and Scala's require and check.
    if (/^(call|function_call|identifier|call_expression)$/.test(n.type) && /^(raise|fail|error|require|check|requireNotNull|checkNotNull)\b/.test(n.text)) return true;
  }
  return false;
}

/** Where each type the project declares in a language is declared: name → files. Read once with the project. */
export function typesDeclaredAt(p: Project, language: string): Map<string, string[]> {
  return p.typesDeclared.get(language) ?? new Map();
}

/** Names of the types a project declares in one language (classes, structs, enums, interfaces, traits). Read once with the project. */
export function declaredTypes(p: Project, language: string): Set<string> {
  return new Set(typesDeclaredAt(p, language).keys());
}
