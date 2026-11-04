//! The in-process driver for a Zig fuzz target, `pub fn fuzz(input: []const u8) !void`: runs it on each input on stdin
//! (u32 LE length, the bytes, handed over as they are) and answers each with one JSON line (src/session.ts's protocol).
//! Coverage is the -ffuzz build's inline 8-bit counters, read and cleared after each input; a counter's address comes from
//! the PC table, for the session to turn into a line. Only Linux system calls, so it builds on every Zig since 0.12.
//! A safety panic ends the process with its message on stderr; the session reads its stack trace from a replay of that one
//! input (`trace`). An error from std.testing's expect functions is the target's assertion failing: its message is what the
//! expect printed, and a replay dumps the error's return trace, whose innermost line of the target is the assertion.
const std = @import("std");
const linux = std.os.linux;

fn failed(r: usize) bool {
    return r > std.math.maxInt(usize) - 4096;
}

fn writeAll(fd: i32, s: []const u8) void {
    var off: usize = 0;
    while (off < s.len) {
        const r = linux.write(fd, s[off..].ptr, s.len - off);
        if (r == 0 or failed(r)) return;
        off += r;
    }
}

fn readAll(buf: []u8) bool {
    var off: usize = 0;
    while (off < buf.len) {
        const r = linux.read(0, buf[off..].ptr, buf.len - off);
        if (r == 0 or failed(r)) return false;
        off += r;
    }
    return true;
}

/// Appends `s` to `out` as a JSON string body.
fn escape(out: *Buf, s: []const u8) void {
    for (s) |c| switch (c) {
        '"' => out.add("\\\""),
        '\\' => out.add("\\\\"),
        '\n' => out.add("\\n"),
        0...9, 11...0x1f, 0x7f...0xff => {
            const hex = "0123456789abcdef";
            out.add(&[_]u8{ '\\', 'u', '0', '0', hex[c >> 4], hex[c & 15] });
        },
        else => out.add(&[_]u8{c}),
    };
}

const Buf = struct {
    data: [1 << 20]u8 = undefined,
    n: usize = 0,
    fn add(self: *Buf, s: []const u8) void {
        const k = @min(s.len, self.data.len - self.n);
        @memcpy(self.data[self.n .. self.n + k], s[0..k]);
        self.n += k;
    }
};

var line: Buf = .{};
var pcs_line: Buf = .{};
/// The input running, numbered, or 0 between inputs: the watchdog counts how long one number stays.
var busy: u32 = 0;
var generation: u32 = 0;
var ticks: u32 = 0;
var limit_ticks: u32 = 50;
var seen: [1 << 22]u8 = undefined;
/// The report stream, the real stderr, and the scratch file the target's and the project's own output goes to.
var proto: i32 = 1;
var err_fd: i32 = 2;
var scratch: i32 = -1;

/// Ends the process with a timeout report when one input runs longer than its allowance (20 ms ticks).
fn watch() void {
    var last: u32 = 0;
    while (true) {
        _ = linux.poll(undefined, 0, 20);
        const now = @atomicLoad(u32, &busy, .seq_cst);
        if (now != 0 and now == last) {
            ticks += 1;
            if (ticks > limit_ticks) {
                writeAll(proto, "{\"status\":\"timeout\",\"origin\":\"library\",\"type\":\"Timeout\"}\n");
                linux.exit_group(0);
            }
        } else ticks = 0;
        last = now;
    }
}

fn section(comptime T: type, comptime name: []const u8) []T {
    const start = @extern([*]T, .{ .name = "__start_" ++ name, .linkage = .weak }) orelse return &.{};
    const stop = @extern([*]T, .{ .name = "__stop_" ++ name, .linkage = .weak }) orelse return &.{};
    return start[0 .. (@intFromPtr(stop) - @intFromPtr(start)) / @sizeOf(T)];
}

/// While inputs stream, a panic prints only its message: the stack trace (seconds of debug-info reading per crash) comes from
/// the replay of that one input, run with `trace`.
pub var fast_panic = false;

/// The root's panic handler, where Zig has `std.debug.FullPanic` (0.14 and later).
pub fn panicFn(msg: []const u8, first_trace_addr: ?usize) noreturn {
    if (fast_panic) {
        writeAll(err_fd, "panic: ");
        writeAll(err_fd, msg);
        writeAll(err_fd, "\n");
        linux.exit_group(134);
    }
    std.debug.defaultPanic(msg, first_trace_addr);
}

/// An error std.testing's expect functions return (all of them are named Test…): the target's assertion failing.
pub fn isAssertion(err: anyerror) bool {
    return std.mem.startsWith(u8, @errorName(err), "Test");
}

/// The last line the target and the project printed during this input: what a failed expect said.
fn printed(out: *Buf) bool {
    if (scratch < 0) return false;
    var buf: [4096]u8 = undefined;
    const size = linux.lseek(scratch, 0, 1);
    if (failed(size)) return false;
    const from: usize = if (size > buf.len) size - buf.len else 0;
    const n = linux.pread(scratch, &buf, size - from, @intCast(from));
    if (failed(n)) return false;
    var end = n;
    while (end > 0 and (buf[end - 1] == ' ' or buf[end - 1] == '\r' or buf[end - 1] == '\n')) end -= 1;
    const text = buf[0..end];
    const at = if (std.mem.lastIndexOfScalar(u8, text, '\n')) |i| i + 1 else 0;
    if (at >= text.len) return false;
    escape(out, text[at..][0..@min(text.len - at, 300)]);
    return true;
}

