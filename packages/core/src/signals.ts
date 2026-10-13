import { writeFile } from 'node:fs/promises';

import { syncDonePath } from './paths.js';

export async function writeSyncDone(dataDir: string): Promise<void> {
  await writeFile(syncDonePath(dataDir), `${new Date().toISOString()}\n`, 'utf8');
}
