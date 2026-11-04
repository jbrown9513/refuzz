// Package refuzz runs a Go fuzz target, `func FuzzXxx(f *testing.F)` exactly as OSS-Fuzz builds it, in this process for
// many inputs (src/session.ts's protocol): inputs on stdin as a u32 LE length and the raw bytes, one JSON line per input on
// the original stdout.
//
// The target runs under the testing package's own fuzz worker: Serve starts a testing.M whose dependencies are this
// package's, with -test.fuzz naming the target and -test.fuzzworker set, so f.Fuzz hands its callback to RunFuzzWorker here
// and each input is one call of it, with a fresh *testing.T, t.Fatal, t.Skip and cleanups as `go test -fuzz` gives them.
// Coverage comes from the test binary's own coverage counters (built with -cover -covermode=count -coverpkg=<the
// project's packages>), read in place after each input: a counter that moved is a feature (its index and how far it moved,
// in AFL's buckets), and a counter that moved off zero names the lines of its block.
package refuzz

import (
	"strconv"
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

type counterBlob struct {
	counters *uint32
	len      uint64
}

type metaBlob struct {
	p                  *byte
	len                uint32
	hash               [16]byte
	pkgPath            string
	pkgID              int
	counterMode        uint8
	counterGranularity uint8
}

// The runtime's lists of coverage counters and metadata, as runtime/coverage reads them. Needs -ldflags=-checklinkname=0.
//
//go:linkname covCounterList internal/coverage/cfile.getCovCounterList
func covCounterList() []counterBlob

//go:linkname covMeta internal/coverage/rtcov.Meta
var covMeta struct {
	list   []metaBlob
	pkgMap map[int]int
	glitch bool
}

type frame struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Name string `json:"name"`
}

type report struct {
	Status   string          `json:"status"`
	Origin   string          `json:"origin,omitempty"`
	Type     string          `json:"type,omitempty"`
	Message  string          `json:"message,omitempty"`
	Clean    *bool           `json:"clean,omitempty"`
	Frames   []frame         `json:"frames,omitempty"`
	Features []uint64        `json:"features"`
	Lines    [][]interface{} `json:"lines"`
}

var (
	root    = os.Getenv("REFUZZ_ROOT")
	gen     = os.Getenv("REFUZZ_GEN")
	target  = os.Getenv("REFUZZ_TARGET")
	modPath = os.Getenv("REFUZZ_MODULE")
	modDir  = os.Getenv("REFUZZ_MODDIR")
	shadow  [][]uint32
	seen    = map[uint64]bool{}
	funcs   = map[[2]uint32]funcDesc{}
	metas   = map[uint32]*metaReader{}
)

// The testing package's corpus entry, which its fuzz worker callback takes: an alias of this same unnamed struct there.
type corpusEntry = struct {
	Parent     string
	Path       string
	Data       []byte
	Values     []interface{}
	Generation int
	IsSeed     bool
}

// Serve runs the fuzz target name, whose function is fuzz, on each input from stdin until stdin closes, then exits.
func Serve(name string, fuzz func(*testing.F)) {
	// What the target and the project print must not land in the report stream.
	fd, err := syscall.Dup(1)
	if err != nil {
		fmt.Printf("{\"fatal\":%q}\n", err.Error())
		return
	}
	out := bufio.NewWriter(os.NewFile(uintptr(fd), "reports"))
	syscall.Dup3(2, 1, 0)
	// The inputs arrive on a private copy of stdin; the project's own stdin is /dev/null, so code that reads it (a CLI's
	// prompt, io.ReadAll(os.Stdin)) gets end of file instead of the next input.
	inFd, err := syscall.Dup(0)
	if err != nil {
		fmt.Fprintf(out, "{\"fatal\":%q}\n", err.Error())
		out.Flush()
		return
	}
	if null, err := os.Open(os.DevNull); err == nil {
		syscall.Dup3(int(null.Fd()), 0, 0)
		null.Close()
	}
	d := &worker{out: out, in: bufio.NewReader(os.NewFile(uintptr(inFd), "inputs"))}
	for k, v := range map[string]string{"test.fuzz": "^" + regexp.QuoteMeta(name) + "$", "test.fuzzworker": "true", "test.fuzzcachedir": os.TempDir()} {
		if err := flag.Set(k, v); err != nil {
			fmt.Fprintf(out, "{\"fatal\":%q}\n", "testing flag "+k+": "+err.Error())
			out.Flush()
			os.Exit(0)
		}
	}
	testing.MainStart(d, nil, nil, []testing.InternalFuzzTarget{{Name: name, Fn: fuzz}}, nil).Run()
	if !d.ready {
		// In a worker the testing package discards what F printed: f.Fatal, f.Skip or f.Fail before f.Fuzz ended it.
		fmt.Fprintf(out, "{\"fatal\":%q}\n", name+" ended before it called f.Fuzz: an f.Fatal, f.Skip or f.Fail in its body, or f.Fuzz given a function it rejects")
	}
	out.Flush()
	os.Exit(0)
}

