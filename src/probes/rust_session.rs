//! The in-process session for a Rust fuzz target, and the `libfuzzer_sys` it is built against there: the target is a
//! cargo-fuzz file (`#![no_main]`, `use libfuzzer_sys::fuzz_target;`, `fuzz_target!(|data: &[u8]| { ... });`), compiled
//! unchanged with this crate standing in for libfuzzer-sys. Its `fuzz_target!` defines the program's `main`, which answers
//! src/session.ts's protocol: reads inputs (u32 LE length, the bytes) on stdin, runs the target's body on each under
//! catch_unwind, and answers each with one JSON line. The native build uses the real libfuzzer-sys on the same file.
//!
//! Coverage comes from SanitizerCoverage trace-pc-guard on the project's crates: each guard records the number of the last
//! input that ran it, so each input reports every line it ran; a guard's first run is also a new feature. A panic out of the
//! project says whether it was a clean rejection; one on a line of the target that asserts is the target's assertion. The
//! project's stdin is /dev/null and its stdout goes to stderr, so the inputs and the reports stay this driver's.
//!
//! This is the `session` module of the refuzz-rt library crate, built without coverage instrumentation, so its own
//! SanitizerCoverage callbacks are not instrumented. The target binary is built with instrumentation: the project's generic
//! code is monomorphized there, and gets guards too.
//! Usage: <target> <timeout ms> <lines file> <target source> | <target> --pcs

use crate::refuzz;

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::FromRawFd;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// What a target's body may return, as in libfuzzer-sys: whether the input may join the corpus. The session keeps every
/// input's report either way.
pub enum Corpus { Keep, Reject }

/// libfuzzer-sys's `fuzz_target!`: the bytes form, the `arbitrary` form (a type built from the bytes with
/// `Arbitrary::arbitrary_take_rest`, as libfuzzer-sys does; bytes it cannot build one from are skipped), either returning a
/// `Corpus`, and an `init:` block run once first.
#[macro_export]
macro_rules! fuzz_target {
    // The `->` forms first: a `$body:expr` fragment that meets `->` is an error, not a mismatch that tries the next arm.
    (init: $init:expr, |$bytes:ident: &[u8]| -> $rty:ty $body:block) => { $crate::fuzz_target!(@main $init, |$bytes: &[u8]| -> $rty { $body }); };
    (init: $init:expr, |$bytes:ident: &[u8]| $body:expr) => { $crate::fuzz_target!(@main $init, |$bytes: &[u8]| $body); };
    (init: $init:expr, |$bytes:ident| $body:expr) => { $crate::fuzz_target!(@main $init, |$bytes: &[u8]| $body); };
    (init: $init:expr, |$data:ident: $dty:ty| -> $rty:ty $body:block) => {
        $crate::fuzz_target!(@main $init, |bytes: &[u8]| {
            if let Ok($data) = <$dty as $crate::arbitrary::Arbitrary>::arbitrary_take_rest($crate::arbitrary::Unstructured::new(bytes)) { let _ = (|| -> $rty { $body })(); }
        });
    };
    (init: $init:expr, |$data:ident: $dty:ty| $body:expr) => {
        $crate::fuzz_target!(@main $init, |bytes: &[u8]| {
            if let Ok($data) = <$dty as $crate::arbitrary::Arbitrary>::arbitrary_take_rest($crate::arbitrary::Unstructured::new(bytes)) { let _ = (|| $body)(); }
        });
    };
    (|$($rest:tt)*) => { $crate::fuzz_target!(init: (), |$($rest)*); };
    (@main $init:expr, $run:expr) => {
        #[no_mangle]
        pub extern "C" fn main(_argc: i32, _argv: *const *const u8) -> i32 {
            let run = $run;
            $crate::session::main(Box::new(|| { let _ = $init; }), Box::new(move |bytes: &[u8]| { let _ = run(bytes); }));
            0
        }
    };
}

