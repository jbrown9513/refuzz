#!/bin/bash -eu
# OSS-Fuzz's go_utils.sh (infra/base-images/base-builder), for the libFuzzer build: compile_native_go_fuzzer and
# compile_native_go_fuzzer_v2 source it. Builds the native Go fuzz function $function in the package at $path into
# $OUT/$fuzzer with go-118-fuzz-build, linked with libFuzzer. OSS-Fuzz's coverage branch is left out: this image builds
# with SANITIZER=address only.

add_to_list_of_native_fuzzers() {
  local file="$OUT/native_go_fuzzers.json"
  [ -s "$file" ] || echo "[]" > "$file"
  jq --arg item "$1" '. += [$item]' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
}

function build_native_go_fuzzer_legacy() {
  fuzzer=$1
  function=$2
  path=$3
  tags="-tags gofuzz"
  go-118-fuzz-build $tags -o $fuzzer.a -func $function $abs_file_dir
  $CXX $CXXFLAGS $LIB_FUZZING_ENGINE $fuzzer.a -o $OUT/$fuzzer
}

function build_native_go_fuzzer() {
  fuzzer=$1
  function=$2
  tags="-tags gofuzz"
  go-118-fuzz-build_v2 $tags -o $fuzzer.a -func $function $abs_file_dir
  $CXX $CXXFLAGS $LIB_FUZZING_ENGINE $fuzzer.a -o $OUT/$fuzzer
  add_to_list_of_native_fuzzers "$fuzzer"
}
