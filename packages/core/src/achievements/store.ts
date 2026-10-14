import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { evaluateAchievements } from './evaluate.js';
import { ACHIEVEMENT_FAMILIES } from './catalog.js';
import { resolveAchievementProjects, type AchievementProjectResolution } from './projects.js';
import type { AchievementFacts, AchievementSnapshot, AchievementOperation, AchievementNotice, EarnedAchievement, AchievementPreferences, AchievementRecord, AnnualFootprint, AchievementEvaluation, AchievementProjectSetting, AchievementProject } from './types.js';

interface StoredAchievements {
  version: 1; initializedAt: string | null; earned: EarnedAchievement[];
  preferences: AchievementPreferences; records: AchievementRecord[]; annual: AnnualFootprint[];
  projectSettings?: AchievementProjectSetting[]; projectAliases?: Record<string, string>; projectCatalog?: Array<Omit<AchievementProject, 'dates' | 'aliases'>>;
}
const initial = (): StoredAchievements => ({ version: 1, initializedAt: null, earned: [], preferences: { showcaseIds: [], celebrationsEnabled: true }, records: [], annual: [] });
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,219}$/.test(id);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const timestamp = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value));
const date = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z'));
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000;
const projectId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const projectName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
const validProjectSetting = (value: AchievementProjectSetting) => value && projectId(value.id) && (value.name === undefined || projectName(value.name)) && (value.confirmed === undefined || typeof value.confirmed === 'boolean') && (value.ignored === undefined || typeof value.ignored === 'boolean') && (value.mergeInto === undefined || projectId(value.mergeInto));
const familyIds = new Set(ACHIEVEMENT_FAMILIES.map(item => item.id));
const validEarned = (item: EarnedAchievement) => item && validId(item.id) && familyIds.has(item.family) && text(item.title) && text(item.description) && text(item.groupId) && text(item.unit) && number(item.value) && number(item.target) && item.target > 0 && number(item.tier)
  && item.ruleVersion === 1 && timestamp(item.unlockedAt) && (item.seenAt === null || timestamp(item.seenAt)) && (item.notifiedAt === null || timestamp(item.notifiedAt))
  && (item.achievedOn === null || date(item.achievedOn)) && item.snapshot && number(item.snapshot.value) && text(item.snapshot.timeZone) && typeof item.historical === 'boolean';
const validRecord = (item: AchievementRecord) => item && ['longest-streak', 'most-active-month'].includes(item.id) && text(item.title) && number(item.value) && (item.achievedOn === null || date(item.achievedOn));
const validAnnual = (item: AnnualFootprint) => item && Number.isInteger(item.year) && item.year >= 1 && item.year <= 9999 && number(item.activeDays) && item.activeDays <= 366 && number(item.activeMonths) && item.activeMonths <= 12 && number(item.tokens) && number(item.costUsd) && typeof item.complete === 'boolean' && (item.topSource === null || text(item.topSource)) && (item.fromDate === null || date(item.fromDate)) && (item.toDate === null || date(item.toDate));

export class AchievementError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function validateAchievementOperation(value: unknown): asserts value is AchievementOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AchievementError('成就请求格式无效');
  const input = value as Record<string, unknown>;
  const allowed = input.operation === 'claim-notice' ? ['operation'] : input.operation === 'seen' ? ['operation', 'ids'] : input.operation === 'preferences' ? ['operation', 'showcaseIds', 'celebrationsEnabled'] : input.operation === 'project' ? ['operation', 'id', 'name', 'confirmed', 'ignored', 'mergeInto'] : [];
  if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key))) throw new AchievementError('不支持的成就操作');
  if (input.operation === 'seen' && (!Array.isArray(input.ids) || input.ids.length > 2048 || !input.ids.every(validId))) throw new AchievementError('已读成就列表无效');
  if (input.showcaseIds !== undefined && (!Array.isArray(input.showcaseIds) || input.showcaseIds.length > 3 || !input.showcaseIds.every(validId) || new Set(input.showcaseIds).size !== input.showcaseIds.length)) throw new AchievementError('展示架最多选择三枚不同的已获得徽章');
  if (input.celebrationsEnabled !== undefined && typeof input.celebrationsEnabled !== 'boolean') throw new AchievementError('成就提示设置无效');
  if (input.operation === 'project' && (!projectId(input.id) || input.name !== undefined && input.name !== null && !projectName(input.name)
    || input.confirmed !== undefined && typeof input.confirmed !== 'boolean' || input.ignored !== undefined && typeof input.ignored !== 'boolean'
    || input.mergeInto !== undefined && input.mergeInto !== null && !projectId(input.mergeInto))) throw new AchievementError('项目设置无效，名称限 1–80 个字符');
}

