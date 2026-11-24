import { defineConfig, normalizePath, searchForWorkspaceRoot, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreSourcePlugin } from '../../scripts/vite-core-source.mjs';
import { tauriPetAssets } from './scripts/tauri-pet-assets.mjs';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };
const fontCss = createRequire(import.meta.url).resolve('@fontsource-variable/jetbrains-mono/index.css');
const fontFiles = realpathSync(resolve(dirname(fontCss), 'files'));

function fontAssetsPlugin(): Plugin {
  const assets = new Map<string, string>();
  let serving = false;
  return {
    name: 'quotern-jetbrains-mono-assets',
    enforce: 'pre',
    configResolved(config) {
      serving = config.command === 'serve';
    },
    buildStart() {
      assets.clear();
    },
    transform(code, id) {
      const rendererCss = resolve(__dirname, 'src/renderer/index.css');
      if (resolve(id.split('?')[0]).toLowerCase() !== rendererCss.toLowerCase()) return;
      const fontImport = /@import\s+["']@fontsource-variable\/jetbrains-mono["'];/;
      if (!fontImport.test(code)) return;
      // Inline only this import before Tailwind rebases the cross-drive URLs.
      const css = readFileSync(fontCss, 'utf8').replace(/\.\/files\/([\w.-]+\.woff2)/g, (_, name: string) => {
        const filename = resolve(fontFiles, name);
        if (serving) return '/@fs/' + encodeURI(normalizePath(filename));
        const source = readFileSync(filename);
        const digest = createHash('sha256').update(source).digest('hex');
        const placeholder = `data:application/x-quotern-font,${digest}`;
        const reference = this.emitFile({ type: 'asset', name: basename(name), source });
        assets.set(placeholder, reference);
        return placeholder;
      });
      return code.replace(fontImport, css);
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        // Resolve emitted asset names relative to each final CSS file.
        for (const output of Object.values(bundle)) {
          if (output.type !== 'asset' || !output.fileName.endsWith('.css') || typeof output.source !== 'string') continue;
          for (const [placeholder, reference] of assets) {
            let url = posix.relative(posix.dirname(output.fileName), this.getFileName(reference));
            if (!url.startsWith('.')) url = `./${url}`;
            output.source = output.source.replaceAll(placeholder, url);
          }
        }
      },
    },
  };
}

const quotaPreview = process.env.QUOTERN_DEV_QUOTA_PREVIEW === '1';
if (quotaPreview && process.env.QUOTERN_DEV_ISOLATED !== '1') {
  throw new Error('额度 mock 必须通过 pnpm dev:desktop:quota 隔离启动');
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [
    fontAssetsPlugin(),
    coreSourcePlugin(),
    tauriPetAssets(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: 'routes',
      generatedRouteTree: 'routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'safari16.4',
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        pet: resolve(__dirname, 'src/renderer/pet.html'),
      },
    },
  },
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, 'src/renderer') }] },
  server: {
    host: process.env.QUOTERN_DEV_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.QUOTERN_DEV_DESKTOP_PORT || 5195),
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(__dirname), fontFiles] },
  },
});
