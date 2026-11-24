import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKUP_CHUNK_UNITS, backupChunk } from '../shared/backup-transfer.js';
import { createBackupTransfer } from './backup-transfer.js';

const first = '1'.repeat(32);
const second = '2'.repeat(32);

test('backup chunks preserve Unicode and allow an interrupted write to be acknowledged twice', async () => {
  const body = 'x'.repeat(BACKUP_CHUNK_UNITS - 1) + '🧪结束';
  const headers = { 'X-Quotern-Local-Admin': 'fixture' };
  const transfer = createBackupTransfer(1024 * 1024, async (incoming, actualHeaders) => {
    assert.equal(incoming, body);
    assert.deepEqual(actualHeaders, headers);
    return { status: 200, body };
  });
  try {
    await transfer.request({ id: first, op: 'open', length: body.length, headers });
    const initial = backupChunk(body, 0);
    assert.equal(initial.length, BACKUP_CHUNK_UNITS - 1);
    const write = { id: first, op: 'write', offset: 0, text: initial };
    assert.equal(await transfer.request(write), initial.length);
    assert.equal(await transfer.request(write), initial.length);
    await assert.rejects(transfer.request({ id: first, op: 'execute' }), /Incomplete backup upload/);
    await transfer.request({ ...write, offset: initial.length, text: backupChunk(body, initial.length) });
    const serialized = JSON.stringify({ status: 200, body });
    const size = await transfer.request({ id: first, op: 'execute' }) as number;
    assert.equal(size, serialized.length);
    let result = '';
    while (result.length < size) {
      result += await transfer.request({ id: first, op: 'read', offset: result.length }) as string;
    }
    assert.equal(result, serialized);
  } finally {
    transfer.close();
  }
});

test('a closed backup operation keeps the slot until its write finishes', async () => {
  let finish!: () => void;
  let calls = 0;
  const transfer = createBackupTransfer(1024, () => {
    calls++;
    return new Promise(resolve => {
      finish = () => resolve({ status: 200, body: 'completed' });
    });
  });
  await transfer.request({ id: first, op: 'open', length: 0 });
  const execution = transfer.request({ id: first, op: 'execute' });
  const duplicate = transfer.request({ id: first, op: 'execute' });
  const stopped = Promise.all([execution, duplicate].map(promise =>
    assert.rejects(promise, /Backup transfer expired/)));
  try {
    assert.equal(calls, 1);
    await transfer.request({ id: first, op: 'close' });
    await assert.rejects(transfer.request({ id: second, op: 'open', length: 0 }), /BACKUP_BUSY/);
  } finally {
    finish();
    await stopped;
    transfer.close();
  }
  await transfer.request({ id: second, op: 'open', length: 0 });
  transfer.close();
});