/** Every read/modify/write is serialized across CLI and Desktop processes. */
export class AchievementStore {
  private readonly directory: string;
  private readonly path: string;
  constructor(dataDir: string, private readonly loadFacts: () => Promise<AchievementFacts>) {
    this.directory = join(dataDir, 'achievements'); this.path = join(this.directory, 'state.json');
  }
  private async readStored(): Promise<StoredAchievements> {
    try {
      if ((await stat(this.path)).size > 8 * 1024 * 1024) throw new Error('oversized');
      const state: StoredAchievements = JSON.parse(await readFile(this.path, 'utf8'));
      if (state?.version !== 1 || (state.initializedAt !== null && !timestamp(state.initializedAt)) || !Array.isArray(state.earned) || !state.earned.every(validEarned) || new Set(state.earned.map(item => item.id)).size !== state.earned.length
        || !state.preferences || typeof state.preferences.celebrationsEnabled !== 'boolean' || !Array.isArray(state.preferences.showcaseIds) || state.preferences.showcaseIds.length > 3 || !state.preferences.showcaseIds.every(id => validId(id) && state.earned.some(item => item.id === id))
        || !Array.isArray(state.records) || !state.records.every(validRecord) || !Array.isArray(state.annual) || !state.annual.every(validAnnual)) throw new Error('invalid');
      if (state.projectSettings !== undefined && (!Array.isArray(state.projectSettings) || state.projectSettings.length > 4096 || !state.projectSettings.every(validProjectSetting))) throw new Error('invalid projects');
      if (state.projectAliases !== undefined && (!state.projectAliases || typeof state.projectAliases !== 'object' || Array.isArray(state.projectAliases) || Object.entries(state.projectAliases).some(([id, target]) => !projectId(id) || !projectId(target)))) throw new Error('invalid aliases');
      if (state.projectCatalog !== undefined && (!Array.isArray(state.projectCatalog) || state.projectCatalog.some(item => !projectId(item.id) || !text(item.label) || !['repository', 'manifest', 'unconfirmed'].includes(item.kind ?? 'unconfirmed')))) throw new Error('invalid project catalog');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initial();
      throw new AchievementError('无法读取成就收藏，原文件已保留，请重试', 500);
    }
  }
  private async save(state: StoredAchievements): Promise<void> {
    const temporary = this.path + '.' + process.pid + '.' + randomUUID() + '.tmp';
    const raw = JSON.stringify(state);
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new AchievementError('成就收藏超出存储限制，原文件已保留', 500);
    try {
      await writeFile(temporary, raw, { flag: 'wx', mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, this.path); break; }
        catch (error) {
          if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await new Promise(resolve => setTimeout(resolve, Math.min(50 * (attempt + 1), 250)));
        }
      }
    } catch { throw new AchievementError('成就保存失败，原文件已保留，请检查存储空间后重试', 500); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  private merge(state: StoredAchievements, facts: AchievementFacts, evaluation: AchievementEvaluation, projects: AchievementProjectResolution): void {
    const earned = new Map(state.earned.map(item => [item.id, item]));
    const historical = state.initializedAt === null;
    for (const previous of state.earned) if (previous.family === 'project') {
      const achievedOn = projects.originalDate(previous);
      if (achievedOn && (!previous.achievedOn || achievedOn < previous.achievedOn)) previous.achievedOn = achievedOn;
    }
    for (const item of evaluation.progress) {
      if (!item.eligible) continue;
      const previous = [...earned.values()].find(value => projects.badgeId(value.id) === item.id);
      if (previous) {
        if (item.family === 'records' && item.value > previous.value) {
          Object.assign(previous, item, { snapshot: { value: item.value, coverageFromDate: facts.coverageFromDate, timeZone: facts.timeZone } });
        } else if (item.family !== 'records' && item.family !== 'project' && item.achievedOn && (!previous.achievedOn || item.achievedOn < previous.achievedOn)) previous.achievedOn = item.achievedOn;
        continue;
      }
      earned.set(item.id, { ...item, ruleVersion: 1, unlockedAt: facts.observedAt, seenAt: null, notifiedAt: null, historical: historical || Boolean(state.initializedAt && item.achievedOn && item.achievedOn < state.initializedAt.slice(0, 10)), snapshot: { value: item.value, coverageFromDate: facts.coverageFromDate, timeZone: facts.timeZone } });
    }
    state.earned = [...earned.values()];
    if (!state.initializedAt && state.earned.length) state.initializedAt = facts.observedAt;
    for (const record of evaluation.records) {
      const previous = state.records.find(item => item.id === record.id);
      if (!previous) state.records.push({ ...record });
      else if (record.value > previous.value) Object.assign(previous, record);
    }
    for (const annual of evaluation.annual.filter(item => item.complete && item.activeDays > 0)) {
      const previous = state.annual.find(item => item.year === annual.year);
      if (!previous) state.annual.push({ ...annual });
      else if (annual.activeDays > previous.activeDays || annual.tokens > previous.tokens) Object.assign(previous, annual);
    }
  }
  private snapshot(state: StoredAchievements, facts: AchievementFacts, evaluation: AchievementEvaluation, projects: AchievementProjectResolution): AchievementSnapshot {
    const progress = new Map(evaluation.progress.map(item => [item.id, { ...item }]));
    for (const earned of projects.earned(state.earned)) {
      const current = progress.get(earned.id);
      progress.set(earned.id, { ...(current ?? earned), eligible: true, achievedOn: earned.achievedOn, value: Math.max(current?.value ?? 0, earned.snapshot.value), ...(earned.family === 'records' ? { target: earned.target } : {}) });
    }
    const annual = new Map(evaluation.annual.map(item => [item.year, item]));
    for (const previous of state.annual) {
      const current = annual.get(previous.year);
      if (!current || previous.activeDays > current.activeDays || previous.tokens > current.tokens) annual.set(previous.year, previous);
    }
    const earned = projects.earned(state.earned).sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt) || a.id.localeCompare(b.id));
    return {
      ...evaluation, progress: [...progress.values()], records: state.records, annual: [...annual.values()].sort((a, b) => b.year - a.year),
      earned, preferences: { ...state.preferences, showcaseIds: [...new Set(state.preferences.showcaseIds.map(projects.badgeId))] }, unreadIds: earned.filter(item => item.seenAt === null).map(item => item.id),
      projects: projects.projects, projectSettings: projects.settings,
      coverage: { fromDate: facts.coverageFromDate, asOfDate: facts.today, timeZone: facts.timeZone, missingSessionSources: facts.missingSessionSources, projectSources: ['claude', 'codex'] },
    };
  }
  private async transaction(operation?: AchievementOperation): Promise<{ snapshot: AchievementSnapshot; notice?: AchievementNotice }> {
    await mkdir(this.directory, { recursive: true });
    const release = await lock(this.path, { realpath: false, stale: 60000, update: 10000, retries: { retries: 100, factor: 1.2, minTimeout: 10, maxTimeout: 200 } });
    try {
      const state = await this.readStored(), before = JSON.stringify(state);
      const facts = await this.loadFacts();
      const catalog = new Map((state.projectCatalog ?? []).map(item => [item.id, item]));
      for (const project of facts.projects) {
        catalog.set(project.id, { id: project.id, label: project.label, kind: project.kind ?? 'unconfirmed' });
        for (const alias of project.aliases ?? []) if (alias !== project.id) (state.projectAliases ??= {})[alias] = project.id;
      }
      if (catalog.size) state.projectCatalog = [...catalog.values()];
      const fullFacts = { ...facts, projects: [...catalog.values()].map(item => ({ ...item, dates: [] as string[] })).filter(item => !facts.projects.some(current => current.id === item.id)).concat(facts.projects) };
      const resolveProjects = () => {
        try { return resolveAchievementProjects(fullFacts, state.projectSettings, state.projectAliases, state.earned); }
        catch (reason) { throw new AchievementError(reason instanceof Error ? reason.message : '项目归属无效'); }
      };
      let projects = resolveProjects();
      if (state.projectSettings !== undefined) state.projectSettings = projects.settings;
      if (operation?.operation === 'project') {
        const id = projects.canonical(operation.id);
        if (!projects.projects.some(item => item.id === id)) throw new AchievementError('项目不存在，请刷新后重试');
        const settings = state.projectSettings ??= [];
        let setting = settings.find(item => projects.canonical(item.id) === id);
        if (!setting) { if (settings.length >= 4096) throw new AchievementError('项目设置已达上限'); setting = { id }; settings.push(setting); }
        if (operation.name === null) delete setting.name;
        else if (operation.name !== undefined) setting.name = operation.name.trim();
        if (operation.confirmed !== undefined) setting.confirmed = operation.confirmed;
        if (operation.ignored !== undefined) setting.ignored = operation.ignored;
        if (operation.mergeInto === null) delete setting.mergeInto;
        else if (operation.mergeInto !== undefined) {
          const target = projects.canonical(operation.mergeInto);
          if (target === id) throw new AchievementError('项目合并不能形成循环');
          if (!projects.projects.some(item => item.id === target && item.confirmed && !item.ignored)) throw new AchievementError('请选择已确认且未忽略的目标项目');
          setting.mergeInto = target;
        }
        projects = resolveProjects();
      }
      const evaluation = evaluateAchievements(projects.facts);
      this.merge(state, facts, evaluation, projects);
      let notice: AchievementNotice | undefined;
      if (operation?.operation === 'seen') {
        if (operation.ids.some(id => !state.earned.some(item => projects.badgeId(item.id) === projects.badgeId(id)))) throw new AchievementError('成就不存在或尚未达成');
        const ids = operation.ids.map(projects.badgeId);
        for (const item of state.earned) if (ids.includes(projects.badgeId(item.id))) { item.seenAt ??= facts.observedAt; item.notifiedAt ??= facts.observedAt; }
      } else if (operation?.operation === 'preferences') {
        if (operation.showcaseIds !== undefined) {
          const ids = operation.showcaseIds.map(projects.badgeId);
          if (new Set(ids).size !== ids.length || ids.some(id => !state.earned.some(item => projects.badgeId(item.id) === id))) throw new AchievementError('展示架只能选择不同的已获得徽章');
          state.preferences.showcaseIds = ids.map(id => state.earned.find(item => projects.badgeId(item.id) === id)!.id);
        }
        if (operation.celebrationsEnabled !== undefined) state.preferences.celebrationsEnabled = operation.celebrationsEnabled;
      } else if (operation?.operation === 'claim-notice') {
        const pending = projects.earned(state.earned).filter(item => item.notifiedAt === null);
        notice = { ids: state.preferences.celebrationsEnabled ? pending.map(item => item.id) : [], historical: pending.length > 0 && pending.every(item => item.historical) };
        for (const item of state.earned) item.notifiedAt ??= facts.observedAt;
      }
      if (before !== JSON.stringify(state)) await this.save(state);
      return { snapshot: this.snapshot(state, facts, evaluation, projects), ...(notice ? { notice } : {}) };
    } finally { await release(); }
  }
  async read(): Promise<AchievementSnapshot> { return (await this.transaction()).snapshot; }
  async update(operation: AchievementOperation): Promise<{ snapshot: AchievementSnapshot; notice?: AchievementNotice }> {
    validateAchievementOperation(operation);
    return this.transaction(operation);
  }
}
