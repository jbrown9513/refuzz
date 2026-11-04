# OSS-Fuzz's base-builder-ruby rebuilt for this machine: Ruby 3.3 with clang, Ruzzy (the libFuzzer engine for Ruby, built with
# clang and installed in /install/ruzzy), OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build variables, gems installed into
# $OUT/fuzz-gem (GEM_HOME) with Ruzzy on GEM_PATH, and its ruzzy-build command. A spec FROM
# gcr.io/oss-fuzz-base/base-builder-ruby builds on it unchanged: `gem build`, `bundle install` and `gem install` put the
# project and its gems in $GEM_HOME, and native extensions build with $CC and the instrumented flags. MAKE is set, as in
# OSS-Fuzz, to `make --environment-overrides`, so $CFLAGS replaces the flags an extension's Makefile sets, include paths with
# them: dependency gems whose extensions need their own flags install first with `MAKE=make CFLAGS= CXXFLAGS=` (bundle install
# or gem install --ignore-dependencies of the rest), and only the project's own extensions build instrumented.
FROM ruby:3.3-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libclang-rt-14-dev make cmake pkg-config git curl ca-certificates zip unzip rsync build-essential \
      binutils xz-utils libyaml-dev libffi-dev zlib1g-dev libssl-dev \
 && rm -rf /var/lib/apt/lists/*
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=ruby ARCHITECTURE=aarch64 \
    BUNDLE_SILENCE_ROOT_WARNING=1
RUN mkdir -p $SRC $OUT $WORK && git clone --depth 1 https://github.com/trailofbits/ruzzy.git $SRC/ruzzy
WORKDIR $SRC/ruzzy
# The MAKE variable makes a Ruby C extension's build respect CC, CFLAGS and the rest from the environment.
ENV MAKE="make --environment-overrides V=1"
RUN CFLAGS= CXXFLAGS= CC=clang CXX=clang++ LDSHARED="clang -shared" LDSHAREDXX="clang++ -shared" gem build \
 && CC=clang CXX=clang++ LDSHARED="clang -shared" LDSHAREDXX="clang++ -shared" CFLAGS="-fPIC" CXXFLAGS="-fPIC" \
    RUZZY_DEBUG=1 gem install --install-dir /install/ruzzy --development ruzzy-*.gem
ENV LDSHARED="clang -shared" LDSHAREDXX="clang++ -shared" \
    GEM_HOME=/out/fuzz-gem GEM_PATH=/install/ruzzy \
    PATH=/out/fuzz-gem/bin:/install/ruzzy/bin:$PATH
COPY ruby/ruzzy-build /usr/bin/ruzzy-build
COPY ruby/ruzzy /usr/local/bin/ruzzy
RUN chmod +x /usr/bin/ruzzy-build /usr/local/bin/ruzzy
WORKDIR $SRC
