"""
Runs one Atheris fuzz target in-process for many inputs, the way libFuzzer runs it: the target module defines
`TestOneInput(data)`, and each input arrives on stdin as a u32 LE length and the raw bytes, handed to it unchanged. For each
input it writes one JSON line: what happened, whose code failed, the project's frames, and the coverage edges this process
had not seen before. Usage: python python_fuzz.py <target.py> <root> <timeout ms> [preamble.py]

With --native it runs the same target under real Atheris instead: python python_fuzz.py --native <target.py> <root>
<crashes.jsonl> <preamble.py or ''> <libFuzzer flags and corpus dirs…>. libFuzzer stops at the first exception, and most are
not findings (a rejection the target did not catch, a mistake in its own lines), so every failure is appended to the crashes
file with its input and the classification the session gives it, and fuzzing goes on.

Whose code failed: an `assert` (or `raise AssertionError`) in the target's own lines is a property the target states, origin
"assertion"; any other error whose innermost frame of the target's or the project's is the project's is "library"; the rest
(a NameError, a TypeError in building arguments, a standard library call straight from the target) is the target's mistake,
"setup". An exception the target catches is a documented rejection it accepts, and the input simply returns.
"""
import base64, contextlib, importlib.util, json, math, os, platform, random, signal, struct, sys, traceback, types, zlib
from fractions import Fraction

# Single-threaded BLAS: a thread pool and a later fork or signal do not mix (see python_probe.py).
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_var] = "1"

NATIVE = len(sys.argv) > 1 and sys.argv[1] == "--native"
args = sys.argv[2:] if NATIVE else sys.argv[1:]
target_path, root = os.path.realpath(args[0]), os.path.realpath(args[1])
sys.setrecursionlimit(max(sys.getrecursionlimit(), 3000))

SIZE_MAX = (1 << 64) - 1
DBL_MAX = sys.float_info.max
FUSED = platform.machine().lower() in ("arm64", "aarch64")


def _fma(a, b, c):
    """
    a * b + c as the real provider's compiled code computes it: clang contracts it into one fused multiply-add on arm64 (one
    rounding), while x86-64 builds round the product first.
    """
    if not FUSED:
        return a * b + c
    if hasattr(math, "fma"):
        return math.fma(a, b, c)
    exact = Fraction(a) * Fraction(b) + Fraction(c)
    try:
        return float(exact)
    except OverflowError:
        return math.copysign(math.inf, exact)


def _size(n):
    """A size_t argument, as pybind11 converts one for the real provider: a negative or non-integer count is a TypeError."""
    if isinstance(n, bool) or not isinstance(n, int) or n < 0 or n > SIZE_MAX:
        raise TypeError(f"incompatible function arguments: expected a size_t, got {n!r}")
    return n


