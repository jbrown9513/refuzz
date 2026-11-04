<?php
/**
 * Runs one php-fuzzer target in-process for many inputs, the way php-fuzzer runs it: the target file is included with a
 * `$config` in scope and calls `$config->setTarget(function (string $input) { ... })`. The `$config` here is a stand-in with
 * php-fuzzer's Config methods, so the same file runs unchanged under php-fuzzer. Each input arrives on stdin as a u32 LE
 * length and its raw bytes and is handed to the target as a string (cut to setMaxLen's length, as php-fuzzer never makes a
 * longer one). For each it writes one JSON line: what happened, whose code failed (the project's, an assertion the target
 * makes, or a bug in the target's own lines), the project's frames, and the project lines pcov saw it run that this process
 * had not seen before (pcov has no edges: a line is the coverage feature). A fatal error ends the process after its report
 * line; the driver starts another. Usage: php php_fuzz.php <target.php> <root> <timeout ms>
 */

$harness = realpath($argv[1]);
$root = rtrim($argv[2], '/');
$timeout = max(1, (int) ceil(((int) $argv[3]) / 1000));
// The target file is written as it is: its lines are its own.
$offset = 0;
$role = 'target';
require __DIR__ . '/php_lib.php';

final class RefuzzTimeout extends Error {}

/** php-fuzzer's Config as a target uses it: the target, its maximum input length; exceptions and dictionaries are the engine's. */
final class RefuzzerConfig
{
    public ?Closure $target = null;
    public array $allowedExceptions = [Exception::class];
    public int $maxLen = PHP_INT_MAX;

    public function setTarget(Closure $target): void { $this->target = $target; }
    public function setAllowedExceptions(array $allowedExceptions): void { $this->allowedExceptions = $allowedExceptions; }
    public function setMaxLen(int $maxLen): void { $this->maxLen = $maxLen; }
    public function addDictionary(string $path): void {}
}

$out = fopen('php://stdout', 'w');
$running = false;
$seen = [];

function emit(array $r): void
{
    global $out;
    fwrite($out, json_encode($r, JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR) . "\n");
    fflush($out);
}

/** Project lines this input ran, every one of them; the ones this process had not seen before also as features. */
function coverage(): array
{
    global $seen;
    if (!function_exists('pcov\collect')) return ['features' => [], 'lines' => []];
    $features = [];
    $lines = [];
    foreach (\pcov\collect() as $file => $hits) {
        if (!project($file)) continue;
        $path = rel($file);
        foreach ($hits as $line => $k) {
            if ($k <= 0) continue;
            $key = "$path:$line";
            $lines[] = [$path, $line];
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $features[] = crc32($key);
        }
    }
    return ['features' => $features, 'lines' => $lines];
}

function readExactly(int $k): ?string
{
    $s = '';
    while (strlen($s) < $k) {
        $part = fread(STDIN, $k - strlen($s));
        if ($part === false || $part === '') return null;
        $s .= $part;
    }
    return $s;
}

/** What failed: an assertion the target makes (`assert()`, or an AssertionError it throws), else whose code it was. */
function failure(Throwable $e): array
{
    global $harness;
    if ($e instanceof AssertionError && $e->getFile() === $harness) {
        return ['status' => 'error', 'origin' => 'assertion', 'type' => 'assertion', 'message' => substr($e->getMessage(), 0, 400), 'frames' => frames($e)];
    }
    return ['status' => 'error', 'origin' => origin($e, $harness), 'type' => shortName(get_class($e)), 'class' => get_class($e), 'message' => message($e, $harness), 'frames' => frames($e)];
}

/**
 * A fatal error (memory, CPU time, a missing class at link time) unwinds to the shutdown functions: report the input it
 * happened on, then go on serving from here, so the driver never sends the next input to a process that is exiting.
 */
function refuzz_fatal(): void
{
    global $running, $harness;
    if (!$running) return;
    $running = false;
    $err = error_get_last();
    while (ob_get_level() > 0) ob_end_clean();
    $time = $err && str_contains($err['message'], 'Maximum execution time');
    $r = ['status' => $time ? 'timeout' : 'error', 'origin' => $err && $err['file'] === $harness ? 'setup' : 'library', 'type' => $time ? 'Timeout' : ($err ? 'FatalError' : 'Exit'), 'message' => substr($err['message'] ?? 'the script exited during the call', 0, 400)];
    if ($err && project($err['file'])) $r['frames'] = [['path' => rel($err['file']), 'line' => $err['line'], 'name' => '']];
    emit($r + coverage());
    // exit() called on purpose ends the process; anything else carries on with the next input.
    if (!$err) exit(0);
    register_shutdown_function('refuzz_fatal');
    ob_start();
    serve();
}

/** Inputs from stdin until it closes, one report line each. */
function serve(): void
{
    global $running, $config, $timeout;
    $target = $config->target;
    while (($head = readExactly(4)) !== null) {
        $n = unpack('V', $head)[1];
        $input = $n > 0 ? (readExactly($n) ?? '') : '';
        if (strlen($input) > $config->maxLen) $input = substr($input, 0, $config->maxLen);
        mt_srand(0);
        if (function_exists('pcov\clear')) \pcov\clear();
        $running = true;
        set_time_limit($timeout + 1);
        if (function_exists('pcntl_alarm')) pcntl_alarm($timeout);
        try {
            $result = $target($input);
            if (function_exists('pcntl_alarm')) pcntl_alarm(0);
            $r = ['status' => 'ok', 'result' => show($result)];
        } catch (RefuzzTimeout $e) {
            $r = ['status' => 'timeout', 'origin' => 'library', 'type' => 'Timeout', 'message' => "ran longer than {$timeout}s"];
        } catch (Throwable $e) {
            if (function_exists('pcntl_alarm')) pcntl_alarm(0);
            $r = failure($e);
        }
        $running = false;
        ob_clean();
        emit($r + coverage());
    }
}

register_shutdown_function('refuzz_fatal');
set_error_handler('refuzz_error');
ini_set('memory_limit', '1G');
if (is_file("$root/vendor/autoload.php")) require "$root/vendor/autoload.php";
if (function_exists('pcntl_async_signals')) {
    // Wall-clock time, which set_time_limit (CPU time) does not count: a call blocked in sleep or I/O.
    pcntl_async_signals(true);
    pcntl_signal(SIGALRM, function () { throw new RefuzzTimeout('timed out'); });
}

$config = new RefuzzerConfig();
ob_start();
try {
    (function () use ($harness, $config) { include $harness; })();
    if (!$config->target) throw new Error('the target never calls $config->setTarget(function (string $input) { ... })');
} catch (Throwable $e) {
    while (ob_get_level() > 0) ob_end_clean();
    emit(['fatal' => get_class($e) . ': ' . message($e, $harness)]);
    exit(0);
}
ob_clean();
emit(['ready' => true]);

if (function_exists('pcov\start')) \pcov\start();
serve();
