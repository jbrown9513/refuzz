# OSS-Fuzz's base-builder-python rebuilt for this machine: Python 3.11 with pip and Atheris (built with clang's libFuzzer),
# OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables, and its compile_python_fuzzer command. A spec FROM
# gcr.io/oss-fuzz-base/base-builder-python builds on it unchanged.
FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libclang-rt-14-dev make cmake pkg-config git curl ca-certificates zip unzip patchelf build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=python ARCHITECTURE=aarch64 \
    PIP_BREAK_SYSTEM_PACKAGES=1 PIP_ROOT_USER_ACTION=ignore PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
# Atheris links libFuzzer from clang; the instrumented flags are for the project's native code, not for building Atheris.
RUN CFLAGS= CXXFLAGS= CLANG_BIN=clang pip install --no-cache-dir atheris
COPY python/compile_python_fuzzer /usr/local/bin/compile_python_fuzzer
RUN chmod +x /usr/local/bin/compile_python_fuzzer && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
