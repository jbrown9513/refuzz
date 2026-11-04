"""
Runs candidate setups and reports what each did: which lines of the target methods executed, whether it raised and from
whose code, and everything observable about `result`. Usage: python python_probe.py <spec.json>. The spec names the preamble,
the setups as {name: code}, the targets as {path, start, end}, and the directory to write one report per setup into.

The preamble runs once; each setup then runs in a forked child, so a heavy preamble (Django's database) is paid once per
batch and a setup that hangs or corrupts state takes nothing else with it.
"""
import json, os, signal, sys, time, traceback

# Each setup runs in a forked child. A BLAS thread pool started before the fork leaves the child with locks no thread will
# release, and it dies in BLAS code (SIGBUS in OpenBLAS on macOS): one thread, set before numpy loads, makes forking safe.
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_var] = "1"

spec = json.load(open(sys.argv[1]))
targets = [(os.path.realpath(t["path"]), t["start"], t["end"]) for t in spec["targets"]]
paths = {p for p, _, _ in targets}
root = os.path.realpath(spec.get("root", "."))
packages = [os.path.realpath(os.path.join(root, p)) for p in spec.get("packages", [])]
per_setup_timeout = int(spec.get("timeout", 30))
out_dir = spec["out"]
os.makedirs(out_dir, exist_ok=True)

names = {}
# An overlay's edited file stands in for the real one: trace it under the real path.
aliases = {os.path.realpath(k): v for k, v in spec.get("aliases", {}).items()}


def in_library(path):
    return any(path.startswith(p + os.sep) for p in packages) and f"{os.sep}tests{os.sep}" not in path and f"{os.sep}testing{os.sep}" not in path


def real(code):
    name = names.get(code)
    if name is None:
        name = os.path.realpath(code.co_filename)
        name = names[code] = aliases.get(name, name)
    return name


def safe(f, default=None):
    try:
        return f()
    except BaseException:
        return default


LITERAL_TYPES = (int, float, bool, str, bytes, type(None))


def is_literal(value):
    if isinstance(value, LITERAL_TYPES):
        return True
    if isinstance(value, (list, tuple, set, frozenset)):
        items = safe(lambda: list(value)[:51], None)
        return items is not None and len(items) <= 50 and all(isinstance(x, LITERAL_TYPES) for x in items)
    if isinstance(value, dict):
        items = safe(lambda: list(value.items())[:51], None)
        return items is not None and len(items) <= 50 and all(isinstance(k, LITERAL_TYPES) and isinstance(v, LITERAL_TYPES) for k, v in items)
    return False


def observe(value):
    """Everything a test could assert about a value, as JSON: its type, text forms, size, items and public attributes."""
    obs = {"type": type(value).__name__, "module": getattr(type(value), "__module__", "")}
    obs["repr"] = safe(lambda: repr(value)[:400], "<unrepresentable>")
    obs["str"] = safe(lambda: str(value)[:400], "<unprintable>")
    obs["is_none"] = value is None
    obs["bool"] = safe(lambda: bool(value))
    obs["len"] = safe(lambda: len(value)) if hasattr(value, "__len__") else None
    obs["literal"] = is_literal(value)
    if isinstance(value, dict):
        obs["keys"] = [safe(lambda k=k: repr(k)[:80]) for k in safe(lambda: list(value)[:16], [])]
        obs["items"] = [[safe(lambda k=k: repr(k)[:80]), safe(lambda v=v: repr(v)[:120]), is_literal(v)] for k, v in safe(lambda: list(value.items())[:16], [])]
    elif isinstance(value, (list, tuple, set, frozenset)) or (hasattr(value, "__getitem__") and hasattr(value, "__len__") and not isinstance(value, (str, bytes))):
        obs["items"] = [[safe(lambda x=x: repr(x)[:120]), is_literal(x)] for x in safe(lambda: list(value)[:16], [])]
    attrs = {}
    if not isinstance(value, LITERAL_TYPES):
        for name in safe(lambda: dir(value), [])[:400]:
            if name.startswith("_"):
                continue
            try:
                a = getattr(value, name)
            except BaseException:
                continue
            if callable(a):
                continue
            attrs[name] = [safe(lambda: repr(a)[:120], "<unrepresentable>"), is_literal(a)]
            if len(attrs) >= 48:
                break
    obs["attrs"] = attrs
    return obs


class Timeout(BaseException):
    pass


def alarm(signum, frame):
    raise Timeout()


