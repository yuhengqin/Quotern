import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NotificationSound } from '../../shared/notifications.js';

/** Original short chimes; no copied application audio or additional media dependency. */
export function notificationWav(sound: Exclude<NotificationSound, 'none'>): Buffer {
  const rate = 22050, count = Math.floor(rate * 0.42), bytes = count * 2, buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate, envelope = Math.min(t / 0.015, 1) * Math.pow(1 - t / 0.42, 2);
    const value = sound === 'soft' ? Math.sin(2 * Math.PI * 660 * t) + 0.4 * Math.sin(2 * Math.PI * 880 * t)
      : Math.sin(2 * Math.PI * 1046.5 * t) + 0.25 * Math.sin(2 * Math.PI * 2093 * t);
    buffer.writeInt16LE(Math.round(value * envelope * 4200), 44 + i * 2);
  }
  return buffer;
}
export function notificationSoundCommand(platform: string, file: string): { command: string; args: string[] } {
  if (platform === 'win32') {
    const script = `[System.Media.SoundPlayer]::new('${file.replaceAll("'", "''")}').PlaySync()`;
    return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
  }
  return platform === 'darwin' ? { command: '/usr/bin/afplay', args: [file] } : { command: 'paplay', args: [file] };
}
export class NotificationSoundPlayer {
  private child: ChildProcess | null = null;
  private pending = false;
  private generation = 0;
  private nextAt = 0;
  private disposed = false;
  constructor(private readonly directory: string, private readonly platform = process.platform) {}
  async play(sound: NotificationSound, current = () => true, preview = false): Promise<void> {
    if (sound === 'none' || this.disposed) return;
    if (preview) this.stop();
    if (this.pending || !preview && Date.now() < this.nextAt) return;
    const generation = this.generation;
    const valid = () => !this.disposed && generation === this.generation && current();
    this.pending = true;
    try {
      await mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, `${sound}-v1.wav`);
      await writeFile(file, notificationWav(sound), { mode: 0o600 });
      if (!valid()) return;
      const { command, args } = notificationSoundCommand(this.platform, file);
      this.nextAt = Date.now() + 1500;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, stdio: 'ignore', shell: false }); this.child = child;
        const timeout = setTimeout(() => { child.kill(); }, 8000); timeout.unref?.();
        const done = (error?: Error) => { clearTimeout(timeout); if (this.child === child) this.child = null; if (error && valid()) reject(error); else resolve(); };
        child.once('error', () => done(new Error('NOTIFICATION_SOUND_FAILED')));
        child.once('close', code => done(code === 0 ? undefined : new Error('NOTIFICATION_SOUND_FAILED')));
      });
    } finally { if (generation === this.generation) this.pending = false; }
  }
  stop(): void { this.generation++; this.pending = false; this.nextAt = 0; const child = this.child; this.child = null; child?.kill(); }
  dispose(): void { this.disposed = true; this.stop(); }
}
