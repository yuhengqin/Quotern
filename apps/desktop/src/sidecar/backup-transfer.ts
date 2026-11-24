import { BACKUP_CHUNK_UNITS, backupChunk } from '../shared/backup-transfer';

type BackupResponse = { status: number; body: unknown };
type Slot = {
  id: string;
  length: number;
  headers?: Record<string, string>;
  chunks: string[];
  units: number;
  bytes: number;
  response?: string;
  execution?: Promise<number>;
  executing?: boolean;
  closeRequested?: boolean;
  expiry?: ReturnType<typeof setTimeout>;
};

export function createBackupTransfer(maximumBytes: number, post: (body: string, headers?: Record<string, string>) => Promise<BackupResponse>) {
  let current: Slot | undefined;

  const release = (slot: Slot) => {
    if (slot.executing) {
      slot.closeRequested = true;
      return;
    }
    clearTimeout(slot.expiry);
    if (current === slot) current = undefined;
    slot.chunks.length = 0;
    slot.response = undefined;
  };
  const touch = (slot: Slot) => {
    clearTimeout(slot.expiry);
    slot.expiry = setTimeout(() => release(slot), 60_000);
    slot.expiry.unref();
  };

  return {
    async request(value: unknown): Promise<unknown> {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup transfer');
      const { id, op, length, offset, text, headers } = value as Record<string, unknown>;
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid backup transfer');

      if (op === 'open') {
        if (current?.id === id) return null;
        if (current) throw new Error('BACKUP_BUSY');
        if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) throw new Error('Invalid backup size');
        if (length > maximumBytes) throw new Error('LOCAL_ADMIN_TOO_LARGE');
        if (headers !== undefined && (!headers || typeof headers !== 'object' || Array.isArray(headers) ||
            Object.values(headers).some(header => typeof header !== 'string'))) {
          throw new Error('Invalid backup headers');
        }
        current = { id, length, headers: headers as Slot['headers'], chunks: [], units: 0, bytes: 0 };
        touch(current);
        return null;
      }

      const slot = current?.id === id ? current : undefined;
      // Retried cleanup must not release a later transfer.
      if (op === 'close') {
        if (slot) release(slot);
        return null;
      }
      if (!slot || slot.closeRequested) throw new Error('Backup transfer expired');

      if (op === 'write') {
        if (slot.execution || typeof text !== 'string' || text.length === 0 || text.length > BACKUP_CHUNK_UNITS) {
          throw new Error('Invalid backup chunk');
        }
        if (offset === slot.units - text.length && slot.chunks.at(-1) === text) return slot.units;
        if (offset !== slot.units || slot.units + text.length > slot.length) throw new Error('Invalid backup chunk offset');
        const bytes = Buffer.byteLength(text);
        if (slot.bytes + bytes > maximumBytes) throw new Error('LOCAL_ADMIN_TOO_LARGE');
        slot.chunks.push(text);
        slot.units += text.length;
        slot.bytes += bytes;
        touch(slot);
        return slot.units;
      }

      if (op === 'execute') {
        if (slot.units !== slot.length) throw new Error('Incomplete backup upload');
        if (!slot.execution) {
          clearTimeout(slot.expiry);
          slot.executing = true;
          const body = slot.chunks.join('');
          slot.chunks.length = 0;
          slot.execution = (async () => {
            try {
              const response = await post(body, slot.headers);
              if (slot.closeRequested) throw new Error('Backup transfer expired');
              // A created backup includes member metadata and the summary in addition to its contents.
              const output = JSON.stringify(response);
              if (Buffer.byteLength(output) > maximumBytes + 8 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
              slot.response = output;
              return output.length;
            } finally {
              slot.executing = false;
              if (slot.closeRequested) release(slot);
              else touch(slot);
            }
          })();
        }
        return slot.execution;
      }

      if (op === 'read' && slot.response !== undefined && typeof offset === 'number' &&
          Number.isSafeInteger(offset) && offset >= 0 && offset < slot.response.length) {
        touch(slot);
        return backupChunk(slot.response, offset);
      }
      throw new Error('Invalid backup transfer operation');
    },
    close() { if (current) release(current); },
  };
}
