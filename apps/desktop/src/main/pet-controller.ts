import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDateNow } from 'quotern-core/timezone';
import { appendJsonLog, logsDir, resolveDataDir } from 'quotern-core';
import { defaultPreloadPath, resolveAppIconPath } from './DesktopWindow';
import { isLocalRuntimeSyncing, localApiRequest, onLocalRuntimeSyncActivity, onLocalRuntimeSynced } from './local-runtime';
import { PetCatalog } from './pet-catalog';
import { petCatalogFailure, petCatalogMessageKey } from './pet-catalog-errors';
import { createPetCursorSampler } from './pet-pointer';
import type { QuotaState } from '../shared/quota';
import type { SupportedLocale } from 'quotern-i18n';
import { NATIVE_MESSAGES, nativeText, type NativeMessageKey } from './native-messages';
import {
  clampPetBounds,
  DEFAULT_PET_SETTINGS,
  normalizePetSettings,
  PET_BUBBLE_BAND,
  PET_ID_RE,
  petDockTarget,
  petPointerRegion,
  petSpriteRect,
  petWindowSize,
  toPetStats,
  type PetSettings,
  type PetCatalogEntry,
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
const CURSOR_POLL_MS = process.platform === 'win32' ? 16 : 50;
const IDLE_SLEEP_MS = 60_000;
const EDGE_ANIMATION_MS = 200;
const DATA_REFRESH_MS = 60_000;

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
    currentKind: 'builtin',
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
  private ignoringMouse: boolean | null = null;
  private pointerPressed = false;
  private sampleCursor = createPetCursorSampler();
  private basePosition: Point | null = null;
  private docked = false;
  private dragging: { cursor: Point; position: Point; direction: 'left' | 'right' } | null = null;
  private cursorTimer: ReturnType<typeof setInterval> | null = null;
  private edgeTimer: ReturnType<typeof setInterval> | null = null;
  private dataTimer: ReturnType<typeof setInterval> | null = null;
  private lastCursor: Point | null = null;
  private lastCursorMoveAt = Date.now();
  private sleeping = false;
  private refreshing = false;
  private refreshAgain = false;
  private lastStatsDate = '';
  private settingsQueue: Promise<unknown> = Promise.resolve();
  private unsubscribeSync: (() => void) | null = null;
  private unsubscribeSyncActivity: (() => void) | null = null;
  private readonly onDisplaysChanged = () => this.normalizePosition();

  constructor(private readonly options: {
    toggleMainWindow: () => void;
    isMainWindowVisible: () => boolean;
    openSettings: () => void;
    getDark: () => boolean;
    getLocale: () => SupportedLocale;
    getQuotaState?: () => QuotaState | null;
    coordinateVisibility?: <T>(visible: boolean, operation: () => Promise<T>) => Promise<T>;
    getCurrentKind?: () => PetState['currentKind'];
  }) {}

  private t(key: NativeMessageKey): string {
    return nativeText(this.options.getLocale(), key);
  }

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
    this.state = { ...this.state, settings: { ...this.settings }, currentKind: this.options.getCurrentKind?.() ?? 'builtin' };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(PET_STATE_CHANNEL, this.state);
    }
  }

  private emitPetEvent(type: string, detail?: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(PET_EVENT_CHANNEL, { type, detail });
    }
  }

  private setMouseIgnored(ignore: boolean): void {
    const w = this.window;
    if (!w || w.isDestroyed() || this.ignoringMouse === ignore) return;
    // Windows forwarding installs a process-wide WH_MOUSE_LL hook, even while hidden.
    w.setIgnoreMouseEvents(ignore, { forward: process.platform !== 'win32' });
    this.ignoringMouse = ignore;
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

  private stopEdgeAnimation(): void {
    if (this.edgeTimer) clearInterval(this.edgeTimer);
    this.edgeTimer = null;
  }

  private applyBounds(animated = false): void {
    const w = this.window;
    if (!w || w.isDestroyed()) return;
    const size = this.currentSize();
    const base = this.ensureBasePosition();
    const work = this.currentWorkArea();
    const position = this.docked
      ? petDockTarget(base, size, work, this.state.hover, true, this.state.bubbleBand)
      : { ...base };
    const target = { x: Math.round(position.x), y: Math.round(position.y), ...size };
    const startX = w.getBounds().x;
    this.stopEdgeAnimation();
    if (!animated || !this.docked || Math.abs(startX - target.x) < 1) {
      w.setBounds(target, false);
      return;
    }
    const startedAt = Date.now();
    const tick = () => {
      if (w.isDestroyed() || !w.isVisible()) { this.stopEdgeAnimation(); return; }
      const t = Math.min(1, (Date.now() - startedAt) / EDGE_ANIMATION_MS);
      const eased = t * (2 - t);
      w.setBounds({ ...target, x: Math.round(startX + (target.x - startX) * eased) }, false);
      if (t >= 1) this.stopEdgeAnimation();
    };
    this.edgeTimer = setInterval(tick, 16);
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
      title: this.t('native.pet.title'),
      icon: resolveAppIconPath(),
      webPreferences: { preload: defaultPreloadPath(), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.window = w;
    this.setMouseIgnored(true);
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    w.webContents.on('did-finish-load', () => {
      if (!w.isDestroyed()) w.webContents.send(PET_STATE_CHANNEL, this.state);
    });
    w.on('closed', () => {
      if (this.window === w) {
        this.window = null;
        this.ignoringMouse = null;
        this.pointerPressed = false;
        this.sampleCursor = createPetCursorSampler();
      }
      this.stopCursorTimer();
    });
    void this.loadRenderer(w).catch(error => console.error('[tud-desktop] pet renderer failed:', error));
    return w;
  }

  private setVisible(visible: boolean): void {
    if (!visible) {
      this.stopCursorTimer();
      this.stopEdgeAnimation();
      this.pointerPressed = false;
      this.sampleCursor = createPetCursorSampler();
      if (this.dragging) {
        this.dragging = null;
        this.emitPetEvent('pet:drag-end');
      }
      this.state.hover = false;
      this.state.miniMode = this.docked;
      this.setMouseIgnored(true);
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
    const work = this.currentWorkArea();
    const region = petPointerRegion(cursor, bounds, work, this.state.bubbleBand, this.docked, this.state.hover);
    const hover = region.hovering || this.dragging !== null;
    if (this.state.hover !== hover) {
      this.state.hover = hover;
      if (this.docked && !this.dragging) this.applyBounds(true);
      this.broadcast();
    }
    if (!this.edgeTimer) this.setMouseIgnored(!region.overSprite && !this.dragging && !this.pointerPressed);
    if (process.platform === 'win32') {
      const sample = this.sampleCursor(bounds, cursor, hover, this.pointerPressed || this.dragging !== null);
      if (sample !== undefined) this.emitPetEvent('pet:cursor-position', sample);
    }
    const sprite = petSpriteRect(bounds, this.state.bubbleBand);
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
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(this.t('native.pet.invalidSettings'));
    const input = patch as PetSettingPatch;
    const keys = Object.keys(input);
    if (keys.some(key => !['visible', 'character', 'size', 'botColor'].includes(key))) throw new Error(this.t('native.pet.unsupportedSettings'));
    if (input.visible !== undefined && typeof input.visible !== 'boolean') throw new Error(this.t('native.pet.invalidVisibility'));
    if (input.character !== undefined && (typeof input.character !== 'string' || !PET_ID_RE.test(input.character))) throw new Error(this.t('native.pet.invalidCharacter'));
    if (input.size !== undefined && !['small', 'medium', 'large'].includes(input.size)) throw new Error(this.t('native.pet.invalidSize'));
    if (input.botColor !== undefined && !['auto', 'bleu', 'turquoise', 'vert', 'ambre', 'rose', 'violet'].includes(input.botColor)) throw new Error(this.t('native.pet.invalidColor'));
    const apply = () => this.applySettings(input);
    return input.visible !== undefined && this.options.coordinateVisibility ? this.options.coordinateVisibility(input.visible, apply) : apply();
  }

  private applySettings(input: PetSettingPatch): Promise<PetState> {
    const run = this.settingsQueue.then(async () => {
      if (input.character && !this.state.catalog.some(pet => pet.id === input.character)) throw new Error(this.t('native.pet.characterGone'));
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
      { label: this.t(this.options.isMainWindowVisible() ? 'native.pet.closeMain' : 'native.pet.openMain'), click: this.options.toggleMainWindow },
      { label: this.t('native.tray.sync'), click: () => void this.triggerSync() },
      { type: 'separator' },
      { label: this.t('native.pet.size'), submenu: (['small', 'medium', 'large'] as const).map((value) => ({
        label: this.t(`native.pet.${value}`), type: 'radio' as const, checked: size === value,
        click: () => this.setSettingsFromMenu({ size: value }),
      })) },
      { label: this.t('native.pet.character'), submenu: this.state.catalog.map(pet => ({
        label: pet.displayName, type: 'radio' as const, checked: this.settings.character === pet.id,
        click: () => this.setSettingsFromMenu({ character: pet.id }),
      })) },
      { type: 'separator' },
      { label: this.t('native.pet.settings'), click: this.options.openSettings },
      { label: this.t('native.pet.hide'), click: () => this.setSettingsFromMenu({ visible: false }) },
    ]);
    menu.popup({ window: w });
  }

  private setSettingsFromMenu(patch: PetSettingPatch): void {
    void this.setSettings(patch).catch(error => console.error('[tud-desktop] pet setting failed:', error));
  }

  private startDrag(direction: 'left' | 'right'): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.stopEdgeAnimation();
    if (this.docked) {
      this.docked = false;
      this.basePosition = { x: this.window.getBounds().x, y: this.window.getBounds().y };
      this.state.miniMode = false;
    }
    this.dragging = { cursor: screen.getCursorScreenPoint(), position: this.ensureBasePosition(), direction };
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
    const nextPosition = {
      x: Math.round(Math.max(work.x - size.width + 40, Math.min(raw.x, work.x + work.width - 40))),
      y: Math.round(Math.max(work.y, Math.min(raw.y, work.y + work.height - size.height))),
    };
    const deltaX = nextPosition.x - this.ensureBasePosition().x;
    if (Math.abs(deltaX) >= 1) {
      const direction = deltaX < 0 ? 'left' : 'right';
      if (direction !== this.dragging.direction) {
        this.dragging.direction = direction;
        this.emitPetEvent('pet:drag-state', direction === 'left' ? 'running-left' : 'running-right');
      }
    }
    this.basePosition = nextPosition;
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
    this.applyBounds(this.docked);
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
    if (raw === 'pointer-down' && this.window.isVisible()) {
      this.pointerPressed = true;
      this.setMouseIgnored(false);
    }
    else if (raw === 'pointer-up') {
      this.pointerPressed = false;
      this.pollCursor();
    }
    else if (raw === 'context-menu') this.showContextMenu();
    else if (raw === 'sync') void this.triggerSync();
    else if (raw === 'hide') this.setSettingsFromMenu({ visible: false });
    else if (raw === 'drag-left' || raw === 'drag-right') this.startDrag(raw === 'drag-left' ? 'left' : 'right');
    else if (raw === 'drag-end') this.endDrag();
    else if (raw.startsWith('move:')) this.moveDrag();
    else if (raw.startsWith('bubble-height:')) this.setBubbleBand(Number(raw.slice('bubble-height:'.length)));
  }

  private async triggerSync(): Promise<void> {
    try {
      const response = await localApiRequest('/functions/tud-trigger-sync', { method: 'POST', body: '{}' });
      if (response.status !== 200) throw new Error(`LOCAL_API_${response.status}`);
    } catch (error) {
      console.error('[tud-desktop] pet sync failed:', error);
    }
    finally { void this.refreshData(); }
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
    const state = this.options.getQuotaState?.();
    if (state) this.updateQuotaState(state);
  }

  updateQuotaState(state: QuotaState): void {
    this.state.limits = state.providers.filter(provider => provider.status === 'ready' && !provider.stale)
      .flatMap(provider => provider.windows.filter(window => window.analysisEligible !== false && window.usedPercent > 0 && window.usedPercent < 100)
        .map(window => ({ provider: provider.label, window: [window.groupLabel, window.label].filter(Boolean).join(' '), usedPercent: window.usedPercent, resetAt: window.resetsAt })))
      .sort((a, b) => b.usedPercent - a.usedPercent);
    this.broadcast();
  }

  private async handleCatalog(request: PetCatalogRequest): Promise<unknown> {
    if (!request || typeof request !== 'object') throw new Error(this.t('native.pet.invalidOperation'));
    if (request.action === 'list-codex') return this.catalog.listCodex();
    let importedPet: PetCatalogEntry | undefined;
    if (request.action === 'import-zip') {
      const result = await dialog.showOpenDialog({ title: this.t('native.pet.import'), properties: ['openFile'], filters: [{ name: this.t('native.pet.zipFilter'), extensions: ['zip'] }] });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      const file = result.filePaths[0];
      const fs = await import('node:fs/promises');
      if ((await fs.stat(file)).size > 12 * 1024 * 1024) throw new Error(this.t('native.pet.zipTooLarge'));
      importedPet = await this.catalog.installZip(await fs.readFile(file));
    } else if (request.action === 'install-url') {
      if (typeof request.url !== 'string') throw new Error(this.t('native.pet.invalidUrl'));
      importedPet = await this.catalog.installFromUrl(request.url);
    } else if (request.action === 'import-codex') {
      await this.catalog.importCodex(request.ids);
    } else if (request.action === 'remove') {
      await this.catalog.remove(request.id);
    } else if (request.action === 'restore-builtins') {
      await this.catalog.restoreBuiltins();
    } else {
      throw new Error(this.t('native.pet.unsupportedOperation'));
    }
    this.state.catalog = await this.catalog.list();
    if (!this.state.catalog.some(pet => pet.id === this.settings.character)) await this.setSettings({ character: 'clawd' });
    this.broadcast();
    return { catalog: this.state.catalog, pet: importedPet };
  }

  async initialize(): Promise<void> {
    if (process.platform !== 'win32') return;
    try { this.settings = normalizePetSettings(JSON.parse(await readFile(this.settingsPath(), 'utf8'))); }
    catch { this.settings = { ...DEFAULT_PET_SETTINGS }; }
    this.state.settings = { ...this.settings };
    this.state.dark = this.options.getDark();
    this.state.locale = this.options.getLocale();
    this.state.syncing = isLocalRuntimeSyncing();
    this.state.catalog = await this.catalog.list();
    if (!this.state.catalog.some(pet => pet.id === this.settings.character)) this.settings.character = 'clawd';
    this.basePosition = this.settings.position;
    this.docked = this.settings.docked;
    this.state.miniMode = this.docked;
    this.catalog.registerAssetProtocol();
    ipcMain.removeHandler(PET_GET_CHANNEL);
    ipcMain.handle(PET_GET_CHANNEL, () => this.state);
    ipcMain.removeHandler(PET_SET_CHANNEL);
    ipcMain.handle(PET_SET_CHANNEL, (_event, patch: unknown) => this.setSettings(patch));
    ipcMain.removeHandler(PET_CATALOG_CHANNEL);
    ipcMain.handle(PET_CATALOG_CHANNEL, async (_event, request: PetCatalogRequest) => {
      try { return { ok: true, data: await this.handleCatalog(request) }; }
      catch (error) {
        const diagnostic = petCatalogFailure(request, error);
        await appendJsonLog(path.join(logsDir(resolveDataDir()), 'pet-import.log'), diagnostic);
        const message = error instanceof Error ? error.message : '';
        const locale = this.options.getLocale();
        const messageKey = petCatalogMessageKey(error);
        if (messageKey) return { ok: false, error: nativeText(locale, messageKey, { status: String(diagnostic.httpStatus ?? '') }) };
        // Catalog validation still throws some diagnostic Chinese messages.
        // Do not expose those raw strings when another language is selected.
        return { ok: false, error: locale === 'zh-CN' || Object.values(NATIVE_MESSAGES[locale]).includes(message)
          ? (message || this.t('native.pet.operationFailed'))
          : this.t('native.pet.operationFailed') };
      }
    });
    ipcMain.removeAllListeners(PET_COMMAND_CHANNEL);
    ipcMain.on(PET_COMMAND_CHANNEL, (event, raw) => this.handleCommand(event, raw));
    screen.on('display-added', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);
    screen.on('display-metrics-changed', this.onDisplaysChanged);
    this.unsubscribeSync = onLocalRuntimeSynced(() => void this.refreshData());
    this.unsubscribeSyncActivity = onLocalRuntimeSyncActivity(active => {
      this.state.syncing = active;
      this.broadcast();
    });
    this.dataTimer = setInterval(() => void this.refreshData(), DATA_REFRESH_MS);
    if (this.settings.visible) {
      const show = async () => { this.setVisible(true); };
      if (this.options.coordinateVisibility) await this.options.coordinateVisibility(true, show); else await show();
    }
    this.broadcast();
    void this.refreshData();
  }

  setDark(dark: boolean): void {
    this.state.dark = dark;
    this.broadcast();
  }

  setLocale(locale: SupportedLocale): void {
    if (this.state.locale === locale) return;
    this.state.locale = locale;
    if (this.window && !this.window.isDestroyed()) this.window.setTitle(this.t('native.pet.title'));
    this.broadcast();
  }

  isVisible(): boolean { return this.settings.visible; }

  getState(): PetState { return this.state; }

  refreshSelection(): void { this.broadcast(); }

  /** Only the shared activation coordinator may bypass visibility coordination. */
  activate(): Promise<PetState> { return this.applySettings({ visible: true }); }

  selectCharacter(character: string): Promise<PetState> { return this.applySettings({ character }); }

  async hide(): Promise<void> { if (this.settings.visible) await this.applySettings({ visible: false }); }

  toggle(): void { this.setSettingsFromMenu({ visible: !this.settings.visible }); }

  dispose(): void {
    this.stopCursorTimer();
    this.stopEdgeAnimation();
    if (this.dataTimer) clearInterval(this.dataTimer);
    this.dataTimer = null;
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.unsubscribeSyncActivity?.();
    this.unsubscribeSyncActivity = null;
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
