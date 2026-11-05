<p align="center">
  <a href="https://github.com/jbrown9513/refuzz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/logo.svg">
      <img alt="refuzz" src=".github/logo-light.svg" width="300">
    </picture>
  </a>
</p>

<p align="center">
  <a href="findings/README.md"><img alt="bugs found: 32" src="https://img.shields.io/badge/bugs%20found-32-8b6cff?labelColor=1a1d26"></a>
  <a href="#languages"><img alt="languages: 14" src="https://img.shields.io/badge/languages-14-3ff0b4?labelColor=1a1d26"></a>
  <a href="https://nodejs.org"><img alt="node 22 or later" src="https://img.shields.io/badge/node-%E2%89%A522-8b6cff?labelColor=1a1d26"></a>
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-3ff0b4?labelColor=1a1d26"></a>
</p>

<p align="center">
  <a href="https://youtu.be/qgFttMC9WfU">demo</a> &nbsp;&middot;&nbsp;
  <a href="findings/README.md">findings</a> &nbsp;&middot;&nbsp;
  <a href="#how-it-improves-itself">how it works</a>
</p>

Self-improving fuzzer for 14 languages.

<a href="https://youtu.be/qgFttMC9WfU"><img alt="refuzz building Dapr, writing a harness, and proving a nil pointer bug with a failing test" src=".github/demo.gif" width="880"></a>

## Quick start

You need Node 22 or later, Docker, and an `OPENAI_API_KEY` in the environment or in a `.env` file.

```sh
git clone https://github.com/jbrown9513/refuzz && cd refuzz
npm install
./bin/refuzz.mjs mangiucugna/json_repair --language python --minutes 10 --cents 100
```

A project is a local path, a GitHub URL, or `owner/name`. Clones go under `.fuzz/repos/`, and each run's summary goes
under `results/fuzz/`.

| Option | Meaning |
|---|---|
| `--language l` | Fuzz one language of a multi-language project |
| `--minutes N` | Time limit for the run |
| `--cents N` | Spending limit for model calls. Some is held back to verify what the run finds |
| `--surfaces N` | Fuzz only the first N surfaces |
| `--only a,b` | Make the named functions the entry points |
| `--changed [base]` | Fuzz only what changed since `base` (default: the remote's default branch) |
| `--model m` | The model that judges and verifies (default `gpt-6-luna`) |
| `--fuzz-model m` | The model that writes specs and targets (default: `--model`) |
| `--store dir` | Keep the `.refuzz` store somewhere other than the project |

Models are OpenAI models by name, `openrouter:<model>` (`OPENROUTER_API_KEY`), or `meta:<model>` for Meta's Model API
(`MODEL_API_KEY`). `REFUZZ_CORES` caps the cores a run uses when several share a machine. Each container's memory is
capped at the machine's share for those cores.

Re-verify stored findings with the current verifier without fuzzing again:

```sh
npx tsx src/reverify.ts mangiucugna/json_repair --language python --cents 100
```

## How it improves itself

Each run picks up where the last one stopped. Everything it learns about a project is kept in the project's own
`.refuzz/` folder:

1. **Build.** If the project is in OSS-Fuzz, refuzz uses that build. Otherwise the model writes a Dockerfile and
   `build.sh` from the project's CI configuration, and rewrites them from the error until they work. The spec that
   worked is kept.
2. **Surfaces.** Code finds where outside data enters (files, sockets, requests, deserializers, public functions nothing
   calls) and groups the entry points that reach the same code.
3. **Targets.** The model writes OSS-Fuzz targets for each surface. A target is only rewritten when it is broken: it
   doesn't build, its inputs never reach the entry point, it fails in its own code, or it asserts something the function
   never promised. Working targets are never replaced.
4. **Coverage.** Every input's project lines are measured. When coverage stops growing, the model writes a new target
   aimed at the entry points, functions and branches nothing has reached yet. It is kept only if it reaches a line no
   other target did.
5. **Judging.** Only failures are judged. Each is shrunk to the smallest input and run again alone.
6. **Verifying.** Each failure ends as a bug or not a bug, and a test decides it. The failure is written as a test in the
   project's own test framework. Unless that test already starts where users call in, a second test must, and must fail
   too. Where users call in is what the package exports (Python's `__all__`, a package.json's `exports`, a Rust crate's
   `pub mod` chain, a C library's public headers, anything outside Go's `internal/`), its commands, and the handlers its
   framework calls (routes, CLI commands, listeners). A file marking a function public is not enough: a failure that only
   a direct call to an internal module reaches is not a bug. A bug gets an `issue.md` and a `pr.md`.

## Languages

| Language | Target | Engine |
|---|---|---|
| Python | Atheris `TestOneInput(data)` | Atheris |
| JavaScript, TypeScript | Jazzer.js `fuzz(data)` | Jazzer.js |
| C, C++ | `LLVMFuzzerTestOneInput` | libFuzzer, ASan/UBSan |
| Rust | cargo-fuzz `fuzz_target!` | cargo-fuzz |
| Go | `Fuzz…(f *testing.F)` | `go test -fuzz` |
| Java, Kotlin, Scala, Groovy | Jazzer `fuzzerTestOneInput` | Jazzer |
| C# | SharpFuzz `Fuzz(ReadOnlySpan<byte>)` | SharpFuzz with libFuzzer |
| Zig | `fuzz(input []const u8)` | libFuzzer |
| Swift | `@_cdecl("LLVMFuzzerTestOneInput")` | libFuzzer |
| Ruby | Ruzzy | Ruzzy |
| PHP | php-fuzzer target | php-fuzzer |
| Lua | luzer | luzer |
| Bash | `fuzz()` function | in-process mutation only |
| Solidity | Foundry `testFuzz_…` | Foundry |

A language is an adapter in `src/adapters/` that implements `src/types.ts`. The engine in `src/engine.ts` and
`src/fuzzer.ts` contains no language-specific code. Toolchains run in Docker, and each container is cut off from the
network before any target runs.

## The store

Each surface is kept in `.refuzz/<language>/<surface>/` inside the project. It is written the moment something is found:

- `targets/`: every target that built and reached the surface, one OSS-Fuzz file each.
- `corpus/`: inputs that reached new coverage, named by content hash and shared by every target.
- `dict.txt`: the surface's string literals and tokens, in libFuzzer's format.
- `coverage.json`, `surface.yaml`: lines covered, and each target's contribution.
- `findings/`: one folder per failure cause, with the judge's verdict. A confirmed one gets `issue.md` and `pr.md`.
  A `.gitignore` keeps findings out of commits, since a confirmed one can be an unfixed vulnerability.
- `rejects/`: targets that did not build, reach, or add anything, and why.
- `export/<target>/`: each target ready for OSS-Fuzz, with its `build.sh`, dictionary and corpus.

## Built on

Source analysis (methods, syntax trees and the call graph, for every language) comes from
[perch](https://github.com/lakeday-org/perch), which is MIT licensed. What the project's own tests run and check is
measured with `perch coverage`.

## License

MIT. See [LICENSE](LICENSE).
