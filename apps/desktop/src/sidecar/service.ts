import { join } from 'node:path';
import { bindRuntimeQuota } from '../main/runtime-quota';
import { onLocalRuntimeSynced, localApiRequest, pokeSyncOnForeground, refreshLocalPricingIfStale,
  setLocalRuntimeQuitting, startLocalRuntime, stopLocalRuntime } from '../main/local-runtime';
import { readDesktopLegacyBackgrounds } from '../main/share-background-store';
import { QUOTA_GET, QUOTA_REFRESH, QUOTA_SET } from '../shared/quota';
import { SHARE_BACKGROUNDS_CHANNEL } from '../shared/share-backgrounds';
import { desktopPreferences } from './preferences';
import { desktopQuotas } from './quotas';
import { desktopPets } from './pets';
import { desktopNotifications } from './notifications';
import { quotaNotice, serviceNotice } from '../main/notifications/quota-notices';
import type { QuotaNotification } from 'quotern-core/quota/readers/quota-manager';
import type { QuotaServiceNotification, QuotaState } from '../shared/quota';
import { QUOTA_CHANGED } from '../shared/quota';
import { nativeText } from '../main/native-messages';
import { quotaTrayTitle, quotaTraySummary } from '../main/tray-quota';
import { formatTrayUsage, isTrayUsageMode } from '../shared/tray-usage';
import { allowsLocalApiRequest } from './local-api-access';

