// Runs installed provider CLIs against a deterministic localhost model endpoint.
// The CLI, its permission flow, transcripts and installed Quotern hooks are real;
// the model reply/failure is controlled and is never labelled as a cloud-model test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import * as zlib from 'node:zlib';
import { once } from 'node:events';

const [directory, scenario] = process.argv.slice(2);
assert.ok(directory && /^(codex|claude)-(complete|confirm|error)$/.test(scenario ?? ''), 'Pass a native acceptance directory and codex|claude-complete|confirm|error');
const ready = JSON.parse(await readFile(path.join(path.resolve(directory), 'ready.json'), 'utf8'));
assert.equal(path.resolve(ready.root), path.resolve(directory), 'Acceptance ownership must match its ready file');
const provider = scenario.split('-')[0], kind = scenario.split('-')[1];
const rows = []; const log = (event, detail = {}) => { const row = { at: new Date().toISOString(), event, ...detail }; rows.push(row); console.log(JSON.stringify(row)); };
const command = "Write-Output 'QUOTERN_NATIVE_APPROVAL_OK'";
let requests = 0, pendingApproval, child, pending = new Map(), rpcId = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const has = async file => { try { await access(file); return true; } catch { return false; } };
const release = path.join(ready.root, `release-${scenario}`);
await rm(release, { force: true });
const deadlineAt = Date.now() + 6 * 60_000;
let finished = false;
function sse(response, name, value) { response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`); }
function codexReply(response, item, model) {
  const value = { id: `resp_acceptance_${requests}`, object: 'response', created_at: Math.floor(Date.now() / 1000), model, status: 'in_progress', output: [] };
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  sse(response, 'response.created', { type: 'response.created', response: value });
  sse(response, 'response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } });
  if (item.type === 'message') sse(response, 'response.output_text.delta', { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
  sse(response, 'response.output_item.done', { type: 'response.output_item.done', output_index: 0, item });
  sse(response, 'response.completed', { type: 'response.completed', response: { ...value, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
  response.end();
}
function claudeReply(response, tool, model) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  sse(response, 'message_start', { type: 'message_start', message: { id: `msg_acceptance_${requests}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  if (tool) {
    sse(response, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_acceptance', name: 'Bash', input: {} } });
    sse(response, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: `node -e "console.log('QUOTERN_NATIVE_APPROVAL_OK')"`, description: 'Print the Quotern notification acceptance marker.' }) } });
  } else {
    sse(response, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    sse(response, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'QUOTERN_NATIVE_COMPLETE_OK' } });
  }
  sse(response, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(response, 'message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
  sse(response, 'message_stop', { type: 'message_stop' }); response.end();
}
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    let bytes = Buffer.concat(chunks);
    const encoding = request.headers['content-encoding'];
    if (encoding === 'gzip') bytes = zlib.gunzipSync(bytes);
    else if (encoding === 'br') bytes = zlib.brotliDecompressSync(bytes);
    else if (encoding === 'zstd') bytes = zlib.zstdDecompressSync(bytes);
    const input = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
    if (!request.url.includes('responses') && !request.url.includes('messages')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [] })); return; }
    requests++; log('model-request', { path: request.url, model: input.model, tools: input.tools?.map(tool => tool.name ?? tool.type) });
    if (kind === 'error') {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'QUOTERN_CONTROLLED_API_ERROR' } })); return;
    }
    if (provider === 'claude') { claudeReply(response, kind === 'confirm' && requests === 1, input.model); return; }
    const functions = (input.tools ?? []).flatMap(tool => tool.type === 'namespace' ? tool.tools.map(value => ({ ...value, namespace: tool.name })) : [tool]);
    const selected = functions.find(tool => ['shell_command', 'exec_command'].includes(tool.name));
    let item = { id: `msg_${requests}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'QUOTERN_NATIVE_COMPLETE_OK', annotations: [] }] };
    if (kind === 'confirm' && requests === 1) {
      assert.ok(selected, 'The real Codex runtime must expose its command tool');
      const args = selected.name === 'exec_command' ? { cmd: command, sandbox_permissions: 'require_escalated', justification: 'Print a harmless Quotern notification test marker.' } : { command, workdir: ready.project, sandbox_permissions: 'require_escalated', justification: 'Print a harmless Quotern notification test marker.' };
      item = { id: 'fc_acceptance', type: 'function_call', call_id: 'call_acceptance', name: selected.name, arguments: JSON.stringify(args), status: 'completed', ...(selected.namespace ? { namespace: selected.namespace } : {}) };
    }
    codexReply(response, item, input.model);
  } catch (error) { log('mock-failure', { error: String(error) }); response.writeHead(500); response.end('Controlled fixture failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, QUOTERN_DEV_ISOLATED: '1', QUOTERN_DATA_DIR: ready.data, QUOTERN_CONFIG_HOME: path.join(ready.root, 'config-home') };
delete env.ELECTRON_RUN_AS_NODE;
let stdout = '', stderr = '', turnId, sessionId, actualError = false;
const send = value => child.stdin.write(JSON.stringify(value) + '\n');
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CLI RPC timed out: ${method}`)); }, 30_000); timeout.unref();
  pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
  send({ id, method, params });
});
function watchTransport(process) {
  const failed = error => { for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  process.once('error', error => { log('cli-launch-failed', { error: String(error) }); failed(error); });
  process.once('close', code => failed(new Error(`CLI closed before pending RPC completed (${code})`)));
  process.stdin.on('error', failed);
  return process;
}
async function approval(message, claude = false) {
  pendingApproval = message;
  await writeFile(path.join(ready.root, `pending-${scenario}.json`), JSON.stringify({ scenario, requestId: message.id ?? message.request_id, sessionId, kind: message.method ?? message.request?.subtype, command: claude ? message.request?.input?.command : message.params?.command }, null, 2));
  log('approval-pending', { requestId: message.id ?? message.request_id });
  while (!finished && Date.now() < deadlineAt && !await has(release)) await wait(200);
  if (finished || !await has(release)) return;
  if (claude) send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { behavior: 'allow', updatedInput: message.request.input } } });
  else send({ id: message.id, result: { decision: 'accept' } });
  log('approval-released'); pendingApproval = undefined;
}
try {
  if (provider === 'codex') {
    env.CODEX_HOME = ready.codexHome; env.QUOTERN_NOTIFICATION_FIXTURE_KEY = 'local-test-only';
    await writeFile(path.join(ready.codexHome, 'config.toml'), `model = "gpt-5.4"\nmodel_provider = "quotern_local_fixture"\nmodel_reasoning_effort = "low"\nproject_doc_max_bytes = 0\n[features]\nplugin_discovery_prefetch = false\nplugins = false\n[analytics]\nenabled = false\n[model_providers.quotern_local_fixture]\nname = "Quotern local acceptance"\nbase_url = "${endpoint}/v1"\nwire_api = "responses"\nenv_key = "QUOTERN_NOTIFICATION_FIXTURE_KEY"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
    const executable = process.env.QUOTERN_TEST_CODEX ?? path.join(process.env.APPDATA, 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
    child = watchTransport(spawn(executable, ['--dangerously-bypass-hook-trust', 'app-server', '--listen', 'stdio://'], { cwd: ready.project, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    child.stderr.on('data', chunk => { stderr += chunk; });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      stdout += line + '\n'; let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method && message.id !== undefined) { log('server-request', { method: message.method }); if (message.method.includes('requestApproval')) void approval(message); else send({ id: message.id, error: { code: -32601, message: 'Unsupported acceptance request' } }); }
      else if (message.id !== undefined && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
      else if (message.method === 'turn/completed') { finished = true; actualError = message.params?.turn?.status === 'failed'; log('turn-completed', { status: message.params?.turn?.status, error: message.params?.turn?.error }); }
      else if (message.method === 'error') log('provider-error', { error: message.params?.error });
    });
    await rpc('initialize', { clientInfo: { name: 'quotern_notification_acceptance', version: '1' }, capabilities: { experimentalApi: true } });
    send({ method: 'initialized', params: {} });
    const thread = await rpc('thread/start', { cwd: ready.project, model: 'gpt-5.4', modelProvider: 'quotern_local_fixture', sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', config: { bypass_hook_trust: true }, baseInstructions: 'Run only the requested notification acceptance. Never delegate work.', experimentalRawEvents: true });
    sessionId = thread.thread.id; log('session', { source: provider, sessionId });
    const configuredHooks = await rpc('hooks/list', { threadId: sessionId });
    await writeFile(path.join(ready.root, `${scenario}-hooks.json`), JSON.stringify(configuredHooks, null, 2));
    const turn = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: 'Run the controlled Quotern notification acceptance. Print the completion marker.' }] });
    turnId = turn.turn.id;
  } else {
    env.CLAUDE_CONFIG_DIR = ready.claudeHome;
    for (const key of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[key];
    env.ANTHROPIC_API_KEY = 'local-test-only'; env.ANTHROPIC_BASE_URL = endpoint; env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'; env.CLAUDE_CODE_MAX_RETRIES = '0'; env.API_MAX_RETRIES = '0';
    const executable = process.env.QUOTERN_TEST_CLAUDE ?? path.join(process.env.USERPROFILE, '.local/bin/claude.exe');
    child = watchTransport(spawn(executable, ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-hook-events', '--model', 'claude-sonnet-4-6', '--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--no-chrome', '--setting-sources', 'user', '--system-prompt', 'Run only the requested Quotern notification acceptance. Never delegate work.'], { cwd: ready.project, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    child.stderr.on('data', chunk => { stderr += chunk; });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      stdout += line + '\n'; let message; try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'system' && message.session_id) { sessionId = message.session_id; }
      if (message.type === 'control_request') { log('server-request', { subtype: message.request?.subtype }); if (message.request?.subtype === 'can_use_tool') void approval(message, true); }
      if (message.type === 'result') { finished = true; actualError = message.is_error === true; log('turn-completed', { source: provider, sessionId: message.session_id, isError: message.is_error, subtype: message.subtype }); }
    });
    send({ type: 'user', message: { role: 'user', content: 'Run the controlled Quotern notification acceptance. Print the completion marker.' }, parent_tool_use_id: null, session_id: '' });
  }
  const ended = once(child, 'close').then(([code]) => { log('process-exit', { code }); return code; });
  while (!finished && child.exitCode === null && Date.now() < deadlineAt) await wait(100);
  assert.ok(finished, `CLI did not finish: ${stderr.slice(-2400)}`);
  await wait(1500); child.stdin.end();
  const code = await Promise.race([ended, wait(5000).then(() => null)]);
  if (code === null && child.exitCode === null) child.kill();
  assert.ok(requests > 0, 'The real CLI must call the controlled model endpoint');
  assert.equal(actualError, kind === 'error', 'The CLI must report the expected successful or failed terminal state');
  if (kind === 'confirm') assert.ok(rows.some(row => row.event === 'approval-pending'), 'The real CLI must enter its permission flow');
  await writeFile(path.join(ready.root, `${scenario}-result.json`), JSON.stringify({ ok: true, provider, scenario, sessionId, turnId, requests, rows }, null, 2));
} finally {
  finished = true;
  if (child) { child.stdin.end(); if (child.exitCode === null) child.kill(); }
  await writeFile(path.join(ready.root, `${scenario}-stdout.jsonl`), stdout);
  await writeFile(path.join(ready.root, `${scenario}-stderr.log`), stderr);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
