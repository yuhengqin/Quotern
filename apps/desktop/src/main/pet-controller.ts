import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDateNow } from 'quotern-core/timezone';
import { defaultPreloadPath, resolveAppIconPath } from './DesktopWindow';
import { localApiRequest, onLocalRuntimeSynced } from './local-runtime';
import { PetCatalog } from './pet-catalog';
import { collectPetLimits } from './pet-limits';
import { readCodexSubscription } from './codex-subscription';
import { readClaudeSubscription } from './claude-subscription';
import { readCursorSubscription } from './cursor-subscription';
import { readCopilotSubscription } from './copilot-subscription';
import { readGrokSubscription } from './grok-subscription';
import { readKimiSubscriptions } from './kimi-subscription';
import { readZcodeSubscription } from './zcode-subscription';
import { readAntigravitySubscription } from './antigravity-subscription';
import { readQoderSubscription } from './qoder-subscription';
import { readMiniMaxSubscription } from './minimax-subscription';
import { readDeepSeekSubscription } from './deepseek-subscription';
import { readOpenCodeSubscription } from './opencode-subscription';
import { readTraeSubscription } from './trae-subscription';
import { readWorkBuddySubscription } from './workbuddy-subscription';
import {
  clampPetBounds,
  DEFAULT_PET_SETTINGS,
  normalizePetSettings,
  PET_BUBBLE_BAND,
  PET_ID_RE,
  petDockTarget,
  petSpriteRect,
  petWindowSize,
  toPetStats,
  type PetSettings,
  type Point,
} from './pet-core';
import {
  PET_CATALOG_CHANNEL,
  PET_COMMAND_CHANNEL,
  PET_EVENT_CHANNEL,
  PET_GET_CHANNEL,
  PET_SET_CHANNEL,
  PET_STATE_CHANNEL,
  type PetCatalogRequest,
  type PetSettingPatch,
  type PetState,
} from '../shared/pet';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURSOR_POLL_MS = 50;
const IDLE_SLEEP_MS = 60_000;
const DATA_REFRESH_MS = 60_000;
const LIMIT_REFRESH_MS = 5 * 60_000;

function dataFromResponse(value: { status: number; body: unknown }): Record<string, unknown> {
  const body = value.body && typeof value.body === 'object' ? value.body as Record<string, unknown> : {};
  if (value.status !== 200 || body.success !== true || !body.data || typeof body.data !== 'object') {
    throw new Error(typeof body.message === 'string' ? body.message : `LOCAL_API_${value.status}`);
  }
  return body.data as Record<string, unknown>;
}

export class PetController {
  private readonly catalog = new PetCatalog();
  private settings: PetSettings = { ...DEFAULT_PET_SETTINGS };
  private state: PetState = {
    settings: this.settings,
    catalog: [],
    stats: toPetStats({}, {}, {}, localDateNow()),
    limits: [],
    connected: false,
    syncing: false,
    dark: false,
    locale: 'zh-CN',
    hover: false,
    miniMode: false,
    lookDirectionIndex: null,
    bubbleBand: PET_BUBBLE_BAND,
  };
  private window: BrowserWindow | null = null;
  private basePosition: Point | null = null;
  private docked = false;
  private dragging: { cursor: Point; position: Point } | null = null;
  private cursorTimer: ReturnType<typeof setInterval> | null = null;
  private dataTimer: ReturnType<typeof setInterval> | null = null;
  private limitTimer: ReturnType<typeof setInterval> | null = null;
  private lastCursor: Point | null = null;
  private lastCursorMoveAt = Date.now();
  private sleeping = false;
  private refreshing = false;
  private refreshingLimits = false;
  private refreshAgain = false;
  private lastStatsDate = '';
  private settingsQueue: Promise<unknown> = Promise.resolve();
  private unsubscribeSync: (() => void) | null = null;
  private readonly onDisplaysChanged = () => this.normalizePosition();

  constructor(private readonly options: {
    showMainWindow: () => void;
    openSettings: () => void;
    getDark: () => boolean;
  }) {}

  private settingsPath(): string {
    return path.join(app.getPath('userData'), 'pet-settings.json');
  }

