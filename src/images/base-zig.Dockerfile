# refuzz's base-builder for Zig, which OSS-Fuzz does not have, in the shape of OSS-Fuzz's: clang with libFuzzer and its
# sanitizers, llvm's tools and binutils (addr2line), OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables, and Zig on
# PATH (/usr/local/zig), the newest release. A project that needs another Zig installs it in its Dockerfile with
# `RUN install_zig <version>`, the version its build.zig.zon's minimum_zig_version names (a release such as 0.14.1, a minor
# version such as 0.14 for its newest release, or master); it replaces the one on PATH. build.sh runs `zig build` (which
# fetches the dependencies build.zig.zon names into Zig's global cache) with the container online; fuzz targets are files at
# the project's root, built with `zig build-exe`/`zig build-obj -ffuzz` and linked by $CC with $LIB_FUZZING_ENGINE.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm lld libclang-rt-dev binutils make cmake pkg-config git curl wget ca-certificates xz-utils zip unzip python3 \
 && rm -rf /var/lib/apt/lists/*
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=zig ARCHITECTURE=aarch64 \
    ZIG_GLOBAL_CACHE_DIR=/root/.cache/zig PATH=/usr/local/zig:$PATH
COPY zig/install_zig /usr/local/bin/install_zig
RUN chmod +x /usr/local/bin/install_zig && install_zig latest && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
