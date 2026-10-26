import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bin = fileURLToPath(new URL(process.env.QUOTERN_CLI_TEST_DIST ? `${process.env.QUOTERN_CLI_TEST_DIST}/index.js` : '../bin/quotern.js', import.meta.url));

test('MCP lists four read-only tools, validates parameters and leaves missing storage untouched', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-mcp-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp', '--data-dir', dir], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', part => { stderr += part; });
  const client = new Client({ name: 'quota-fixture', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['quota_diagnostics', 'quota_forecast', 'quota_recommend', 'quota_status']);
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.openWorldHint, false);
      const result = await client.callTool({ name: tool.name, arguments: { provider: 'codex' } });
      if (tool.name === 'quota_recommend') assert.equal(result.structuredContent.result, 'unknown');
      else assert.equal(result.structuredContent.availability, 'missing');
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    }
    const invalid = await client.callTool({ name: 'quota_status', arguments: { refresh: true } });
    assert.equal(invalid.isError, true);
    const provider = await client.callTool({ name: 'quota_status', arguments: { provider: 'nonexistent' } });
    assert.equal(provider.isError, true);
    assert.deepEqual(await readdir(dir), []); assert.equal(stderr, '');
  } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
});

test('MCP stdin EOF terminates cleanly without a service stop banner on stdout', { timeout: 10000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-mcp-eof-'));
  try {
    const child = spawn(process.execPath, [bin, 'mcp', '--data-dir', dir], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise(resolve => child.once('close', code => resolve(code)));
    child.stdin.end();
    assert.equal(await closed, 0); assert.equal(stdout, ''); assert.equal(stderr, '');
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