  private async persistSettings(): Promise<void> {
    const file = this.settingsPath();
    const stage = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(stage, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
    try { await rename(stage, file); }
    catch (error) { await import('node:fs/promises').then(fs => fs.rm(stage, { force: true })); throw error; }
  }

  private broadcast(): void {
    this.state = { ...this.state, settings: { ...this.settings } };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(PET_STATE_CHANNEL, this.state);
    }
  }

  private emitPetEvent(type: string, detail?: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(PET_EVENT_CHANNEL, { type, detail });
    }
  }

  private currentSize(): { width: number; height: number } {
    return petWindowSize(this.settings.size, this.state.bubbleBand);
  }

  private currentWorkArea(): Electron.Rectangle {
    const point = this.basePosition ?? this.window?.getBounds() ?? screen.getPrimaryDisplay().workArea;
    return screen.getDisplayNearestPoint(point).workArea;
  }

  private ensureBasePosition(): Point {
    if (this.basePosition) return this.basePosition;
    const work = screen.getPrimaryDisplay().workArea;
    const size = this.currentSize();
    this.basePosition = {
      x: work.x + work.width - size.width - 48,
      y: work.y + work.height - size.height - 24,
    };
    return this.basePosition;
  }

  private applyBounds(): void {
    const w = this.window;
    if (!w || w.isDestroyed()) return;
    const size = this.currentSize();
    const base = this.ensureBasePosition();
    const work = this.currentWorkArea();
    const position = this.docked
      ? petDockTarget(base, size, work, this.state.hover, true, this.state.bubbleBand)
      : { ...base };
    w.setBounds({ x: Math.round(position.x), y: Math.round(position.y), ...size }, false);
  }

  private normalizePosition(): void {
    if (!this.settings.visible || !this.window || this.window.isDestroyed()) return;
    const base = this.ensureBasePosition();
    const size = this.currentSize();
    this.basePosition = clampPetBounds(base, size, this.currentWorkArea());
    this.applyBounds();
    void this.savePosition();
  }

  private async savePosition(): Promise<void> {
    this.settings.position = this.basePosition;
    this.settings.docked = this.docked;
    this.state.settings = { ...this.settings };
    const run = this.settingsQueue.then(() => this.persistSettings()).catch(error => {
      console.error('[tud-desktop] pet position save failed:', error);
    });
    this.settingsQueue = run;
    await run;
  }

  private async loadRenderer(w: BrowserWindow): Promise<void> {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) {
      await w.loadURL(new URL('pet.html', devUrl).toString());
    } else {
      await w.loadFile(path.join(__dirname, '../renderer/pet.html'));
    }
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const size = this.currentSize();
    const w = new BrowserWindow({
      ...size,
      x: this.ensureBasePosition().x,
      y: this.ensureBasePosition().y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: 'Quotern 桌面宠物',
      icon: resolveAppIconPath(),
      webPreferences: { preload: defaultPreloadPath(), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.window = w;
    w.setIgnoreMouseEvents(true, { forward: true });
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    w.webContents.on('did-finish-load', () => {
      if (!w.isDestroyed()) w.webContents.send(PET_STATE_CHANNEL, this.state);
    });
    w.on('closed', () => {
      if (this.window === w) this.window = null;
      this.stopCursorTimer();
    });
    void this.loadRenderer(w).catch(error => console.error('[tud-desktop] pet renderer failed:', error));
    return w;
  }

  private setVisible(visible: boolean): void {
    if (!visible) {
      this.stopCursorTimer();
      this.state.hover = false;
      this.state.miniMode = this.docked;
      this.window?.hide();
      this.broadcast();
      return;
    }
    const w = this.ensureWindow();
    const original = this.ensureBasePosition();
    const clamped = clampPetBounds(original, this.currentSize(), this.currentWorkArea());
    this.basePosition = clamped;
    this.applyBounds();
    if (original.x !== clamped.x || original.y !== clamped.y) void this.savePosition();
    w.showInactive();
    this.lastCursorMoveAt = Date.now();
    this.sleeping = false;
    this.emitPetEvent('pet:wake');
    this.startCursorTimer();
    this.broadcast();
    void this.refreshLimits();
  }

  private startCursorTimer(): void {
    if (this.cursorTimer) return;
    this.cursorTimer = setInterval(() => this.pollCursor(), CURSOR_POLL_MS);
    this.pollCursor();
  }

  private stopCursorTimer(): void {
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    this.cursorTimer = null;
  }

  private pollCursor(): void {
    const w = this.window;
    if (!w || w.isDestroyed() || !w.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    if (this.dragging) this.moveDrag();
    if (!this.lastCursor || cursor.x !== this.lastCursor.x || cursor.y !== this.lastCursor.y) {
      this.lastCursorMoveAt = Date.now();
      this.lastCursor = cursor;
      if (this.sleeping) {
        this.sleeping = false;
        this.emitPetEvent('pet:wake');
      }
    } else if (!this.sleeping && Date.now() - this.lastCursorMoveAt >= IDLE_SLEEP_MS) {
      this.sleeping = true;
      this.emitPetEvent('pet:sleep', { phase: 'sleeping' });
    }
    const bounds = w.getBounds();
    const sprite = petSpriteRect(bounds, this.state.bubbleBand);
    const inSprite = cursor.x >= bounds.x + sprite.x && cursor.x < bounds.x + sprite.x + sprite.width
      && cursor.y >= bounds.y + sprite.y && cursor.y < bounds.y + sprite.y + sprite.height;
    const work = this.currentWorkArea();
    const inEdgeHandle = this.docked && this.state.hover
      && cursor.x >= work.x + work.width - 35 && cursor.x <= work.x + work.width
      && cursor.y >= bounds.y + sprite.y && cursor.y < bounds.y + sprite.y + sprite.height;
    const hover = inSprite || inEdgeHandle || this.dragging !== null;
    if (this.state.hover !== hover) {
      this.state.hover = hover;
      this.state.miniMode = this.docked && !hover;
      if (this.docked && !this.dragging) this.applyBounds();
      this.broadcast();
    }
    w.setIgnoreMouseEvents(!inSprite && !this.dragging, { forward: true });
    const centerX = bounds.x + sprite.x + sprite.width / 2;
    const centerY = bounds.y + sprite.y + sprite.height / 2;
    const angle = (Math.atan2(cursor.x - centerX, centerY - cursor.y) * 180 / Math.PI + 360) % 360;
    const look = Math.round(angle / 22.5) % 16;
    if (look !== this.state.lookDirectionIndex) {
      this.state.lookDirectionIndex = look;
      this.broadcast();
    }
  }

  private async setSettings(patch: unknown): Promise<PetState> {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('无效的宠物设置');
    const input = patch as PetSettingPatch;
    const keys = Object.keys(input);
    if (keys.some(key => !['visible', 'character', 'size', 'botColor'].includes(key))) throw new Error('不支持的宠物设置');
    if (input.visible !== undefined && typeof input.visible !== 'boolean') throw new Error('无效的显示设置');
    if (input.character !== undefined && (typeof input.character !== 'string' || !PET_ID_RE.test(input.character))) throw new Error('无效的角色');
    if (input.size !== undefined && !['small', 'medium', 'large'].includes(input.size)) throw new Error('无效的尺寸');
    if (input.botColor !== undefined && !['auto', 'bleu', 'turquoise', 'vert', 'ambre', 'rose', 'violet'].includes(input.botColor)) throw new Error('无效的颜色');
    const run = this.settingsQueue.then(async () => {
      if (input.character && !this.state.catalog.some(pet => pet.id === input.character)) throw new Error('角色已不存在');
      const previousVisible = this.settings.visible;
      this.settings = normalizePetSettings({ ...this.settings, ...input });
      this.state.settings = { ...this.settings };
      if (input.size) this.normalizePosition();
      await this.persistSettings();
      if (input.visible !== undefined && input.visible !== previousVisible) this.setVisible(input.visible);
      else if (input.size) this.applyBounds();
      this.broadcast();
      return this.state;
    });
    this.settingsQueue = run.catch(() => undefined);
    return run;
  }

  private showContextMenu(): void {
    const w = this.window;
    if (!w || w.isDestroyed()) return;
    const size = this.settings.size;
    const menu = Menu.buildFromTemplate([
      { label: '打开 Quotern', click: this.options.showMainWindow },
      { label: '同步数据', click: () => void this.triggerSync() },
      { type: 'separator' },
      { label: '大小', submenu: (['small', 'medium', 'large'] as const).map((value, index) => ({
        label: ['小', '中', '大'][index]!, type: 'radio' as const, checked: size === value,
        click: () => this.setSettingsFromMenu({ size: value }),
      })) },
      { label: '角色', submenu: this.state.catalog.map(pet => ({
        label: pet.displayName, type: 'radio' as const, checked: this.settings.character === pet.id,
        click: () => this.setSettingsFromMenu({ character: pet.id }),
      })) },
      { type: 'separator' },
      { label: '宠物设置', click: this.options.openSettings },
      { label: '隐藏宠物', click: () => this.setSettingsFromMenu({ visible: false }) },
    ]);
    menu.popup({ window: w });
  }

  private setSettingsFromMenu(patch: PetSettingPatch): void {
    void this.setSettings(patch).catch(error => console.error('[tud-desktop] pet setting failed:', error));
  }

  private startDrag(direction: 'left' | 'right'): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.docked) {
      this.docked = false;
      this.basePosition = { x: this.window.getBounds().x, y: this.window.getBounds().y };
      this.state.miniMode = false;
    }
    this.dragging = { cursor: screen.getCursorScreenPoint(), position: this.ensureBasePosition() };
    this.emitPetEvent('pet:drag-state', direction === 'left' ? 'running-left' : 'running-right');
  }

  private moveDrag(): void {
    if (!this.dragging || !this.window || this.window.isDestroyed()) return;
    const now = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(now);
    const work = display.workArea;
    const size = this.currentSize();
    const raw = {
      x: this.dragging.position.x + now.x - this.dragging.cursor.x,
      y: this.dragging.position.y + now.y - this.dragging.cursor.y,
    };
    this.basePosition = {
      x: Math.round(Math.max(work.x - size.width + 40, Math.min(raw.x, work.x + work.width - 40))),
      y: Math.round(Math.max(work.y, Math.min(raw.y, work.y + work.height - size.height))),
    };
    this.applyBounds();
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = null;
    const base = this.ensureBasePosition();
    const target = petDockTarget(base, this.currentSize(), this.currentWorkArea(), false, false, this.state.bubbleBand);
    this.docked = target.docked;
    this.state.miniMode = this.docked;
    this.state.hover = false;
    this.applyBounds();
    this.emitPetEvent('pet:drag-end');
    this.broadcast();
    void this.savePosition();
  }

  private setBubbleBand(raw: number): void {
    if (!Number.isFinite(raw)) return;
    const work = this.currentWorkArea();
    const next = Math.max(PET_BUBBLE_BAND, Math.min(Math.round(raw), work.height - 48));
    if (next === this.state.bubbleBand) return;
    const diff = next - this.state.bubbleBand;
    this.state.bubbleBand = next;
    if (this.basePosition) this.basePosition = { x: this.basePosition.x, y: Math.max(work.y, this.basePosition.y - diff) };
    this.applyBounds();
    this.broadcast();
  }

  private handleCommand(event: Electron.IpcMainEvent, raw: unknown): void {
    if (!this.window || event.sender !== this.window.webContents || typeof raw !== 'string') return;
    if (raw === 'context-menu') this.showContextMenu();
    else if (raw === 'open-dashboard') this.options.showMainWindow();
    else if (raw === 'sync') void this.triggerSync();
    else if (raw === 'hide') this.setSettingsFromMenu({ visible: false });
    else if (raw === 'drag-left' || raw === 'drag-right') this.startDrag(raw === 'drag-left' ? 'left' : 'right');
    else if (raw === 'drag-end') this.endDrag();
    else if (raw.startsWith('move:')) this.moveDrag();
    else if (raw.startsWith('bubble-height:')) this.setBubbleBand(Number(raw.slice('bubble-height:'.length)));
  }

  private async triggerSync(): Promise<void> {
    this.state.syncing = true;
    this.broadcast();
    try {
      const response = await localApiRequest('/functions/tud-trigger-sync', { method: 'POST', body: '{}' });
      if (response.status !== 200) throw new Error(`LOCAL_API_${response.status}`);
    } catch (error) {
      console.error('[tud-desktop] pet sync failed:', error);
    }
    finally { this.state.syncing = false; this.broadcast(); void this.refreshData(); }
  }

  private async refreshData(): Promise<void> {
    if (this.refreshing) { this.refreshAgain = true; return; }
    this.refreshing = true;
    try {
      const [summaryResponse, dailyResponse, breakdownResponse, sessionsResponse] = await Promise.all([
        localApiRequest('/functions/tud-usage-summary'),
        localApiRequest('/functions/tud-usage-daily?days=365'),
        localApiRequest('/functions/tud-usage-model-breakdown?days=30'),
        localApiRequest('/functions/tud-usage-sessions?days=1').catch(() => null),
      ]);
      const summary = dataFromResponse(summaryResponse);
      const daily = dataFromResponse(dailyResponse);
      const breakdown = dataFromResponse(breakdownResponse);
      const today = localDateNow();
      const previous = this.state.stats;
      let sessions: Record<string, unknown> | undefined;
      try { if (sessionsResponse) sessions = dataFromResponse(sessionsResponse); } catch { /* session facts are optional */ }
      const next = toPetStats(
        summary,
        daily as Parameters<typeof toPetStats>[1],
        breakdown as Parameters<typeof toPetStats>[2],
        today,
        sessions as Parameters<typeof toPetStats>[4],
      );
      this.state.stats = next;
      this.state.connected = true;
      this.broadcast();
      if (this.lastStatsDate === today && next.todayTokens > previous.todayTokens) {
        this.emitPetEvent('pet:model-status', {
          tokensDelta: next.todayTokens - previous.todayTokens,
          costDelta: Math.max(0, next.todayCostUsd - previous.todayCostUsd),
        });
      }
      this.lastStatsDate = today;
    } catch (error) {
      this.state.connected = false;
      this.broadcast();
      console.debug('[tud-desktop] pet data refresh failed:', error);
    } finally {
      this.refreshing = false;
      if (this.refreshAgain) { this.refreshAgain = false; void this.refreshData(); }
    }
  }

  private async refreshLimits(): Promise<void> {
    if (!this.settings.visible || this.refreshingLimits) return;
    this.refreshingLimits = true;
    const readers: Record<string, Promise<unknown>> = {
      codex: readCodexSubscription(),
      claude: readClaudeSubscription(),
      cursor: readCursorSubscription(),
      copilot: readCopilotSubscription(),
      grok: readGrokSubscription(),
      kimi: readKimiSubscriptions(),
      zcode: readZcodeSubscription(),
      antigravity: readAntigravitySubscription(),
      qoder: readQoderSubscription(),
      minimax: readMiniMaxSubscription(),
      deepseek: readDeepSeekSubscription(),
      opencode: readOpenCodeSubscription(),
      traeGlobal: readTraeSubscription('global'),
      traeCn: readTraeSubscription('mainland'),
      workbuddyGlobal: readWorkBuddySubscription('global'),
      workbuddyMainland: readWorkBuddySubscription('mainland'),
    };
    try {
      const pairs = await Promise.all(Object.entries(readers).map(async ([key, promise]) => [key, await promise.catch(() => null)] as const));
      const snapshots = Object.fromEntries(pairs) as Record<string, unknown>;
      const kimi = Array.isArray(snapshots.kimi) ? snapshots.kimi as Array<{ source?: string }> : [];
      snapshots.kimiCode = kimi.find(item => item.source === 'code');
      snapshots.kimiDesktop = kimi.find(item => item.source === 'desktop');
      this.state.limits = collectPetLimits(snapshots);
      this.broadcast();
    } catch (error) {
      console.debug('[tud-desktop] pet limits refresh failed:', error);
    } finally { this.refreshingLimits = false; }
  }

  private async handleCatalog(request: PetCatalogRequest): Promise<unknown> {
    if (!request || typeof request !== 'object') throw new Error('无效的宠物操作');
    if (request.action === 'list-codex') return this.catalog.listCodex();
    if (request.action === 'import-zip') {
      const result = await dialog.showOpenDialog({ title: '导入桌面宠物', properties: ['openFile'], filters: [{ name: '宠物 ZIP', extensions: ['zip'] }] });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      const file = result.filePaths[0];
      const fs = await import('node:fs/promises');
      if ((await fs.stat(file)).size > 12 * 1024 * 1024) throw new Error('宠物 ZIP 超过 12 MB');
      await this.catalog.installZip(await fs.readFile(file));
    } else if (request.action === 'install-url') {
      if (typeof request.url !== 'string') throw new Error('无效的下载地址');
      await this.catalog.installFromUrl(request.url);
    } else if (request.action === 'import-codex') {
      await this.catalog.importCodex(request.ids);
    } else if (request.action === 'remove') {
      await this.catalog.remove(request.id);
    } else if (request.action === 'restore-builtins') {
      await this.catalog.restoreBuiltins();
    } else {
      throw new Error('不支持的宠物操作');
    }
    this.state.catalog = await this.catalog.list();
    if (!this.state.catalog.some(pet => pet.id === this.settings.character)) await this.setSettings({ character: 'clawd' });
    this.broadcast();
    return { catalog: this.state.catalog };
  }

  async initialize(): Promise<void> {
    if (process.platform !== 'win32') return;
    try { this.settings = normalizePetSettings(JSON.parse(await readFile(this.settingsPath(), 'utf8'))); }
    catch { this.settings = { ...DEFAULT_PET_SETTINGS }; }
    this.state.settings = { ...this.settings };
    this.state.dark = this.options.getDark();
    this.state.locale = app.getLocale();
    this.state.catalog = await this.catalog.list();
    if (!this.state.catalog.some(pet => pet.id === this.settings.character)) this.settings.character = 'clawd';
    this.basePosition = this.settings.position;
    this.docked = this.settings.docked;
    this.catalog.registerAssetProtocol();
    ipcMain.removeHandler(PET_GET_CHANNEL);
    ipcMain.handle(PET_GET_CHANNEL, () => this.state);
    ipcMain.removeHandler(PET_SET_CHANNEL);
    ipcMain.handle(PET_SET_CHANNEL, (_event, patch: unknown) => this.setSettings(patch));
    ipcMain.removeHandler(PET_CATALOG_CHANNEL);
    ipcMain.handle(PET_CATALOG_CHANNEL, async (_event, request: PetCatalogRequest) => {
      try { return { ok: true, data: await this.handleCatalog(request) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : '宠物操作失败' }; }
    });
    ipcMain.removeAllListeners(PET_COMMAND_CHANNEL);
    ipcMain.on(PET_COMMAND_CHANNEL, (event, raw) => this.handleCommand(event, raw));
    screen.on('display-added', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);
    screen.on('display-metrics-changed', this.onDisplaysChanged);
    this.unsubscribeSync = onLocalRuntimeSynced(() => void this.refreshData());
    this.dataTimer = setInterval(() => void this.refreshData(), DATA_REFRESH_MS);
    this.limitTimer = setInterval(() => void this.refreshLimits(), LIMIT_REFRESH_MS);
    if (this.settings.visible) this.setVisible(true);
    this.broadcast();
    void this.refreshData();
  }

  setDark(dark: boolean): void {
    this.state.dark = dark;
    this.broadcast();
  }

  isVisible(): boolean { return this.settings.visible; }

  toggle(): void { this.setSettingsFromMenu({ visible: !this.settings.visible }); }

  dispose(): void {
    this.stopCursorTimer();
    if (this.dataTimer) clearInterval(this.dataTimer);
    this.dataTimer = null;
    if (this.limitTimer) clearInterval(this.limitTimer);
    this.limitTimer = null;
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    screen.removeListener('display-added', this.onDisplaysChanged);
    screen.removeListener('display-removed', this.onDisplaysChanged);
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
    ipcMain.removeHandler(PET_GET_CHANNEL);
    ipcMain.removeHandler(PET_SET_CHANNEL);
    ipcMain.removeHandler(PET_CATALOG_CHANNEL);
    ipcMain.removeAllListeners(PET_COMMAND_CHANNEL);
    this.catalog.unregisterAssetProtocol();
    this.window?.destroy();
    this.window = null;
  }
}
