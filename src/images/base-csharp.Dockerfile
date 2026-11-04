# refuzz's base-builder-csharp, in the shape of OSS-Fuzz's base-builder images (OSS-Fuzz has none for C#): the .NET 10 SDK
# with the 8 and 9 SDKs beside it (a project's global.json picks one), clang with libFuzzer, SharpFuzz 2.3.0 (its sharpfuzz
# instrumenter, and its package already restored) and libfuzzer-dotnet, OSS-Fuzz's paths ($SRC, $OUT, $WORK) and build
# variables, and compile_dotnet_fuzzer, which builds a SharpFuzz target against what build.sh left in $OUT. build.sh builds
# the project and publishes each library project into $OUT (`dotnet publish <lib>.csproj -c Release -o $OUT`), so $OUT holds
# the project's assemblies with their portable .pdb files (not built with ContinuousIntegrationBuild, DeterministicSourcePaths
# or a PathMap, so the symbols name the sources under $SRC) and every assembly they depend on. It builds no fuzz targets.
FROM mcr.microsoft.com/dotnet/sdk:10.0
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1 \
    NUGET_XMLDOC_MODE=skip NUGET_PACKAGES=/root/.nuget/packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libclang-rt-18-dev make cmake pkg-config git curl wget ca-certificates zip unzip jq python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
RUN curl -sSfL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
 && bash /tmp/dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet --no-path \
 && bash /tmp/dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet --no-path \
 && rm /tmp/dotnet-install.sh
# libfuzzer-dotnet reports a failed input with __builtin_trap, which is SIGTRAP on arm64, a signal libFuzzer does not catch;
# built here with abort() instead, which it catches on every architecture.
RUN curl -sSfLo /tmp/libfuzzer-dotnet.cc https://raw.githubusercontent.com/Metalnem/libfuzzer-dotnet/v2025.05.02.0904/libfuzzer-dotnet.cc \
 && sed -i 's/__builtin_trap()/abort()/' /tmp/libfuzzer-dotnet.cc \
 && clang -fsanitize=fuzzer -O2 /tmp/libfuzzer-dotnet.cc -o /usr/local/bin/libfuzzer-dotnet && rm /tmp/libfuzzer-dotnet.cc \
 && dotnet tool install SharpFuzz.CommandLine --version 2.3.0 --tool-path /usr/local/share/sharpfuzz \
 && ln -s /usr/local/share/sharpfuzz/sharpfuzz /usr/local/bin/sharpfuzz
# refuzz's line coverage (Instrument.cs) built, and SharpFuzz's package restored, so both work with the network cut.
COPY csharp/Instrument.cs csharp/Instrument.csproj /opt/refuzz/instrument-src/
RUN dotnet publish /opt/refuzz/instrument-src/Instrument.csproj -c Release -o /opt/refuzz/instrument -nologo -v quiet \
 && mkdir -p /tmp/restore && cd /tmp/restore \
 && printf '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="SharpFuzz" Version="2.3.0" /></ItemGroup></Project>' > r.csproj \
 && dotnet restore r.csproj && cd / && rm -rf /tmp/restore
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=csharp ARCHITECTURE=aarch64
COPY csharp/compile_dotnet_fuzzer /usr/local/bin/
RUN chmod +x /usr/local/bin/compile_dotnet_fuzzer && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
