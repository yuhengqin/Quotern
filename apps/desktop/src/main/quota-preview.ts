import { app } from 'electron';
import { resolve } from 'node:path';
import { configureQuoternAppIdentity } from './app-identity';
import { DesktopWindow, defaultPreloadPath, markAppQuitting, registerDesktopWindowControls } from './DesktopWindow';
import { resolveQuotaPreviewConfig } from '../shared/quota-preview';

// A separate entry keeps readers, Core runtime, hooks, pets and updaters out of
// the preview process entirely. Never import the normal main entry here.
const preview = resolveQuotaPreviewConfig(process.env, app.isPackaged);
process.env.QUOTERN_DESKTOP_USER_DATA = preview.userData;
configureQuoternAppIdentity(app);

app.on('before-quit', markAppQuitting);
app.on('window-all-closed', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(async () => {
    const response = await fetch(new URL('/__quota_mock_health__', preview.url), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('请先启动本 worktree 的 quota-mock-preview.mjs');
    const health = await response.json() as { kind?: unknown; checkout?: unknown };
    if (health.kind !== 'quota-mock' || typeof health.checkout !== 'string' || resolve(health.checkout) !== resolve(__dirname, '../../../..')) {
      throw new Error('额度 mock 服务不属于当前 worktree，拒绝加载');
    }
    const page = await fetch(preview.url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!page.ok) throw new Error(`额度 mock 页面无法加载：HTTP ${page.status}`);
    await page.body?.cancel();
    process.env.ELECTRON_RENDERER_URL = preview.url;
    let window: DesktopWindow | undefined;
    registerDesktopWindowControls(() => window?.window ?? null);
    window = new DesktopWindow({ preloadPath: defaultPreloadPath(), title: 'Quotern Desktop · Mock 预览' });
    window.window.once('ready-to-show', () => window?.window.focus());
    console.log(`[Quota mock] ${preview.url}\n独立窗口数据 ${preview.userData}\n仅虚构额度，不启动采集或订阅读取`);
  }).catch(error => { console.error('[Quota mock]', error); app.exit(1); });
}
