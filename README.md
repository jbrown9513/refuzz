<p align="center">
  <a href="https://github.com/jbrown9513/refuzz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/logo.svg">
      <img alt="refuzz" src=".github/logo-light.svg" width="300">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://cerebralvalley.ai/e/meta-ai-developer-hackathon"><img alt="Meta Global AI Developer Hackathon 2026 submission" src="https://img.shields.io/badge/Meta%20Global%20AI%20Developer%20Hackathon-2026%20submission-0866ff?labelColor=1a1d26"></a>
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
  <a href="#how-it-works">how it works</a>
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

## How it works

refuzz does the job of a fuzzing engineer.

1. **Build.** The first step is getting the project to build. If the project is in OSS-Fuzz, refuzz starts from that
   build. Otherwise the model reads the project's CI configuration and writes a Dockerfile and build script. Either way
   it rewrites them from each error until they work, and later runs reuse that setup.
2. **Surfaces.** refuzz uses [perch](https://github.com/lakeday-org/perch), a semantic code scanner, to build a call
   graph that finds the entry points into the codebase: requests, files, sockets, deserializers and public functions.
   Entry points that reach the same code are grouped into one surface.
3. **Harnesses.** The model reads each surface's code and the project's own tests, then writes a harness that turns the
   fuzzer's raw bytes into the inputs that code expects.
4. **Coverage.** perch shows which code the project's own tests leave unchecked, and refuzz fuzzes that code first. When
   coverage stops growing, the model looks at what was missed and writes a new harness to reach it.
5. **Judging.** refuzz runs each failure again alone and drops any that don't repeat. Failures with the same cause become
   one finding with the smallest input. The model checks failed assertions against the project's documentation.
6. **Verification.** The model writes each failure as a test in the project's own test framework. If that test doesn't
   start where users call in, a second test must start there and fail too. A failure only reachable by calling an
   internal module directly is not a bug.
7. **Reporting.** The model writes an issue and a draft pull request for each confirmed bug.
8. **Repeat.** Harnesses, inputs, coverage and rejected attempts are saved in the project's `.refuzz` folder. The next
   run picks up where the last one stopped.

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

Each surface is kept in `.refuzz/<language>/<surface>/` inside the project:

- `targets/`: every target that built and reached the surface, one OSS-Fuzz file each.
- `corpus/`: inputs that reached new coverage, named by content hash and shared by every target.
- `dict.txt`: the surface's string literals and tokens, in libFuzzer's format.
- `coverage.json`, `surface.yaml`: lines covered, and each target's contribution.
- `findings/`: one folder per failure cause, with the judge's verdict. A confirmed one gets `issue.md` and `pr.md`.
  A `.gitignore` keeps findings out of commits, since a confirmed one can be an unfixed vulnerability.
- `rejects/`: targets that did not build, reach, or add anything, and why.
- `export/<target>/`: each target ready for OSS-Fuzz, with its `build.sh`, dictionary and corpus.

## Built on

Source analysis (methods, syntax## Built on

[perch](https://github.com/lakeday-org/perch) (MIT) does the source analysis and test coverage.

