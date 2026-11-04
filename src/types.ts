/**
 * What the fuzzing engine and a language adapter agree on. The engine is the same for every language: perch's tree-sitter
 * records say what the code is, the judge decides and the writer writes, and code mutates, runs and checks. An adapter only knows how
 * to build one language's project and run a harness in it with coverage.
 */

export interface Param {
  name: string;
  type?: string;
  default?: string;
  /** *args, ...rest, varargs: never required. */
  variadic?: boolean;
}

export interface BranchPoint {
  line: number;
  kind: string;
  text: string;
}

/** One function or method of the project, read from perch's records and the file's syntax tree. */
export interface Target {
  /** refuzz's method id: `path::qualified_name`. */
  id: string;
  path: string;
  /** refuzz's language id for the file (python, rust, go, c_sharp, …). */
  language: string;
  name: string;
  /** Class- or type-qualified name as refuzz reports it (`Parser.parse`, `QcowDisk::new`). */
  qualifiedName: string;
  line: number;
  endLine: number;
  /** The source from the start of the definition to the start of its body: modifiers, name, parameters, return type. */
  header: string;
  /** Comments right above the definition, or a docstring. */
  doc: string;
  params: Param[];
  /** First line of the body's statements (after an opening brace or the header's colon). */
  bodyStart: number;
  /** refuzz's cyclomatic complexity for the method. */
  complexity: number;
  test: boolean;
}

export interface Frame {
  /** Repository-relative path. */
  path: string;
  line: number;
  name: string;
}

/** What one harness did when run. Every adapter reports in this shape. */
export interface Report {
  status: 'ok' | 'error' | 'timeout';
  /**
   * Whose code failed: the harness's own lines (or it did not compile), the project's code, or an assertion the fuzz target
   * itself makes about the result (its `assert`, `assert!`, `t.Fatal`…, a property it states), which is a finding.
   */
  origin?: 'setup' | 'library' | 'assertion';
  /** Exception, panic or signal type: `ValueError`, `TypeError`, `panic`, `SIGSEGV`, `AddressSanitizer`. */
  type?: string;
  message?: string;
  /** The project's frames the failure passed through, innermost last. */
  frames?: Frame[];
  /** The process died to a signal or a sanitizer: no language-level error to read. */
  native?: boolean;
  /** Per target, the lines of it that executed. Undefined when the adapter cannot measure coverage. */
  hits?: number[][];
  /** The value the harness bound to `result`, printed. */
  result?: string;
}

/** A project prepared for one language: built, dependencies installed, ready to run harnesses. */
export interface Runtime {
  language: string;
  /** How a harness is written in this language, for the writer: the shape of the code, how imports look, how `result` is bound. */
  guide: string;
  /** The line(s) that bring a target into scope in a harness. */
  importFor(t: Target): string;
  /**
   * The import lines a test of the project relies on that its own body does not show (a Rust test module's `use` lines),
   * written as a harness outside the project must write them.
   */
  importsOfTest?(test: Target): string[];
  /** A harness line that imports, so splitting and mutation leave it alone and it is hoisted where the language needs. */
  isImport(line: string): boolean;
  /** A line that binds `result`: harnesses end with one, and one harness with several is split at them. */
  bindsResult(line: string): boolean;
  /** Wraps harness code so tree-sitter parses it as a whole program; the harness starts on line `offset + 1` of the result. */
  parseWrap(code: string): { source: string; offset: number };
  /** Public API a caller outside the project could reach: pub, exported, capitalized, not underscore-private. */
  isPublic(t: Target, source: string): boolean;
  /** Whether the build compiled the code `t` is in (a C library's archives hold an object of its file); absent: always. */
  compiled?(t: Target): boolean;
  /** Runs each harness in its own process with the targets' lines measured. */
  probe?(harnesses: Record<string, string>, targets: Target[], timeoutMs: number): Promise<Record<string, Report>>;
  /** Errors are values in this language (Rust, Go, C, Zig): a panic or crash is never the contract working. */
  errorsAreValues: boolean;
  /** Exception types a function throws on purpose to reject its input (ValueError, IllegalArgumentException, RangeError). */
  rejections: string[];
  /** A failure that says the environment is wrong (a missing module, a missing native library), not the project. */
  environmental(r: Report): boolean;
  /** Fuzzing with OSS-Fuzz targets: raw bytes in, run in-process many times and by the language's own engine. */
  fuzz?: FuzzRuntime;
  close?(): Promise<void>;
}

/**
 * A project built the way OSS-Fuzz builds it (src/build.ts): its build spec's image, the checkout copied to `src` inside
 * it, the spec's build.sh run there. The container is started and cut off from the network.
 */
