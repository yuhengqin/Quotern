import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDisplayTitle, sessionProjectDisplay } from './session-list-display.ts';

test('session titles prefer named metadata and use an explicit unnamed identity otherwise', () => {
  assert.equal(sessionDisplayTitle({ sessionTitle: '  Review CLI changes  ', sessionId: 'abcdef1234567890' }, 'Untitled session'), 'Review CLI changes');
  assert.equal(sessionDisplayTitle({ sessionTitle: null, sessionId: 'abcdef1234567890' }, '未命名会话'), '未命名会话 · 34567890');
  assert.equal(sessionDisplayTitle({ sessionTitle: '  ', sessionId: 'short' }, 'Untitled session'), 'Untitled session · short');
});

test('unnamed sessions use trusted nicknames and roles from summaries or legacy details', () => {
  const sessionId = 'abcdef1234567890';
  assert.equal(sessionDisplayTitle({ sessionId, relation: { agentNickname: ' Ada ', agentRole: 'explorer' } }, '未命名会话'), 'Ada · 34567890');
  assert.equal(sessionDisplayTitle({ sessionId, relation: { agentRole: 'reviewer' } }, '未命名会话'), 'reviewer · 34567890');
  assert.equal(sessionDisplayTitle({ sessionId, relation: {}, insights: { agentNickname: 'Grace', agentRole: 'reviewer' } }, '未命名会话'), 'Grace · 34567890');
  assert.equal(sessionDisplayTitle({ sessionId, sessionTitle: '真实标题', relation: { agentNickname: 'Ada' } }, '未命名会话'), '真实标题');
  assert.equal(sessionDisplayTitle({ sessionId, relation: { agentRole: 'default', agentNickname: '  ' } }, '未命名会话'), '未命名会话 · 34567890');
});

test('project display shortens explicit paths and URLs without rewriting literal project names', () => {
  assert.equal(sessionProjectDisplay('D:\\AgentPro\\Quotern\\'), 'Quotern');
  assert.equal(sessionProjectDisplay('/home/user/project%2F2026'), 'project%2F2026');
  assert.equal(sessionProjectDisplay('file:///D:/AgentPro/My%20Project'), 'My Project');
  assert.equal(sessionProjectDisplay('https://ghuntley.com/allocations/'), 'ghuntley.com/allocations');
  assert.equal(sessionProjectDisplay('project%2F2026'), 'project%2F2026');
  assert.equal(sessionProjectDisplay('my-project-with-dashes'), 'my-project-with-dashes');
});

test('long project labels preserve both ends and do not split Unicode characters', () => {
  const label = 'https-ghuntley-com-allocations-' + 'long-'.repeat(12) + 'task-id-42';
  const compact = sessionProjectDisplay(label);
  assert.ok(compact.startsWith('https-ghuntley-com') && compact.endsWith('task-id-42'));
  assert.ok(compact.includes('…') && [...compact].length <= 40);
  const unicode = '🔬'.repeat(45);
  assert.ok([...sessionProjectDisplay(unicode)].every(character => character === '🔬' || character === '…'));
  assert.ok([...sessionProjectDisplay(unicode)].length <= 40);
});

test('malformed URLs and root paths keep a usable original label', () => {
  assert.equal(sessionProjectDisplay('https://[broken'), 'https://[broken');
  assert.equal(sessionProjectDisplay('/'), '/');
  assert.equal(sessionProjectDisplay('https://example.com/a%ZZ'), 'example.com/a%ZZ');
});
