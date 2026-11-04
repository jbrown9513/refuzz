# OSS-Fuzz's base-builder-javascript rebuilt for this machine: Node.js 24 with npm, corepack (pnpm, yarn) and Jazzer.js,
# OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables, and its compile_javascript_fuzzer command. A spec FROM
# gcr.io/oss-fuzz-base/base-builder-javascript builds on it unchanged. build.sh installs the project's dependencies into
# node_modules in its folder (npm ci, pnpm install, yarn install, as its lockfile says) and builds what must be built
# before its code runs; fuzz targets import the project's files by path from that folder. Jazzer.js is also installed at
# $JAZZER_DIR, and esbuild for TSX and JSX at $ESBUILD_DIR.
# Debian trixie: Jazzer.js's prebuilt fuzzer needs glibc 2.38.
FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libclang-rt-dev make cmake pkg-config git curl ca-certificates zip unzip rsync python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=none FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=javascript ARCHITECTURE=aarch64 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1 npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false \
    JAZZER_DIR=/usr/local/lib/jazzer ESBUILD_DIR=/usr/local/lib/esbuild
# Jazzer.js and esbuild are tools, not the project: their native parts ship prebuilt, so they install without the
# instrumented flags.
RUN corepack enable \
 && CFLAGS= CXXFLAGS= npm install --prefix $JAZZER_DIR --no-save --loglevel=error @jazzer.js/core@4 \
 && CFLAGS= CXXFLAGS= npm install --prefix $ESBUILD_DIR --no-save --loglevel=error esbuild@0.25 \
 && git config --global --add safe.directory '*'
COPY javascript/compile_javascript_fuzzer /usr/local/bin/compile_javascript_fuzzer
RUN chmod +x /usr/local/bin/compile_javascript_fuzzer && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
