/**
 * The files a surface's tests read: keys, certificates, tokens, sample documents and images in the project's test data. A
 * harness that checks a signature, a certificate chain or a checksummed format starts from these and alters them, since
 * random bytes never form a signed SAML response or a PNG whose CRCs match; those small enough also join the corpus as they
 * are, for targets that take the bytes whole.
 *
 * Found from the code, never from documentation: the string literals of the tests that call the surface (and of their
 * files, where fixture paths usually sit in constants and helpers), resolved against the test's folder and the project
 * root, then the conventional test-data folders beside those tests and the surface's own files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Surface } from './surface.ts';
import { testsCalling, type Project } from './syntax.ts';

export interface Fixture {
  /** From the project root. */
  path: string;
  bytes: number;
  /** What the file is, from its first bytes: a PEM block's label, a format's magic, or its extension. */
  what: string;
}

/** Source code and build files are what the tests are written in, not what they read. */
const CODE = /\.(c|cc|cpp|cxx|h|hh|hpp|go|rs|py|pyi|rb|js|mjs|cjs|jsx|ts|tsx|java|kt|scala|php|cs|swift|zig|lua|sh|bash|pl|ex|exs|erl|lock|mod|sum|gradle|cmake|o|a|so|class|jar|pyc)$/i;
const MAX_BYTES = 1 << 20;
const MAX = 24;

/** What a fixture is, from its first bytes. */
function what(path: string, head: Buffer): string {
  const text = head.toString('latin1');
  const pem = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(text);
  if (pem) return `PEM ${pem[1].toLowerCase()}`;
  const magic: [RegExp | Buffer, string][] = [
    [Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'PNG image'], [Buffer.from([0xff, 0xd8, 0xff]), 'JPEG image'], [Buffer.from('GIF8'), 'GIF image'],
    [Buffer.from('RIFF'), 'RIFF (WebP, WAV)'], [Buffer.from('%PDF'), 'PDF document'], [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'ZIP archive'],
    [Buffer.from([0x1f, 0x8b]), 'gzip data'], [Buffer.from('BZh'), 'bzip2 data'], [Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a]), 'xz data'],
    [Buffer.from([0x37, 0x7a, 0xbc, 0xaf]), '7z archive'], [Buffer.from([0x30, 0x82]), 'DER (ASN.1) structure'], [Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'ELF binary'],
  ];
  for (const [m, label] of magic) if (Buffer.isBuffer(m) && head.subarray(0, m.length).equals(m)) return label;
  if (head.length >= 262 && head.subarray(257, 262).toString('latin1') === 'ustar') return 'tar archive';
  if (/^\s*<\?xml|^\s*<[A-Za-z][\w:-]*[\s>]/.test(text)) return /<(?:\w+:)?(Response|Assertion|EntityDescriptor|AuthnRequest)\b/.test(text) ? 'XML (SAML)' : 'XML document';
  if (/^\s*[{[]/.test(text)) return /"(kty|keys)"\s*:/.test(text) ? 'JSON (JWK)' : 'JSON document';
  if (/^eyJ[\w-]+\.eyJ[\w-]+\./.test(text.trim())) return 'JWT';
  const ext = extname(path).slice(1).toLowerCase();
  return ext ? `.${ext} file` : 'file';
}

const SKIP_DIR = /^(\.git|node_modules|vendor|target|dist|build|\.refuzz|\.refuzz-harness|__pycache__|\.venv|venv|\.tox)$/;

/**
 * Every non-code data file in the project, by file name: what a test's `read_fixture("x.pem")` can mean. Anywhere, not only
 * under test folders (libpng's pngtest.png sits at the root, its samples in contrib/testpngs); a file counts only when a
 * test names it.
 */
function testDataIndex(root: string): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  let seen = 0;
  const walk = (rel: string, depth: number) => {
    if (depth > 8 || seen > 20_000) return;
    let names: string[] = [];
    try { names = readdirSync(join(root, rel || '.')); } catch { return; }
    for (const n of names) {
      if (SKIP_DIR.test(n)) continue;
      const child = rel ? `${rel}/${n}` : n;
      let st;
      try { st = statSync(join(root, child)); } catch { continue; }
      if (st.isDirectory()) walk(child, depth + 1);
      else if (st.size > 0 && st.size <= MAX_BYTES && !CODE.test(n)) {
        seen++;
        (byName.get(n) ?? byName.set(n, []).get(n)!).push(child);
      }
    }
  };
  walk('', 0);
  return byName;
}