export interface Built {
  box: import('./run.ts').Container;
  /** The project's folder inside the container, `$SRC/<name>`. */
  src: string;
  /** The checkout on this machine, which the project's records are read from. */
  dir: string;
  /** The OSS-Fuzz project name. */
  name: string;
  language: string;
  /** test.sh, which made the project's test suite runnable offline in the image (src/build.ts); absent when it could not. */
  testSetup?: string;
  /** Seconds the project's own test of one file took through refuzz-test-one.sh when test.sh was checked, its compile included. */
  testSeconds?: number;
  /** run.sh, which starts the project's own service in the container as it is deployed (src/build.ts); absent when it could not. */
  runSetup?: string;
  /** The service run.sh started: its base URL and the settings a client needs, from /src/refuzz-run.env. */
  service?: { url: string; env: Record<string, string> };
}

export interface Adapter {
  /** refuzz language ids this adapter runs. */
  languages: string[];
  /**
   * What is wrong with a built project for fuzz targets to use it (the package does not import, the library is not there to
   * link), or undefined: checked after the build spec's build.sh, and sent back with the spec when it is rewritten.
   */
  ready?(b: Built): Promise<string | undefined>;
  /** A runtime over the built project: how targets are written, built, run and measured. It installs and builds nothing. */
  prepare(b: Built, log: (s: string) => void): Promise<Runtime>;
}

/** What one input did in a fuzz session: a Report, plus the coverage features it hit (opaque ids, compared for novelty). */
export interface InputReport extends Report {
  /** The error is a clean rejection: an invalid-value or OS error, or one of the project's own exception types. */
  clean?: boolean;
  features?: string[];
  /** For engines that only say whether an input added coverage (libFuzzer's merge), not which features. */
  novel?: boolean;
  /**
   * Every project line this input ran, as [path, line], whether or not an earlier input ran it: the engine decides what is new
   * and whether the input reached its target. Absent when the driver could not measure this input's lines (an empty list
   * means it ran none).
   */
  lines?: [string, number][];
}

/**
 * Fuzz targets built once and kept running, so an input costs microseconds, not a process: the engine sends batches of raw
 * inputs through a target and reads back what each did. The target receives the bytes exactly as libFuzzer would hand them
 * to it.
 */
export interface FuzzSession {
  /** Runs inputs through one target, in order. A target that kills its process loses only the input that did it. */
  /** May return fewer reports than inputs (a deadline passed, or the batch kept hanging): the rest were not run. */
  run(target: string, inputs: Buffer[], timeoutMs: number, deadline?: number): Promise<InputReport[]>;
  /**
   * The language's own engine (libFuzzer, Atheris, Jazzer.js, Jazzer, cargo-fuzz, go test -fuzz…) running the same target
   * file for `seconds`, seeded with `corpus` and `dict`. Returns what crashed it, with the inputs, and the corpus it grew.
   */
  native?(target: string, corpus: Buffer[], dict: string[], seconds: number): Promise<{ crashes: { input: Buffer; report: Report }[]; corpus: Buffer[]; execs: number; error?: string }>;
  /** Stops one target that will not be run again (it failed to build or load), keeping the rest of the session. */
  release?(target: string): void;
  close(): Promise<void>;
}

/**
 * A runtime that runs OSS-Fuzz targets: the file a project would add to OSS-Fuzz for this language, unchanged (an Atheris
 * `TestOneInput(data)`, a Jazzer.js `fuzz(data)`, `LLVMFuzzerTestOneInput`, a cargo-fuzz `fuzz_target!`, a Go `Fuzz…(f
 * *testing.F)`, a Jazzer `fuzzerTestOneInput`, and the nearest equivalent where OSS-Fuzz has no engine). Whatever a target
 * asserts about a result is in the target; there is no separate checks file.
 */
export interface FuzzRuntime {
  /**
   * How a fuzz target is written for this project, for the writer: the file's shape and entry point, how it imports the
   * project, how it splits the bytes into arguments (FuzzedDataProvider or the language's equivalent), which exceptions to
   * catch (only the project's documented rejections), and how to assert a property so a failure reads as an assertion.
   */
  guide: string;
  /** Builds targets, name → source; a target that does not build or load comes back in `errors` with the message. */
  session(targets: Record<string, string>, project: Target[]): Promise<{ session: FuzzSession; errors: Record<string, string> }>;
  /**
   * One target as it goes into the project's OSS-Fuzz folder: the file it is kept in there (under `$SRC/refuzz/`), its
   * content, and the build.sh lines that build it, after the project's own build, into `$OUT/<name>` the way OSS-Fuzz runs it.
   */
  oss(name: string, source: string): { file: string; source: string; compile: string[] };
}
