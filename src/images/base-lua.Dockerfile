# refuzz's base-builder-lua, in the shape of OSS-Fuzz's base-builder images (OSS-Fuzz has none for Lua): Lua 5.4 with luarocks
# and a C toolchain, so a project's rocks and their C modules build; luzer, the libFuzzer engine for Lua, built with clang;
# OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables; and a compile_lua_fuzzer command in the manner of OSS-Fuzz's
# compile_* helpers. A spec FROM refuzz/base-builder-lua builds on it: its build.sh runs `luarocks make` (or the project's own
# install) so the project's modules are installed in the image's Lua tree.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends lua5.4 liblua5.4-dev luarocks gcc libc6-dev make cmake unzip zip ca-certificates curl git \
      clang llvm libclang-rt-14-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*
# luzer's rock is only on the dev server; it builds its libFuzzer bridge with clang.
RUN CC=clang CXX=clang++ luarocks --lua-version 5.4 install --dev luzer
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=lua ARCHITECTURE=aarch64
COPY lua/compile_lua_fuzzer /usr/local/bin/compile_lua_fuzzer
RUN chmod +x /usr/local/bin/compile_lua_fuzzer && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