// worker is the testing package's dependencies (its unexported testDeps interface, as of the toolchain in the container)
// with the fuzz worker's half replaced: RunFuzzWorker is the input loop, and the coverage hooks f.Fuzz calls around each
// input read a panic before the testing package turns it into t.Errorf text.
type worker struct {
	out     *bufio.Writer
	in      *bufio.Reader
	ready   bool
	failure *report
}

func (*worker) ImportPath() string                                       { return "" }
func (*worker) ModulePath() string                                       { return "" }
func (*worker) MatchString(pat, str string) (bool, error)                { return regexp.MatchString(pat, str) }
func (*worker) SetPanicOnExit0(bool)                                     {}
func (*worker) StartCPUProfile(io.Writer) error                          { return nil }
func (*worker) StopCPUProfile()                                          {}
func (*worker) StartTestLog(io.Writer)                                   {}
func (*worker) StopTestLog() error                                       { return nil }
func (*worker) WriteProfileTo(string, io.Writer, int) error              { return nil }
func (*worker) ReadCorpus(string, []reflect.Type) ([]corpusEntry, error) { return nil, nil }
func (*worker) CheckCorpus([]interface{}, []reflect.Type) error          { return nil }
func (*worker) InitRuntimeCoverage() (string, func(string, string) (string, error), func() float64) {
	return "", nil, nil
}
func (*worker) CoordinateFuzzing(time.Duration, int64, time.Duration, int64, int, []corpusEntry, []reflect.Type, string, string) error {
	return errors.New("refuzz: this process is a fuzz worker only")
}

// ResetCoverage runs as each input starts, inside the target's goroutine.
func (w *worker) ResetCoverage() { w.failure = nil }

// SnapshotCoverage is deferred around each call of the target's callback, so it runs while a panic unwinds: it reads the
// panic with its stack and panics again with the same value, which the testing package then reports as a failed input.
func (w *worker) SnapshotCoverage() {
	if p := recover(); p != nil {
		r := failure(p)
		w.failure = &r
		panic(p)
	}
}

// RunFuzzWorker calls run with each input from stdin, as a fuzz worker calls it with the coordinator's: what it returns is
// the failure text of the input's *testing.T.
func (w *worker) RunFuzzWorker(run func(corpusEntry) error) error {
	diff() // what package initialization and the target's own setup ran is not any input's
	w.ready = true
	w.out.WriteString("{\"ready\":true}\n")
	w.out.Flush()
	// A target that hangs is reported by the session, which then drops this process; this only makes sure it ends.
	watchdog := time.AfterFunc(time.Hour, func() { os.Exit(3) })
	head := make([]byte, 4)
	enc := json.NewEncoder(w.out)
	for {
		if _, err := io.ReadFull(w.in, head); err != nil {
			return nil
		}
		buf := make([]byte, binary.LittleEndian.Uint32(head))
		if _, err := io.ReadFull(w.in, buf); err != nil {
			return nil
		}
		watchdog.Reset(2 * time.Minute)
		w.failure = nil
		err := run(corpusEntry{Data: buf, Values: []interface{}{buf}})
		r := report{Status: "ok"}
		if w.failure != nil {
			r = *w.failure
		} else if err != nil {
			r = assertion(err.Error())
		}
		r.Features, r.Lines = diff()
		enc.Encode(r)
		w.out.Flush()
	}
}

var logged = regexp.MustCompile(`^\s+([\w.-]+\.go):(\d+): (.*)$`)

// assertion reads a failed input's text with no panic in it: t.Error, t.Fatal and their f-forms, which the target (or a
// helper it called) makes about the result. The messages, without the testing package's FAIL line and file:line prefixes.
func assertion(text string) report {
	var msgs []string
	// The first logged line's file and line, as a frame named `target`: the engine keys the assertion by its line, not by
	// its message, which carries the values compared.
	var frames []frame
	for _, l := range strings.Split(text, "\n") {
		if m := logged.FindStringSubmatch(l); m != nil {
			msgs = append(msgs, m[3])
			if frames == nil {
				n, _ := strconv.Atoi(m[2])
				frames = []frame{{Path: m[1], Line: n, Name: "target"}}
			}
		} else if len(msgs) > 0 && strings.HasPrefix(l, "        ") {
			msgs[len(msgs)-1] += "\n" + strings.TrimSpace(l)
		}
	}
	msg := strings.Join(msgs, "\n")
	if msg == "" {
		msg = strings.TrimSpace(text)
	}
	if len(msg) > 400 {
		msg = msg[:400]
	}
	return report{Status: "error", Origin: "assertion", Type: "assertion", Message: msg, Frames: frames}
}

