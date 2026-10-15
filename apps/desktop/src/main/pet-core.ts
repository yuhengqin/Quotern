/** Pure desktop pet state and geometry; kept independent of Electron for tests. */
export type PetSize = 'small' | 'medium' | 'large';
export type PetCharacter = string;
export type PetBotColor = 'auto' | 'bleu' | 'turquoise' | 'vert' | 'ambre' | 'rose' | 'violet';

export interface PetSettings {
  visible: boolean;
  character: PetCharacter;
  size: PetSize;
  botColor: PetBotColor;
  position: { x: number; y: number } | null;
  docked: boolean;
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  visible: false,
  character: 'clawd',
  size: 'medium',
  botColor: 'auto',
  position: null,
  docked: false,
};

export const BUILTIN_PETS = [
  { id: 'clawd', displayName: 'Clawd', spriteVersionNumber: 1, custom: false },
  { id: 'bot', displayName: 'Bot', spriteVersionNumber: 1, custom: false },
  { id: 'sprout', displayName: 'Sprout', spriteVersionNumber: 1, custom: false },
  { id: 'byte', displayName: 'Byte', spriteVersionNumber: 1, custom: false },
  { id: 'ember', displayName: 'Ember', spriteVersionNumber: 1, custom: false },
] as const;

export interface PetCatalogEntry {
  id: string;
  displayName: string;
  description?: string;
  spriteVersionNumber: number;
  custom: boolean;
  assetUrl?: string;
}

const COLORS = new Set<PetBotColor>(['auto', 'bleu', 'turquoise', 'vert', 'ambre', 'rose', 'violet']);
export const PET_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function normalizePetSettings(raw: unknown): PetSettings {
  const v = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const p = v.position && typeof v.position === 'object' ? v.position as Record<string, unknown> : null;
  return {
    visible: v.visible === true,
    character: typeof v.character === 'string' && PET_ID_RE.test(v.character) ? v.character : 'clawd',
    size: v.size === 'small' || v.size === 'large' ? v.size : 'medium',
    botColor: typeof v.botColor === 'string' && COLORS.has(v.botColor as PetBotColor) ? v.botColor as PetBotColor : 'auto',
    docked: v.docked === true,
    position: p && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: Math.round(p.x as number), y: Math.round(p.y as number) }
      : null,
  };
}

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export const PET_BUBBLE_BAND = 138;
export const PET_WINDOW_WIDTH = 400;
export const PET_EDGE_PEEK = 30;
const EDGE_DOCK_THRESHOLD = 24;

export function petWindowSize(size: PetSize, bubbleBand = PET_BUBBLE_BAND): { width: number; height: number } {
  const baseHeight = size === 'small' ? 230 : size === 'large' ? 286 : 254;
  return { width: PET_WINDOW_WIDTH, height: baseHeight + Math.max(0, bubbleBand - PET_BUBBLE_BAND) };
}

export function petSpriteRect(size: { width: number; height: number }, bubbleBand = PET_BUBBLE_BAND): Rect {
  const side = Math.max(40, Math.min(size.width, size.height - bubbleBand) - 8);
  return { x: (size.width - side) / 2, y: bubbleBand + (size.height - bubbleBand - side) / 2, width: side, height: side };
}

export function clampPetBounds(point: Point, size: { width: number; height: number }, work: Rect): Point {
  return {
    x: Math.round(Math.max(work.x, Math.min(point.x, work.x + Math.max(0, work.width - size.width)))),
    y: Math.round(Math.max(work.y, Math.min(point.y, work.y + Math.max(0, work.height - size.height)))),
  };
}

export function petDockTarget(
  point: Point,
  size: { width: number; height: number },
  work: Rect,
  hovering: boolean,
  alreadyDocked = false,
  bubbleBand = PET_BUBBLE_BAND,
): Point & { docked: boolean } {
  const nearEdge = point.x + size.width >= work.x + work.width - EDGE_DOCK_THRESHOLD;
  if (!nearEdge && !alreadyDocked) return { ...point, docked: false };
  const sprite = petSpriteRect(size, bubbleBand);
  return {
    x: Math.round(work.x + work.width - sprite.x - (hovering ? sprite.width : PET_EDGE_PEEK)),
    y: point.y,
    docked: true,
  };
}

interface Summary { todayTokens?: number; todayCostUsd?: number; totalTokens?: number; totalCostUsd?: number }
interface DailyRow { date: string; tokens: number }
interface BreakdownRow { model: string; source: string; tokens: number; pct: number }

export interface PetStats {
  todayTokens: number;
  todayCostUsd: number;
  conversations: number;
  last7dTokens: number;
  last7dActiveDays: number;
  last30dTokens: number;
  last30dAvgPerDay: number;
  streakDays: number;
  activeDaysAllTime: number;
  topModels: { name: string; tokens: number; percent: number; source: string }[];
}

export function toPetStats(
  summary: Summary,
  daily: { days?: DailyRow[] },
  breakdown: { models?: BreakdownRow[] },
  todayDate: string,
  sessions?: { sessionCount?: number; complete?: boolean },
): PetStats {
  const rows = [...(daily.days ?? [])].filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.tokens)).sort((a, b) => a.date.localeCompare(b.date));
  const cutoff = (count: number): string => {
    const date = new Date(`${todayDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (count - 1));
    return date.toISOString().slice(0, 10);
  };
  const latest30 = rows.filter(row => row.date >= cutoff(30) && row.date <= todayDate);
  const latest7 = latest30.filter(row => row.date >= cutoff(7));
  const todayRow = rows.find(row => row.date === todayDate);
  let streakDays = 0;
  const daysByDate = new Map(rows.map(row => [row.date, row]));
  const cursor = new Date(`${todayDate}T12:00:00Z`);
  if ((todayRow?.tokens ?? 0) <= 0) cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (let i = 0; i < 365; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if ((daysByDate.get(key)?.tokens ?? 0) <= 0) break;
    streakDays++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const last30dTokens = latest30.reduce((sum, row) => sum + row.tokens, 0);
  return {
    todayTokens: Math.max(0, summary.todayTokens ?? 0),
    todayCostUsd: Math.max(0, summary.todayCostUsd ?? 0),
    conversations: sessions?.complete === true ? Math.max(0, sessions.sessionCount ?? 0) : 0,
    last7dTokens: latest7.reduce((sum, row) => sum + row.tokens, 0),
    last7dActiveDays: latest7.filter(row => row.tokens > 0).length,
    last30dTokens,
    last30dAvgPerDay: Math.round(last30dTokens / 30),
    streakDays,
    activeDaysAllTime: rows.filter(row => row.tokens > 0).length,
    topModels: (breakdown.models ?? []).filter(row => row.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 10)
      .map(row => ({ name: row.model, tokens: row.tokens, percent: Math.round(row.pct * 10) / 10, source: row.source })),
  };
}
