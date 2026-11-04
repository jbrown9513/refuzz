# OSS-Fuzz's base-builder-go rebuilt for this machine: Go (1.27.1, as OSS-Fuzz installs it, at /root/.go with GOPATH /root/go),
# clang with libFuzzer, go114-fuzz-build (as go-fuzz) and go-118-fuzz-build for linking Go fuzz targets with libFuzzer, and
# goimports, which tidies a target's imports. OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables, and its
# compile_go_fuzzer, compile_native_go_fuzzer and compile_native_go_fuzzer_v2 commands. A spec FROM
# gcr.io/oss-fuzz-base/base-builder-go builds on it unchanged; build.sh runs `go mod download` (or `go build ./...`) so the
# module's dependencies are in the image when the network is cut.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libclang-rt-14-dev make cmake pkg-config git curl wget ca-certificates zip unzip jq python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV GOPATH=/root/go PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.go/bin:/root/go/bin
RUN mkdir -p /tmp/go && curl -sSfL "https://go.dev/dl/go1.27.1.linux-$(dpkg --print-architecture).tar.gz" | tar -C /tmp/go -xz \
 && mv /tmp/go/go /root/.go && rm -rf /tmp/go
RUN go install github.com/mdempsky/go114-fuzz-build@latest && ln -s $GOPATH/bin/go114-fuzz-build $GOPATH/bin/go-fuzz \
 && git clone -q https://github.com/AdamKorcz/go-118-fuzz-build /tmp/go-118-fuzz-build && cd /tmp/go-118-fuzz-build \
 && go build -o $GOPATH/bin/go-118-fuzz-build . \
 && git checkout -q v2 && go build -o $GOPATH/bin/go-118-fuzz-build_v2 . \
 && (cd cmd/convertLibFuzzerTestcaseToStdLibGo && go build -o $GOPATH/bin/ .) \
 && (cd cmd/addStdLibCorpusToFuzzer && go build -o $GOPATH/bin/ .) \
 && cd / && rm -rf /tmp/go-118-fuzz-build \
 && go install golang.org/x/tools/cmd/goimports@v0.51.0 \
 && go clean -cache -modcache
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=go ARCHITECTURE=aarch64
COPY go/compile_go_fuzzer go/compile_native_go_fuzzer go/compile_native_go_fuzzer_v2 go/go_utils.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/compile_go_fuzzer /usr/local/bin/compile_native_go_fuzzer /usr/local/bin/compile_native_go_fuzzer_v2 \
 && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
