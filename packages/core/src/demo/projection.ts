import { createHmac, randomBytes } from 'node:crypto';
import type { DemoSnapshot } from './types.js';
import { projectDemoSnapshot } from './schema.js';

/** A new secret per export prevents correlating identifiers across public snapshots. */
export function anonymizeDemoSnapshot(input: DemoSnapshot): DemoSnapshot {
  const result = projectDemoSnapshot(input), secret = randomBytes(32);
  const opaque = (kind: string, value: string) => createHmac('sha256', secret).update(JSON.stringify([kind, value])).digest('hex');
  const names = new Map<string, string>();
  const label = (value: string) => {
    if (value === 'unknown' || !value) return 'unknown';
    if (!names.has(value)) names.set(value, `Project ${names.size + 1}`);
    return names.get(value)!;
  };
  const session = (source: string, id: string) => opaque('session', JSON.stringify([source, id]));
  const event = (id: string) => opaque('event', id);
  const turn = (id: string) => {
    const value = opaque('turn', id);
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
      ? `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}` : `legacy-${value}`;
  };
  const request = (fact: { id: string }) => { fact.id = event(fact.id); };
  for (const row of result.buckets) { row.project = label(row.project); row.pricing_requests?.forEach(request); }
  const sessionNames = new Map<string, string>();
  const rememberSession = (source: string, id: string) => {
    const key = JSON.stringify([source, id]);
    if (!sessionNames.has(key)) sessionNames.set(key, `Demo session ${sessionNames.size + 1}`);
    return session(source, id);
  };
  for (const row of result.history.messages) {
    row.sessionId = rememberSession(row.source, row.sessionId); row.id = event(row.id);
    if (row.projectId) row.projectId = opaque('project', row.projectId);
    if (row.projectLegacyId) row.projectLegacyId = opaque('project', row.projectLegacyId);
    if (row.projectLabel) row.projectLabel = label(row.projectLabel);
    if (row.replayKey) row.replayKey = opaque('replay', row.replayKey);
  }
  for (const row of result.history.timingEvents) {
    row.sessionId = rememberSession(row.source, row.sessionId); row.id = event(row.id);
    if (row.turnId) row.turnId = turn(row.turnId);
  }
  for (const row of result.history.evidence ?? []) {
    row.sessionId = rememberSession(row.source, row.sessionId); row.id = event(row.id);
    if (row.parentId) row.parentId = session(row.source, row.parentId);
    if (row.projectId) row.projectId = opaque('project', row.projectId);
    if (row.turnId) row.turnId = turn(row.turnId);
    if (row.agentRole) row.agentRole = 'agent';
    if (row.agentNickname) row.agentNickname = 'Demo agent';
  }
  for (const row of result.history.observations) {
    row.sessionId = rememberSession(row.source, row.sessionId); row.id = event(row.id);
    if (row.parentId) row.parentId = session(row.source, row.parentId);
    if (row.replayKey) row.replayKey = opaque('replay', row.replayKey);
    if (row.projectLabel) row.projectLabel = label(row.projectLabel);
    if (row.profileId) row.profileId = opaque('profile', row.profileId);
    if (row.pricingFact) request(row.pricingFact);
    if (row.billing.accountRef) row.billing.accountRef = opaque('account', row.billing.accountRef);
    if (row.billing.accountLabel) row.billing.accountLabel = 'Demo account';
  }
  result.history.titles = [...sessionNames].map(([key, title]) => {
    const [source, id] = JSON.parse(key) as [string, string];
    return [JSON.stringify([source, session(source, id)]), { title, priority: 2 }];
  });
  result.history.codexParents = result.history.codexParents.map(([id, parent]) => [session('codex', id), session('codex', parent)]);
  const badgeId = (id: string) => id.replace(/[a-f0-9]{64}/g, value => opaque('project', value));
  for (const item of [...result.achievements.progress, ...result.achievements.earned]) {
    item.id = badgeId(item.id); item.groupId = badgeId(item.groupId);
    // Display copy is rendered from the localized achievement catalog. Stored copy may be user supplied.
    item.title = item.family; item.description = item.family;
    if (item.scope) item.scope = item.family === 'project' ? opaque('project', item.scope) : item.scope;
    if (item.scopeLabel) item.scopeLabel = item.family === 'project' ? label(item.scopeLabel) : item.scopeLabel;
  }
  result.achievements.preferences.showcaseIds = result.achievements.preferences.showcaseIds.map(badgeId);
  result.achievements.unreadIds = result.achievements.unreadIds.map(badgeId);
  for (const item of result.achievements.records) item.title = item.id;
  for (const item of result.achievements.projects ?? []) { item.id = opaque('project', item.id); item.label = label(item.label); if (item.mergeInto) item.mergeInto = opaque('project', item.mergeInto); }
  for (const item of result.achievements.projectSettings ?? []) { item.id = opaque('project', item.id); if (item.name) item.name = label(item.name); if (item.mergeInto) item.mergeInto = opaque('project', item.mergeInto); }
  // Preserve rates and effective dates, while replacing potentially private citation URLs.
  for (const pricing of [result.pricing.builtin, result.pricing.overlay]) {
    if (!pricing) continue;
    for (const rule of pricing.request_rules ?? []) rule.reference = 'https://example.invalid/demo-pricing-snapshot';
    for (const table of [pricing.model_metadata, pricing.subscription_models]) for (const meta of Object.values(table ?? {})) { delete meta.release_date_source; delete meta.context_window_source; }
  }
  return result;
}