// failure reads a recovered panic: whose code raised it, by its innermost frame, and the project's frames, innermost last. A
// panic on a line of the target file is the target's assertion, unless the runtime raised it there (a nil dereference, an
// index out of range in the target's own slicing), which is the target being wrong.
func failure(p interface{}) report {
	pcs := make([]uintptr, 100)
	n := runtime.Callers(1, pcs)
	frames := runtime.CallersFrames(pcs[:n])
	var all []runtime.Frame
	for {
		f, more := frames.Next()
		all = append(all, f)
		if !more {
			break
		}
	}
	// From where it panicked outwards: after the panic call, past the runtime's own frames.
	from := 0
	for i, f := range all {
		if f.Function == "runtime.gopanic" {
			from = i + 1
			break
		}
	}
	site := all[from:]
	for len(site) > 0 && strings.HasPrefix(site[0].Function, "runtime.") {
		site = site[1:]
	}
	ours := func(f runtime.Frame) bool {
		return gen != "" && strings.HasPrefix(f.File, gen+"/") || strings.Contains(filepath.Base(f.File), "refuzzserve_")
	}
	project := func(f runtime.Frame) bool {
		return strings.HasPrefix(f.File, root+"/") && !ours(f) && !strings.HasSuffix(f.File, "_test.go") && !strings.Contains(f.File, "/vendor/")
	}
	var mine []frame
	for i := len(site) - 1; i >= 0; i-- {
		if project(site[i]) {
			mine = append(mine, frame{Path: strings.TrimPrefix(site[i].File, root+"/"), Line: site[i].Line, Name: shortName(site[i].Function)})
		}
	}
	typ := fmt.Sprintf("%T", p)
	if typ == "string" {
		typ = "panic"
	}
	msg := fmt.Sprint(p)
	if len(msg) > 400 {
		msg = msg[:400]
	}
	_, broke := p.(runtime.Error)
	if len(site) > 0 && site[0].File == target {
		if !broke {
			return report{Status: "error", Origin: "assertion", Type: "assertion", Message: msg}
		}
		return report{Status: "error", Origin: "setup", Type: typ, Message: fmt.Sprintf("%s (target line %d)", msg, site[0].Line)}
	}
	clean := deliberate(p, mine)
	// Raised by our own code, or by the standard library called straight from the target: the target is wrong.
	if len(site) == 0 || ours(site[0]) || len(mine) == 0 {
		for _, f := range site {
			if f.File == target {
				msg = fmt.Sprintf("%s (target line %d)", msg, f.Line)
				break
			}
		}
		return report{Status: "error", Origin: "setup", Type: typ, Message: msg, Clean: &clean}
	}
	return report{Status: "error", Origin: "library", Type: typ, Message: msg, Clean: &clean, Frames: mine}
}

// deliberate says whether a panic is a clean rejection of the input. Go rejects input by returning an error, which the
// target handles; a panic is a rejection only when the project raised it on purpose: an error value panicked with (a Must
// function's parse error, a project's own error type) or an OS error on a path. A runtime error (nil dereference, index out
// of range, a failed type assertion, division by zero) never is, nor is a bare string panic outside a Must function, which
// is how Go code says an invariant broke.
func deliberate(p interface{}, mine []frame) bool {
	if _, ok := p.(runtime.Error); ok {
		return false
	}
	if _, ok := p.(error); ok {
		return true
	}
	if len(mine) > 0 {
		name := mine[len(mine)-1].Name
		if i := strings.LastIndex(name, "."); i >= 0 {
			name = name[i+1:]
		}
		return strings.HasPrefix(name, "Must")
	}
	return false
}

// `github.com/x/y/pkg.(*Parser).parse` → `Parser.parse`.
func shortName(fn string) string {
	if i := strings.LastIndex(fn, "/"); i >= 0 {
		fn = fn[i+1:]
	}
	if i := strings.Index(fn, "."); i >= 0 {
		fn = fn[i+1:]
	}
	return strings.NewReplacer("(*", "", "(", "", ")", "").Replace(fn)
}

// AFL's hit-count buckets: a loop running 5 times and 6 times is the same feature, 1 and 2 times are not.
func bucket(d uint32) uint64 {
	switch {
	case d <= 3:
		return uint64(d)
	case d <= 7:
		return 4
	case d <= 15:
		return 5
	case d <= 31:
		return 6
	case d <= 127:
		return 7
	}
	return 8
}

