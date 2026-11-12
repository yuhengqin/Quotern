import assert from 'node:assert/strict';
import test from 'node:test';
import * as hooks from '../src/agent/hook.js';
import { transformIntegrationHooks, integrationHandler } from '../src/agent/install.js';
import { agentHookScript } from '../src/agent/hook.js';
import { patchAgentPreferences } from '../src/agent/preferences.js';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

type Notice = { kind: string; sessionId: string; requestId?: string; requestKey?: string };
const event = (input: Record<string, unknown>, source = 'claude') => {
  const reduce = (hooks as unknown as { notificationHookEvent?: (input: Record<string, unknown>, source: string, now: number) => Notice | null }).notificationHookEvent;
  assert.equal(typeof reduce, 'function');
  return reduce!({ session_id: 'session', ...input }, source, 1000);
};
test('notification hooks map explicit finish, permission, question, failure and resolution', () => {
  assert.equal(event({ hook_event_name: 'Stop' })?.kind, 'complete');
  assert.equal(event({ hook_event_name: 'StopFailure', error: 'rate_limit' })?.kind, 'error');
  assert.equal(event({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'request' })?.requestId, 'request');
  assert.equal(event({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })?.kind, 'confirmation');
  assert.equal(event({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }), null, 'PermissionRequest is canonical, so the duplicate channel is ignored');
  assert.equal(event({ hook_event_name: 'PostToolUse', tool_use_id: 'request' })?.kind, 'resolved');
  assert.equal(event({ hook_event_name: 'Interrupt' }, 'codex')?.kind, 'resolved');
});
test('Codex approval without a call id resolves through the same tool and turn key', () => {
  const approval = event({ hook_event_name: 'PermissionRequest', turn_id: 'turn', tool_name: 'Bash' }, 'codex');
  const resolved = event({ hook_event_name: 'PostToolUse', turn_id: 'turn', tool_name: 'Bash', tool_use_id: 'actual-call' }, 'codex');
  assert.equal(approval?.requestId, 'Bash:turn'); assert.equal(resolved?.requestId, 'actual-call');
  assert.equal(resolved?.requestKey, approval?.requestId);
});
test('notification metadata excludes messages, input, output and unverified errors', () => {
  assert.equal(event({ hook_event_name: 'PostToolUse', tool_response: { output: 'error is plain text', exit_code: 1 } }, 'codex')?.kind, 'resolved');
  assert.equal(event({ hook_event_name: 'PostToolUseFailure', is_interrupt: true }), null);
  assert.equal(event({ hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
  assert.equal(event({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }), null);
  assert.equal(event({ hook_event_name: 'Stop', session_id: '\u001bunsafe' }), null);
  const row = event({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { secret: 'private text' }, prompt: 'private text', last_assistant_message: 'private text' });
  assert.doesNotMatch(JSON.stringify(row), /private text|tool_input|prompt|last_assistant/);
});

test('the real generated hook writes bounded notification metadata with all other features disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-notification-hook-'));
  try {
    await patchAgentPreferences(root, { desktopNotifications: true });
    const script = join(root, 'hook.cjs'); await writeFile(script, agentHookScript());
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [script, root, 'claude'], { windowsHide: true }); let text = '', errors = '';
      child.stdout.on('data', chunk => text += chunk); child.stderr.on('data', chunk => errors += chunk);
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(text) : reject(new Error(errors)));
      child.stdin.end(JSON.stringify({ session_id: 'fixture', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'request', tool_input: { secret: 'do not retain' }, prompt: 'do not retain' }));
    });
    assert.deepEqual(JSON.parse(output), {});
    const directory = join(root, 'integrations/notification-events'), files = await readdir(directory); assert.equal(files.length, 1);
    const text = await readFile(join(directory, files[0]!), 'utf8'), row = JSON.parse(text);
    assert.equal(row.version, 1); assert.equal(row.kind, 'confirmation'); assert.equal(row.requestId, 'request');
    assert.doesNotMatch(text, /do not retain|tool_input|prompt/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('hook registration covers only provider-supported notification events', () => {
  const claude = transformIntegrationHooks({}, [], integrationHandler('claude', '/data', '/node')).hooks as Record<string, unknown>;
  const codex = transformIntegrationHooks({}, [], integrationHandler('codex', '/data', '/node')).hooks as Record<string, unknown>;
  assert.ok(claude.StopFailure); assert.ok(claude.Notification); assert.ok(claude.PreToolUse);
  assert.ok(codex.PreToolUse); assert.ok(codex.PostToolUse); assert.ok(codex.Interrupt);
  assert.equal(codex.StopFailure, undefined); assert.equal(codex.Notification, undefined);
});
