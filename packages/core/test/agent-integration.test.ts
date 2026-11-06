import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, appendFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_AGENT_PREFERENCES, patchAgentPreferences, readAgentPreferences } from '../src/agent/preferences.js';
import { evaluateAgentHook, agentHookScript } from '../src/agent/hook.js';
import { setIntegrationInstalled, transformIntegrationHooks, integrationHandler } from '../src/agent/install.js';
import { handoffExcerpts, prepareHandoff } from '../src/agent/handoff.js';
import { claudePluginModule, prepareClaudePlugin } from '../src/agent/plugin.js';
import { Hono } from 'hono';
import { registerAgentApi } from '../src/server/agent-api.js';

test('independent opt-in preferences merge under concurrent writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-agent-prefs-'));
  try {
    assert.deepEqual(await readAgentPreferences(root), DEFAULT_AGENT_PREFERENCES);
    await Promise.all([patchAgentPreferences(root, { tokenSaver: true }), patchAgentPreferences(root, { quotaHints: true })]);
    const prefs = await readAgentPreferences(root);
    assert.equal(prefs.tokenSaver, true); assert.equal(prefs.quotaHints, true); assert.equal(prefs.glossary, false);
    await assert.rejects(patchAgentPreferences(root, { arbitrary: true }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('integration preserves mixed hook groups and refuses malformed config', async () => {
  const own = integrationHandler('codex', '/data', '/node');
  const other = { type: 'command', command: 'notify.py', timeout: 42 };
  const doc = { otherSetting: true, hooks: { Stop: [{ matcher: 'own-matcher', extra: 8, hooks: [other, own] }] } };
  const next = transformIntegrationHooks(doc, [own]);
  assert.deepEqual(next, { otherSetting: true, hooks: { Stop: [{ matcher: 'own-matcher', extra: 8, hooks: [other] }] } });
  assert.throws(() => transformIntegrationHooks({ hooks: 'broken' }, [own]));
  const root = await mkdtemp(join(tmpdir(), 'quotern-agent-install-'));
  try {
    const config = join(root, 'host'); await mkdir(config);
    const target = join(config, 'settings.json');
    await writeFile(target, JSON.stringify(doc));
    await setIntegrationInstalled(root, 'claude', true, { directory: config });
    const once = await readFile(target, 'utf8');
    await setIntegrationInstalled(root, 'claude', true, { directory: config });
    assert.equal(await readFile(target, 'utf8'), once);
    await setIntegrationInstalled(root, 'claude', false);
    const removed = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(removed.hooks.Stop, doc.hooks.Stop);
    assert.equal(removed.otherSetting, true);
    await writeFile(target, '{broken');
    await assert.rejects(setIntegrationInstalled(root, 'claude', true, { directory: config }), /AGENT_INVALID_CONFIG/);
    assert.equal(await readFile(target, 'utf8'), '{broken');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('hooks are nonblocking and same-session guidance is deduplicated', () => {
  const memory = { seen: {} };
  assert.deepEqual(evaluateAgentHook({ session_id: 'one', hook_event_name: 'Stop' }, { tokenSaver: true }, null, memory, 1000), {});
  const first = evaluateAgentHook({ session_id: 'one', hook_event_name: 'SessionStart' }, { tokenSaver: true, beginner: true }, null, memory, 1000);
  assert.equal(first.hookSpecificOutput?.hookEventName, 'SessionStart');
  assert.match(first.hookSpecificOutput?.additionalContext ?? '', /concise answers/);
  assert.deepEqual(evaluateAgentHook({ session_id: 'one', hook_event_name: 'UserPromptSubmit' }, { tokenSaver: true, beginner: true }, null, memory, 1001), {});
});
test('standalone hook runs with Node, releases its lock and saves no prompt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-agent-script-'));
  try {
    await patchAgentPreferences(root, { tokenSaver: true });
    const script = join(root, 'runner.cjs'); await writeFile(script, agentHookScript());
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [script, root, 'claude'], { windowsHide: true });
      let output = '', errors = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => errors += c);
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(output) : reject(new Error(errors)));
      child.stdin.end(JSON.stringify({ session_id: 'fixture', hook_event_name: 'SessionStart', prompt: 'private test content' }));
    });
    assert.match(await run(), /concise answers/);
    assert.deepEqual(JSON.parse(await run()), {});
    const state = await readFile(join(root, 'integrations', 'hook-state.json'), 'utf8');
    assert.doesNotMatch(state, /private test content/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Agent API rejects cross-origin and remote actions and requires a runtime token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-agent-api-'));
  try {
    const app = new Hono(); registerAgentApi(app, root);
    const url = 'http://localhost/functions/tud-agent';
    assert.equal((await app.request(url, { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await app.request(url, {}, { quoternRemoteAddress: '192.0.2.1' })).status, 403);
    const state = (await (await app.request(url)).json()).data;
    const body = JSON.stringify({ action: 'preferences', patch: { quotaHints: true } });
    assert.equal((await app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    const response = await app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Agent-Action': state.token }, body });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.preferences.quotaHints, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('handoff extracts selected-session text and outstanding plan without tool results', () => {
  const rows = [
    { type: 'user', sessionId: 'selected', message: { content: [{ type: 'tool_result', content: 'private result' }, { type: 'text', text: 'Continue UI work' }] } },
    { type: 'user', sessionId: 'other', message: { content: 'wrong session' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ status: 'completed', content: 'Done' }, { status: 'pending', content: 'Review layout' }] } }] } },
  ];
  assert.deepEqual(handoffExcerpts('claude', 'selected', rows.map(row => JSON.stringify(row))), { requests: ['Continue UI work'], pending: ['Review layout'] });
});
test('handoff preview accepts a collected session index larger than the Agent config limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-handoff-large-index-'));
  try {
    await mkdir(join(root, 'sessions'));
    const path = join(root, 'session.jsonl');
    await writeFile(path, [
      { type: 'session_meta', payload: { id: 'handoff-large-index', cwd: root } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Continue the selected project' } },
    ].map(row => JSON.stringify(row)).join('\n'));
    const index = join(root, 'sessions', 'codex.json');
    // JSON whitespace represents unrelated collected history without a huge fixture string.
    await writeFile(index, Buffer.alloc(128 * 1024 * 1024, 32));
    await appendFile(index, JSON.stringify({ files: { [path]: { context: { sessionId: 'handoff-large-index' } } } }));
    const preview = await prepareHandoff(root, 'codex', 'handoff-large-index');
    assert.match(preview.text, /Continue the selected project/);
    assert.equal(preview.canSave, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('handoff reads current Codex user records once and respects session boundaries', () => {
  const rows = [
    { type: 'session_meta', payload: { id: 'selected' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the preview' }] } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Fix the preview' }] } } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Private response' }] } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Keep the draft editable' }] } } },
    { type: 'response_item', payload: { type: 'function_call', name: 'functions.update_plan', arguments: JSON.stringify({ plan: [{ step: 'Check preview', status: 'in_progress' }] }) } },
    { type: 'session_meta', payload: { id: 'other' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Wrong session' } },
  ];
  assert.deepEqual(handoffExcerpts('codex', 'selected', rows.map(row => JSON.stringify(row))), { requests: ['Fix the preview', 'Keep the draft editable'], pending: ['Check preview'] });
});
test('generated Claude plugin is valid JavaScript and learning remains explicitly gated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-plugin-'));
  try {
    const result = await prepareClaudePlugin(root);
    assert.match(result.command, /--plugin-dir/);
    const module = await import('data:text/javascript;base64,' + Buffer.from(claudePluginModule(root)).toString('base64'));
    const handlers = new Map();
    module.register((event: string, matcher: unknown, handler?: unknown) => { handlers.set(event + ':' + (typeof matcher === 'object' ? (matcher as { command?: string }).command ?? '' : ''), handler ?? matcher); });
    let calls = 0;
    const api = { fs: { stat: async () => { throw new Error('absent'); } }, session: { usage: async () => ({ rateLimits: [] }) }, agent: { list: async () => [] }, store: { get: async () => [], keys: async () => [] }, ui: { invalidate: () => {} }, model: { complete: async () => { calls++; return ''; } } };
    const reply = await handlers.get('command.run:quotern-learn')(api);
    assert.match(reply.text, /Enable/);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
