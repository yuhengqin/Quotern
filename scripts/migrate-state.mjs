import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readlink, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

async function snapshot(root) {
  const entries = [];
  async function visit(relative) {
    const path = join(root, relative);
    const stat = await lstat(path);
    const mode = process.platform === 'win32' ? 0 : stat.mode & 0o777;
    if (stat.isDirectory()) {
      entries.push([relative, 'directory', mode]);
      for (const name of (await readdir(path)).sort()) await visit(join(relative, name));
    } else if (stat.isFile()) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      entries.push([relative, 'file', mode, hash.digest('hex')]);
    } else if (stat.isSymbolicLink()) {
      entries.push([relative, 'symlink', await readlink(path)]);
    } else {
      throw new Error(`Unsupported state entry: ${relative}. Stop the application before migration.`);
    }
  }
  await visit('');
  return JSON.stringify(entries);
}

async function canonicalDestination(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(await canonicalDestination(dirname(path)), basename(path));
  }
}

/** Explicit, offline migration. The source remains as a backup; conflicts require manual resolution. */
export async function migrateState(from, to) {
  const sourcePath = resolve(from);
  if (!(await lstat(sourcePath)).isDirectory()) throw new Error('Source must be a directory.');
  const source = await realpath(sourcePath);
  const destination = resolve(to);
  const canonical = await canonicalDestination(destination);
  if (canonical === source || canonical.startsWith(source + sep) || source.startsWith(canonical + sep)) {
    throw new Error('Source and destination must be separate directories.');
  }
  const before = await snapshot(source);
  try {
    const stat = await lstat(destination);
    if (stat.isDirectory() && await snapshot(destination) === before) {
      return { status: 'already-copied', destination };
    }
    throw new Error('Destination already exists with different state. Back it up and resolve the conflict first.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(join(dirname(destination), '.quotern-migration-'));
  const profile = join(stage, 'profile');
  try {
    await cp(source, profile, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true });
    await chmod(profile, (await lstat(source)).mode & 0o777);
    if (await snapshot(profile) !== before || await snapshot(source) !== before) {
      throw new Error('State changed during migration. Stop the application and retry.');
    }
    // mkdir fails atomically if a competing process creates the destination.
    try {
      await mkdir(destination, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Destination already exists. No state was overwritten.');
      throw error;
    }
    try {
      for (const name of (await readdir(profile)).sort()) {
        await cp(join(profile, name), join(destination, name), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true });
      }
      await chmod(destination, (await lstat(profile)).mode & 0o777);
      if (await snapshot(destination) !== before) throw new Error('Destination verification failed.');
    } catch (error) {
      throw new Error(`Migration incomplete at ${destination}; source is preserved. Back up the incomplete destination before retrying. ${error.message}`, { cause: error });
    }
    return { status: 'copied', destination };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      console.log('Stop the application first. Usage: node scripts/migrate-state.mjs --from SOURCE_DIR --to QUOTERN_DIR');
    } else {
      if (!values.from || !values.to) throw new Error('Both --from and --to are required.');
      console.log(JSON.stringify(await migrateState(values.from, values.to)));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
