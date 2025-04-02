import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const format = (process.argv[2] || 'all').replace('--', '');
const isSingleFormat = format !== 'all';
const outputFileName = 'mikrodb.bundled';

const getPackageVersion = () => JSON.parse(readFileSync('./package.json', 'utf-8')).version;
const packageVersion = getPackageVersion();

console.log(`Building MikroDB (${packageVersion}) for format "${format}"...`);

const getConfig = () => {
  return {
    entryPoints: ['src/index.ts'],
    bundle: isSingleFormat,
    minify: isSingleFormat,
    treeShaking: isSingleFormat,
    platform: 'node',
    target: 'node22',
    mainFields: ['module', 'main'],
    banner: {
      js: '// MikroDB - See LICENSE file for copyright and license details.'
    }
  };
};

const common = getConfig();

if (format === 'all' || format === 'esm') {
  build({
    ...common,
    format: 'esm',
    outfile: `lib/${outputFileName}.mjs`
  }).catch(() => process.exit(1));
}

if (format === 'all' || format === 'cjs') {
  build({
    ...common,
    format: 'cjs',
    outfile: `lib/${outputFileName}.cjs`
  }).catch(() => process.exit(1));
}
