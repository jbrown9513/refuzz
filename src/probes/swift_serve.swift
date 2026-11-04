/*
 * The main file of a Swift fuzz target's session: runs the target's LLVMFuzzerTestOneInput (through refuzz_test_one, in
 * src/probes/swift_cov.c) on each input on stdin (u32 LE length, the bytes, handed over as they are) and answers each with
 * one JSON line (src/session.ts's protocol). Coverage is the SanitizerCoverage guards the input ran (swift_cov.c). A trap
 * ends the process; the session replays that input with `--once <file>` to read its backtrace.
 * Usage: <binary> <timeout ms> | <binary> --once <input file>
 */
import RefuzzCov
#if canImport(Glibc)
import Glibc
#endif

func refuzzReadAll(_ f: UnsafeMutablePointer<FILE>, _ n: Int) -> [UInt8]? {
    var buf = [UInt8](repeating: 0, count: n)
    var got = 0
    while got < n {
        let r = buf.withUnsafeMutableBytes { fread($0.baseAddress! + got, 1, n - got, f) }
        if r <= 0 { return nil }
        got += r
    }
    return buf
}

/// Runs the target on a copy of the bytes in an allocation of exactly their size, so a read past them is ASan's to report.
func refuzzRun(_ bytes: [UInt8]) {
    let p = UnsafeMutablePointer<UInt8>.allocate(capacity: bytes.count)
    defer { p.deallocate() }
    p.initialize(from: bytes, count: bytes.count)
    _ = refuzz_test_one(p, bytes.count)
}

let refuzzArgs = CommandLine.arguments
if refuzzArgs.count > 2 && refuzzArgs[1] == "--once" {
    guard let f = fopen(refuzzArgs[2], "rb") else { exit(2) }
    var bytes: [UInt8] = []
    var c = fgetc(f)
    while c != EOF { bytes.append(UInt8(c)); c = fgetc(f) }
    refuzzRun(bytes)
    exit(0)
}

// Reports go to a private copy of stdout; what the target and the project print goes to stderr.
let refuzzOut = fdopen(dup(1), "w")!
dup2(2, 1)
refuzz_watch_start(Int64(refuzzArgs.count > 1 ? Int(refuzzArgs[1]) ?? 1000 : 1000), fileno(refuzzOut))
fputs("{\"ready\":true}\n", refuzzOut)
fflush(refuzzOut)
var refuzzIds = [UInt32](repeating: 0, count: 1 << 16)
var refuzzPcs = [UInt](repeating: 0, count: 1 << 16)
_ = refuzz_cov_take(&refuzzIds, &refuzzPcs, refuzzIds.count)
while let head = refuzzReadAll(stdin, 4) {
    let n = Int(head[0]) | Int(head[1]) << 8 | Int(head[2]) << 16 | Int(head[3]) << 24
    guard let input = refuzzReadAll(stdin, n) else { break }
    refuzz_input_begin()
    refuzzRun(input)
    refuzz_input_end()
    let k = refuzz_cov_take(&refuzzIds, &refuzzPcs, refuzzIds.count)
    let line = "{\"status\":\"ok\",\"features\":[" + refuzzIds[0..<k].map { String($0) }.joined(separator: ",") + "],\"pcs\":[" + refuzzPcs[0..<k].map { String($0) }.joined(separator: ",") + "]}\n"
    fputs(line, refuzzOut)
    fflush(refuzzOut)
}
