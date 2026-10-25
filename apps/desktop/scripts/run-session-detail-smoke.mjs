// Runs the built renderer acceptance with an isolated synthetic profile.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL('./session-detail-smoke.mjs', import.meta.url)), ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: 'inherit', windowsHide: true,
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
