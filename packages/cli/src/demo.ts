import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { BucketStore, createHttpServer, createLocalApiApp, demoMetadata, exportDemoSnapshot, listenServer, loadDemoSnapshot, resolveDataDir, type TudConfig } from 'quotern-core';
import { applyPricingSnapshot } from 'quotern-core';
import { prepareDemoBootstrap } from 'quotern-core';
import { normalizeListenHost, normalizeListenPort } from './args.js';

type DemoArgs = { action: 'export'; out: string; dataDir?: string } | { action: 'start'; file: string; host: string; port: number } | { action: 'help' };
export function parseDemoArgs(args: readonly string[]): DemoArgs {
  if (args.includes('--help') || args[0] === 'help') return { action: 'help' };
  const action = args[0];
  if (action !== 'export' && action !== 'start') throw new Error('用法：quotern demo export --out <snapshot.json> [--data-dir <source>]；quotern demo start --file <snapshot.json> [--host <address>] [--port <number>]');
  const allowed = action === 'export' ? ['--out', '--data-dir'] : ['--file', '--host', '--port'];
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!allowed.includes(flag) || values.has(flag) || !value?.trim() || value.startsWith('--')) throw new Error(`无效、重复或缺少值的演示参数：${flag}`);
    values.set(flag, value);
  }
  if (action === 'export') {
    if (!values.has('--out')) throw new Error('演示导出必须指定 --out <snapshot.json>');
    return { action, out: values.get('--out')!, ...(values.has('--data-dir') ? { dataDir: values.get('--data-dir')! } : {}) };
  }
  if (!values.has('--file')) throw new Error('演示启动必须指定 --file <snapshot.json>，不会读取正常数据目录');
  return { action, file: values.get('--file')!, host: normalizeListenHost(values.get('--host') ?? '127.0.0.1'), port: normalizeListenPort(values.get('--port') ?? '8253') };
}

/** Separate entry point: no normal runtime/config/ownership/quota initialization. */
export async function runDemoCommand(args: readonly string[], staticDir: string): Promise<Server | null> {
  const parsed = parseDemoArgs(args);
  if (parsed.action === 'help') { console.log('quotern demo export --out <snapshot.json> [--data-dir <source>]\nquotern demo start --file <snapshot.json> [--host 127.0.0.1] [--port 8253]\n匿名化已采集数据；只读演示不会采集、刷新额度或修改数据。'); return null; }
  if (parsed.action === 'export') {
    const snapshot = await exportDemoSnapshot(parsed.dataDir ? resolve(parsed.dataDir) : resolveDataDir(), resolve(parsed.out));
    console.log(`演示快照已导出：${resolve(parsed.out)}\n统计桶：${snapshot.buckets.length}；消息：${snapshot.history.messages.length}；参考时间：${snapshot.referenceTime}`);
    return null;
  }
  const snapshot = await loadDemoSnapshot(resolve(parsed.file));
  applyPricingSnapshot(snapshot.pricing);
  const bucketStore = new BucketStore(); bucketStore.apply(snapshot.buckets);
  const config = { deviceId: 'demo', statsSince: snapshot.collectSince, localCollectSince: snapshot.collectSince, lastSyncAt: snapshot.lastSyncAt } as TudConfig;
  const app = createLocalApiApp({ dataDir: '', getConfig: () => config, bucketStore, demo: snapshot });
  const demoBootstrap = await prepareDemoBootstrap(app, snapshot);
  const server = createHttpServer({ honoApp: app, staticDir, host: parsed.host, port: parsed.port, demo: demoMetadata(snapshot), demoBootstrap });
  await listenServer(server, parsed.host, parsed.port);
  const host = parsed.host.includes(':') ? `[${parsed.host}]` : parsed.host;
  console.log(`只读演示：http://${host}:${parsed.port}\n快照：${snapshot.exportedAt}；参考时间：${snapshot.referenceTime}\nCtrl+C 停止演示；正常客户端和数据不受影响。`);
  return server;
}
