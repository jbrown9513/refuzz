//! What a caught panic says about whose code failed, for the in-process session (rust_session.rs): the project's (a panic
//! out of its code, and whether that was a deliberate rejection), the fuzz target's own assertion (a property it states that
//! the project broke), or the fuzz target's mistake (an unwrap or an index of its own).
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub struct Panic {
    pub location: Option<(String, u32)>,
    pub message: String,
    pub backtrace: String,
}

static LAST: Mutex<Option<Panic>> = Mutex::new(None);

/// Keeps each panic's location, message and backtrace for `take_panic`, instead of printing it.
pub fn install_hook() {
    std::panic::set_hook(Box::new(|info| {
        let message = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_default();
        let location = info.location().map(|l| (l.file().to_string(), l.line()));
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        if let Ok(mut last) = LAST.lock() {
            *last = Some(Panic { location, message, backtrace });
        }
    }));
}

pub fn take_panic() -> Option<Panic> { LAST.lock().ok().and_then(|mut l| l.take()) }

pub struct Frame {
    pub path: String,
    pub line: u32,
    pub name: String,
}

/// The fuzz target's source file, as the session was given it: every file of the target crate (paths relative to it, or
/// under /work) is the target's.
static TARGET: OnceLock<String> = OnceLock::new();

pub fn set_target(path: String) { let _ = TARGET.set(path); }

enum Own { Target, Project(String) }

static ROOT: OnceLock<String> = OnceLock::new();

/// The project's folder in the container, with a trailing slash: REFUZZ_ROOT, which the session sets to where the build spec
/// put the checkout. Read once at startup, before any panic hook needs it.
pub fn root() -> &'static str {
    ROOT.get_or_init(|| format!("{}/", std::env::var("REFUZZ_ROOT").expect("REFUZZ_ROOT names the project's folder").trim_end_matches('/')))
}