/** The test data a surface's tests read: the files their string literals name, smallest first, at most MAX. */
export function fixturesOf(p: Project, surface: Surface): Fixture[] {
  const root = p.dir;
  const index = testDataIndex(root);
  if (!index.size) return [];
  // The tests about the surface: those that call it, and the test files that name an entry, its type or its file.
  const words = new Set(surface.entries.flatMap((e) => {
    const parts = e.qualifiedName.split(/[.:#]+/).filter((w) => w.length > 3);
    const stem = e.path.split('/').pop()!.replace(/\.\w+$/, '');
    return [e.name, ...parts.slice(-2), ...(stem.length > 3 ? [stem] : [])];
  }));
  const testFiles = new Set([...surface.entries, ...surface.via].flatMap((x) => testsCalling(p, x, 8)).map((t) => t.path));
  const candidates = new Set(p.targets.filter((t) => t.test).map((t) => t.path));
  for (const [f] of p.files) if (/(^|\/)(tests?|spec|__tests__)\//.test(f)) candidates.add(f);
  for (const f of candidates) {
    if (testFiles.size >= 40) break;
    let text = '';
    try { text = p.read(f); } catch { continue; }
    if ([...words].some((w) => text.includes(w))) testFiles.add(f);
  }
  // A literal names a fixture by its whole path, by a path's tail, or by its file name alone (a helper adds the folder).
  const hits = new Map<string, number>();
  for (const f of testFiles) {
    let text = '';
    try { text = p.read(f); } catch { continue; }
    for (const m of text.matchAll(/(["'`])((?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,8})\1/g)) {
      const lit = m[2].replace(/^\.\//, '');
      if (/^(https?|file):/.test(lit) || /^\d+(\.\d+)+$/.test(lit)) continue;
      const name = lit.split('/').pop()!;
      for (const path of index.get(name) ?? []) if (path === lit || path.endsWith(`/${lit}`) || !lit.includes('/')) hits.set(path, (hits.get(path) ?? 0) + 1);
    }
  }
  // No test names a file (libpng's scripts glob contrib/testpngs/*.png): the data files in a test-looking folder whose format
  // the surface's own code names (a PNG decoder's source says png).
  if (!hits.size) {
    const code = surface.entries.map((e) => `${e.path}\n${(() => { try { return p.read(e.path); } catch { return ''; } })()}`).join('\n').toLowerCase();
    for (const paths of index.values()) for (const path of paths) {
      if (!/(^|\/)[^/]*(test|fixture|sample|corpus|example|vector)[^/]*\//i.test(path)) continue;
      try {
        const kind = what(path, readFileSync(join(root, path)).subarray(0, 512));
        const word = kind.split(/[\s(]/)[0].replace(/^\./, '').toLowerCase();
        if (word.length >= 3 && !['file', 'json', 'xml'].includes(word) && code.includes(word)) hits.set(path, 0);
      } catch {}
      if (hits.size >= MAX * 2) break;
    }
  }
  const out: Fixture[] = [];
  for (const path of hits.keys()) {
    try {
      const abs = join(root, path);
      const bytes = statSync(abs).size;
      out.push({ path, bytes, what: what(path, readFileSync(abs).subarray(0, 512)) });
    } catch {}
  }
  // The most named first, then the smallest, which mutate fastest; taken a folder at a time, so one folder of samples
  // (libpng's crashers/, ruby-saml's invalids/) does not crowd out the valid ones.
  out.sort((a, b) => (hits.get(b.path)! - hits.get(a.path)!) || a.bytes - b.bytes);
  const byDir = new Map<string, Fixture[]>();
  for (const f of out) { const d = f.path.replace(/\/[^/]*$/, ''); (byDir.get(d) ?? byDir.set(d, []).get(d)!).push(f); }
  const picked: Fixture[] = [];
  for (let i = 0; picked.length < MAX && [...byDir.values()].some((l) => l.length > i); i++) for (const l of byDir.values()) if (l[i] && picked.length < MAX) picked.push(l[i]);
  return picked;
}

/** The prompt's section: where each fixture is in the container and what it is. */
export function describeFixtures(fixtures: Fixture[], containerRoot: string): string {
  if (!fixtures.length) return '';
  const size = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
  return [
    `TEST DATA THE PROJECT'S TESTS READ, in this container (absolute paths; read them at the target's start, once):`,
    ...fixtures.map((f) => `${containerRoot}/${f.path} (${f.what}, ${size(f.bytes)})`),
    'Inputs built from these are well formed: the real keys, certificates, signed tokens and files the project accepts. A target that needs a valid key, signature, chain, document or image loads it from here (or generates one the way these were made) and lets the bytes choose what to change.',
  ].join('\n');
}

/** The fixtures small enough to seed the corpus as they are. */
export function fixtureSeeds(p: Project, fixtures: Fixture[]): Buffer[] {
  return fixtures.filter((f) => f.bytes <= 64 * 1024).flatMap((f) => { try { return [readFileSync(join(p.dir, f.path))]; } catch { return []; } });
}
