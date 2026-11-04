/**
 * PHP: the project built by its build spec (src/build.ts) in refuzz's base-builder-php image, its Composer dependencies
 * installed in its folder by the spec's build.sh. Fuzz targets are php-fuzzer's (phpFuzz below), run in that container by
 * src/probes/php_fuzz.php with pcov measuring the project's lines and warnings raised as ErrorException, and by php-fuzzer
 * itself for the native engine.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { containerPlace, type Place } from '../place.ts';
import { PARALLEL, pool, shq } from '../run.ts';
import type { LineDriver } from '../session.ts';
import type { Adapter, Built, FuzzRuntime, FuzzSession, Report, Runtime, Target } from '../types.ts';
import { dictLine } from './ruby.ts';

/** Where the driver and its library go in the container. */
const DRIVERS = '/tmp/refuzz';
/** `assert()` compiled in and throwing AssertionError, whatever the image's php.ini says: it is how a target states a property. */
/** php-fuzzer, where the base image installs it. */
const FUZZER = '/opt/php-fuzzer/vendor/bin/php-fuzzer';
const ASSERTS = ['-d', 'zend.assertions=1', '-d', 'assert.exception=1'];

const namespaceOf = (source: string) => /^\s*namespace\s+([\w\\]+)\s*;/m.exec(source)?.[1];

/** The project's composer.json, or null. */
function composerOf(dir: string): any {
  try { return JSON.parse(readFileSync(join(dir, 'composer.json'), 'utf8')); } catch { return null; }
}

/** The project's folder as build.sh names it: under $SRC. */
const inSrc = (path: string) => path.replace(/^\/src(?=\/|$)/, '$SRC');

export const php: Adapter = {
  languages: ['php'],
  // The build installed the project's dependencies: the Composer autoloader its composer.json declares is there and loads.
  async ready(b) {
    const composer = composerOf(b.dir);
    if (!composer?.autoload || !Object.keys(composer.autoload).length) return undefined;
    const r = await b.box.exec(`php -r ${shq(`require ${JSON.stringify(`${b.src}/vendor/autoload.php`)};`)}`, { cwd: '/tmp', timeoutMs: 120_000 });
    return r.code === 0 ? undefined : `the Composer autoloader ${b.src}/vendor/autoload.php does not load: ${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`;
  },
  async prepare(b, log) {
    const place = containerPlace(b.box);
    await place.put(DRIVERS, Object.fromEntries(['php_lib.php', 'php_fuzz.php'].map((f) => [f, readFileSync(resolve(import.meta.dirname, '..', 'probes', f))])));
    // Without a Composer autoload section the project's classes are not autoloaded: a target requires the file.
    const composer = composerOf(b.dir);
    const autoloaded = !!(composer?.autoload && Object.keys(composer.autoload).length) && (await b.box.exec(`test -f ${shq(`${b.src}/vendor/autoload.php`)}`)).code === 0;
    if (!autoloaded) log('  php: no Composer autoloader; targets require the project\'s files');
    const rt: Runtime = {
      language: b.language,
      guide: 'PHP statements at file scope, one per item, without `<?php`. `use Vendor\\Package\\ClassName;` lines bring classes into scope (`use function Vendor\\Package\\fn;` for a function); the Composer autoloader is already loaded. Build the arguments, then the last line calls the target and binds what it returns: `$result = ClassName::method(...);` or `$result = (new ClassName(...))->method(...);`.',
      importFor(t: Target) {
        const ns = namespaceOf(existsSync(join(b.dir, t.path)) ? readFileSync(join(b.dir, t.path), 'utf8') : '');
        const parts = t.qualifiedName.split('.');
        const lines = autoloaded ? [] : [`require_once getenv('REFUZZ_ROOT') . '/${t.path}';`];
        if (parts.length > 1 && ns) lines.push(`use ${ns}\\${parts[0]};`);
        if (parts.length === 1 && ns) lines.push(`use function ${ns}\\${parts[0]};`);
        return lines.join('\n') || `require_once getenv('REFUZZ_ROOT') . '/${t.path}';`;
      },
      isImport: (l) => /^\s*(use\s|require(_once)?\b|include(_once)?\b)/.test(l),
      bindsResult: (l) => /^\$result\s*=(?!=)/.test(l),
      parseWrap: (code) => ({ source: `<?php\n${code}`, offset: 1 }),
      isPublic(t, source) {
        const parts = t.qualifiedName.split('.');
        if (parts.length > 2 || parts.some((x) => x.startsWith('_'))) return false;
        const definition = `${t.header} ${source.split('\n')[t.line - 1] ?? ''}`;
        return !/\b(private|protected)\b/.test(definition);
      },
      errorsAreValues: false,
      rejections: ['InvalidArgumentException', 'DomainException', 'LengthException', 'OutOfRangeException', 'OutOfBoundsException', 'RangeException', 'OverflowException', 'UnderflowException', 'UnexpectedValueException', 'ValueError', 'TypeError', 'JsonException', 'DivisionByZeroError', 'ArithmeticError'],
      environmental: (r) => /^(NoReport|Exit)$/.test(r.type ?? '') || /Call to undefined function|(Class|Interface|Trait) "[^"]+" not found|extension/i.test(r.message ?? ''),
      fuzz: phpFuzz(place, b, autoloaded, log),
    };
    return rt;
  },
};

