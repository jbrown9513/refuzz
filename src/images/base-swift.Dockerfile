# OSS-Fuzz's base-builder-swift rebuilt for this machine: the Swift 6.3 toolchain (swiftc, SwiftPM, the clang it ships with
# libFuzzer and the sanitizers, llvm-symbolizer), OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables, and its
# precompile_swift command (`. precompile_swift` sets $SWIFTFLAGS for `swift build`). Fuzz targets are executable targets of
# packages that depend on the project's package by path, built with the container cut off from the network: build.sh
# resolves the package's dependencies (`swift package resolve`) and builds it (`swift build`), so they are in SwiftPM's cache
# and Package.resolved. A spec FROM gcr.io/oss-fuzz-base/base-builder-swift builds on it unchanged.
FROM swift:6.3
RUN apt-get update && apt-get install -y --no-install-recommends \
      make cmake pkg-config git curl wget ca-certificates zip unzip xz-utils python3 libssl-dev zlib1g-dev libsqlite3-dev \
 && rm -rf /var/lib/apt/lists/*
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=swift ARCHITECTURE=aarch64
COPY swift/precompile_swift /usr/local/bin/precompile_swift
RUN chmod +x /usr/local/bin/precompile_swift && ln -s /usr/bin/llvm-symbolizer /usr/local/bin/llvm-symbolizer-swift \
 && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
