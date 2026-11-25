import { Console } from 'node:console';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
import type { DesktopService } from './service';

// stdout is the private protocol stream. Core and its workers can log freely to stderr.
const output = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
globalThis.console = new Console(process.stderr, process.stderr);
const profile = process.env.QUOTERN_DESKTOP_USER_DATA;
if (!profile || !isAbsolute(profile)) throw new Error('Desktop profile must be an absolute path');
if (process.env.QUOTERN_DEV_ISOLATED === '1' && ![process.env.QUOTERN_DATA_DIR, process.env.QUOTERN_CONFIG_HOME].every(value => value && isAbsolute(value))) {
  throw new Error('Missing isolated desktop data directories');
}
const MAX_FRAME = 64 * 1024 * 1024;
let closing = false;
let writes = Promise.resolve();
function publish(message: object): Promise<void> {
  const frame = JSON.stringify(message) + '\n';
  if (Buffer.byteLength(frame) > MAX_FRAME) return Promise.reject(new Error('Desktop response is too large'));
  const operation = writes.then(async () => {
    if (!output(frame)) await once(process.stdout, 'drain');
  });
  writes = operation.catch(() => {});
  return operation;
}

const nativeRequests = new Map<number, {resolve(value:unknown):void; reject(reason:Error):void}>();
let nativeId = 0;
async function native(channel:string, ...args:unknown[]): Promise<unknown> {
  // The exiting host releases these windows and notifications as part of shutdown.
  if (closing && (channel === 'dsh:window' && args[0] === false || channel === 'notifications:remove')) return null;
  if (closing || nativeRequests.size >= 128) throw Error('Native host unavailable');
  const id = ++nativeId;
  let timer: ReturnType<typeof setTimeout>;
  const reply = new Promise<unknown>((resolve,reject) => {
    nativeRequests.set(id,{resolve,reject});
    timer = setTimeout(()=>reject(Error('Native operation timed out')),120_000);
    timer.unref();
  });
  try { await publish({type:'native',id,channel,args}); return await reply; }
  finally { clearTimeout(timer!); nativeRequests.delete(id); }
}

let activeBackup: Promise<unknown> | undefined;
async function runBackup<T>(operation: () => Promise<T>): Promise<T> {
  if (closing) throw Error('Desktop runtime is stopping');
  if (activeBackup) throw Error('BACKUP_BUSY');
  const pending = (async () => {
    try {
      // The host must reserve this operation before it can modify the filesystem.
      await native('host:backup-begin');
      return await operation();
    }
    finally {
      await publish({ type: 'backup-finished' }).catch(error => {
        console.error('Could not report backup completion:', error);
        void stop();
      });
    }
  })();
  activeBackup = pending;
  try { return await pending; }
  finally { activeBackup = undefined; }
}

const service: Promise<DesktopService> = import('./service').then(({ createDesktopService }) =>
  createDesktopService(profile, (channel, ...args) => {
    if (!closing) void publish({ type: 'event', channel, args }).catch(() => { void stop(); });
  }, native, runBackup));
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const active = new Set<number>();
async function handle(line: string): Promise<void> {
  if (closing) return;
  if (Buffer.byteLength(line) >= MAX_FRAME) throw new Error('Invalid desktop frame');
  const request = JSON.parse(line);
  if (request?.type === 'shutdown') { await stop(); return; }
  if (request.type === 'native-reply' && Number.isSafeInteger(request.id)) {
    const operation = nativeRequests.get(request.id);
    if (request.error) operation?.reject(new Error(String(request.error)));
    else operation?.resolve(request.value);
    return;
  }
  if (!Number.isSafeInteger(request?.id) || request.id < 1 || typeof request.channel !== 'string' ||
      typeof request.window !== 'string' || !Array.isArray(request.args) || request.args.length > 8 || active.has(request.id)) {
    throw new Error('Malformed desktop request');
  }
  const id = request.id as number;
  if (active.size >= 128) { await publish({type:'reply', id, error:'Too many concurrent requests'}); return; }
  active.add(id);
  try {
    const result = await (await service).request(request.window, request.channel, request.args);
    await publish({ type: 'reply', id, value: result ?? null });
  } catch (error) {
    await publish({ type: 'reply', id, error: error instanceof Error ? error.message : 'Desktop request failed' });
  } finally {
    active.delete(id);
  }
}
async function stop() {
  if (closing) return;
  closing = true;
  for (const operation of nativeRequests.values()) operation.reject(Error('Native host disconnected'));
  nativeRequests.clear();
  input.close();
  try {
    // A lost renderer or shutdown request does not cancel an admitted restore.
    await activeBackup?.catch(() => {}); // The request handler owns its result.
    await (await service).close();
    await writes;
  }
  catch (error) { console.error('Failed to stop Quotern runtime:', error instanceof Error ? error.message : error); process.exitCode = 1; }
  process.exit(process.exitCode ?? 0);
}
input.on('line', line => { void handle(line).catch(() => { process.exitCode = 1; void stop(); }); });
input.once('close', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
void service.catch(error => { console.error('Quotern initialization failed:', error instanceof Error ? error.message : error); });
