# refuzz's base-builder-solidity, in the shape of OSS-Fuzz's base images (OSS-Fuzz has none for Solidity): Foundry (forge,
# cast, anvil, chisel), Node.js with npm for projects whose dependencies are npm packages, OSS-Fuzz's paths ($SRC, $OUT,
# $WORK) and build variables, and compile_solidity_fuzzer. Targets are Foundry fuzz tests compiled and run by forge in the
# project's folder with the network off, so build.sh leaves there a foundry.toml (written by build.sh for a project that
# has none: its sources folder, `libs`, its remappings) and runs `forge build` once, which fetches solc; dependencies are
# fetched by build.sh (git submodule update --init --recursive, forge install, npm ci) into lib/ or node_modules.
FROM ghcr.io/foundry-rs/foundry:latest AS foundry
FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libclang-rt-dev make cmake pkg-config git curl ca-certificates zip unzip python3 build-essential jq \
 && rm -rf /var/lib/apt/lists/*
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/cast /usr/local/bin/anvil /usr/local/bin/chisel /usr/local/bin/
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=solidity ARCHITECTURE=aarch64 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1 npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false \
    FOUNDRY_DISABLE_NIGHTLY_WARNING=1
COPY solidity/compile_solidity_fuzzer /usr/local/bin/compile_solidity_fuzzer
RUN corepack enable && chmod +x /usr/local/bin/compile_solidity_fuzzer && git config --global --add safe.directory '*' && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
