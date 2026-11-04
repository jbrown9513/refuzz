/*
 * The in-process driver for C and C++ fuzz targets, compiled on its own as C (`clang -x c`) and linked with one target: an
 * unchanged libFuzzer file that defines LLVMFuzzerTestOneInput, and maybe LLVMFuzzerInitialize. It answers src/session.ts's
 * line protocol: each input arrives as a u32 LE length and its bytes, is copied into an allocation of exactly its size (so a
 * read past it is ASan's to report, as under libFuzzer) and handed to the target as is. libFuzzer runs the same file natively.
 * Usage: <binary> <timeout ms> <the project's folder, ending in />
 */
#include <fcntl.h>
#include <setjmp.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <unistd.h>

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);
__attribute__((weak)) int LLVMFuzzerInitialize(int *argc, char ***argv);
#ifdef REFUZZ_MULTI
/* Several targets in one binary, linked once against the project's libraries: each target's entry point renamed
 * (refuzz_run_<name>, refuzz_init_<name>), listed in refuzz_targets, and the one this process runs named as its third argument. */
struct refuzz_target { const char *name; int (*run)(const uint8_t *, size_t); int (*init)(int *, char ***); };
extern const struct refuzz_target refuzz_targets[];
static int (*refuzz_run)(const uint8_t *, size_t);
#endif
void __sanitizer_set_death_callback(void (*)(void));
void __sanitizer_symbolize_pc(void *pc, const char *fmt, char *out, size_t size);

/*
 * Coverage: the library is built with -fsanitize=fuzzer-no-link, whose 8-bit edge counters and PC tables are handed to these
 * callbacks as each module loads. After each input the counters that moved for the first time are its new features, and
 * every counter that moved gives its project line: a counter's PC is symbolized the first time it moves and kept. The target
 * is compiled without counters, so its own edges are neither features nor lines.
 */
#define REFUZZ_MODULES 256
static uint8_t *refuzz_ctr[REFUZZ_MODULES], *refuzz_ctr_end[REFUZZ_MODULES], *refuzz_seen[REFUZZ_MODULES];
/* Per counter, once symbolized: its project file (relative to the project's folder) and line, or line -1 when it is not the project's. */
static char **refuzz_lpath[REFUZZ_MODULES];
static int *refuzz_lno[REFUZZ_MODULES];
static const uintptr_t *refuzz_pcs[REFUZZ_MODULES];
static int refuzz_nctr, refuzz_npcs;
void __sanitizer_cov_8bit_counters_init(uint8_t *start, uint8_t *stop) {
  if (refuzz_nctr >= REFUZZ_MODULES) return;
  refuzz_ctr[refuzz_nctr] = start;
  refuzz_ctr_end[refuzz_nctr] = stop;
  refuzz_seen[refuzz_nctr] = (uint8_t *)calloc((size_t)(stop - start) + 1, 1);
  refuzz_lpath[refuzz_nctr] = (char **)calloc((size_t)(stop - start) + 1, sizeof(char *));
  refuzz_lno[refuzz_nctr] = (int *)calloc((size_t)(stop - start) + 1, sizeof(int));
  refuzz_nctr++;
}
void __sanitizer_cov_pcs_init(const uintptr_t *start, const uintptr_t *stop) {
  (void)stop;
  if (refuzz_npcs < REFUZZ_MODULES) refuzz_pcs[refuzz_npcs++] = start;
}

static int refuzz_proto = 1, refuzz_stderr = 2, refuzz_scratch = -1;
static sigjmp_buf refuzz_jump;

static void refuzz_write(int fd, const char *s, size_t n) {
  while (n) { ssize_t w = write(fd, s, n); if (w <= 0) return; s += w; n -= (size_t)w; }
}

