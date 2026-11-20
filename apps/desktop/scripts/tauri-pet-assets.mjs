import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const petRuntimeFiles = Object.freeze([
  'index.html', 'shared-core.js', 'constants.js', 'sprite.js', 'events.js',
  'controls.js', 'interactions.js', 'renderer.js',
]);

const web = fileURLToPath(new URL('../out/tauri-pet-web/', import.meta.url));
const files = [...petRuntimeFiles, 'native-bridge.js'];
const routes = new Map(files.map(name => [`/dsh/${name}`, name]));

export function tauriPetAssets() {
  return {
    name: 'quotern-tauri-pet-assets',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const name = routes.get((req.url || '').split('?')[0]);
        if (!name) return next();
        try {
          const source = await readFile(path.join(web, name));
          res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
          res.end(source);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const name of files) {
        const source = await readFile(path.join(web, name));
        this.emitFile({ type: 'asset', fileName: `dsh/${name}`, source });
      }
    },
  };
}