def run_setup(name, code_text):
    """In the child: run one setup with the targets traced and write its report."""
    report = {"phase": "setup", "status": "error", "hits": [], "reached": []}
    hits = [set() for _ in targets]
    calls = {}

    def local(frame, event, arg):
        if event == "line":
            path, line = real(frame.f_code), frame.f_lineno
            for i, (p, s, e) in enumerate(targets):
                if path == p and s <= line <= e:
                    hits[i].add(line)
        return local

    def tracer(frame, event, arg):
        path = real(frame.f_code)
        if packages and event == "call" and in_library(path):
            key = (path, frame.f_code.co_firstlineno, frame.f_code.co_name)
            calls[key] = calls.get(key, 0) + 1
        return local if path in paths else None

    def write():
        report["hits"] = [sorted(h) for h in hits]
        report["reached"] = [bool(h) for h in hits]
        top = sorted(calls.items(), key=lambda kv: -kv[1])[:400]
        report["executed"] = [{"path": os.path.relpath(p, root), "line": line, "name": fn, "calls": n} for (p, line, fn), n in top]
        with open(os.path.join(out_dir, f"{name}.json"), "w") as f:
            json.dump(report, f)

    try:
        code = compile(code_text, "<setup>", "exec")
    except SyntaxError as error:
        report.update(error_type="SyntaxError", error=f"{error.msg} (line {error.lineno})", origin="setup")
        write()
        return

    signal.signal(signal.SIGALRM, alarm)
    signal.alarm(per_setup_timeout)
    ns = dict(namespace)
    sys.settrace(tracer)
    try:
        exec(code, ns)
        report["status"] = "ok"
    except Timeout:
        sys.settrace(None)
        report.update(status="timeout", error_type="Timeout", error=f"setup ran longer than {per_setup_timeout}s", origin="setup")
    except BaseException as error:
        sys.settrace(None)
        frames = traceback.extract_tb(error.__traceback__)
        last = frames[-1] if frames else None
        # A failure raised by the setup's own lines means the setup is wrong; one raised inside the library may be the bug.
        origin = "setup" if last is None or last.filename == "<setup>" else "library"
        where = f"{os.path.relpath(aliases.get(os.path.realpath(last.filename), last.filename), root)}:{last.lineno}" if last and origin == "library" else (f"setup line {last.lineno}" if last else "")
        report.update(error_type=type(error).__name__, error=str(error)[:400], origin=origin, where=where)
        report["exception"] = {"type": type(error).__name__, "module": type(error).__module__, "message": str(error)[:300], "args": [safe(lambda a=a: repr(a)[:120]) for a in getattr(error, "args", ())[:4]]}
        report["stack"] = [{"path": os.path.relpath(aliases.get(os.path.realpath(f.filename), os.path.realpath(f.filename)), root), "line": f.lineno, "name": f.name} for f in frames if f.filename != "<setup>" and in_library(aliases.get(os.path.realpath(f.filename), os.path.realpath(f.filename)))][-12:]
    finally:
        sys.settrace(None)
        signal.alarm(0)

    if "result" in ns:
        value = ns["result"]
        report["result"] = safe(lambda: str(value)[:400], "<unprintable>")
        report["result_type"] = type(value).__name__
        signal.alarm(per_setup_timeout)
        try:
            report["observation"] = observe(value)
        except BaseException:
            pass
        finally:
            signal.alarm(0)
    write()


namespace = {"__name__": "__swt_setup__"}
try:
    exec(compile(spec["preamble"], "<preamble>", "exec"), namespace)
except BaseException:
    error = {"phase": "preamble", "status": "error", "hits": [[] for _ in targets], "reached": [False for _ in targets], "error_type": "PreambleError", "error": traceback.format_exc(limit=3)[-600:], "origin": "preamble"}
    for name in spec["setups"]:
        with open(os.path.join(out_dir, f"{name}.json"), "w") as f:
            json.dump(error, f)
    sys.exit(0)

# Fixed seeds, as the emitted tests have: an outcome that changes run to run says nothing about a fix.
import random
random.seed(0)
try:
    import numpy
    numpy.random.seed(0)
except Exception:
    pass

sys.stdout.flush()
sys.stderr.flush()
for name, code_text in spec["setups"].items():
    try:
        pid = os.fork()
    except OSError:
        pid = None
    if pid == 0:
        try:
            run_setup(name, code_text)
        finally:
            os._exit(0)
    elif pid is None:
        run_setup(name, code_text)
    else:
        # The alarm inside the child cannot interrupt C code; the parent kills what outlives its allowance.
        deadline = time.time() + per_setup_timeout + 3
        while True:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                # A child killed by a signal wrote no report: the call crashed the interpreter (a segfault in compiled code).
                report_file = os.path.join(out_dir, f"{name}.json")
                if os.WIFSIGNALED(status) and not os.path.exists(report_file):
                    sig = os.WTERMSIG(status)
                    with open(report_file, "w") as f:
                        json.dump({"phase": "setup", "status": "error", "hits": [[] for _ in targets], "reached": [False for _ in targets], "error_type": "NativeCrash", "error": f"the interpreter was killed by signal {sig} ({signal.Signals(sig).name})", "origin": "library", "exception": {"type": "NativeCrash", "module": "", "message": f"killed by {signal.Signals(sig).name}", "args": []}, "stack": []}, f)
                break
            if time.time() > deadline:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
                with open(os.path.join(out_dir, f"{name}.json"), "w") as f:
                    json.dump({"phase": "setup", "status": "timeout", "hits": [[] for _ in targets], "reached": [False for _ in targets], "error_type": "Timeout", "origin": "setup"}, f)
                break
            time.sleep(0.02)