/* A growing JSON line. */
static char *refuzz_line;
static size_t refuzz_line_n, refuzz_line_cap;
static void refuzz_put(const char *s, size_t n) {
  if (refuzz_line_n + n + 1 > refuzz_line_cap) {
    refuzz_line_cap = (refuzz_line_n + n + 1) * 2;
    refuzz_line = (char *)realloc(refuzz_line, refuzz_line_cap);
  }
  memcpy(refuzz_line + refuzz_line_n, s, n);
  refuzz_line_n += n;
}
static void refuzz_puts(const char *s) { refuzz_put(s, strlen(s)); }

/*
 * The process is dying to a sanitizer: its report went to the scratch file (fd 2). The part that names the failure and its
 * stack, then the part that says whose memory the address was (a frame's local, a global, the stack that allocated a heap
 * block), go to the real stderr as one line, the last one LineDriver keeps. The shadow-byte map after them is left out. A
 * failed assert() prints its line before the sanitizer's report of the abort, so the line comes first and the stack is the
 * report's.
 */
static size_t refuzz_esc(char *line, size_t k, const char *from, const char *to, size_t cap) {
  size_t start = k;
  for (const char *p = from; p < to && *p && k - start < cap; p++) {
    unsigned char c = (unsigned char)*p;
    if (c == '\n') { line[k++] = '\\'; line[k++] = 'n'; }
    else if (c == '"' || c == '\\') { line[k++] = '\\'; line[k++] = (char)c; }
    else if (c >= 32 && c < 127) line[k++] = (char)c;
  }
  return k;
}
static void refuzz_died(void) {
  static char rep[65536], line[16384];
  ssize_t n = refuzz_scratch >= 0 ? pread(refuzz_scratch, rep, sizeof rep - 1, 0) : 0;
  if (n < 0) n = 0;
  rep[n] = 0;
  /* The symbolizer's own complaints (`warning: address range table … premature terminator`, from line-table-only debug
   * information) can fill the report before its stack: they are dropped. */
  {
    char *w = rep;
    for (char *r = rep; *r; ) {
      char *nl = strchr(r, '\n');
      size_t len = nl ? (size_t)(nl - r) + 1 : strlen(r);
      if (strncmp(r, "warning: ", 9) != 0) { memmove(w, r, len); w += len; }
      r += len;
    }
    *w = 0;
    n = w - rep;
  }
  const char *marks[] = {"terminate called", "Assertion", "ERROR: AddressSanitizer", "runtime error:", "ERROR: "};
  const char *from = rep;
  for (size_t m = 0; m < sizeof marks / sizeof *marks; m++) { const char *at = strstr(rep, marks[m]); if (at) { from = at; break; } }
  while (from > rep && from[-1] != '\n') from--;
  const char *end = rep + n;
  const char *report = strstr(from, "ERROR: ");
  const char *gap = strstr(report ? report : from, "\n\n");
  const char *stack_end = gap ? gap + 1 : end;
  const char *shadow = strstr(stack_end, "Shadow bytes around");
  size_t k = 0;
  memcpy(line, "@@REFUZZ_CRASH \"", 15);
  k = 15;
  k = refuzz_esc(line, k, from, stack_end, 6000);
  /* A blank line between the two, so a stack cut short still ends where a reader of the first stack stops. */
  k = refuzz_esc(line, k, "\n", "\n" + 1, 2);
  k = refuzz_esc(line, k, stack_end, shadow ? shadow : end, 6000);
  line[k++] = '"';
  line[k++] = '\n';
  refuzz_write(refuzz_stderr, line, k);
}

/* The target or the project called exit() in the middle of an input: no sanitizer reports that, so what it printed (PHP's
 * "Bailed out without a bailout address!") goes out as a crash line, with the status. A normal end (stdin closed) does not. */
static int refuzz_finished;
static void refuzz_exited(int status, void *arg) {
  (void)arg;
  if (refuzz_finished) return;
  char note[64];
  snprintf(note, sizeof note, "refuzz: the process called exit(%d)\n", status);
  if (refuzz_scratch >= 0) { off_t end = lseek(refuzz_scratch, 0, SEEK_END); if (end >= 0) pwrite(refuzz_scratch, note, strlen(note), end); }
  refuzz_died();
}

