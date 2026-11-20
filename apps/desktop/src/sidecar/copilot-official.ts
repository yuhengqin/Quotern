import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { guiCliEnvironment } from 'quotern-core/quota/readers/cli-runtime';

const unavailable = (status: string) => ({ status, limits: [], fetchedAt: null, stale: false, message: null });
const object = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function mapCopilotQuota(result: unknown) {
  const quota = object(object(result)?.quotaSnapshots);
  if (!quota) return unavailable('temporarily-unavailable');
  const limits = [];
  for (const [id, raw] of Object.entries(quota)) {
    const row = object(raw);
    if (!row || !/^[\w-]{1,64}$/.test(id)) continue;
    const label = id.replaceAll('_', ' ');
    const reset = typeof row.resetDate === 'string' ? Date.parse(row.resetDate) : NaN;
    const resetsAt = Number.isFinite(reset) ? Math.floor(reset / 1000) : null;
    if (row.entitlementRequests === -1) { limits.push({id,label,unlimited:true,resetsAt}); continue; }
    if (!finite(row.remainingPercentage) || row.remainingPercentage < 0 || row.remainingPercentage > 100) continue;
    limits.push({id, label, remainingPercent:row.remainingPercentage, resetsAt,
      ...(finite(row.usedRequests) && row.usedRequests >= 0 && finite(row.entitlementRequests) && row.entitlementRequests > 0
        ? {used:row.usedRequests, limit:row.entitlementRequests, unit:'requests'} : {})});
  }
  return limits.length ? {status:'ready',limits,fetchedAt:Math.floor(Date.now()/1000),stale:false,message:null} : unavailable('temporarily-unavailable');
}

async function findCommand(env:NodeJS.ProcessEnv) {
  for (const dir of (env.PATH || env.Path || '').split(delimiter).filter(isAbsolute)) {
    const executable = join(dir, process.platform === 'win32' ? 'copilot.exe' : 'copilot');
    try { await access(executable,constants.X_OK); return [executable] as const; } catch {}
    if (process.platform !== 'win32') continue;
    const pkg = join(dir,'node_modules','@github','copilot');
    try {
      const meta=JSON.parse(await readFile(join(pkg,'package.json'),'utf8'));
      if (meta.name !== '@github/copilot') continue;
      const bin = typeof meta.bin === 'string' ? meta.bin : meta.bin?.copilot;
      if (typeof bin !== 'string') continue;
      const entry=resolve(pkg,bin);
      if (!entry.startsWith(pkg+sep) || !/\.[cm]?js$/i.test(entry)) continue;
      await access(entry);
      return [process.execPath,entry] as const;
    } catch {}
  }
}

export async function readCopilotOfficial() {
  const env=guiCliEnvironment();
  const command=await findCommand(env);
  if (!command) return unavailable('not-installed');
  const [exe,...base] = command;
  const proc=spawn(exe,[...base,'--headless','--no-auto-update','--stdio'],{cwd:tmpdir(),env,windowsHide:true,stdio:['pipe','pipe','ignore']});
  const conn=createMessageConnection(new StreamMessageReader(proc.stdout),new StreamMessageWriter(proc.stdin));
  let timer:ReturnType<typeof setTimeout> | undefined;
  try {
    const stopped=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(Error('timeout')),12000);
      proc.once('error',reject);
      proc.once('exit',()=>reject(Error('exit')));
      let bytes=0;
      proc.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024)reject(Error('response too large'));});
    });
    conn.listen();
    const request=async()=>{
      const hello = object(await conn.sendRequest('connect',{}));
      if (!Number.isSafeInteger(hello?.protocolVersion)) throw Error('Unsupported CLI');
      return mapCopilotQuota(await conn.sendRequest('account.getQuota',{}));
    };
    return await Promise.race([stopped,request()]);
  } catch { return unavailable('temporarily-unavailable'); }
  finally { clearTimeout(timer); conn.dispose(); proc.stdin.end(); proc.kill(); }
}
