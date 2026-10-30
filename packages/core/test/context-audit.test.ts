import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditContextSources } from '../src/context-audit.js';

test('context audit reports discovery separately from actual loading without revealing content or MCP secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-context-'));
  try {
    await mkdir(join(root, '.agents', 'skills', 'demo'), { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'PRIVATE_INSTRUCTION_CONTENT');
    await writeFile(join(root, '.agents', 'skills', 'demo', 'SKILL.md'), 'PRIVATE_SKILL_CONTENT');
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'PRIVATE_COMMAND', env: { TOKEN: 'PRIVATE_SECRET' } } } }));
    const result = await auditContextSources({ projectDir: root, userRoots: [], maxFiles: 20 });
    assert.equal(result.actualLoadedTokens, null);
    assert.equal(result.mcp.actualSchemaTokens, null);
    assert.equal(result.mcp.declaredServerCount, 1);
    assert.equal(result.items.filter(item => item.category === 'skill').length, 1);
    assert.ok(result.estimatedDiscoveredTokens > 0);
    assert.ok(result.items.every(item => item.loadStatus === 'unknown'));
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
    assert.ok(!JSON.stringify(result).includes(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('bounded context discovery exposes truncation rather than claiming complete zero cost', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-context-'));
  try {
    await writeFile(join(root, 'AGENTS.md'), 'a');
    await writeFile(join(root, 'CLAUDE.md'), 'b');
    const result = await auditContextSources({ projectDir: root, userRoots: [], maxFiles: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.truncated, true);
    assert.equal((result as any).diagnostics[0].name, 'project/CLAUDE.md');
    assert.equal((result as any).diagnostics[0].reason, 'file_limit');
    assert.equal((result as any).truncatedCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('diagnostics locate oversized files, invalid JSON and directory failures without leaking content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-context-diagnostics-'));
  try {
    await writeFile(join(root, 'AGENTS.md'), 'x'.repeat(2 * 1024 * 1024 + 1));
    await writeFile(join(root, '.mcp.json'), '{"secret":"PRIVATE_TOKEN"');
    await mkdir(join(root, '.agents'));
    await writeFile(join(root, '.agents', 'skills'), 'not a directory');
    const result = await auditContextSources({ projectDir: root, userRoots: [] });
    const diagnostics = (result as any).diagnostics;
    assert.deepEqual(diagnostics.map((item: any) => [item.name, item.reason]), [
      ['project/AGENTS.md', 'file_size_limit'],
      ['project/.agents/skills', 'directory_access_error'],
      ['project/.mcp.json', 'invalid_json'],
    ]);
    assert.equal(result.unreadableCount, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.category, 'mcp_config');
    assert.equal(result.estimatedDiscoveredTokens, 0);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
    assert.ok(!JSON.stringify(result).includes(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('hitting the exact file budget does not invent skipped nonexistent directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-context-exact-'));
  try {
    await writeFile(join(root, 'AGENTS.md'), 'a');
    const result = await auditContextSources({ projectDir: root, userRoots: [], maxFiles: 1 });
    assert.equal(result.truncated, false);
    assert.deepEqual((result as any).diagnostics, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
