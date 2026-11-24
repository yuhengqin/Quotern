import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import native from './prepare-native-runtime.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'out', 'sidecar');
await mkdir(out, { recursive: true });
await mkdir(path.join(out, 'resources'), { recursive:true });
await copyFile(path.join(root,'resources/icon.png'),path.join(out,'resources/icon.png'));
await copyFile(path.join(root,'resources/node-LICENSE.txt'),path.join(out,'node-LICENSE.txt'));
await copyFile(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(out,'THIRD_PARTY_NOTICES.md'));
await copyFile(path.join(root, 'src-tauri/nsis/License-MIT.md'), path.join(out, 'tauri-bundler-LICENSE-MIT.md'));
const {version} = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await writeFile(path.join(out,'release-mode.json'),JSON.stringify({version,mode:process.env.QUOTERN_MACOS_MODE || 'local'}));
const platform = process.env.TAURI_ENV_PLATFORM || process.platform;
const arch = process.env.QUOTERN_TARGET_ARCH || process.arch;
await native.prepareNativeRuntime({
  appDirectory: root,
  platform: platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : platform,
  arch,
  outputDirectory: path.join(out, 'node_modules'),
});
await build({
  absWorkingDir: root,
  entryPoints: {
    'quotern-desktop-runtime': 'src/sidecar/index.ts',
    'notification-action': 'src/sidecar/notification-action.ts',
    'sync-worker': 'src/main/sync-worker.ts',
    'session-analysis-worker': 'src/main/session-analysis-worker.ts',
  },
  outdir: out,
  outExtension: { '.js': '.cjs' },
  platform: 'node', format: 'cjs', target: 'node24', bundle: true,
  external: ['sharp'],
  define: { 'import.meta.url': 'quoternModuleUrl' },
  banner: { js: "const quoternModuleUrl = require('node:url').pathToFileURL(__filename).href;" },
  plugins: [{
    name: 'standalone-node-runtime',
    setup(plugin) {
      plugin.onResolve({ filter: /^electron(?:$|\/|-)/ }, args => ({
        errors: [{ text: 'Desktop sidecar imports ' + args.path + ' from ' + args.importer }],
      }));
    },
  }],
});
