import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationWav, notificationSoundCommand } from './sound.js';

test('original chimes are bounded mono PCM WAV files suitable for the OS player', () => {
  for (const sound of ['soft', 'bell'] as const) {
    const wav = notificationWav(sound);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40) + 44, wav.length); assert.ok(wav.length < 24000);
    let peak = 0; for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert.ok(peak > 0 && peak < 16000);
  }
});
test('Windows sound uses encoded fixed PowerShell code and safely quotes a literal file path', () => {
  const file = "C:/sound's/$literal`name.wav", result = notificationSoundCommand('win32', file);
  assert.equal(result.command, 'powershell.exe'); assert.ok(result.args.includes('-NonInteractive'));
  const decoded = Buffer.from(result.args.at(-1)!, 'base64').toString('utf16le');
  assert.equal(decoded, "[System.Media.SoundPlayer]::new('C:/sound''s/$literal`name.wav').PlaySync()");
  assert.deepEqual(notificationSoundCommand('darwin', file).args, [file]);
});
