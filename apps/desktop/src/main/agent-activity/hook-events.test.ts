import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentHookEvents } from './hook-events.js';
import type { ActivityEvent } from '../../shared/agent-activity.js';

test('independent hook events baseline old data, consume fresh metadata once, and reject stale/oversized records', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quotern-notification-events-')), events: ActivityEvent[] = [];
  const now = 1_000_000;
  const put = async (n: number, patch: Record<string, unknown> = {}) => {
    const id = `${String(n).padStart(13, '0')}-0123456789abcdef`;
    await writeFile(path.join(directory, id + '.json'), JSON.stringify({ version: 1, id, source: 'claude', sessionId: 's', at: now / 1000, kind: 'confirmation', event: 'PermissionRequest', requestId: 'r', ...patch }));
  };
  const monitor = new AgentHookEvents({ directory, now: () => now, onEvent: event => events.push(event) });
  try {
    await put(1); await monitor.start(); await monitor.poll(); assert.equal(events.length, 0);
    await put(2); await monitor.poll(); await monitor.poll(); assert.equal(events.length, 1); assert.equal(events[0]!.notice, 'confirmation'); assert.equal(events[0]!.requestId, 'r');
    await put(3, { kind: 'resolved', event: 'PostToolUse' }); await monitor.poll(); assert.equal(events[1]!.resolvedRequestId, 'r');
    await put(4, { at: now / 1000 - 121 }); await put(5, { padding: 'x'.repeat(5000) }); await monitor.poll(); assert.equal(events.length, 2);
    monitor.dispose(); await put(6); await monitor.poll(); assert.equal(events.length, 2);
  } finally { monitor.dispose(); await rm(directory, { recursive: true, force: true }); }
});
