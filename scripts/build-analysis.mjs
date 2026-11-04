/**
 * Bundles perch's source analysis (tree-sitter parse of a checkout, method records, call graph) from a perch checkout into
 * vendor/perch/lib.mjs. perch is MIT (github.com/lakeday-org/perch); its license and the commit bundled sit beside the bundle.
 * `node scripts/build-analysis.mjs [path-to-perch]`, or PERCH_DIR. The native parser pack stays external, resolved from
 * refuzz's own node_modules.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const perch = resolve(process.argv[2] ?? process.env.PERCH_DIR ?? '../perch');
const { build } = createRequire(join(perch, 'package.json'))('esbuild');
const out = resolve('vendor', 'perch');
mkdirSync(out, { recursive: true });
// perch reads its shipped questions from ../scan.yaml relative to the module.
copyFileSync(join(perch, 'scan.yaml'), resolve('vendor', 'scan.yaml'));
copyFileSync(join(perch, 'LICENSE'), join(out, 'LICENSE'));
const commit = execFileSync('git', ['-C', perch, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(join(out, 'VERSION'), `lakeday-org/perch ${commit}\n`);
const entry = [
  `export { analyzeFiles, createSourceAnalyzer, sourceFile } from ${JSON.stringify(join(perch, 'src/analysis.js'))};`,
  `export { buildGraph } from ${JSON.stringify(join(perch, 'src/graph.js'))};`,
  `export { listTree, readBlob } from ${JSON.stringify(join(perch, 'src/git.js'))};`,
  `export { createFileSelector } from ${JSON.stringify(join(perch, 'src/exclusions.js'))};`,
  `export { Node } from ${JSON.stringify(join(perch, 'src/treesitter/node.ts'))};`,
  `export { downloading, normalizeLanguage } from ${JSON.stringify(join(perch, 'src/treesitter/languages.ts'))};`,
  `export { default as treeSitterPack } from '@xberg-io/tree-sitter-language-pack';`,
].join('\n');
await build({
  stdin: { contents: entry, resolveDir: perch, sourcefile: 'analysis.mjs', loader: 'js' },
  outfile: join(out, 'lib.mjs'),
  absWorkingDir: perch,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  nodePaths: [join(perch, 'node_modules')],
  external: ['@xberg-io/tree-sitter-language-pack'],
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);` },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log(`built vendor/perch/lib.mjs from perch ${commit.slice(0, 7)}`);
