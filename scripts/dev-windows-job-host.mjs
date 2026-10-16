// Windows PowerShell 5 needs a console-capable host; spawning it with libuv's
// DETACHED_PROCESS silently exits on some systems. A detached Node host survives
// the supervisor and keeps its own hidden PowerShell child alive until Job zero.
import { spawn } from 'node:child_process';

const child = spawn('powershell.exe', process.argv.slice(2), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
process.stdin.pipe(child.stdin);
for (const [source, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  source.pipe(destination);
  destination.on('error', () => { source.unpipe(destination); source.resume(); });
}
child.stdin.on('error', () => { process.stdin.unpipe(child.stdin); process.stdin.destroy(); });
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.stdin.destroy();
  process.exitCode = 1;
});
child.on('exit', (code) => { process.stdin.destroy(); process.exitCode = code ?? 1; });
