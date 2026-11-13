import { utilityProcess, type UtilityProcess } from 'electron';
import workerPath from './session-analysis-worker?modulePath';
import { isSessionAnalysisRequest, type AnalysisContext, type AnalysisRequest, type AnalysisRequestInit, type AnalysisResponse, type AnalysisResult } from './session-analysis-protocol';

interface Instance {
  process: UtilityProcess;
  dataDir: string;
  ready: Promise<void>;
  rejectReady(error: Error): void;
  exited: boolean;
  exit: Promise<void>;
  closing?: Promise<void>;
  pending: Map<number, { resolve(value: AnalysisResult): void; reject(error: Error): void }>;
  bucketRevision?: number;
  collectSince?: string;
  pricingFingerprint?: string;
}
let active: Instance | null = null;
let nextId = 1;
let generation = 0;

function rejectPending(instance: Instance, error: Error): void {
  for (const waiter of instance.pending.values()) waiter.reject(error);
  instance.pending.clear();
}

function terminate(instance: Instance, error: Error): Promise<void> {
  if (instance.closing) return instance.closing;
  instance.rejectReady(error);
  rejectPending(instance, error);
  instance.closing = (async () => {
    if (!instance.exited) instance.process.kill();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([instance.exit, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('session analysis worker did not exit')), 5000); })]);
    } finally { clearTimeout(timer); }
    if (active === instance) active = null;
  })();
  return instance.closing;
}

function start(dataDir: string): Instance {
  const child = utilityProcess.fork(workerPath, [], { serviceName: 'Quotern Session Analysis', stdio: 'pipe' });
  let resolveReady!: () => void, rejectReady!: (error: Error) => void, resolveExit!: () => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const exit = new Promise<void>(resolve => { resolveExit = resolve; });
  const instance: Instance = { process: child, dataDir, ready, rejectReady, exited: false, exit, pending: new Map() };
  active = instance;
  const timer = setTimeout(() => { void terminate(instance, new Error('session analysis startup timed out')).catch(console.error); }, 15000);
  void ready.then(() => clearTimeout(timer), () => clearTimeout(timer));
  child.stdout?.on('data', (data: Buffer) => process.stdout.write('[tud-session-analysis] ' + data.toString()));
  child.stderr?.on('data', (data: Buffer) => process.stderr.write('[tud-session-analysis] ' + data.toString()));
  child.on('message', (data: unknown) => {
    if (active !== instance || instance.closing || instance.exited) return;
    const message = data as AnalysisResponse;
    if (message?.type === 'ready') {
      console.log(`[tud-desktop] session analysis utilityProcess ready pid=${message.pid}`);
      resolveReady(); return;
    }
    if (message?.type !== 'result' && message?.type !== 'error') return;
    const waiter = instance.pending.get(message.id);
    if (!waiter) return;
    if (message.type === 'error') { void terminate(instance, new Error(message.error)).catch(console.error); return; }
    instance.pending.delete(message.id); waiter.resolve(message.result);
  });
  child.on('error', () => { void terminate(instance, new Error('session analysis worker failed')).catch(console.error); });
  child.on('exit', code => {
    instance.exited = true;
    const error = new Error(`session analysis worker exited (${code ?? 'null'})`);
    rejectReady(error); rejectPending(instance, error); resolveExit();
    if (active === instance) active = null;
  });
  return instance;
}

export async function runSessionAnalysisRequest(url: string, init: AnalysisRequestInit | undefined, context: AnalysisContext): Promise<AnalysisResult> {
  if (!isSessionAnalysisRequest(url, init?.method)) throw new Error('invalid session analysis request');
  const token = generation;
  if (active && (active.closing || active.dataDir !== context.dataDir)) await terminate(active, new Error('session analysis worker replaced'));
  if (token !== generation) throw new Error('session analysis worker stopped');
  const instance = active ?? start(context.dataDir);
  await instance.ready;
  if (active !== instance || instance.closing || token !== generation) throw new Error('session analysis worker stopped');
  if (instance.pending.size >= 64) throw new Error('too many session analysis requests');
  const id = nextId++;
  const { rows, pricing, ...snapshot } = context;
  const message: AnalysisRequest = { type: 'request', id, url, init, snapshot: {
    ...snapshot,
    ...(instance.bucketRevision !== context.bucketRevision || instance.collectSince !== context.collectSince ? { rows } : {}),
    ...(instance.pricingFingerprint !== context.pricingFingerprint ? { pricing } : {}),
  } };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void terminate(instance, new Error('session analysis timed out')).catch(console.error); }, 30000);
    instance.pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    try {
      instance.process.postMessage(message);
      instance.bucketRevision = context.bucketRevision; instance.collectSince = context.collectSince; instance.pricingFingerprint = context.pricingFingerprint;
    } catch (error) {
      instance.pending.delete(id); clearTimeout(timer); reject(error);
    }
  });
}

export async function stopSessionAnalysisWorker(): Promise<void> {
  generation++;
  if (active) await terminate(active, new Error('session analysis worker stopped'));
}