static void refuzz_alarm(int sig) { (void)sig; siglongjmp(refuzz_jump, 1); }

static int refuzz_read_full(void *buf, size_t n) {
  char *p = (char *)buf;
  while (n) { ssize_t r = read(0, p, n); if (r <= 0) return 0; p += r; n -= (size_t)r; }
  return 1;
}

/* The project's folder in the container, with its trailing slash: a counter's file under it is the project's. */
static const char *refuzz_root = "";
static size_t refuzz_root_n;

int main(int argc, char **argv) {
  long timeout_ms = argc > 1 ? atol(argv[1]) : 5000;
  if (argc > 2) { refuzz_root = argv[2]; refuzz_root_n = strlen(refuzz_root); }
  /* Protocol on the real stdout; whatever the target and the project print, on either stream, into a scratch file read on a
   * crash. */
  refuzz_proto = dup(1);
  refuzz_stderr = dup(2);
  char path[64];
  snprintf(path, sizeof path, "/tmp/refuzz-%d.out", (int)getpid());
  refuzz_scratch = open(path, O_RDWR | O_CREAT | O_TRUNC, 0600);
  unlink(path);
  dup2(refuzz_scratch, 1);
  dup2(refuzz_scratch, 2);
  __sanitizer_set_death_callback(refuzz_died);
  on_exit(refuzz_exited, 0);
  /* Once, before any input, as libFuzzer calls it; the timeout argument is the driver's, not a flag for the target. */
#ifdef REFUZZ_MULTI
  const struct refuzz_target *chosen = 0;
  for (const struct refuzz_target *t = refuzz_targets; t->name; t++) if (argc > 3 && strcmp(t->name, argv[3]) == 0) chosen = t;
  if (!chosen) { dprintf(refuzz_stderr, "no target named %s in this binary\n", argc > 3 ? argv[3] : "(none)"); return 2; }
  refuzz_run = chosen->run;
  if (chosen->init) { int one = 1; chosen->init(&one, &argv); }
#else
  if (LLVMFuzzerInitialize) { int one = 1; LLVMFuzzerInitialize(&one, &argv); }
#endif
  /* What ran before the first input (static constructors, LLVMFuzzerInitialize) is not an input's coverage: cleared, or the
   * first input's report symbolizes every counter a program's startup moved (ClickHouse's: hundreds of thousands, minutes). */
  for (int m = 0; m < refuzz_nctr; m++) memset(refuzz_ctr[m], 0, (size_t)(refuzz_ctr_end[m] - refuzz_ctr[m]));
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = refuzz_alarm;
  sigaction(SIGALRM, &sa, 0);
  refuzz_write(refuzz_proto, "{\"ready\":true}\n", 15);
  /* The first input of a process also pays for what the target sets up on its first call (ClickHouse registers its formats
   * and functions, seconds under ASan): it gets ten times the allowance, so that is not taken for the input hanging. */
  int first = 1;
  for (;;) {
    uint32_t n;
    if (!refuzz_read_full(&n, 4)) break;
    uint8_t *buf = (uint8_t *)malloc(n);
    if (!buf || !refuzz_read_full(buf, n)) break;
    if (ftruncate(refuzz_scratch, 0) == 0) lseek(refuzz_scratch, 0, SEEK_SET);
    struct itimerval on, off;
    memset(&on, 0, sizeof on);
    memset(&off, 0, sizeof off);
    long allowed = first ? timeout_ms * 10 : timeout_ms;
    first = 0;
    on.it_value.tv_sec = allowed / 1000;
    on.it_value.tv_usec = (allowed % 1000) * 1000;
    int timed_out = 0;
    if (sigsetjmp(refuzz_jump, 1) == 0) {
      setitimer(ITIMER_REAL, &on, 0);
#ifdef REFUZZ_MULTI
      refuzz_run(buf, n);
#else
      LLVMFuzzerTestOneInput(buf, n);
#endif
      setitimer(ITIMER_REAL, &off, 0);
    } else {
      timed_out = 1;
    }
    setitimer(ITIMER_REAL, &off, 0);
    /* The call is over: its time is what a hang is judged on. The report, which may symbolize much new coverage, follows. */
    if (!timed_out) refuzz_write(refuzz_proto, "{\"returned\":true}\n", 18);
    refuzz_line_n = 0;
    refuzz_puts(timed_out ? "{\"status\":\"timeout\",\"origin\":\"library\",\"type\":\"Timeout\"" : "{\"status\":\"ok\"");
    refuzz_puts(",\"features\":[");
    int first = 1;
    char num[32], where[1024];
    size_t lines_at = 0;
    static char *lines;
    static size_t lines_cap;
    for (int m = 0; m < refuzz_nctr; m++) {
      size_t count = (size_t)(refuzz_ctr_end[m] - refuzz_ctr[m]);
      for (size_t i = 0; i < count; i++) {
        if (!refuzz_ctr[m][i]) continue;
        refuzz_ctr[m][i] = 0;
        if (!refuzz_seen[m][i]) {
          refuzz_seen[m][i] = 1;
          snprintf(num, sizeof num, "%s%lu", first ? "" : ",", (unsigned long)(((size_t)m << 24) | i));
          refuzz_puts(num);
          first = 0;
          refuzz_lno[m][i] = -1;
          if (m < refuzz_npcs) {
            /* pc-table entries are (pc, flags) pairs; the symbolizer looks one instruction back from what it is given. */
#if defined(__aarch64__)
            uintptr_t pc = refuzz_pcs[m][2 * i] + 4;
#else
            uintptr_t pc = refuzz_pcs[m][2 * i] + 1;
#endif
            where[0] = 0;
            __sanitizer_symbolize_pc((void *)pc, "%s:%l", where, sizeof where);
            char *colon = strrchr(where, ':');
            /* A path under the project's folder, or one relative to it: a build that maps its folder away
             * (ClickHouse's -ffile-prefix-map=<root>/=) leaves `src/Formats/JSONUtils.cpp`. */
            const char *rel = 0;
            if (refuzz_root_n && strncmp(where, refuzz_root, refuzz_root_n) == 0) rel = where + refuzz_root_n;
            else if (where[0] && where[0] != '/' && where[0] != '?' && where[0] != '<') rel = strncmp(where, "./", 2) == 0 ? where + 2 : where;
            if (rel && colon && atoi(colon + 1) > 0) {
              *colon = 0;
              refuzz_lpath[m][i] = strdup(rel);
              refuzz_lno[m][i] = atoi(colon + 1);
            }
          }
        }
        if (refuzz_lno[m][i] <= 0) continue;
        const char *path = refuzz_lpath[m][i];
        size_t need = strlen(path) * 2 + 40;
        if (lines_at + need > lines_cap) { lines_cap = (lines_at + need) * 2; lines = (char *)realloc(lines, lines_cap); }
        lines_at += snprintf(lines + lines_at, lines_cap - lines_at, "%s[\"", lines_at ? "," : "");
        for (const char *p = path; *p; p++) {
          if (*p == '"' || *p == '\\') lines[lines_at++] = '\\';
          lines[lines_at++] = *p;
        }
        lines_at += snprintf(lines + lines_at, lines_cap - lines_at, "\",%d]", refuzz_lno[m][i]);
      }
    }
    refuzz_puts("],\"lines\":[");
    if (lines_at) refuzz_put(lines, lines_at);
    refuzz_puts("]}\n");
    refuzz_write(refuzz_proto, refuzz_line, refuzz_line_n);
    free(buf);
  }
  refuzz_finished = 1;
  return 0;
}
