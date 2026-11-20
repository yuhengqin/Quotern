import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./pet-win32-probe.ps1', import.meta.url));
export const defaultHost = fileURLToPath(new URL('../src-tauri/target/x86_64-pc-windows-msvc/release/Quotern.exe', import.meta.url));

export function ownedPetWindow(probe, kind) {
  const title = kind === 'dsh' ? 'Quotern · 大肥鱼' : 'Quotern · Pet';
  return async (action, itemPath = '') => {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, String(probe.child.pid), title, action, itemPath], { windowsHide:true, encoding:'utf8', timeout:12000 });
    return stdout.trim() ? JSON.parse(stdout) : null;
  };
}

export async function eventually(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await wait(70);
  }
  throw Error('Timed out waiting for '+label);
}