export interface DesktopService {
  request(window: string, channel: string, args: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}
export type NativeCall = (channel:string,...args:unknown[])=>Promise<unknown>;
export async function createDesktopService(profile: string, emit: (channel: string, ...args: unknown[]) => void, native:NativeCall): Promise<DesktopService> {
  let pets: Awaited<ReturnType<typeof desktopPets>> | null = null;
  const prefs = await desktopPreferences(profile,(channel,...args)=>{
    emit(channel,...args);
    if(channel==='theme:changed') void pets?.request('pet:theme',[(args[0] as {resolved:string}).resolved==='dark']);
    if(channel==='theme:changed'||channel==='appearance:changed') void prefs.chrome().then(colors=>native('host:chrome',colors)).catch(console.error);
  });
  const notices = await desktopNotifications(profile,emit,native,prefs.locale);
  const quota = await desktopQuotas(profile,(channel,...args) => {
    if(channel==='runtime:quota-notification') { void notices.send(quotaNotice(args[0] as QuotaNotification,prefs.locale())).catch(console.error); return; }
    if(channel==='runtime:service-notification') { void notices.send(serviceNotice(args[0] as QuotaServiceNotification,prefs.locale())).catch(console.error); return; }
    if(channel===QUOTA_CHANGED)notices.reconcileQuota(args[0] as QuotaState);
    emit(channel,...args);
  });
  pets = process.platform==='win32' ? await desktopPets(profile,native,emit,quota.getState,()=>quota.refresh(undefined),prefs.locale,notices.activity) : null;
  void prefs.chrome().then(colors=>native('host:chrome',colors)).catch(console.error);
  if(pets) await pets.request('pet:theme',[(await prefs.channels.get('theme:get')!() as {resolved:string}).resolved==='dark']);
  const unbind = bindRuntimeQuota({ directory: quota.directory, getState: quota.getState });
  const unsubscribe = onLocalRuntimeSynced(() => emit('tud:data-synced'));
  const startup = startLocalRuntime().then(async () => { quota.start(); await Promise.all([notices.start(),pets?.start()]); }).catch(error => {
    console.error('Desktop runtime startup:', error instanceof Error ? error.message : error);
    emit('app:runtime-notice', 'LOCAL_RUNTIME_NOT_READY');
  });
  let closed = false;
  return {
    async request(window, channel, args) {
      if (closed) throw Error('Desktop runtime is stopping');
      const [value, option] = args;
      if (channel.startsWith('runtime:') || channel === 'autostart:save') {
        if (window !== 'host') throw Error('Native window required');
        if (channel === 'runtime:fish-closed') return pets?.fishWindowClosed(value);
        if (channel === 'runtime:tray-info') {
          const locale = prefs.locale();
          const { providers } = quota.getState();
          const mode = await prefs.channels.get('tray-usage-mode:get')!();
          let title = '';
          if (process.platform === 'darwin' && await prefs.channels.get('tray-usage:get')!() && isTrayUsageMode(mode)) {
            if (mode === 'quota') title = quotaTrayTitle(providers,locale);
            else {
              const response = await localApiRequest('/functions/tud-usage-summary');
              const body = response.body as {success?:boolean;data?:{todayCostUsd?:number;todayTokens?:number}};
              if (body.success && body.data) title = formatTrayUsage(body.data,mode);
            }
          }
          const selection = await pets?.request('pet:selection:get',[]) as {enabled:boolean} | undefined;
          const incidents = providers.filter(p=>p.service && p.service.level !== 'operational' && p.service.level !== 'unknown').map(p=>nativeText(locale,'native.tray.serviceIssue',{provider:p.label}));
          return {title,tooltip:['Quotern',...incidents,quotaTraySummary(providers,locale).text].join('\n').slice(0,127),
            login:await prefs.channels.get('autostart:get')!(),pet:selection?.enabled,
            labels:['native.tray.showMain','native.tray.autostart','native.tray.togglePet','native.tray.settings','native.tray.quit'].map(key=>nativeText(locale,key as Parameters<typeof nativeText>[1]))};
        }
        if (channel === 'runtime:foreground') { notices.focus(value===true); if(value===true)pokeSyncOnForeground(); return; }
        if (channel === 'runtime:wake') { quota.wake(); await refreshLocalPricingIfStale(); return; }
        if (channel === 'runtime:theme' && typeof value === 'boolean') { prefs.systemTheme(value); return; }
      }
      const handler = prefs.channels.get(channel);
      if (handler) return channel === 'dashboard-range:set' ? handler(value, window) : handler(...args);
      if (channel.startsWith('notifications:') || channel.startsWith('dsh-pet:navigation') || channel==='quota:test-notification') {
        if(channel==='notifications:activate' && window!=='host')throw Error('Native activation required');
        return notices.request(channel==='quota:test-notification'?'notifications:test':channel,args);
      }
      if (channel.startsWith('pet:') || channel.startsWith('dsh:') || channel.startsWith('dsh-pet:')) {
        if(!pets)throw Error('Desktop pets are available on Windows');
        return pets.request(channel,args);
      }
      switch (channel) {
        case QUOTA_GET: return quota.getState();
        case QUOTA_REFRESH: return quota.refresh(value);
        case QUOTA_SET: return quota.set(value);
        case 'quota:authorize': return quota.authorize(value, option);
        case 'quota:disconnect': return quota.disconnect(value);
        case SHARE_BACKGROUNDS_CHANNEL: {
          if (!value || typeof value !== 'object' || !('operation' in value) || value.operation !== 'legacy') throw Error('Invalid share background request');
          return readDesktopLegacyBackgrounds(join(profile, 'share-backgrounds'));
        }
        case 'tud:api-request': {
          if (typeof value !== 'string' || !/^\/(?:functions\/tud-[a-z0-9-]+(?:[/?]|$)|health(?:\?|$))/.test(value) || value.includes('\\')) throw Error('Invalid local API path');
          const url = new URL(value,'http://tud.local');
          if (url.origin !== 'http://tud.local' || (!url.pathname.startsWith('/functions/tud-') && url.pathname !== '/health')) throw Error('Invalid local API path');
          if (option != null && (typeof option !== 'object' || Array.isArray(option))) throw Error('Invalid local API options');
          const init = option as Parameters<typeof localApiRequest>[1];
          const method = init?.method?.toUpperCase() ?? 'GET';
          if (!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method)) throw Error('Invalid local API method');
          if (!allowsLocalApiRequest(window, url.pathname, method)) throw Error('Main window required');
          if (url.pathname === '/functions/tud-quota' && method === 'GET') return {status:200, body:{success:true,message:'ok',data:quota.getState()}};
          return localApiRequest(url.pathname + url.search, init);
        }
        default: throw Error('Unsupported desktop operation: ' + channel);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      setLocalRuntimeQuitting(true);
      await startup;
      unsubscribe();
      unbind();
      try {
        await pets?.close();
      } finally {
        try { await notices.close(); } finally {
          await Promise.all([quota.close(), stopLocalRuntime(), prefs.flush()]);
        }
      }
    },
  };
}