class FuzzedDataProvider:
    """
    atheris.FuzzedDataProvider, byte for byte (atheris 3.0's fuzzed_data_provider.cc), for interpreters real Atheris does not
    support: the same bytes give the same values, so a target behaves the same in the session and under the native engine.
    Bytes are consumed from the front, except ranged integers and list picks, which take theirs from the end.
    """

    def __init__(self, data):
        self._data = bytes(data)
        self._at = 0
        self._left = len(self._data)

    def _advance(self, n):
        if n > self._left:
            self._left = 0
        else:
            self._at += n
            self._left -= n

    def _take(self, n):
        return self._data[self._at:self._at + n]

    def remaining_bytes(self):
        return self._left

    def buffer(self):
        return self._take(self._left)

    def ConsumeBytes(self, count):
        n = min(_size(count), self._left)
        out = self._take(n)
        self._advance(n)
        return out

    def _unicode(self, count, no_surrogates):
        count = _size(count)
        if count == 0 or self._left == 0:
            return ""
        if self._left == 1:
            self._advance(1)
            return ""
        spec = self._data[self._at]
        self._advance(1)
        if spec & 1:
            n = min(count, self._left)
            out = bytes(b & 0x7F for b in self._take(n)).decode("ascii")
            self._advance(n)
            return out
        if spec & 2:
            n = min((count * 2) & SIZE_MAX, self._left)
            units = struct.unpack(f"<{n // 2}H", self._take(n & ~1))
            if no_surrogates:
                units = [u - 0xD800 if 0xD800 <= u < 0xE000 else u for u in units]
            self._advance(n)
            return "".join(map(chr, units))
        n = min((count * 4) & SIZE_MAX, self._left)
        points = []
        for p in struct.unpack(f"<{n // 4}I", self._take(n & ~3)):
            p &= 0x1FFFFF
            if p & 0x100000:
                p &= ~0x0F0000
            if no_surrogates and 0xD800 <= p < 0xE000:
                p -= 0xD800
            points.append(p)
        self._advance(n)
        return "".join(map(chr, points))

    def ConsumeUnicode(self, count):
        return self._unicode(count, False)

    def ConsumeUnicodeNoSurrogates(self, count):
        return self._unicode(count, True)

    def ConsumeString(self, count):
        return self._unicode(count, False)

    def ConsumeInt(self, size):
        n = min(_size(size), self._left)
        v = int.from_bytes(self._take(n), "little", signed=True) if n else 0
        self._advance(n)
        return v

    def ConsumeUInt(self, size):
        n = min(_size(size), self._left)
        v = int.from_bytes(self._take(n), "little") if n else 0
        self._advance(n)
        return v

    def _small(self, bits, rng):
        result = offset = 0
        while offset < bits and (rng >> offset) > 0 and self._left:
            self._left -= 1
            result = ((result << 8) | self._data[self._at + self._left]) & SIZE_MAX
            offset += 8
        return result if rng == SIZE_MAX else result % (rng + 1)

    def ConsumeIntInRange(self, min, max):
        delta = max - min
        if delta < 0:
            raise RuntimeError("ConsumeIntInRange: min must be <= max")
        bits = delta.bit_length()
        if bits <= 64:
            return min + self._small(bits, delta)
        return min + self.ConsumeInt(bits // 8) % (delta + 1)

    def ConsumeIntList(self, count, size):
        return [self.ConsumeInt(size) for _ in range(_size(count))]

    def ConsumeIntListInRange(self, count, min, max):
        return [self.ConsumeIntInRange(min, max) for _ in range(_size(count))]

    def ConsumeProbability(self):
        n = min(8, self._left)
        v = int.from_bytes(self._take(n), "little")
        self._advance(n)
        return float(v) / float(SIZE_MAX)

    def ConsumeFloatInRange(self, min, max):
        min, max = float(min), float(max)
        if min > max:
            raise RuntimeError("ConsumeFloatInRange: min must be <= max")
        result = min
        if min < 0 and max > 0 and min + DBL_MAX < max:
            span = (max / 2) - (min / 2)
            if self.ConsumeBool():
                result += span
        else:
            span = max - min
        return _fma(span, self.ConsumeProbability(), result)

    def ConsumeRegularFloat(self):
        return self.ConsumeFloatInRange(-DBL_MAX, DBL_MAX)

    SPECIAL = (0.0, -0.0, math.inf, -math.inf, math.nan, 5e-324, -5e-324, sys.float_info.min, -sys.float_info.min, DBL_MAX, -DBL_MAX)

    def ConsumeFloat(self):
        if not self._left:
            return 0.0
        kind = self._data[self._at]
        self._advance(1)
        if kind <= 10:
            self._advance(min(9, self._left))
            return self.SPECIAL[kind]
        return self.ConsumeRegularFloat()

    def ConsumeFloatList(self, count):
        return [self.ConsumeFloat() for _ in range(_size(count))]

    def ConsumeRegularFloatList(self, count):
        return [self.ConsumeRegularFloat() for _ in range(_size(count))]

    def ConsumeProbabilityList(self, count):
        return [self.ConsumeProbability() for _ in range(_size(count))]

    def ConsumeFloatListInRange(self, count, min, max):
        return [self.ConsumeFloatInRange(min, max) for _ in range(_size(count))]

    def ConsumeBool(self):
        if not self._left:
            return False
        v = bool(self._data[self._at] & 1)
        self._advance(1)
        return v

    def PickValueInList(self, values):
        if not isinstance(values, list):
            raise TypeError("PickValueInList takes a list")
        bits = 8 if len(values) <= 0xFF else 16 if len(values) <= 0xFFFF else 32 if len(values) <= 0xFFFFFFFF else 64
        return values[self._small(bits, (len(values) - 1) & SIZE_MAX)]


def _quiet(*a, **k):
    """Instrumentation and engine entry points, which do nothing in a session: coverage is the driver's, and it calls the target."""


@contextlib.contextmanager
def _no_instrumentation(*a, **k):
    yield


def _as_is(func):
    return func


def atheris_for_session():
    """
    Real Atheris when this interpreter has it (its FuzzedDataProvider is the one the native engine uses), else a module with
    the provider above. Either way instrumentation and Setup/Fuzz do nothing: a target that calls them at module level loads.
    """
    try:
        import atheris
    except Exception:
        atheris = sys.modules["atheris"] = types.ModuleType("atheris")
        atheris.FuzzedDataProvider = FuzzedDataProvider
        atheris.ALL_REMAINING = SIZE_MAX
    atheris.instrument_imports = _no_instrumentation
    atheris.instrument_all = _quiet
    atheris.instrument_func = _as_is
    atheris.Setup = _quiet
    atheris.Fuzz = _quiet
    return atheris


_sources, _mapped = None, {}


def source_of(path):
    """
    The project file a running file is, relative to the project's folder, or None. The project's build installs it the way
    its users get it (`pip install .` copies it into site-packages), so a file there is mapped back to the checkout's file
    with the same path below its package folder.
    """
    if path in _mapped:
        return _mapped[path]
    global _sources
    rel = None
    if path.startswith(root + os.sep) and path != target_path:
        rel = os.path.relpath(path, root)
    else:
        for marker in (f"{os.sep}site-packages{os.sep}", f"{os.sep}dist-packages{os.sep}"):
            if marker in path:
                if _sources is None:
                    _sources = []
                    for d, ds, fs in os.walk(root):
                        ds[:] = [x for x in ds if not x.startswith(".") and x not in ("node_modules", "build", "dist")]
                        _sources += [os.path.relpath(os.path.join(d, f), root) for f in fs if f.endswith(".py")]
                tail = path.split(marker, 1)[1]
                found = [s for s in _sources if s == tail or s.endswith(os.sep + tail)]
                rel = found[0] if len(found) == 1 else None
                break
    if rel is not None and any(part in ("tests", "testing") for part in rel.split(os.sep)[:-1]):
        rel = None
    _mapped[path] = rel
    return rel


def project(path):
    return source_of(path) is not None


class Timeout(BaseException):
    pass


class Sandbox(BaseException):
    """A target that reached for the network or another process: its mistake, never the project's finding."""


# Targets must not use the network or start processes. Loading may (a project probing its platform); inputs may not.
BLOCKED = ("socket.connect", "socket.bind", "socket.sendto", "socket.sendmsg", "subprocess.Popen", "os.system", "os.exec",
           "os.posix_spawn", "os.fork", "os.forkpty", "os.spawn", "pty.spawn", "webbrowser.open")
fuzzing = False


def guard(event, args):
    if fuzzing and event in BLOCKED:
        raise Sandbox(f"{event} is not allowed in a fuzz target")


def clean(error):
    """
    A clean rejection: an invalid-value or OS error, an exception class the project defines, or the standard library's parse
    and decode errors, which say plainly that the input was malformed whatever their base class. For hostile input that is
    the right answer; for ordinary input it can still be a bug.
    """
    cls_file = getattr(sys.modules.get(type(error).__module__), "__file__", None) or ""
    return isinstance(error, (ValueError, OSError, SyntaxError, EOFError)) or project(os.path.realpath(cls_file)) or any(
        c.__module__.split(".")[0].lstrip("_") in ("xml", "xmlrpc", "pyexpat", "pickle", "marshal", "json", "csv", "struct", "zlib", "binascii", "email", "tomllib", "plistlib", "configparser", "shlex", "tarfile", "zipfile", "gzip", "lzma", "bz2")
        or c.__name__.endswith(("ParseError", "DecodeError", "FormatError", "SyntaxError"))
        for c in type(error).__mro__ if c not in (BaseException, Exception, object))


def classify(error):
    """The report for an error out of TestOneInput: whose code failed, its message, the project's frames."""
    frames = traceback.extract_tb(error.__traceback__)
    # The innermost frame that is the target's or the project's decides. A dependency's or the standard library's, called
    # straight from the target, is the target's.
    origin = "setup"
    for f in reversed(frames):
        path = os.path.realpath(f.filename)
        if path == target_path:
            break
        if project(path):
            origin = "library"
            break
    here = [f for f in frames if os.path.realpath(f.filename) == target_path]
    if origin == "setup" and here and isinstance(error, AssertionError):
        origin = "assertion"
    try:
        message = str(error)[:400]
    except BaseException as broken:
        message = f"<str() of the error failed: {type(broken).__name__}>"
    # An assert with no message says what it asserted by its line.
    if origin == "assertion" and not message:
        message = f"target line {here[-1].lineno}: {here[-1].line}"
    elif origin == "setup" and here:
        message = f"target line {here[-1].lineno}: {here[-1].line}: {message}"
    return {
        "status": "error", "origin": origin, "type": "AssertionError" if origin == "assertion" else type(error).__name__,
        "module": type(error).__module__, "message": message, "clean": origin == "library" and bool(clean(error)),
        "frames": [{"path": source_of(os.path.realpath(f.filename)), "line": f.lineno, "name": f.name} for f in frames if project(os.path.realpath(f.filename))][-12:],
    }


def load(preamble, wrap=_no_instrumentation):
    """The target's TestOneInput, its module loaded under a name that is not __main__, so its `atheris.Fuzz()` block stays out."""
    if preamble:
        exec(compile(open(preamble).read(), "<preamble>", "exec"), {"__name__": "__refuzz_preamble__"})
    spec = importlib.util.spec_from_file_location("refuzz_target", target_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["refuzz_target"] = module
    with wrap():
        spec.loader.exec_module(module)
    test = getattr(module, "TestOneInput", None)
    if not callable(test):
        raise NameError("the target does not define TestOneInput(data) at module level")
    return test


def native():
    """Real Atheris on the target, the project's imports instrumented: libFuzzer's flags and corpus dirs follow the preamble."""
    crashes, preamble, flags = args[2], args[3], args[4:]
    import atheris
    setup, fuzz = atheris.Setup, atheris.Fuzz
    atheris.Setup = atheris.Fuzz = _quiet
    try:
        test = load(preamble, atheris.instrument_imports)
    except BaseException as error:
        sys.stderr.write(f"refuzz: the target did not load: {type(error).__name__}: {error}\n{traceback.format_exc(limit=6)[-1500:]}")
        sys.exit(3)
    atheris.Setup, atheris.Fuzz = setup, fuzz
    test = atheris.instrument_func(test)
    sys.addaudithook(guard)
    kept = {}

    def one(data):
        global fuzzing
        fuzzing = True
        try:
            test(data)
        except KeyboardInterrupt:
            raise
        except Sandbox:
            pass
        except BaseException as error:
            fuzzing = False
            report = classify(error)
            inner = report["frames"][-1] if report["frames"] else {}
            key = f"{report['origin']}|{report['type']}|{inner.get('path')}:{inner.get('line')}"
            # A few inputs per cause: the same failure a thousand times says nothing more.
            kept[key] = kept.get(key, 0) + 1
            if kept[key] <= 3:
                with open(crashes, "a") as f:
                    f.write(json.dumps({"input": base64.b64encode(bytes(data)).decode(), "report": report}) + "\n")
        finally:
            fuzzing = False

    atheris.Setup([sys.argv[0], *flags], one)
    atheris.Fuzz()


def session():
    global fuzzing
    timeout_ms = int(args[2])
    out = os.fdopen(os.dup(1), "w", buffering=1)
    # Inputs arrive on a private copy of stdin; the project's own stdin is empty, so code that reads it (an interactive
    # shell, a prompt) gets end-of-file at once instead of taking the next input's bytes.
    inputs = os.fdopen(os.dup(0), "rb")
    os.dup2(os.open(os.devnull, os.O_RDONLY), 0)
    sys.stdin = open(os.devnull)
    # What the target and the project print must not land in the report stream.
    sys.stdout = sys.stderr

    # Coverage: edges between consecutive project lines, hashed. sys.monitoring where there is one (3.12+), a tracer otherwise.
    names, paths, seen = {}, {}, set()
    state = {"current": set(), "lines": set(), "prev": 0}

    def file_id(code):
        f = names.get(code)
        if f is None:
            path = os.path.realpath(code.co_filename)
            f = names[code] = (zlib.crc32(path.encode()) & 0xFFFF) if project(path) else -1
            if f >= 0:
                paths[f] = source_of(path)
        return f

    def hit(code, line):
        f = file_id(code)
        if f < 0:
            return False
        here = (f << 20) | (line & 0xFFFFF)
        state["current"].add((state["prev"] * 31 + here) & 0xFFFFFFFF)
        state["lines"].add(here)
        state["prev"] = here
        return True

    if hasattr(sys, "monitoring"):
        mon = sys.monitoring
        TOOL = 3
        mon.use_tool_id(TOOL, "refuzz")

        def on_line(code, line):
            if not hit(code, line):
                return mon.DISABLE

        mon.register_callback(TOOL, mon.events.LINE, on_line)
        start = lambda: mon.set_events(TOOL, mon.events.LINE)
        stop = lambda: mon.set_events(TOOL, 0)
    else:
        def local(frame, event, arg):
            if event == "line":
                hit(frame.f_code, frame.f_lineno)
            return local

        def tracer(frame, event, arg):
            return local if file_id(frame.f_code) >= 0 else None

        start = lambda: sys.settrace(tracer)
        stop = lambda: sys.settrace(None)

    def alarm(signum, frame):
        raise Timeout()

    signal.signal(signal.SIGALRM, alarm)
    try:
        atheris_for_session()
        test = load(args[3] if len(args) > 3 else "")
    except BaseException as error:
        out.write(json.dumps({"fatal": f"{type(error).__name__}: {error}", "trace": traceback.format_exc(limit=6)[-1500:]}) + "\n")
        sys.exit(0)
    out.write(json.dumps({"ready": True}) + "\n")
    sys.addaudithook(guard)

    while True:
        head = inputs.read(4)
        if len(head) < 4:
            break
        data = inputs.read(struct.unpack("<I", head)[0])
        random.seed(0)
        # numpy's generator too, once the project has loaded it: a result that depends on it must not look nondeterministic.
        if "numpy" in sys.modules:
            try:
                sys.modules["numpy"].random.seed(0)
            except Exception:
                pass
        state.update(current=set(), lines=set(), prev=0)
        report = {"status": "ok"}
        signal.setitimer(signal.ITIMER_REAL, timeout_ms / 1000)
        start()
        fuzzing = True
        try:
            test(data)
            stop()
        except Sandbox as error:
            stop()
            report = {"status": "error", "origin": "setup", "type": "Sandbox", "message": str(error)}
        except Timeout:
            stop()
            report = {"status": "timeout", "origin": "library", "type": "Timeout"}
        except BaseException as error:
            stop()
            signal.setitimer(signal.ITIMER_REAL, 0)
            report = classify(error)
        finally:
            fuzzing = False
            signal.setitimer(signal.ITIMER_REAL, 0)
        fresh = state["current"] - seen
        seen |= fresh
        report["features"] = sorted(fresh)
        report["lines"] = [[paths[h >> 20], h & 0xFFFFF] for h in state["lines"] if (h >> 20) in paths]
        out.write(json.dumps(report) + "\n")


if NATIVE:
    native()
else:
    session()