// diff compares the counters with their last reading: the new features, and the lines of every block this input ran.
func diff() ([]uint64, [][]interface{}) {
	features := []uint64{}
	lines := [][]interface{}{}
	for bi, b := range covCounterList() {
		// Not unsafe.Slice: the driver is compiled inside the project's module, whose go directive may be older than 1.17.
		live := (*[1 << 28]uint32)(unsafe.Pointer(b.counters))[:int(b.len):int(b.len)]
		for len(shadow) <= bi {
			shadow = append(shadow, nil)
		}
		if len(shadow[bi]) != len(live) {
			shadow[bi] = make([]uint32, len(live))
		}
		sh := shadow[bi]
		// Laid out per function as it first runs: counter count, package id, function id, then one counter per block.
		for i := 0; i+3 <= len(live); {
			if live[i] == 0 {
				i++
				continue
			}
			n, pkg, fn, first := int(live[i]), live[i+1], live[i+2], i+3
			if first+n > len(live) {
				break
			}
			for j := 0; j < n; j++ {
				c, o := live[first+j], sh[first+j]
				if c == o {
					continue
				}
				id := uint64(bi)<<40 | uint64(first+j)<<8 | bucket(c-o)
				if !seen[id] {
					seen[id] = true
					features = append(features, id)
				}
				lines = append(lines, blockLines(pkg, fn, j)...)
				sh[first+j] = c
			}
			i = first + n
		}
	}
	return features, lines
}

type unit struct{ start, end uint32 }

type funcDesc struct {
	file  string
	units []unit
}

// blockLines are the lines of one coverage block, as [path, line].
func blockLines(pkg, fn uint32, j int) [][]interface{} {
	if int32(pkg) <= 0 {
		return nil
	}
	f, ok := funcs[[2]uint32{pkg, fn}]
	if !ok {
		f = readFunc(pkg-1, fn)
		funcs[[2]uint32{pkg, fn}] = f
	}
	if j >= len(f.units) || f.file == "" {
		return nil
	}
	var out [][]interface{}
	for l := f.units[j].start; l <= f.units[j].end && l < f.units[j].start+500; l++ {
		out = append(out, []interface{}{f.file, l})
	}
	return out
}

// The coverage metadata of one package (internal/coverage/decodemeta's layout): a 44-byte header, a u32 offset per
// function, a string table, and per function its unit count, name, file and units as ULEB128.
type metaReader struct {
	b       []byte
	numFunc uint32
	strs    []string
}

func uleb(b []byte, at *int) uint32 {
	var v uint64
	for shift := 0; *at < len(b) && shift < 64; shift += 7 {
		c := b[*at]
		*at++
		v |= uint64(c&0x7f) << uint(shift) // an unsigned count: signed shift counts need go1.13
		if c&0x80 == 0 {
			break
		}
	}
	return uint32(v)
}

func readFunc(slot, fn uint32) (out funcDesc) {
	defer func() { recover() }()
	m := metas[slot]
	if m == nil {
		if int(slot) >= len(covMeta.list) {
			return
		}
		blob := covMeta.list[slot]
		m = &metaReader{b: (*[1 << 30]byte)(unsafe.Pointer(blob.p))[:int(blob.len):int(blob.len)]}
		m.numFunc = binary.LittleEndian.Uint32(m.b[40:])
		at := 44 + 4*int(m.numFunc)
		n := uleb(m.b, &at)
		for k := uint32(0); k < n; k++ {
			l := int(uleb(m.b, &at))
			m.strs = append(m.strs, string(m.b[at:at+l]))
			at += l
		}
		metas[slot] = m
	}
	if fn >= m.numFunc {
		return
	}
	at := int(binary.LittleEndian.Uint32(m.b[44+4*fn:]))
	units := uleb(m.b, &at)
	uleb(m.b, &at)
	file := m.strs[uleb(m.b, &at)]
	for k := uint32(0); k < units; k++ {
		st := uleb(m.b, &at)
		uleb(m.b, &at)
		en := uleb(m.b, &at)
		uleb(m.b, &at)
		uleb(m.b, &at)
		out.units = append(out.units, unit{st, en})
	}
	out.file = repoPath(file)
	return
}

// A file as the coverage metadata names it (an import path or an absolute path), as a repository-relative path.
func repoPath(file string) string {
	if strings.HasPrefix(file, root+"/") {
		return strings.TrimPrefix(file, root+"/")
	}
	if modPath != "" && strings.HasPrefix(file, modPath+"/") {
		return filepath.Join(modDir, strings.TrimPrefix(file, modPath+"/"))
	}
	return file
}
