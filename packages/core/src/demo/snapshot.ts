import { link, lstat, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadBucketsForRange } from '../queue/index.js';
import { readSessionHistory } from '../session-collector.js';
import { AchievementStore } from '../achievements/store.js';
import { buildAchievementFacts } from '../achievements/facts.js';
import { applyRemotePricingOverlay, getPricingSnapshot, loadCachedPricingOverlay } from '../pricing/index.js';
import type { DemoSnapshot } from './types.js';
import { anonymizeDemoSnapshot } from './projection.js';
import { projectDemoSnapshot } from './schema.js';

async function canonical(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = dirname(path); if (parent === path) throw error; return join(await canonical(parent), relative(parent, path)); }
}
const contains = (parent: string, child: string) => { const rel = relative(parent, child); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
async function fingerprint(dir: string): Promise<string> {
  const files = ['config.json', 'pricing-overlay.json', 'achievements/state.json'];
  for (const sub of ['queue', 'sessions']) {
    const directory = await lstat(join(dir, sub)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) throw new Error('演示导出拒绝符号链接或非普通数据目录');
    const entries = await readdir(join(dir, sub), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return []; });
    for (const entry of entries) if (entry.name.endsWith(sub === 'queue' ? '.jsonl' : '.json')) {
      if (!entry.isFile()) throw new Error('演示导出拒绝符号链接或非普通数据文件');
      files.push(`${sub}/${entry.name}`);
    }
  }
  const stamps = await Promise.all(files.sort().map(async name => {
    if (name === 'achievements/state.json') {
      const folder = await lstat(join(dir, 'achievements')).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
      if (folder && (!folder.isDirectory() || folder.isSymbolicLink())) throw new Error('演示导出拒绝符号链接或非普通数据目录');
    }
    try { const info = await lstat(join(dir, name)); if (!info.isFile() || info.isSymbolicLink()) throw new Error('演示导出拒绝非普通数据文件'); return [name, info.size, info.mtimeMs, info.ctimeMs, info.ino]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [name, null]; throw error; }
  }));
  return JSON.stringify(stamps);
}

/** Reads only persisted accounting files. Never loads/repairs normal config or starts a runtime. */
export async function exportDemoSnapshot(sourceDir: string, outputFile: string, options: { now?: Date } = {}): Promise<DemoSnapshot> {
  const source = await realpath(resolve(sourceDir)), output = await canonical(resolve(outputFile));
  if (contains(source, output) || contains(output, source)) throw new Error('演示输出路径与源数据目录重叠');
  if (await lstat(output).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return false; })) throw new Error('演示输出文件已存在，不会覆盖');
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('演示导出时间无效');
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await fingerprint(source);
    const raw: unknown = JSON.parse(await readFile(join(source, 'config.json'), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('源配置无效，演示导出不会修复');
    const config = raw as Record<string, unknown>;
    const buckets = await loadBucketsForRange(source, '0001-01-01T00:00:00.000Z');
    if (!buckets.length) throw new Error('没有已采集的统计数据可供演示导出');
    const history = await readSessionHistory(source, [...new Set(buckets.map(row => row.source))]);
    if (!loadCachedPricingOverlay(source)) applyRemotePricingOverlay(null);
    const times = [...buckets.map(row => Date.parse(row.hour_start) + 30 * 60000), ...history.messages.map(row => Date.parse(row.timestamp) + 1), ...history.observations.map(row => Date.parse(row.timestamp) + 1), ...history.timingEvents.map(row => Date.parse(row.timestamp) + 1)];
    const latest = times.reduce((max, stamp) => Math.max(max, stamp), 0);
    const referenceTime = new Date(Math.min(now.getTime(), latest)).toISOString();
    const earliest = [...buckets.map(row => Date.parse(row.hour_start)), ...history.messages.map(row => Date.parse(row.timestamp))].reduce((min, stamp) => Math.min(min, stamp), now.getTime());
    const collectSince = new Date(earliest).toISOString();
    const achievements = await new AchievementStore(source, async () => buildAchievementFacts(buckets, history.messages, history.missingSources, new Date(referenceTime))).readOnly();
    const result = anonymizeDemoSnapshot({ schemaVersion: 1, readOnly: true, exportedAt: now.toISOString(), referenceTime, collectSince,
      lastSyncAt: typeof config.lastSyncAt === 'string' && Number.isFinite(Date.parse(config.lastSyncAt)) ? config.lastSyncAt : null,
      buckets, history: { ...history, titles: [...history.titles], codexParents: [...history.codexParents] }, achievements, pricing: getPricingSnapshot() });
    if (before !== await fingerprint(source)) continue;
    await mkdir(dirname(output), { recursive: true });
    // Re-resolve after mkdir as well; a symlinked parent must not redirect into the source.
    if (output !== await canonical(output)) throw new Error('演示输出目录在导出期间发生变化');
    const temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(result) + '\n', { flag: 'wx', mode: 0o600 });
      // Publish atomically without replacing an existing destination, even with concurrent exports.
      await link(temporary, output);
    } finally { await unlink(temporary).catch(() => undefined); }
    return result;
  }
  throw new Error('源数据在导出期间持续变化，请稍后重试；未写入演示文件');
}

export async function loadDemoSnapshot(file: string): Promise<DemoSnapshot> {
  try {
    if ((await stat(file)).size > 256 * 1024 * 1024) throw new Error('oversized');
    return projectDemoSnapshot(JSON.parse(await readFile(file, 'utf8')));
  } catch (cause) { throw new Error('无法读取演示快照：文件缺失、损坏或版本不兼容', { cause }); }
}
