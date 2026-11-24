export const BACKUP_ROUTE = '/functions/tud-local-admin/backup';
export const BACKUP_TRANSFER = 'backup:transfer';
export const BACKUP_CHUNK_UNITS = 512 * 1024;

export function backupChunk(text: string, offset: number): string {
  let end = Math.min(offset + BACKUP_CHUNK_UNITS, text.length);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(offset, end);
}