static NEW: Mutex<Vec<u32>> = Mutex::new(Vec::new());
/// Per guard, the number of the last input that ran it (0: never); INPUT is the number of the input running now.
static HITS: OnceLock<Vec<AtomicU32>> = OnceLock::new();
static INPUT: AtomicU32 = AtomicU32::new(1);
static PCS: AtomicPtr<usize> = AtomicPtr::new(std::ptr::null_mut());
static PCS_END: AtomicPtr<usize> = AtomicPtr::new(std::ptr::null_mut());
static STARTED: AtomicU64 = AtomicU64::new(0);
/// The report stream: the driver's own copy of stdout.
static OUT: Mutex<Option<File>> = Mutex::new(None);

extern "C" {
    fn dup(fd: i32) -> i32;
    fn dup2(from: i32, to: i32) -> i32;
}

fn emit(line: &str) {
    if let Ok(mut out) = OUT.lock() {
        if let Some(f) = out.as_mut() {
            let _ = f.write_all(format!("{}\n", line).as_bytes());
            let _ = f.flush();
        }
    }
}

/// Every instrumented module calls this with the same merged section; guards are numbered from 1 once.
#[no_mangle]
pub unsafe extern "C" fn __sanitizer_cov_trace_pc_guard_init(start: *mut u32, stop: *mut u32) {
    if start == stop || *start != 0 {
        return;
    }
    let mut p = start;
    let mut n = 0u32;
    while p < stop {
        n += 1;
        *p = n;
        p = p.add(1);
    }
    let _ = HITS.set((0..=n).map(|_| AtomicU32::new(0)).collect());
}

