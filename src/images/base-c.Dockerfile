# OSS-Fuzz's base-builder rebuilt for this machine: clang with libFuzzer and its sanitizers, llvm's tools (llvm-symbolizer
# for sanitizer stacks), and the build systems C and C++ projects use (make, CMake, Meson and Ninja, autotools, pkg-config,
# bison and flex), with OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables. Fuzz targets link the static libraries
# (lib*.a) the build leaves in the project's folder, $WORK or /usr/local/lib, with the headers where the build puts them, so
# build.sh builds the library static with $CC/$CXX and $CFLAGS/$CXXFLAGS. CMake writes compile_commands.json when it
# configures. A spec FROM gcr.io/oss-fuzz-base/base-builder builds on it unchanged.
# Clang is LLVM's own release 21 (apt.llvm.org), as OSS-Fuzz's image tracks a recent clang: projects that require it
# (ClickHouse's minimum is 21) build here as there. `clang`, `clang++`, `lld` and the llvm tools name it.
FROM debian:trixie-slim
ARG LLVM=21
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /usr/share/keyrings/llvm.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/llvm.gpg] http://apt.llvm.org/trixie/ llvm-toolchain-trixie-$LLVM main" > /etc/apt/sources.list.d/llvm.list \
 && apt-get update && apt-get install -y --no-install-recommends \
      clang-$LLVM llvm-$LLVM lld-$LLVM libclang-rt-$LLVM-dev g++ make cmake meson ninja-build autoconf automake autotools-dev libtool pkg-config \
      bison flex gettext patch file python3 python3-pip git wget zip unzip xz-utils zlib1g-dev ccache \
 && for t in clang clang++ clang-cpp ld.lld lld llvm-ar llvm-nm llvm-ranlib llvm-objcopy llvm-strip llvm-symbolizer llvm-profdata llvm-cov llvm-config; do \
      [ -e /usr/bin/$t-$LLVM ] && ln -sf /usr/bin/$t-$LLVM /usr/bin/$t; done \
 && rm -rf /var/lib/apt/lists/*
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    SANITIZER_FLAGS="-fsanitize=address -fsanitize-address-use-after-scope" COVERAGE_FLAGS="-fsanitize=fuzzer-no-link" \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=c++ ARCHITECTURE=aarch64 \
    CMAKE_EXPORT_COMPILE_COMMANDS=ON PIP_BREAK_SYSTEM_PACKAGES=1 PIP_ROOT_USER_ACTION=ignore
RUN mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