/// Project files are under root(); the fuzz target is built from the session's crate under /work, its paths relative to it.
/// Anything else (std, a dependency from the registry) is neither.
fn own(path: &str) -> Option<Own> {
    if let Some(p) = path.strip_prefix(root()) {
        Some(Own::Project(p.to_string()))
    } else if !path.starts_with('/') || path.starts_with("/work/") {
        Some(Own::Target)
    } else {
        None
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Origin { Library, Setup, Assertion }

/// Whose failure a panic is: the project's when the innermost frame in the project or the target is the project's; the
/// target's assertion when the panic is raised on a line of the target that asserts (`assert!`, `assert_eq!`, `panic!`…);
/// the target's mistake otherwise. With the project frames it passed through, innermost last.
pub fn classify(p: &Panic) -> (Origin, Vec<Frame>) {
    let mut trace: Vec<(String, u32, String)> = Vec::new();
    if let Some((f, l)) = &p.location {
        trace.push((f.clone(), *l, String::new()));
    }
    let lines: Vec<&str> = p.backtrace.lines().collect();
    for i in 0..lines.len() {
        let t = lines[i].trim_start();
        let Some(colon) = t.find(": ") else { continue };
        if colon == 0 || !t[..colon].bytes().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let name = t[colon + 2..].to_string();
        let Some(at) = lines.get(i + 1).map(|s| s.trim_start()).and_then(|s| s.strip_prefix("at ")) else { continue };
        let mut parts = at.rsplitn(3, ':');
        let (_col, line, path) = (parts.next(), parts.next(), parts.next());
        if let (Some(line), Some(path)) = (line.and_then(|l| l.parse().ok()), path) {
            trace.push((path.to_string(), line, name));
        }
    }
    let mut first: Option<Origin> = None;
    let mut frames: Vec<Frame> = Vec::new();
    for (path, line, name) in trace {
        match own(&path) {
            Some(Own::Target) => {
                first.get_or_insert(if asserts(p) { Origin::Assertion } else { Origin::Setup });
                break;
            }
            Some(Own::Project(p)) => {
                first.get_or_insert(Origin::Library);
                match frames.last_mut() {
                    Some(f) if f.path == p && f.line == line => {
                        if f.name.is_empty() {
                            f.name = name;
                        }
                    }
                    _ => frames.push(Frame { path: p, line, name }),
                }
            }
            None => {}
        }
    }
    frames.reverse();
    (first.unwrap_or(Origin::Setup), frames)
}

pub fn js(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Panics the language's runtime raises on the project's behalf: what the input broke, not what the project refused.
const RUNTIME: &[&str] = &[
    "index out of bounds", "attempt to ", "called `Option::unwrap()`", "called `Result::unwrap()`", "called `Option::expect()`", "is not a char boundary",
    "out of range for slice", "out of range for str", "range end index", "range start index", "slice index starts", "capacity overflow", "divide by zero",
    "remainder with a divisor of zero", "internal error: entered unreachable code", "not implemented", "not yet implemented", "already borrowed",
    "already mutably borrowed", "removal index", "insertion index", "swap_remove index", "split_off", "chunk size must be non-zero",
];

static SOURCES: Mutex<Option<HashMap<String, Vec<String>>>> = Mutex::new(None);

/// One line of a source file, read once per file: a project file where the container mounts it (/src), the target's from
/// the path the session was given.
fn source_line(path: &str, line: u32) -> Option<String> {
    let file = match own(path)? {
        Own::Target => TARGET.get()?.clone(),
        Own::Project(_) => path.to_string(),
    };
    let mut cache = SOURCES.lock().ok()?;
    let files = cache.get_or_insert_with(HashMap::new);
    let lines = files.entry(file.clone()).or_insert_with(|| std::fs::read_to_string(&file).map(|t| t.lines().map(str::to_string).collect()).unwrap_or_default());
    lines.get((line as usize).checked_sub(1)?).cloned()
}

/// Whether the line a panic was raised on calls one of `macros` (by name, not as part of a longer one), outside a comment.
fn raised_by(p: &Panic, macros: &[&str]) -> bool {
    let Some((path, line)) = &p.location else { return false };
    let Some(text) = source_line(path, *line) else { return false };
    let code = text.split("//").next().unwrap_or("");
    macros.iter().any(|m| code.match_indices(m).any(|(i, _)| !code[..i].ends_with(|c: char| c.is_alphanumeric() || c == '_')))
}

/// The target's own assertion failed: a panic raised on a line of the target that asserts or panics on purpose.
fn asserts(p: &Panic) -> bool {
    matches!(p.location.as_ref().and_then(|(f, _)| own(f)), Some(Own::Target))
        && raised_by(p, &["assert!", "assert_eq!", "assert_ne!", "debug_assert!", "debug_assert_eq!", "debug_assert_ne!", "panic!", "unreachable!"])
}

/// A deliberate rejection: the project's own `panic!` or `assert!` raised it, on a line of the project, with a message of its
/// own. A panic the runtime raised for it (unwrap on None or Err, an index out of bounds, an overflow, a char boundary) is
/// not, and neither is a debug assertion, which states an internal invariant.
pub fn deliberate(p: &Panic) -> bool {
    let Some((path, _)) = &p.location else { return false };
    path.starts_with(root()) && !RUNTIME.iter().any(|m| p.message.contains(m)) && raised_by(p, &["panic!", "assert!", "assert_eq!", "assert_ne!"])
}

/// A caught panic as the JSON fields of a report: status, origin, type, message, frames, and whether it was a clean rejection.
pub fn panic_json(p: &Panic) -> String {
    let (origin, frames) = classify(p);
    let frames: Vec<String> = frames.iter().map(|f| format!("{{\"path\":{},\"line\":{},\"name\":{}}}", js(&f.path), f.line, js(&f.name))).collect();
    let message: String = p.message.chars().take(1200).collect();
    let (origin, kind) = match origin {
        Origin::Library => ("library", "panic"),
        Origin::Setup => ("setup", "panic"),
        Origin::Assertion => ("assertion", "assertion"),
    };
    format!("\"status\":\"error\",\"origin\":\"{}\",\"type\":\"{}\",\"message\":{},\"clean\":{},\"frames\":[{}]", origin, kind, js(&message), origin == "library" && deliberate(p), frames.join(","))
}
