# refuzz's base-builder-bash, in the shape of OSS-Fuzz's base images (OSS-Fuzz has none for Bash): Bash 5.2 with the GNU
# tools scripts are written against, OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables, and compile_bash_fuzzer.
# Bash has no fuzzing engine: targets are sourced from the project's folder and run by refuzz. build.sh installs the
# commands the project's scripts call that are not here (apt-get in the Dockerfile, or a build of the project's own tools)
# and leaves the scripts in the project's folder, where targets source them by their paths from it.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash coreutils grep sed gawk findutils diffutils jq ncurses-bin procps util-linux tini file bc \
      clang llvm libclang-rt-dev make cmake pkg-config git curl ca-certificates zip unzip build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=bash ARCHITECTURE=aarch64
COPY bash/compile_bash_fuzzer /usr/local/bin/compile_bash_fuzzer
RUN chmod +x /usr/local/bin/compile_bash_fuzzer && git config --global --add safe.directory '*' && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
