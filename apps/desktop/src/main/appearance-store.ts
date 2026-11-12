import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppearancePreferences } from '../shared/appearance.js';

export async function readAppearancePreferences(directory: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(directory, 'appearance.json'), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeAppearancePreferences(directory: string, value: AppearancePreferences): Promise<void> {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.appearance-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, ...value }) + '\n', 'utf8');
    await rename(temporary, join(directory, 'appearance.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}
