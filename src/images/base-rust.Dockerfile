# OSS-Fuzz's base-builder-rust rebuilt for this machine: rustup's nightly toolchain pinned as OSS-Fuzz pins it
# (RUSTUP_TOOLCHAIN, which also makes rustup ignore a project's rust-toolchain file), with rust-src, cargo-fuzz (OSS-Fuzz's
# Rust helper command: `cargo fuzz build -O`), clang with libFuzzer and libclang for crates that generate bindings, and
# binutils' addr2line for mapping coverage guards to lines. CARGO_HOME is /rust as in OSS-Fuzz; libfuzzer-sys and arbitrary
# (with its derive), which fuzz targets build against, are fetched into its registry, so targets build offline. OSS-Fuzz's
# paths ($SRC, $OUT, $WORK) and build variables. A spec FROM gcr.io/oss-fuzz-base/base-builder-rust builds on it unchanged;
# build.sh runs `cargo fetch` (or `cargo build`) so the project's dependencies are in the image when the network is cut.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libclang-rt-14-dev libclang-dev binutils make cmake pkg-config git curl ca-certificates zip unzip jq python3 \
      build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV CARGO_HOME=/rust RUSTUP_HOME=/rust/rustup OSSFUZZ_RUSTPATH=/rust RUSTUP_TOOLCHAIN=nightly-2025-09-05 \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/rust/bin
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain=$RUSTUP_TOOLCHAIN --profile=minimal \
 && cargo install cargo-fuzz --locked && rm -rf /rust/registry \
 && rustup component add rust-src
RUN mkdir -p /tmp/prefetch/src && cd /tmp/prefetch && touch src/lib.rs \
 && printf '[package]\nname = "prefetch"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\nlibfuzzer-sys = "0.4"\narbitrary = { version = "1", features = ["derive"] }\n' > Cargo.toml \
 && cargo fetch && cd / && rm -rf /tmp/prefetch
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=rust ARCHITECTURE=aarch64
RUN mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
