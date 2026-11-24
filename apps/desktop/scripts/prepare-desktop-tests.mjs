import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import './prepare-dsh-pet-tests.mjs';

// These tests exercise the same bundled CJS-to-ESM boundary as the shipped Node worker.
const root=fileURLToPath(new URL('../',import.meta.url));
await build({absWorkingDir:root,entryPoints:['src/main/locale.test.ts','src/main/autostart.test.ts','src/renderer/lib/legacy-display-preferences.test.ts','src/sidecar/codex-official.test.ts','src/sidecar/copilot-official.test.ts','src/sidecar/preferences.test.ts','src/sidecar/quotas.test.ts'],
  outbase:'src',outdir:'dist-test',bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning'});
