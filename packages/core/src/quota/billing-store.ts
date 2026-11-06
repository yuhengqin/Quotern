import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentTransaction, writeAgentJson } from '../agent/preferences.js';
import { discoverBillingOrganizations, normalizeBillingCookie, readBillingReport, validBillingOrganization } from './billing.js';
import type { BillingConnectionView, BillingOrganization, BillingReport, BillingSource } from './shared/billing.js';

export interface BillingSecret { kind: string; value: string }
interface SecretCodec { protect(value: string): Promise<BillingSecret>; unprotect(value: BillingSecret): Promise<string> }
interface StoredBilling { revision: string; connection: { organization: BillingOrganization; secret: BillingSecret } | null; report: BillingReport | null }
const empty = (): StoredBilling => ({ revision: 'initial', connection: null, report: null });

/** Fixed program; secret/ciphertext travels through stdin, never argv or a script file. */
async function dpapi(value: string, decrypt: boolean): Promise<string> {
  const expression = decrypt
    ? '[System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($v), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))';
  const script = `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; [Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $v=[Console]::In.ReadToEnd(); [Console]::Out.Write(${expression}) } catch { exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10_000, maxBuffer: 128 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(new Error('BILLING_SECRET_UNAVAILABLE')) : resolve(stdout));
    child.stdin?.on('error', () => { /* execFile reports process failure without including stderr. */ });
    child.stdin?.end(value);
  });
}
export async function protectBillingSecret(value: string): Promise<BillingSecret> {
  return process.platform === 'win32' ? { kind: 'dpapi', value: await dpapi(value, false) } : { kind: 'private-file', value };
}
export async function unprotectBillingSecret(secret: BillingSecret): Promise<string> {
  if (secret.kind === 'dpapi' && process.platform === 'win32') return dpapi(secret.value, true);
  if (secret.kind === 'private-file' && process.platform !== 'win32') return secret.value;
  throw new Error('BILLING_SECRET_UNAVAILABLE');
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nullableNumber = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string' && value.length <= 240;
function validReport(value: unknown): value is BillingReport {
  if (value === null) return true;
  if (!record(value) || typeof value.attemptedAt !== 'number' || !Number.isFinite(value.attemptedAt)) return false;
  const fields: Record<string, string[]> = { spend: ['enabled', 'usedUsd', 'limitUsd'], grants: ['remainingUsd', 'grantedUsd'], currentSpend: ['usd', 'resetsAt'], prepaid: ['usd'], details: ['from', 'until', 'totalUsd', 'complete', 'unknownRows', 'rows'] };
  for (const [key, section] of Object.entries(value)) {
    if (key === 'attemptedAt') continue;
    if (!Object.hasOwn(fields, key) || !record(section) || Object.keys(section).some(k => !['data', 'observedAt', 'stale', 'error'].includes(k)) || !nullableNumber(section.observedAt) || typeof section.stale !== 'boolean'
      || section.error !== null && (typeof section.error !== 'string' || !/^BILLING_(AUTH|CHALLENGE|RATE_LIMIT|NETWORK|HTTP|INVALID_RESPONSE|RESPONSE_TOO_LARGE|CURRENCY)$/.test(section.error))) return false;
    if (section.data === null) continue;
    const data = section.data;
    if (!record(data) || Object.keys(data).length !== fields[key]!.length || Object.keys(data).some(k => !fields[key]!.includes(k))) return false;
    for (const [name, field] of Object.entries(data)) {
      if (name.endsWith('Usd') || name === 'usd') { if (!nullableNumber(field)) return false; }
      else if (name === 'enabled') { if (field !== null && typeof field !== 'boolean') return false; }
      else if (name === 'resetsAt') { if (!nullableString(field)) return false; }
    }
    if (key === 'details' && (typeof data.from !== 'string' || typeof data.until !== 'string' || typeof data.complete !== 'boolean' || !Number.isSafeInteger(data.unknownRows) || !Array.isArray(data.rows) || data.rows.length > 20_000 || data.rows.some(row => !record(row) || Object.keys(row).some(k => !['day', 'model', 'keyId', 'keyName', 'usd'].includes(k)) || typeof row.day !== 'string' || row.day.length > 10 || !nullableNumber(row.usd) || !nullableString(row.model) || !nullableString(row.keyId) || !nullableString(row.keyName)))) return false;
  }
  return true;
}

export class BillingService {
  private readonly directory: string;
  private readonly codec: SecretCodec;
  private readonly pending = new Set<BillingSource>();
  constructor(dataDir: string, private readonly options: { fetch?: typeof fetch; codec?: SecretCodec; now?: () => Date } = {}) {
    this.directory = join(dataDir, 'billing-private'); this.codec = options.codec ?? { protect: protectBillingSecret, unprotect: unprotectBillingSecret };
  }
  private path(source: BillingSource) { return join(this.directory, `${source}.json`); }
  private async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BILLING_STORAGE');
    if (process.platform !== 'win32') await chmod(this.directory, 0o700);
  }
  private async read(source: BillingSource): Promise<StoredBilling> {
    await this.prepare();
    try {
      const stat = await lstat(this.path(source));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 4 * 1024 * 1024) throw new Error();
      if (process.platform !== 'win32') await chmod(this.path(source), 0o600);
      const data: unknown = JSON.parse(await readFile(this.path(source), 'utf8'));
      if (!record(data) || typeof data.revision !== 'string' || data.revision.length > 64 || !validReport(data.report)) throw new Error();
      const c = data.connection;
      if (c !== null && (!record(c) || !record(c.organization) || !validBillingOrganization(c.organization.id) || typeof c.organization.name !== 'string' || c.organization.name.length > 240 || !record(c.secret) || typeof c.secret.kind !== 'string' || typeof c.secret.value !== 'string' || c.secret.value.length > 64 * 1024)) throw new Error();
      return data as unknown as StoredBilling;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw new Error('BILLING_STORAGE'); }
  }
  private async commit(source: BillingSource, revision: string, value: Omit<StoredBilling, 'revision'>): Promise<void> {
    await this.prepare();
    await agentTransaction(this.path(source), async () => {
      if ((await this.read(source)).revision !== revision) throw new Error('BILLING_CONFLICT');
      const next = { ...value, revision: randomUUID() };
      // Projection (including repeated labels) may be larger than the upstream
      // response. Never replace a usable connection with an unreadable file.
      if (Buffer.byteLength(JSON.stringify(next, null, 2) + '\n') > 4 * 1024 * 1024) throw new Error('BILLING_RESPONSE_TOO_LARGE');
      await writeAgentJson(this.path(source), next);
    });
  }
  async view(): Promise<Record<BillingSource, BillingConnectionView>> {
    const read = async (source: BillingSource): Promise<BillingConnectionView> => {
      try { const data = await this.read(source); return { revision: data.revision, organization: data.connection ? { id: data.connection.organization.id, name: data.connection.organization.name } : null, report: data.connection ? data.report : null }; }
      catch { return { revision: 'unavailable', organization: null, report: null, error: 'BILLING_STORAGE' }; }
    };
    const [extra, console] = await Promise.all([read('extra'), read('console')]); return { extra, console };
  }
  discover(source: BillingSource, cookie: string) { return discoverBillingOrganizations(source, cookie, this.options.fetch); }
  async connect(source: BillingSource, input: string, organizationId: string, revision: string): Promise<void> {
    if ((await this.read(source)).revision !== revision) throw new Error('BILLING_CONFLICT');
    const cookie = normalizeBillingCookie(input), organizations = await this.discover(source, cookie), organization = organizations.find(org => org.id === organizationId);
    if (!organization) throw new Error('BILLING_ORGANIZATION_INVALID');
    const secret = await this.codec.protect(cookie);
    await this.commit(source, revision, { connection: { organization, secret }, report: null });
  }
  async disconnect(source: BillingSource, revision: string): Promise<void> { await this.commit(source, revision, { connection: null, report: null }); }
  async refresh(source: BillingSource, revision: string): Promise<void> {
    if (this.pending.has(source)) throw new Error('BILLING_PENDING');
    this.pending.add(source);
    try {
      const current = await this.read(source);
      if (current.revision !== revision) throw new Error('BILLING_CONFLICT');
      if (!current.connection) throw new Error('BILLING_NOT_CONNECTED');
      const cookie = await this.codec.unprotect(current.connection.secret);
      const report = await readBillingReport(source, current.connection.organization.id, cookie, { fetch: this.options.fetch, previous: current.report, now: this.options.now?.() });
      await this.commit(source, revision, { connection: current.connection, report });
    } finally { this.pending.delete(source); }
  }
}