#[no_mangle]
pub unsafe extern "C" fn __sanitizer_cov_trace_pc_guard(guard: *mut u32) {
    let g = *guard;
    if g == 0 {
        return;
    }
    let Some(hit) = HITS.get().and_then(|h| h.get(g as usize)) else { return };
    let now = INPUT.load(Ordering::Relaxed);
    let was = hit.swap(now, Ordering::Relaxed);
    if was == 0 {
        if let Ok(mut v) = NEW.lock() {
            v.push(g);
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn __sanitizer_cov_pcs_init(beg: *const usize, end: *const usize) {
    if PCS.load(Ordering::Relaxed).is_null() {
        PCS.store(beg as *mut usize, Ordering::Relaxed);
        PCS_END.store(end as *mut usize, Ordering::Relaxed);
    }
}

/// Each guard's address in the executable file (the PC table's entries, less where the executable is mapped), for addr2line.
fn pcs() {
    let maps = std::fs::read_to_string("/proc/self/maps").unwrap_or_default();
    let exe = std::fs::read_link("/proc/self/exe").map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let base = maps.lines().find(|l| l.ends_with(&exe)).and_then(|l| l.split('-').next()).and_then(|s| usize::from_str_radix(s, 16).ok()).unwrap_or(0);
    let (mut p, end) = (PCS.load(Ordering::Relaxed) as *const usize, PCS_END.load(Ordering::Relaxed) as *const usize);
    let mut out = String::new();
    while !p.is_null() && p < end {
        let pc = unsafe { *p };
        out.push_str(&format!("{:x}\n", pc.wrapping_sub(base)));
        p = unsafe { p.add(2) };
    }
    print!("{}", out);
}

/// A guard's place: a line of the project (refuzz::root()), the target binary's own code (/work: the target, this runtime), or other
/// code (std or a dependency monomorphized in the binary).
enum Place { Project(String, u32), Ours, Other }

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

/// The target binary's `main`, as `fuzz_target!` writes it: `init` once, then `run` on every input. Not generic, so none of
/// this runtime is compiled into the instrumented binary: a guard callback that took a lock this code holds would deadlock.
pub fn main(init: Box<dyn FnOnce()>, run: Box<dyn Fn(&[u8]) + Send>) {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("--pcs") {
        pcs();
        return;
    }
    refuzz::root();
    // Inputs come on a private copy of stdin and reports go out on a private copy of stdout. The project's own stdin is
    // /dev/null, so code that reads it gets end of file instead of the next input's bytes, and what it prints goes to stderr.
    let (input, output) = unsafe {
        let (i, o) = (dup(0), dup(1));
        if let Ok(null) = File::open("/dev/null") {
            dup2(std::os::fd::AsRawFd::as_raw_fd(&null), 0);
        }
        dup2(2, 1);
        (File::from_raw_fd(i), File::from_raw_fd(o))
    };
    *OUT.lock().unwrap() = Some(output);
    let timeout: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(5000);
    // Guard n's source line is line n of the file addr2line wrote, kept when it is in the project (refuzz::root()).
    let lines: Vec<Place> = args.get(2).and_then(|f| std::fs::read_to_string(f).ok()).map(|text| {
        text.lines().map(|l| {
            let l = l.split(" (discriminator").next().unwrap_or(l);
            if l.starts_with("/work/") {
                return Place::Ours;
            }
            let at = l.rsplit_once(':').and_then(|(path, line)| Some((path.strip_prefix(refuzz::root())?.to_string(), line.trim().parse().ok()?)));
            at.map_or(Place::Other, |(p, n)| Place::Project(p, n))
        }).collect()
    }).unwrap_or_default();
    if let Some(source) = args.get(3) {
        refuzz::set_target(source.clone());
    }
    refuzz::install_hook();
    if catch_unwind(AssertUnwindSafe(init)).is_err() {
        let p = refuzz::take_panic().map(|p| p.message).unwrap_or_default();
        emit(&format!("{{\"fatal\":{}}}", refuzz::js(&format!("the target's init panicked: {}", p))));
        return;
    }
    // A deep stack, so recursion in the project overflows only where it would for a real caller.
    let worker = std::thread::Builder::new().stack_size(256 << 20).spawn(move || serve(run, timeout, &lines, input)).unwrap();
    let _ = worker.join();
}

fn serve(run: Box<dyn Fn(&[u8]) + Send>, timeout: u64, lines: &[Place], input: File) {
    // An input that hangs past the session's own limit is killed by the session; this only stops the process outliving it.
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let s = STARTED.load(Ordering::Relaxed);
        if s > 0 && now().saturating_sub(s) > timeout + 5_000 {
            std::process::exit(3);
        }
    });
    NEW.lock().unwrap().clear();
    emit("{\"ready\":true}");
    let mut stdin = std::io::BufReader::new(input);
    loop {
        let mut head = [0u8; 4];
        if stdin.read_exact(&mut head).is_err() {
            break;
        }
        // Exactly the input's length, as libFuzzer hands it over.
        let mut buf = vec![0u8; u32::from_le_bytes(head) as usize];
        if stdin.read_exact(&mut buf).is_err() {
            break;
        }
        NEW.lock().unwrap().clear();
        STARTED.store(now(), Ordering::Relaxed);
        let r = catch_unwind(AssertUnwindSafe(|| run(&buf)));
        STARTED.store(0, Ordering::Relaxed);
        let new: Vec<u32> = std::mem::take(&mut *NEW.lock().unwrap());
        // Every project line this input ran: the guards stamped with its number.
        let this = INPUT.fetch_add(1, Ordering::Relaxed);
        let mut ran: HashSet<(String, u32)> = HashSet::new();
        if let Some(hits) = HITS.get() {
            for (g, h) in hits.iter().enumerate().skip(1) {
                if h.load(Ordering::Relaxed) == this {
                    if let Some(Place::Project(p, n)) = lines.get(g - 1) {
                        ran.insert((p.clone(), *n));
                    }
                }
            }
        }
        let fresh: Vec<String> = ran.iter().map(|(p, n)| format!("[{},{}]", refuzz::js(p), n)).collect();
        // The target's and this runtime's own edges say nothing about the project: they are not features.
        let features: Vec<String> = new.iter().filter(|g| !matches!(lines.get(**g as usize - 1), Some(Place::Ours))).map(|g| g.to_string()).collect();
        let tail = format!("\"features\":[{}],\"lines\":[{}]", features.join(","), fresh.join(","));
        let report = match r {
            Ok(()) => format!("{{\"status\":\"ok\",{}}}", tail),
            Err(_) => match refuzz::take_panic() {
                Some(p) => format!("{{{},{}}}", refuzz::panic_json(&p), tail),
                None => format!("{{\"status\":\"error\",\"origin\":\"setup\",\"type\":\"panic\",\"message\":\"\",{}}}", tail),
            },
        };
        emit(&report);
    }
}
