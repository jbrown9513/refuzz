/*
 * Coverage, a time limit and the call into the target for Swift fuzz targets' sessions (src/probes/swift_serve.swift). The
 * Swift code is built with SanitizerCoverage's trace-pc-guard; these are its callbacks. Each guard is numbered once and
 * stamped with the input that last ran it, so each input reports every guard it ran, once, with the address it ran at. The
 * watchdog ends the process, after writing a timeout report, when one input runs past its allowance: a call cannot be
 * interrupted in Swift.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <ucontext.h>
#include <unistd.h>

static uint32_t guards;
static uint32_t stamp[1 << 22];
static uint32_t input_no = 1;
static uint32_t fresh_ids[1 << 16];
static uintptr_t fresh_pcs[1 << 16];
static size_t fresh_n;
static uintptr_t base;

void __sanitizer_cov_trace_pc_guard_init(uint32_t *start, uint32_t *stop) {
  if (start == stop || *start) return;
  for (uint32_t *g = start; g < stop; g++) *g = ++guards;
}

void __sanitizer_cov_trace_pc_guard(uint32_t *guard) {
  uint32_t id = *guard;
  if (!id || id >= sizeof stamp / sizeof *stamp || stamp[id] == input_no) return;
  stamp[id] = input_no;
  if (fresh_n < sizeof fresh_ids / sizeof *fresh_ids) {
    fresh_ids[fresh_n] = id;
    fresh_pcs[fresh_n] = (uintptr_t)__builtin_return_address(0);
    fresh_n++;
  }
}

/** Guards run since the last call, once each, as ids and as addresses relative to the executable (for llvm-symbolizer). */
size_t refuzz_cov_take(uint32_t *ids, uintptr_t *pcs, size_t max) {
  if (!base) {
    Dl_info info;
    if (dladdr((void *)&refuzz_cov_take, &info)) base = (uintptr_t)info.dli_fbase;
  }
  size_t n = fresh_n < max ? fresh_n : max;
  for (size_t i = 0; i < n; i++) { ids[i] = fresh_ids[i]; pcs[i] = fresh_pcs[i] - base; }
  fresh_n = 0;
  input_no++;
  return n;
}

static volatile int64_t started_ms;
static int64_t limit_ms;
static int report_fd;

static int64_t now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static void *watch(void *unused) {
  (void)unused;
  for (;;) {
    usleep(20000);
    int64_t s = started_ms;
    if (s && now_ms() - s > limit_ms) {
      const char *line = "{\"status\":\"timeout\",\"origin\":\"library\",\"type\":\"Timeout\"}\n";
      (void)!write(report_fd, line, strlen(line));
      _exit(0);
    }
  }
  return 0;
}

/*
 * A trap (a failed precondition, a force unwrap of nil, an index out of range) prints the runtime's message and stack, the
 * same last lines for every trap in a target: the trap's own address, relative to the executable, goes last, so the session
 * tells one trap from another without replaying each.
 */
static void refuzz_trap(int sig, siginfo_t *info, void *context) {
  (void)info;
  ucontext_t *uc = (ucontext_t *)context;
#if defined(__aarch64__)
  uintptr_t pc = (uintptr_t)uc->uc_mcontext.pc;
#else
  uintptr_t pc = (uintptr_t)uc->uc_mcontext.gregs[REG_RIP];
#endif
  char line[64];
  int n = snprintf(line, sizeof line, "refuzz: trap at %lx\n", (unsigned long)(pc - base));
  (void)!write(2, line, (size_t)n);
  signal(sig, SIG_DFL);
  raise(sig);
}

void refuzz_watch_start(int64_t ms, int fd) {
  limit_ms = ms;
  report_fd = fd;
  Dl_info info;
  if (dladdr((void *)&refuzz_watch_start, &info)) base = (uintptr_t)info.dli_fbase;
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_sigaction = refuzz_trap;
  sa.sa_flags = SA_SIGINFO;
  sigaction(SIGTRAP, &sa, 0);
  sigaction(SIGILL, &sa, 0);
  pthread_t t;
  pthread_create(&t, 0, watch, 0);
}

/* The target's entry point, which its `@_cdecl("LLVMFuzzerTestOneInput")` function defines: Swift calls it through here. */
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);
int refuzz_test_one(const uint8_t *data, size_t size) { return LLVMFuzzerTestOneInput(data, size); }

void refuzz_input_begin(void) { started_ms = now_ms(); }
void refuzz_input_end(void) { started_ms = 0; }
