import type { AchievementFacts, AchievementProject, AchievementProjectRecord, AchievementProjectSetting, AchievementProgress, EarnedAchievement } from './types.js';

const earlier = (a: string | null, b: string | null) => a && b ? a < b ? a : b : a ?? b;

/** Keep stored awards intact; all grouping is a reversible projection of their original identities. */
export function resolveAchievementProjects(facts: AchievementFacts, settings: AchievementProjectSetting[] = [], aliases: Record<string, string> = {}, historical: EarnedAchievement[] = []) {
  const canonical = (id: string) => {
    const visited = new Set<string>();
    while (aliases[id]) {
      if (visited.has(id)) throw new Error('项目归属不能形成循环');
      visited.add(id); id = aliases[id]!;
    }
    return id;
  };
  const base = new Map<string, AchievementProject>();
  for (const project of facts.projects) {
    const id = canonical(project.id), previous = base.get(id);
    if (previous) {
      previous.dates = [...new Set([...previous.dates, ...project.dates])].sort();
      if (project.id === id) { previous.label = project.label; previous.kind = project.kind; }
    }
    else base.set(id, { ...project, id, dates: [...new Set(project.dates)].sort() });
  }
  for (const badge of historical) if (badge.family === 'project' && badge.scope) {
    const id = canonical(badge.scope);
    if (!base.has(id)) base.set(id, { id, label: badge.scopeLabel ?? '历史项目', kind: 'unconfirmed', dates: [] });
  }
  const preferences = new Map<string, AchievementProjectSetting>();
  // A previously separate directory can become an alias of its manual merge target.
  // Canonical settings take precedence and identity-induced self-edges disappear.
  const orderedSettings = [...settings].sort((a, b) => Number(a.id === canonical(a.id)) - Number(b.id === canonical(b.id)));
  for (const setting of orderedSettings) {
    const id = canonical(setting.id), normalized = { ...setting, id };
    if (setting.mergeInto) {
      const target = canonical(setting.mergeInto);
      if (target === id && (setting.id !== id || setting.mergeInto !== target)) delete normalized.mergeInto;
      else normalized.mergeInto = target;
    }
    preferences.set(id, normalized);
  }
  const owner = (input: string) => {
    let id = canonical(input);
    const visited = new Set<string>();
    while (preferences.get(id)?.mergeInto) {
      if (visited.has(id)) throw new Error('项目合并不能形成循环');
      visited.add(id); id = canonical(preferences.get(id)!.mergeInto!);
      if (!base.has(id)) throw new Error('目标项目不存在，请刷新后重试');
    }
    return id;
  };
  // Validate all edges, including a cycle among ignored projects.
  for (const id of base.keys()) owner(id);
  const names = new Map([...base].map(([id, project]) => [id, preferences.get(id)?.name ?? project.label]));
  const counts = new Map<string, number>();
  for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  const label = (id: string) => {
    const name = names.get(id) ?? '历史项目';
    return (counts.get(name) ?? 0) > 1 ? name + ' · ' + id.slice(0, 6) : name;
  };
  const confirmed = (id: string) => preferences.get(id)?.confirmed ?? (base.get(id)?.kind !== undefined && base.get(id)?.kind !== 'unconfirmed');
  const grouped = new Map<string, AchievementProject>();
  for (const [id, project] of base) {
    const target = owner(id);
    if (preferences.get(id)?.ignored || preferences.get(target)?.ignored || !confirmed(target)) continue;
    const result = grouped.get(target) ?? { id: target, label: label(target), kind: base.get(target)?.kind, dates: [] };
    result.dates = [...new Set([...result.dates, ...project.dates])].sort();
    grouped.set(target, result);
  }
  const projects: AchievementProjectRecord[] = [...base].map(([id, project]) => ({
    id, label: label(id), kind: project.kind ?? 'unconfirmed', activeDays: (grouped.get(id)?.dates ?? project.dates).length,
    confirmed: confirmed(id), ignored: preferences.get(id)?.ignored ?? false,
    ...(owner(id) !== id ? { mergeInto: owner(id) } : {}),
  })).sort((a, b) => Number(b.confirmed && !b.ignored) - Number(a.confirmed && !a.ignored) || b.activeDays - a.activeDays || a.id.localeCompare(b.id));
  const badgeId = (id: string): string => {
    const match = /^project-([a-f0-9]{64})-(\d+)$/.exec(id);
    return match ? 'project-' + owner(match[1]!) + '-' + match[2] : id;
  };
  const badge = <T extends AchievementProgress>(item: T): T => item.family === 'project' && item.scope ? {
    ...item, id: badgeId(item.id), scope: owner(item.scope), groupId: 'project-' + owner(item.scope), scopeLabel: label(owner(item.scope)),
  } : item;
  const dateFor = (project: AchievementProject | undefined, target: number): string | null => project?.dates.filter(date => date <= facts.today)[target - 1] ?? null;
  const originalDate = (item: AchievementProgress): string | null => item.family === 'project' && item.scope ? dateFor(base.get(canonical(item.scope)), item.target) : null;
  const earned = (items: EarnedAchievement[]): EarnedAchievement[] => {
    const result = new Map<string, EarnedAchievement>();
    for (const original of items) {
      const item = badge(original), previous = result.get(item.id);
      if (!previous) result.set(item.id, { ...item, snapshot: { ...item.snapshot } });
      else result.set(item.id, {
        ...previous, value: Math.max(previous.value, item.value), achievedOn: earlier(previous.achievedOn, item.achievedOn),
        unlockedAt: earlier(previous.unlockedAt, item.unlockedAt)!, seenAt: earlier(previous.seenAt, item.seenAt), notifiedAt: earlier(previous.notifiedAt, item.notifiedAt),
        snapshot: { ...previous.snapshot, value: Math.max(previous.snapshot.value, item.snapshot.value) },
      });
    }
    // A combined calendar can reach a target earlier. Apply that date only to the
    // visible award, so undoing a manual merge restores each original snapshot.
    for (const item of result.values()) if (item.family === 'project' && item.scope) {
      item.achievedOn = earlier(item.achievedOn, dateFor(grouped.get(item.scope), item.target));
    }
    return [...result.values()];
  };
  return { facts: { ...facts, projects: [...grouped.values()] }, projects, settings: [...preferences.values()], badge, badgeId, earned, canonical, originalDate };
}
export type AchievementProjectResolution = ReturnType<typeof resolveAchievementProjects>;
