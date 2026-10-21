import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function runWithUtf8Output(command, args) {
  // Electron writes UTF-8 bytes directly to the Windows console. Relay through
  // Node's TTY stream so a legacy console code page cannot decode them as GBK.
  const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout?.pipe(process.stdout, { end: false });
  child.stderr?.pipe(process.stderr, { end: false });
  const interrupt = () => {
    // Windows broadcasts Ctrl+C to the entire attached console already.
    if (process.platform !== 'win32') child.kill('SIGINT');
  };
  const terminate = () => { child.kill('SIGTERM'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  return new Promise(resolveExit => {
    child.once('error', error => { console.error(error.message); });
    child.once('close', (code, signal) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      resolveExit(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js');
  if (process.platform === 'win32') {
    process.exitCode = await runWithUtf8Output(process.execPath, [cli, ...process.argv.slice(2)]);
  } else {
    // Other platforms need no encoding bridge. Keep Vite in this process so
    // targeted signals retain the original CLI's process lifecycle.
    process.argv[1] = cli;
    await import(pathToFileURL(cli).href);
  }
}
