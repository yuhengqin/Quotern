// WMI creates this host outside the development terminal's process tree. Keep
// the native observer alive when the supervisor's named pipe disappears.
import { spawn } from 'node:child_process';
import net from 'node:net';

const { pipeName, token, args } = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
const socket = net.connect(pipeName);
const deadline = setTimeout(() => socket.destroy(), 15000);
let child;
socket.on('connect', () => {
  clearTimeout(deadline);
  socket.write(`${JSON.stringify({ type: 'host', pid: process.pid, token })}\n`);
  // A console-capable non-detached child supports Windows PowerShell 5 too.
  child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  socket.pipe(child.stdin);
  child.stdout.pipe(socket, { end: false });
  child.stdout.on('error', () => {});
  child.stdin.on('error', () => { socket.unpipe(child.stdin); });
  let errors = '';
  child.stderr.on('data', data => { errors = (errors + data).slice(-2000); });
  child.on('error', error => { socket.end(`${JSON.stringify({ type: 'error', message: error.message })}\n`); });
  child.on('exit', code => {
    if (code) socket.write(`${JSON.stringify({ type: 'error', message: errors || `Windows Job observer exited: ${code}` })}\n`);
    socket.end(); process.exitCode = code ?? 1;
  });
});
socket.on('error', () => {});
socket.on('close', () => {
  clearTimeout(deadline);
  if (child) {
    socket.unpipe(child.stdin); child.stdin.end();
    // Do not leave a paused readable stream blocking the observer on a dead pipe.
    child.stdout.unpipe(socket); child.stdout.resume();
  }
});
