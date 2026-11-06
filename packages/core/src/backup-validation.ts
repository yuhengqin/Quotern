import { TOKEN_FIELDS } from './pricing/request-pricing.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const stamp = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
function requireValid(valid: unknown): asserts valid { if (!valid) throw new Error('invalid stored structure'); }
const map = (value: unknown, valid: (item: unknown) => boolean): boolean => object(value) && Object.values(value).every(valid);
const optional = (value: ObjectValue, keys: string[], valid: (item: unknown) => boolean) => keys.every(key => value[key] === undefined || valid(value[key]));
const tokens = (value: unknown) => object(value) && TOKEN_FIELDS.every(key => number(value[key]));
const fact = (value: unknown) => object(value) && text(value.id) && stamp(value.timestamp) && tokens(value);
const event = (value: unknown) => object(value) && text(value.source) && text(value.sessionId) && text(value.id) && stamp(value.timestamp)
  && optional(value, ['parentId', 'model', 'projectLabel', 'projectId', 'replayKey', 'turnId', 'agentRole', 'agentNickname'], text)
  && optional(value, ['seq', 'durationMs', 'ttftMs', 'outputTokens'], number);
const operation = (value: unknown) => object(value)
  && text(value.kind) && ['read', 'scan', 'edit', 'command', 'other', 'result'].includes(value.kind)
  && text(value.tool)
  && optional(value, ['targetKey', 'targetLabel', 'outputFingerprint', 'dispatchSessionId', 'projectKey'], text)
  && optional(value, ['generated'], item => typeof item === 'boolean')
  && optional(value, ['outputChars'], number)
  && optional(value, ['dispatchSource'], item => item === 'codex' || item === 'antigravity');

/** Check fields consumed by history materialization before creating a restore directory. */
export function validateBackupSessions(value: ObjectValue, source: string): void {
  requireValid(Number.isInteger(value.version) && Number(value.version) >= 3 && Number(value.version) <= 12 && value.source === source && typeof value.complete === 'boolean' && object(value.files));
  for (const file of Object.values(value.files)) {
    requireValid(object(file) && object(file.context) && text(file.context.sessionId) && typeof file.complete === 'boolean'
      && ['size', 'mtimeMs', 'ino', 'offset'].every(key => number(file[key])) && text(file.guard));
    requireValid(optional(file.context, ['parentId', 'projectLabel', 'observationModel', 'insightTurnId', 'insightModel'], text));
    requireValid(map(file.messages, row => event(row) && object(row) && ['user', 'assistant'].includes(String(row.role))));
    requireValid(optional(file, ['timings'], rows => map(rows, row => event(row) && object(row) && ['user', 'activity', 'task-start', 'task-end', 'task-abort'].includes(String(row.kind)))));
    requireValid(optional(file, ['evidence'], rows => map(rows, row => event(row) && object(row) && ['metadata', 'request', 'turn', 'tool', 'tool-result', 'retry', 'error', 'compaction', 'coverage'].includes(String(row.kind))
      && optional(row, ['operation'], operation))));
    requireValid(optional(file, ['titles'], rows => map(rows, row => object(row) && text(row.title) && number(row.priority))));
    requireValid(optional(file, ['observations'], rows => map(rows, row => event(row) && object(row) && text(row.model) && number(row.tokens) && typeof row.usageKnown === 'boolean'
      && (row.costUsd === null || number(row.costUsd)) && ['recorded', 'estimated', 'unknown'].includes(String(row.costKind))
      && object(row.billing) && text(row.billing.service) && ['subscription', 'api', 'unknown'].includes(String(row.billing.mode))
      && ['recorded', 'unknown'].includes(String(row.billing.evidence)) && (row.billing.accountRef === null || text(row.billing.accountRef))
      && optional(row, ['tokenParts', 'estimatedTokenParts'], tokens) && optional(row, ['pricingFact'], fact)
      && optional(row, ['context'], context => object(context) && (context.usedTokens === null || number(context.usedTokens)) && (context.limitTokens === null || number(context.limitTokens)) && stamp(context.observedAt)))));
  }
}

/** Cursor slots are extensible, but consumed map/array containers must have their declared shape. */
export function validateBackupCursors(value: ObjectValue): void {
  const objectMaps = new Set(['files', 'fileOffsets', 'updateOffsets', 'messages', 'sessionIndex', 'ledgerTotals', 'sessionTotals', 'threadTotals', 'sessionSnapshots', 'sqliteSessions', 'seenUsage', 'seenTurns', 'profiles']);
  const numberMaps = new Set(['databases', 'dbMtimes', 'ledgerReadings', 'ideWatermarks', 'extFileMtimes']);
  const stringLists = new Set(['seenHashes', 'seenIds', 'seenMessageIds', 'extSeenIds', 'seenSessions', 'unfinishedIds']);
  for (const slot of Object.values(value)) {
    requireValid(object(slot));
    for (const [key, field] of Object.entries(slot)) {
      if (objectMaps.has(key)) requireValid(map(field, object));
      if (numberMaps.has(key)) requireValid(map(field, number));
      if (stringLists.has(key)) requireValid(Array.isArray(field) && field.every(text));
      if (['files', 'fileOffsets', 'updateOffsets'].includes(key)) for (const entry of Object.values(field as ObjectValue)) {
        requireValid(object(entry) && optional(entry, ['offset', 'inode', 'ino', 'size', 'mtimeMs', 'lastIndex', 'lastLine', 'tokenCountSeen'], number));
      }
      if (key === 'messages') requireValid(map(field, item => object(item) && tokens(item.lastTotals)));
    }
  }
}
