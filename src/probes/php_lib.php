<?php
/**
 * What the PHP driver needs: which files are the project's, a throwable's project frames innermost last, whose code failed,
 * a value printed for a report, and warnings raised as ErrorException. Reads the including script's globals $root and $offset,
 * and $role, what it calls the file it runs (a harness when unset).
 */

/** A project file: under the root, not a dependency, not a test. */
function project(?string $file): bool
{
    global $root;
    if (!$file || !str_starts_with($file, "$root/")) return false;
    return !preg_match('#/(vendor|tests?|Tests?|spec)/#', substr($file, strlen($root)));
}

function rel(string $file): string
{
    global $root;
    return str_starts_with($file, "$root/") ? substr($file, strlen($root) + 1) : $file;
}
/** A harness line number as the harness was written, not as the file holds it. */
function harnessLine(int $line): int
{
    global $offset;
    return $line - $offset;
}

function frameName(array $f): string
{
    return isset($f['class']) ? "{$f['class']}::{$f['function']}" : ($f['function'] ?? '{main}');
}

/**
 * The project's frames a throwable passed through, innermost last. Each trace entry is where a function was called from;
 * the throw site is inside the first entry's function.
 */
function frames(Throwable $e): array
{
    $trace = array_values(array_filter($e->getTrace(), fn ($f) => ($f['function'] ?? '') !== 'refuzz_error'));
    $file = $e->getFile();
    $line = $e->getLine();
    // `throw Invalid::because($x)`: the exception is built in its own factory; the throw is where the factory was called.
    while (isset($trace[0]['class'], $trace[0]['file']) && $e instanceof $trace[0]['class']) {
        ['file' => $file, 'line' => $line] = array_shift($trace);
    }
    $out = [['file' => $file, 'line' => $line, 'name' => isset($trace[0]) ? frameName($trace[0]) : '{main}']];
    foreach ($trace as $i => $f) {
        if (!isset($f['file'])) continue;
        $out[] = ['file' => $f['file'], 'line' => $f['line'] ?? 0, 'name' => isset($trace[$i + 1]) ? frameName($trace[$i + 1]) : '{main}'];
    }
    // An internal function's error is raised at its call site: one frame, named for the function around it.
    if (isset($out[1]) && $out[0]['file'] === $out[1]['file'] && $out[0]['line'] === $out[1]['line']) array_shift($out);
    $project = array_filter($out, fn ($f) => project($f['file']));
    return array_reverse(array_map(fn ($f) => ['path' => rel($f['file']), 'line' => $f['line'], 'name' => $f['name']], array_values($project)));
}

function shortName(string $class): string
{
    $at = strrpos($class, '\\');
    return $at === false ? $class : substr($class, $at + 1);
}

/** Whose code failed: the harness's own lines (or a call it made with the wrong arguments), or the project's. */
function origin(Throwable $e, string $harness): string
{
    if ($e->getFile() === $harness || $e instanceof ParseError || $e instanceof CompileError) return 'setup';
    // A bad argument is reported at the callee, with the caller in the message.
    if (($e instanceof TypeError || $e instanceof ArgumentCountError) && preg_match('/(?:called|passed) in (\S+) on line/', $e->getMessage(), $m) && $m[1] === $harness) return 'setup';
    return 'library';
}

function message(Throwable $e, string $harness): string
{
    $m = $e->getMessage();
    if ($e instanceof ErrorException) $m = severity($e->getSeverity()) . ": $m";
    // What the including script calls the file it runs: a harness, or a fuzz target.
    $role = $GLOBALS['role'] ?? 'harness';
    $m = preg_replace_callback('/' . preg_quote($harness, '/') . ' on line (\d+)/', fn ($x) => "the $role on line " . harnessLine((int) $x[1]), $m);
    if ($e->getFile() === $harness) $m .= " ($role line " . harnessLine($e->getLine()) . ')';
    return substr($m, 0, 400);
}

function severity(int $no): string
{
    return match ($no) { E_WARNING, E_USER_WARNING => 'Warning', E_NOTICE, E_USER_NOTICE => 'Notice', default => 'Error' };
}

function show(mixed $v): string
{
    try {
        if ($v === null || is_scalar($v)) return var_export($v, true);
        if ($v instanceof Stringable) return get_class($v) . '(' . substr((string) $v, 0, 300) . ')';
        // Bounded: print_r walks the whole object graph, which for an object holding shared state can exhaust memory.
        return substr(refuzz_brief($v, 2), 0, 400);
    } catch (Throwable $e) {
        return '<unprintable: ' . get_class($e) . '>';
    }
}

/** A value to at most `depth` levels and 20 entries per level: arrays as [k => v], objects as Class{prop: v}. */
function refuzz_brief(mixed $v, int $depth): string
{
    if ($v === null || is_scalar($v)) return var_export($v, true);
    if ($v instanceof Stringable) return get_class($v) . '(' . substr((string) $v, 0, 120) . ')';
    $items = is_array($v) ? $v : get_object_vars($v);
    $open = is_array($v) ? '[' : get_class($v) . '{';
    $close = is_array($v) ? ']' : '}';
    if ($depth <= 0) return $open . (count($items) ? '…' : '') . $close;
    $parts = [];
    foreach (array_slice($items, 0, 20, true) as $k => $x) $parts[] = "$k => " . refuzz_brief($x, $depth - 1);
    if (count($items) > 20) $parts[] = '…';
    return $open . implode(', ', $parts) . $close;
}

/** Warnings and notices as exceptions at the line that raised them; deprecations and @-silenced ones stay quiet. */
function refuzz_error(int $no, string $str, string $file, int $line): bool
{
    if (!(error_reporting() & $no) || ($no & (E_DEPRECATED | E_USER_DEPRECATED))) return true;
    throw new ErrorException($str, 0, $no, $file, $line);
}
