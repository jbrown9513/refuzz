/**
 * What the project really defines, for a target whose error says it used a name that is not there (`undefined method
 * build_header for SecureHeaders::ContentSecurityPolicy`, `pki.certificateFromPem is not a function`, `MapClaims has no field
 * or method VerifyAud`). The same for every language: read from perch's model of the project, not from a language's tools.
 *
 * Two parts. The types the error names, matched against the project's owners (`MapClaims` in `MapClaims.VerifyAudience`) and
 * its files (`ContentSecurityPolicy` is content_security_policy.rb, where Ruby's methods are named after their module), with
 * the methods each defines. And the names the target used that the project does not define, each with the project's closest.
 */
import type { Project } from './syntax.ts';
import type { Target } from './types.ts';

const NOISE = /^(undefined|method|function|instance|object|class|module|error|errors|type|field|fields|property|properties|attribute|cannot|read|reading|value|values|null|nil|none|self|this|from|for|not|has|have|the|and|define|defined|declared|exist|exists|true|false|line|target|call|calls|called|argument|arguments|expected|got|missing|unknown|invalid|private|public|protected|wrong|number|string|int|bool|boolean|import|imported|export|exports|exported|module|package|named|name|names|provide|provides|does|uninitialized|constant|initialize|new|return|returns)$/i;
const IDENT = /[A-Za-z_$][\w$]*(?:(?:::|\.|#|->)[A-Za-z_$][\w$]*)*/g;
const norm = (s: string) => s.toLowerCase().replace(/[_$-]/g, '');
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_$-]+/).filter(Boolean);

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** How alike two names are: shared words first, then edit distance. Lower is closer. */
const closeness = (want: string, have: string) => {
  const w = new Set(words(want));
  const shared = words(have).filter((x) => w.has(x)).length;
  return distance(want.toLowerCase(), have.toLowerCase()) - shared * 4;
};

export function apiHint(p: Project, error: string, source: string, language: string, isPublic: (t: Target) => boolean, importFor?: (t: Target) => string): string {
  const code = p.targets.filter((t) => !t.test && t.language === language);
  if (!code.length) return '';
  const names = new Set(code.map((t) => t.name.split('.').pop()!));
  // A qualified name's last segment first (SecureHeaders::ContentSecurityPolicy names the class before the module).
  const segments = [...new Set([...error.matchAll(IDENT)].flatMap((m) => m[0].split(/::|\.|#|->/).reverse()).filter((x) => x.length >= 3 && !NOISE.test(x)))];

  // The types the error names: an owner segment of a qualified name, or a file named after the type.
  const owners = new Map<string, Target[]>();
  const ownerOf = (t: Target) => t.qualifiedName.split('.').slice(0, -1);
  const stem = (t: Target) => t.path.split('/').pop()!.replace(/\.\w+$/, '');
  for (const seg of segments) {
    if (names.has(seg) && !/^[A-Z]/.test(seg)) continue;
    const n = norm(seg);
    const members = code.filter((t) => ownerOf(t).includes(seg) || (/^[A-Z]/.test(seg) && norm(stem(t)) === n));
    if (members.length && members.length <= 400) owners.set(seg, members);
    if (owners.size >= 3) break;
  }

  // The names the target used that the project does not define: in the error and in the target's own text.
  // Only names the target calls or reaches into: after a `.`, `::`, `#` or `->`, or before a `(`.
  const called = new Set([...source.matchAll(/(?:\.|::|#|->)\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1] ?? m[2]));
  const missing = segments.filter((x) => called.has(x) && !names.has(x) && !owners.has(x)).slice(0, 4);
  // Names in the error the project does define, where the target cannot find them: an import or a namespace gone wrong.
  const misplaced = segments.filter((x) => called.has(x) && names.has(x) && !owners.has(x)).slice(0, 4);

  const out: string[] = [];
  const pool = owners.size ? [...owners.values()].flat() : code;
  for (const m of missing) {
    const near = [...new Set(pool.map((t) => t.name.split('.').pop()!))].sort((a, b) => closeness(m, a) - closeness(m, b)).slice(0, 5);
    if (near.length) out.push(`${m} is not defined in the project. Its closest names: ${near.join(', ')}.`);
  }
  for (const m of misplaced) {
    const defs = code.filter((t) => t.name.split('.').pop() === m).slice(0, 3);
    out.push(`${m} is defined in the project as ${defs.map((t) => `${t.qualifiedName} in ${t.path}${importFor ? ` (${importFor(t).split('\n').join(' ')})` : ''}`).join('; ')}.`);
  }
  for (const [seg, members] of owners) {
    const files = [...new Set(members.map((t) => t.path))].slice(0, 3).join(', ');
    const listed = members
      .sort((a, b) => (missing.length ? Math.min(...missing.map((m) => closeness(m, a.name))) - Math.min(...missing.map((m) => closeness(m, b.name))) : 0))
      .map((t) => `  ${t.header.split('\n')[0].trim().slice(0, 160)}${isPublic(t) ? '' : '   (not public: reach it through a public method that calls it)'}`)
      .filter((l, i, all) => all.indexOf(l) === i)
      .slice(0, 30);
    out.push(`${seg} (${files}) defines:\n${listed.join('\n')}`);
  }
  return out.length ? `WHAT THE PROJECT DEFINES, for the names in this error (read from its source):\n${out.join('\n')}` : '';
}
