# Contributing

Fork the repository, make your change on a branch, and open a pull request against `main`. Nobody pushes to `main`
directly. The maintainer reviews and merges.

## Setup

You need Node 22 or later, Docker, and an `OPENAI_API_KEY` in the environment or in a `.env` file.

```sh
npm install
./bin/refuzz.mjs mangiucugna/json_repair --language python --minutes 10 --cents 100
```

## Pull requests

Keep a pull request to one change, and say in the description what it fixes and how you tested it. There is no test
suite yet, so run refuzz on a real project that exercises your change and include what happened. A title starts with a
verb and says what the change does, for example `fix: build Rust projects with their pinned toolchain`.

## Reporting a bug in refuzz

Open an issue with the command you ran, the project and commit, and the part of the log around the failure.
