import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, resolve } from 'node:path';

export type ProjectKind = 'repository' | 'manifest' | 'unconfirmed';
export interface SessionProjectEvidence { projectId: string; projectLabel: string; projectKind: ProjectKind; projectLegacyId?: string }

/** Literal paths only: percent signs are never decoded. Foreign paths retain their namespace. */
function pathIdentity(raw: string): { identity: string; label: string } | null {
  let path = raw.replace(/\\/g, '/');
  if (/^\/\/\?\/UNC\//i.test(path)) path = '//' + path.slice(8);
  else if (/^\/\/\?\/[a-z]:\//i.test(path)) path = path.slice(4);
  else if (path.startsWith('//?/') || path.startsWith('//./')) return null;
  let identity: string;
  if (/^[a-z]:\//i.test(path)) {
    path = posix.normalize(path).replace(/\/+$/, '');
    identity = 'win-drive:' + path.toLowerCase();
  } else if (path.startsWith('//')) {
    path = '//' + posix.normalize(path.slice(2)).replace(/\/+$/, '');
    if (path.split('/').filter(Boolean).length < 2) return null;
    identity = 'win-unc:' + path.toLowerCase();
  } else if (path.startsWith('/')) {
    path = posix.normalize(path).replace(/\/+$/, '') || '/';
    identity = 'posix:' + path;
  } else return null;
  const label = posix.basename(path);
  return label && !/^[a-z]:$/i.test(label) ? { identity, label } : null;
}
const idFor = (identity: string) => createHash('sha256').update(identity).digest('hex');
const cache = new Map<string, SessionProjectEvidence | null>();
const manifests = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'CMakeLists.txt', 'composer.json', '.project'];
export function clearProjectResolutionCache(): void { cache.clear(); }

function repositoryRoot(directory: string): string | null {
  const marker = join(directory, '.git');
  try {
    let gitDir = marker;
    if (statSync(marker).isFile()) {
      const match = /^gitdir:\s*(.+)$/im.exec(readFileSync(marker, 'utf8'));
      if (!match) return null;
      gitDir = resolve(directory, match[1]!.trim());
    }
    const commonFile = join(gitDir, 'commondir');
    if (existsSync(commonFile)) gitDir = resolve(gitDir, readFileSync(commonFile, 'utf8').trim());
    if (!statSync(gitDir).isDirectory()) return null;
    // Worktrees share commondir. A nonstandard separate git-dir also shares one identity.
    return basename(gitDir).toLowerCase() === '.git' ? dirname(gitDir) : gitDir;
  } catch { return null; }
}

export function resolveSessionProject(raw: string): SessionProjectEvidence | null {
  if (cache.has(raw)) return cache.get(raw)!;
  const original = pathIdentity(raw);
  if (!original) { cache.set(raw, null); return null; }
  let root = raw, kind: ProjectKind = 'unconfirmed';
  // Do not interpret a Linux path as a drive-relative Windows path (or vice versa).
  const native = process.platform === 'win32' ? /^[a-z]:[\\/]|^(?:\\\\|\/\/)/i.test(raw) : raw.startsWith('/');
  if (native && isAbsolute(raw)) {
    let directory = raw, manifest: string | null = null;
    while (true) {
      const repository = repositoryRoot(directory);
      if (repository) { root = repository; kind = 'repository'; break; }
      if (!manifest && manifests.some(name => { try { return statSync(join(directory, name)).isFile(); } catch { return false; } })) manifest = directory;
      const parent = dirname(directory);
      if (parent === directory) {
        if (manifest) { root = manifest; kind = 'manifest'; }
        break;
      }
      directory = parent;
    }
    if (kind !== 'unconfirmed') { try { root = realpathSync.native(root); } catch { /* Keep verified lexical root. */ } }
  }
  const canonical = pathIdentity(root) ?? original;
  const projectId = idFor(canonical.identity), legacyId = idFor(original.identity);
  const result: SessionProjectEvidence = { projectId, projectLabel: canonical.label, projectKind: kind, ...(legacyId !== projectId ? { projectLegacyId: legacyId } : {}) };
  cache.set(raw, result);
  return result;
}
