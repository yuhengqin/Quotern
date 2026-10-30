import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { codexHomeCandidates } from './paths.js';

export interface ContextAuditItem {
  category: 'instruction' | 'skill' | 'mcp_config';
  scope: 'project' | 'user-candidate';
  name: string;
  bytes: number;
  estimatedTokens: number | null;
  loadStatus: 'unknown';
}
export interface ContextAuditDiagnostic {
  name: string;
  scope: ContextAuditItem['scope'];
  category: ContextAuditItem['category'];
  target: 'file' | 'directory';
  reason: 'file_limit' | 'file_size_limit' | 'depth_limit' | 'directory_limit' | 'file_access_error' | 'directory_access_error' | 'invalid_json';
  errorCode?: string;
}
export interface ContextAudit {
  generatedAt: string;
  scope: 'server-working-directory';
  estimateMethod: 'cjk-1-other-4-v1';
  actualLoadedTokens: null;
  estimatedDiscoveredTokens: number;
  discoveredBytes: number;
  items: ContextAuditItem[];
  truncated: boolean;
  unreadableCount: number;
  /** Counts known skipped file/directory entries, not unknown files in unscanned subtrees. */
  truncatedCount?: number;
  diagnostics?: ContextAuditDiagnostic[];
  diagnosticsTruncated?: boolean;
  mcp: { declaredServerCount: number; connectedServerCount: null; actualSchemaTokens: null };
}
export async function auditContextSources(options: { projectDir?: string; userRoots?: string[]; maxFiles?: number } = {}): Promise<ContextAudit> {
  const project = resolve(options.projectDir ?? process.cwd());
  const userRoots = options.userRoots ?? [...new Set([...codexHomeCandidates(), join(homedir(), '.claude'), join(homedir(), '.agents')])];
  const limit = Math.max(1, Math.min(500, options.maxFiles ?? 500));
  const report: ContextAudit = { generatedAt: new Date().toISOString(), scope: 'server-working-directory', estimateMethod: 'cjk-1-other-4-v1', actualLoadedTokens: null, estimatedDiscoveredTokens: 0, discoveredBytes: 0, items: [], truncated: false, unreadableCount: 0, truncatedCount: 0, diagnostics: [], diagnosticsTruncated: false, mcp: { declaredServerCount: 0, connectedServerCount: null, actualSchemaTokens: null } };
  const seen = new Set<string>(), servers = new Set<string>();
  const nameFor = (path: string, root: string, scope: ContextAuditItem['scope']) => `${scope === 'project' ? 'project' : `user-${userRoots.indexOf(root) + 1}/${basename(root)}`}/${relative(root, path).replace(/\\/g, '/')}`;
  const diagnose = (path: string, root: string, scope: ContextAuditItem['scope'], category: ContextAuditItem['category'], target: ContextAuditDiagnostic['target'], reason: ContextAuditDiagnostic['reason'], error?: unknown) => {
    if (reason.endsWith('_limit')) { report.truncated = true; report.truncatedCount!++; }
    else report.unreadableCount++;
    if (report.diagnostics!.length >= 100) { report.diagnosticsTruncated = true; return; }
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    report.diagnostics!.push({ name: nameFor(path, root, scope), scope, category, target, reason, ...(typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? { errorCode: code } : {}) });
  };
  let directories = 0;
  const add = async (path: string, root: string, scope: ContextAuditItem['scope'], category: ContextAuditItem['category']) => {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
      const identity = await realpath(path);
      if (seen.has(identity)) return;
      if (report.items.length >= limit || stat.size > 2 * 1024 * 1024) { diagnose(path, root, scope, category, 'file', report.items.length >= limit ? 'file_limit' : 'file_size_limit'); return; }
      seen.add(identity);
      const content = await readFile(path, 'utf8');
      const cjk = (content.match(/[\u3400-\u9fff\u3040-\u30ff]/gu) ?? []).length;
      const estimatedTokens = category === 'mcp_config' ? null : cjk + Math.ceil((content.length - cjk) / 4);
      report.items.push({ category, scope, name: nameFor(path, root, scope), bytes: stat.size, estimatedTokens, loadStatus: 'unknown' });
      report.discoveredBytes += stat.size;
      report.estimatedDiscoveredTokens += estimatedTokens ?? 0;
      if (category === 'mcp_config') {
        if (path.endsWith('.toml')) {
          for (const match of content.matchAll(/^\s*\[mcp_servers\.([^\]\s]+)\]\s*$/gm)) servers.add(`${identity}:${match[1]}`);
        } else {
          try {
            const config = JSON.parse(content) as Record<string, unknown>;
            const declared = config.mcpServers ?? config.mcp_servers;
            if (declared && typeof declared === 'object' && !Array.isArray(declared)) for (const name of Object.keys(declared)) servers.add(`${identity}:${name}`);
          } catch { diagnose(path, root, scope, category, 'file', 'invalid_json'); }
        }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnose(path, root, scope, category, 'file', 'file_access_error', error); }
  };
  const skills = async (path: string, root: string, scope: ContextAuditItem['scope'], depth = 0): Promise<void> => {
    try {
      if((await lstat(path)).isSymbolicLink())return;
      if (depth > 7 || ++directories > 1000 || report.items.length >= limit) {
        diagnose(path, root, scope, 'skill', 'directory', depth > 7 ? 'depth_limit' : directories > 1000 ? 'directory_limit' : 'file_limit'); return;
      }
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || ['.git', 'node_modules', 'dist', 'build'].includes(entry.name)) continue;
        const child = join(path, entry.name);
        if (entry.isFile() && entry.name === 'SKILL.md') await add(child, root, scope, 'skill');
        else if (entry.isDirectory()) await skills(child, root, scope, depth + 1);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnose(path, root, scope, 'skill', 'directory', 'directory_access_error', error); }
  };
  for (const name of ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', '.claude/CLAUDE.md']) await add(join(project, name), project, 'project', 'instruction');
  for (const name of ['.agents/skills', '.codex/skills', '.claude/skills']) await skills(join(project, name), project, 'project');
  await add(join(project, '.mcp.json'), project, 'project', 'mcp_config');
  for (const root of userRoots) {
    for (const name of ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md']) await add(join(root, name), root, 'user-candidate', 'instruction');
    await skills(join(root, 'skills'), root, 'user-candidate');
    for (const name of ['config.toml', 'settings.json']) await add(join(root, name), root, 'user-candidate', 'mcp_config');
  }
  report.mcp.declaredServerCount = servers.size;
  return report;
}
