import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor/dsh-pet');
const manifest = JSON.parse(await readFile(path.join(vendor, 'UPSTREAM.json'), 'utf8'));
const files = manifest.files.filter(file => file.path.endsWith('.test.ts'));
await build({ entryPoints: files.map(file => path.join(vendor, file.path)), outbase: path.join(vendor, 'src'), outdir: path.join(root, 'dist-test/upstream'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning', plugins: [{ name: 'upstream-source-guards', setup(bundle) {
  bundle.onLoad({ filter: /\.test\.ts$/ }, async args => {
    let contents = (await readFile(args.path, 'utf8')).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(args.path).href));
    // Three guards inspect the absent browser overlay / original DSH host, outside this port.
    contents = contents.replace("test('浏览器 overlay：", "test.skip('浏览器 overlay：").replace("test('源码守卫：客户端", "test.skip('源码守卫：客户端").replace("describe('宠物固定 —— 双端一致守卫", "describe.skip('宠物固定 —— 双端一致守卫");
    return { contents, loader: 'ts' };
  });
} }] });
console.log(`Prepared ${files.length} upstream dsh-pet test modules`);
