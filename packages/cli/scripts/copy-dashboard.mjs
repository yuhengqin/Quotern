import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, '..');
const source = join(cliRoot, '../dashboard/dist');
const target = join(cliRoot, 'dist/dashboard');

if (!existsSync(source)) {
  console.error(
    'Dashboard not built. Run: pnpm --filter quotern-dashboard build',
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`Copied dashboard dist → ${target}`);
