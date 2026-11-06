import { createHash } from 'node:crypto';
import type { SessionEvidence } from './session-insights.js';
import type { SessionActivity } from './session-observation.js';

export interface SessionOperation {
  kind: 'read' | 'scan' | 'edit' | 'command' | 'other' | 'result';
  tool: string;
  targetKey?: string;
  targetLabel?: string;
  generated?: boolean;
  outputChars?: number;
  outputFingerprint?: string;
  dispatchSource?: 'codex' | 'antigravity';
  dispatchSessionId?: string;
  projectKey?: string;
}
export interface DiagnosticEvidence { timestamp: string; eventId: string; tool: string; target?: string; characters?: number }
export interface SessionDiagnosticFinding {
  code: 'repeated-read' | 'generated-scan' | 'large-output' | 'repeated-output' | 'high-usage';
  count: number;
  evidence: DiagnosticEvidence[];
  estimatedTokens?: number;
}
export interface SessionDiagnostics {
  coverage: 'complete' | 'partial' | 'unsupported';
  scannedToolCalls: number;
  findings: SessionDiagnosticFinding[];
}
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function operationProjectKey(value: string): string | undefined {
  if (!value) return undefined;
  let normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^(?:[a-z]:|\/\/)/i.test(normalized)) normalized = normalized.toLowerCase();
  return hash(normalized);
}
const label = (value: string) => value.replace(/\\/g, '/').split('/').pop()!.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 80);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,159}$/;

/** Persist only categorical facts, opaque keys and a basename; never arguments. */
export function operationForCall(toolName: string, value: unknown, projectKey?: string): SessionOperation {
  const name = toolName.toLowerCase().replace(/^(functions|tools)\./, '').split('__').pop()!;
  let input = obj(value);
  if (typeof value === 'string' && value.length <= 1024 * 1024) { try { input = obj(JSON.parse(value)); } catch { /* Free-form tools have no structured targets. */ } }
  const kind = ['read', 'read_file', 'inspect_local_file'].includes(name) ? 'read'
    : ['grep', 'glob', 'search', 'list_directory'].includes(name) ? 'scan'
      : ['apply_patch', 'edit', 'write', 'multiedit', 'notebookedit'].includes(name) ? 'edit'
        : ['bash', 'exec_command', 'shell', 'run_command', 'shell_command'].includes(name) ? 'command' : 'other';
  const operation: SessionOperation = { kind, tool: kind === 'other' ? 'tool' : name, projectKey };
  const target = text(input.file_path ?? input.path ?? input.file);
  if ((kind === 'read' || kind === 'scan') && target) {
    operation.targetKey = hash([target.replace(/\\/g, '/'), input.offset ?? null, input.limit ?? null, input.pages ?? null]);
    operation.targetLabel = label(target);
    operation.generated = /(?:^|[/\\])(?:node_modules|\.git|dist|build|out|\.next|coverage)(?:[/\\]|$)/i.test(target);
  }
  if (kind === 'command') {
    const command = text(input.command ?? input.cmd);
    const invocations = [...command.matchAll(/(?:^|[;&|]\s*)\s*(?:["'][^"'\r\n]*[/\\])?(codex|agy)(?:\.exe|\.cmd)?["']?\s+(exec\b|resume\b|--conversation\b|-p\b)/g)];
    if (invocations.length === 1) {
      const match = invocations[0]!;
      operation.dispatchSource = match[1] === 'codex' ? 'codex' : 'antigravity';
      const tail = command.slice(match.index! + match[0].length);
      const explicit = tail.match(/^\s+(?:resume\s+)?["']?([a-zA-Z0-9_-]{8,160})(?:["']?\s|$)/)?.[1];
      if ((match[2] !== 'exec' || /^\s+resume\b/.test(tail)) && explicit && idPattern.test(explicit)) operation.dispatchSessionId = explicit;
    }
  }
  return operation;
}

function resultText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.slice(0, 256).map(part => text(obj(part).text)).join('\n');
  return text(obj(value).stdout ?? obj(value).output ?? obj(value).text);
}
export function operationForResult(value: unknown): SessionOperation {
  const content = resultText(value);
  const result: SessionOperation = { kind: 'result', tool: 'result', outputChars: content.length };
  if (content.length > 0 && content.length <= 1024 * 1024) result.outputFingerprint = hash(content);
  // Only a structured CLI session-start response provides an explicit target.
  for (const line of content.slice(0, 65536).split('\n').slice(0, 256)) {
    try {
      const record = obj(JSON.parse(line));
      const id = record.type === 'thread.started' ? record.thread_id : record.type === 'conversation.started' ? record.conversation_id : null;
      if (typeof id === 'string' && idPattern.test(id)) { result.dispatchSessionId = id; break; }
    } catch { /* Ordinary output is not identity evidence. */ }
  }
  return result;
}

export function diagnoseSession(row: SessionActivity, events: readonly SessionEvidence[], peers: readonly SessionActivity[], coverage: SessionDiagnostics['coverage']): SessionDiagnostics {
  const findings = new Map<SessionDiagnosticFinding['code'], SessionDiagnosticFinding>();
  const reads = new Set<string>(), outputs = new Set<string>();
  let scannedToolCalls = 0;
  const add = (code: SessionDiagnosticFinding['code'], event?: SessionEvidence) => {
    const finding = findings.get(code) ?? { code, count: 0, evidence: [] };
    finding.count++;
    const operation = event?.operation;
    if (event && operation && finding.evidence.length < 3) finding.evidence.push({ timestamp: event.timestamp, eventId: event.id, tool: operation.tool, target: operation.targetLabel, characters: operation.outputChars });
    if (operation?.outputChars !== undefined) finding.estimatedTokens = (finding.estimatedTokens ?? 0) + Math.ceil(operation.outputChars / 4);
    findings.set(code, finding);
  };
  for (const event of events) {
    const operation = event.operation;
    if (!operation) continue;
    if (event.kind === 'tool') scannedToolCalls++;
    if (operation.kind === 'edit' || operation.kind === 'command') reads.clear(); // A command can change any file.
    if (operation.kind === 'read' && operation.targetKey) {
      if (reads.has(operation.targetKey)) add('repeated-read', event);
      reads.add(operation.targetKey);
    }
    if (operation.kind === 'scan' && operation.generated) add('generated-scan', event);
    if (operation.kind === 'result') {
      if ((operation.outputChars ?? 0) >= 20000) add('large-output', event);
      if ((operation.outputChars ?? 0) >= 4000 && operation.outputFingerprint) {
        if (outputs.has(operation.outputFingerprint)) add('repeated-output', event);
        outputs.add(operation.outputFingerprint);
      }
    }
  }
  const values = peers.filter(peer => peer.source === row.source && peer.tokens !== null && peer.tokens > 0).map(peer => peer.tokens!).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  if (values.length >= 5 && median && row.tokens !== null && row.tokens >= 1_000_000 && row.tokens >= median * 3) add('high-usage');
  return { coverage, scannedToolCalls, findings: [...findings.values()] };
}