/// The arguments, read from /proc: how std exposes them differs between Zig versions.
fn args() struct { timeout_ms: u32, trace: bool } {
    const fd = linux.open("/proc/self/cmdline", .{}, 0);
    if (failed(fd)) return .{ .timeout_ms = 1000, .trace = false };
    var buf: [4096]u8 = undefined;
    const n = linux.read(@intCast(fd), &buf, buf.len);
    if (n > buf.len) return .{ .timeout_ms = 1000, .trace = false };
    var it = std.mem.splitScalar(u8, buf[0..n], 0);
    _ = it.next();
    const ms = std.fmt.parseInt(u32, it.next() orelse "", 10) catch 1000;
    return .{ .timeout_ms = ms, .trace = std.mem.eql(u8, it.next() orelse "", "trace") };
}

/// Runs `H.fuzz` for each input on stdin until it closes. Usage: <binary> <timeout ms> [trace].
pub fn serve(comptime H: type) void {
    const a = args();
    const timeout_ms = a.timeout_ms;
    fast_panic = !a.trace;
    // Reports go out on a private copy of stdout. While inputs stream, what the target and the project print goes to a
    // scratch file; replaying, to stderr, beside the trace.
    const p = linux.dup(1);
    const e = linux.dup(2);
    if (!failed(p)) proto = @intCast(p);
    if (!failed(e)) err_fd = @intCast(e);
    const m = if (fast_panic) linux.memfd_create("refuzz-out", 0) else std.math.maxInt(usize);
    if (!failed(m)) {
        scratch = @intCast(m);
        _ = linux.dup2(scratch, 1);
        _ = linux.dup2(scratch, 2);
    } else _ = linux.dup2(2, 1);
    const counters = section(u8, "__sancov_cntrs");
    const pcs = section(usize, "__sancov_pcs1");
    // An entry of the PC table is a PC and its flags.
    const stride: usize = if (counters.len > 0 and pcs.len >= 2 * counters.len) 2 else 1;
    @memset(&seen, 0);
    limit_ticks = @max(1, timeout_ms / 20);
    _ = std.Thread.spawn(.{}, watch, .{}) catch null;
    writeAll(proto, "{\"ready\":true}\n");
    var input: []u8 = &.{};
    while (true) {
        var head: [4]u8 = undefined;
        if (!readAll(&head)) return;
        const n = std.mem.readInt(u32, &head, .little);
        // Exactly the input's length, as libFuzzer hands it over: a read past it is out of bounds.
        if (input.len > 0) std.heap.page_allocator.free(input);
        input = std.heap.page_allocator.alloc(u8, n) catch return;
        if (!readAll(input)) return;
        if (scratch >= 0) {
            _ = linux.ftruncate(scratch, 0);
            _ = linux.lseek(scratch, 0, 0);
        }
        @memset(counters, 0);
        generation = generation +% 1;
        if (generation == 0) generation = 1;
        @atomicStore(u32, &busy, generation, .seq_cst);
        const result = H.fuzz(input);
        @atomicStore(u32, &busy, 0, .seq_cst);
        line.n = 0;
        if (result) |_| {
            line.add("{\"status\":\"ok\"");
        } else |err| if (isAssertion(err)) {
            line.add("{\"status\":\"error\",\"origin\":\"assertion\",\"type\":\"assertion\",\"message\":\"");
            if (!printed(&line)) {
                line.add("error.");
                line.add(@errorName(err));
            }
            line.add("\"");
            if (!fast_panic) if (@errorReturnTrace()) |t| {
                if (comptime @hasDecl(std.debug, "dumpErrorReturnTrace")) std.debug.dumpErrorReturnTrace(t) else std.debug.dumpStackTrace(t.*);
            };
        } else {
            // An error the target let out: the project's own answer to the input, a clean rejection.
            line.add("{\"status\":\"error\",\"origin\":\"library\",\"clean\":true,\"type\":\"error.");
            line.add(@errorName(err));
            line.add("\",\"message\":\"error.");
            line.add(@errorName(err));
            line.add("\"");
        }
        line.add(",\"features\":[");
        // Every counter the input moved gives its address (its line, for the session); one moved for the first time is also
        // a new feature.
        var first = true;
        var first_pc = true;
        pcs_line.n = 0;
        for (counters, 0..) |c, i| {
            if (c == 0) continue;
            var num: [24]u8 = undefined;
            if (!first_pc) pcs_line.add(",");
            pcs_line.add(std.fmt.bufPrint(&num, "{d}", .{if (i * stride < pcs.len) pcs[i * stride] else 0}) catch "0");
            first_pc = false;
            if (i >= seen.len or seen[i] != 0) continue;
            seen[i] = 1;
            if (!first) line.add(",");
            line.add(std.fmt.bufPrint(&num, "{d}", .{i}) catch "0");
            first = false;
        }
        line.add("],\"pcs\":[");
        line.add(pcs_line.data[0..pcs_line.n]);
        line.add("]}\n");
        writeAll(proto, line.data[0..line.n]);
    }
}