/**
 * php-fuzzer targets: a file that calls `$config->setTarget(function (string $input) { … })`, kept running in its own `php`
 * process inside the container (src/probes/php_fuzz.php, with a stand-in `$config`), pcov saying which project lines each
 * input ran. The native engine is php-fuzzer itself on the same file.
 */
function phpFuzz(place: Place, b: Built, autoloaded: boolean, log: (s: string) => void): FuzzRuntime {
  /** pcov on for the project's own files only. */
  const pcov = ['-d', 'pcov.enabled=1', '-d', `pcov.directory=${b.src}`, '-d', 'pcov.exclude=~/vendor/~', '-d', 'display_errors=stderr', '-d', 'log_errors=0'];
  return {
    guide: [
      `A php-fuzzer target: a PHP file starting \`<?php\`, \`use\` lines for the project's classes (${autoloaded ? 'the Composer autoloader is already loaded; a file it does not autoload' : 'the project has no Composer autoloader: each file it needs'} is \`require_once getenv('REFUZZ_ROOT') . '/path/from/root.php';\`), then \`$config->setTarget(function (string $input): void { … });\`, optionally followed by \`$config->setMaxLen(n);\`.`,
      '$input is the raw bytes, a PHP string. Hand it on as it is to a target that parses bytes or text; to build several arguments, cut them from it yourself: `ord($input[0] ?? "\\0")` for a small number, `substr($input, 1, 8)` for a piece, `unpack(\'q\', str_pad(substr($input, 0, 8), 8, "\\0"))[1]` for an integer, explode on a byte for a list.',
      'Call the target. Catch only the exceptions the project documents or throws on purpose for invalid input (its own exception classes, InvalidArgumentException where it says so), each with an empty `catch` or `return;`; anything else it throws is the finding, so let it through.',
      'State what the result must satisfy with `assert(condition, \'what broke\')` in the target (a round trip, a range, an invariant the method promises): a failing assert is reported as the target\'s assertion; any other error in the target\'s own lines (a warning, a TypeError from a call it built wrongly) is a bug in the target. Do not echo.',
    ].join(' '),
    async session(targets) {
      const dir = await place.folder('php');
      const errors: Record<string, string> = {};
      const files: Record<string, string> = {};
      for (const [name, code] of Object.entries(targets)) {
        if (/^\w+$/.test(name)) files[`${name}.php`] = code;
        else errors[name] = `${name} is not a name a file can take`;
      }
      await place.put(dir, files);
      const file = (name: string) => `${dir}/${name}.php`;
      const make = (name: string, ms: number) => place.driver(['env', `REFUZZ_ROOT=${b.src}`, 'php', ...pcov, ...ASSERTS, `${DRIVERS}/php_fuzz.php`, file(name), b.src, String(ms)], { cwd: '/tmp' });
      const drivers = new Map<string, { d: LineDriver; timeout: number }>();
      await pool(Object.keys(targets).filter((n) => !errors[n]), PARALLEL, async (name) => {
        const d = make(name, 5_000);
        if (await d.start()) drivers.set(name, { d, timeout: 5_000 });
        else errors[name] = (d.fatal ?? 'did not load').replaceAll(file(name), '(target)');
      });
      const session: FuzzSession = {
        async run(name, inputs, timeoutMs, deadline) {
          let h = drivers.get(name);
          if (!h) return inputs.map(() => ({ status: 'error', origin: 'setup', type: 'TargetLoad', message: errors[name] ?? 'no such target' }));
          // The driver's timer is set when it starts; a different allowance needs a new process.
          if (h.timeout !== timeoutMs) { h.d.stop(); h = { d: make(name, timeoutMs), timeout: timeoutMs }; drivers.set(name, h); }
          return h.d.run(inputs, timeoutMs, deadline);
        },
        /**
         * php-fuzzer on the target for `seconds`: it has no time limit of its own, so it is killed at the end, its corpus and
         * crashes already on disk. It counts only Errors as crashes (Exceptions are its default allowed ones); each crash is
         * run back through the session for its report, one per kind and place.
         */
        async native(name, corpus, dict, seconds) {
          const crashes: { input: Buffer; report: Report }[] = [];
          if (!drivers.has(name)) return { crashes, corpus: [], execs: 0 };
          const at = await place.folder('php-native');
          try {
            await place.put(at, {
              ...Object.fromEntries(corpus.map((c) => [`corpus/${createHash('sha1').update(c).digest('hex')}.txt`, c])),
              'dict.txt': dict.map(dictLine).join('\n') + '\n',
            });
            const prepend = autoloaded ? `-d auto_prepend_file=${shq(`${b.src}/vendor/autoload.php`)} ` : '';
            const r = await place.run(['sh', '-c', `mkdir -p corpus crashes && cd crashes && timeout -s KILL ${seconds} php ${ASSERTS.join(' ')} -d memory_limit=1G ${prepend}${FUZZER} fuzz ${dict.length ? `--dict ${at}/dict.txt ` : ''}--timeout 10 ${shq(file(name))} ${at}/corpus 2>&1 | grep -v '^DUPLICATE CRASH' | tail -c 20000`], { cwd: at, env: { REFUZZ_ROOT: b.src }, timeoutMs: (seconds + 60) * 1000 });
            const files = await place.get(at);
            const kinds = new Set<string>();
            for (const [f, input] of Object.entries(files)) {
              if (!/^crashes\/crash-[^/]+\.txt$/.test(f)) continue;
              const [again] = await session.run(name, [input], 5_000);
              const report: Report = again && again.status !== 'ok' ? again : { status: 'error', origin: 'library', type: 'Crash', message: r.stdout.trim().split('\n').slice(-12).join('\n').slice(-1500) };
              const key = `${report.origin}|${report.type}|${report.frames?.at(-1)?.path}:${report.frames?.at(-1)?.line}`;
              if (kinds.has(key)) continue;
              kinds.add(key);
              crashes.push({ input, report });
            }
            // Its status lines carry the run count so far: `NEW    run: 1234 (6493/s), ft: …`.
            const execs = Math.max(0, ...[...r.stdout.matchAll(/\brun: (\d+)/g)].map((m) => Number(m[1])));
            log(execs ? `  php-fuzzer ${name}: ${execs} execs, ${crashes.length} crashes` : `  php-fuzzer ${name}: did not run: ${r.stdout.trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`);
            return { crashes, corpus: Object.entries(files).filter(([f]) => f.startsWith('corpus/')).map(([, c]) => c), execs };
          } finally {
            await place.remove(at);
          }
        },
        release(name) {
          drivers.get(name)?.d.stop();
          drivers.delete(name);
        },
        async close() {
          // A stopped driver closes the process's stdin, and php_fuzz.php exits at the end of its input.
          for (const h of drivers.values()) h.d.stop();
          await place.remove(dir);
        },
      };
      return { errors, session };
    },
    // The target is already the file php-fuzzer runs; the image's compile_php_fuzzer turns it into $OUT/<name>, with the
    // project's autoloader prepended.
    oss(name, source) {
      const file = `${name}.php`;
      return { file, source, compile: [`compile_php_fuzzer $SRC/refuzz/${file} ${inSrc(b.src)}`] };
    },
  };
}
