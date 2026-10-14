export type AchievementFamily = 'first' | 'tokens' | 'sessions' | 'active-days' | 'streak' | 'monthly-full' | 'monthly-active' | 'cost' | 'duration' | 'agent-loyalty' | 'multi-agent' | 'project' | 'records' | 'annual';
export type AchievementCategory = 'milestones' | 'consistency' | 'exploration' | 'memories';
export interface AchievementDay { date: string; tokens: number; costUsd: number; sources: Record<string, number> }
export interface AchievementSession { source: string; id: string; firstAt: string; lastAt: string; durationSeconds: number }
export interface AchievementProject { id: string; label: string; dates: string[]; kind?: 'repository' | 'manifest' | 'unconfirmed'; aliases?: string[] }
export interface AchievementProjectSetting { id: string; name?: string; confirmed?: boolean; ignored?: boolean; mergeInto?: string }
export interface AchievementProjectRecord { id: string; label: string; kind: 'repository' | 'manifest' | 'unconfirmed'; activeDays: number; confirmed: boolean; ignored: boolean; mergeInto?: string }
export interface AchievementFacts {
  observedAt: string; today: string; timeZone: string; coverageFromDate: string | null;
  days: AchievementDay[]; sessions: AchievementSession[]; projects: AchievementProject[]; missingSessionSources: string[];
}
export interface AchievementProgress {
  id: string; family: AchievementFamily; category: AchievementCategory; groupId: string;
  title: string; description: string; target: number; value: number; unit: string; tier: number;
  eligible: boolean; achievedOn: string | null; scope?: string; scopeLabel?: string; period?: string;
  privateScope?: boolean;
}
export interface EarnedAchievement extends AchievementProgress {
  ruleVersion: 1; unlockedAt: string; seenAt: string | null; notifiedAt: string | null;
  historical: boolean; snapshot: { value: number; coverageFromDate: string | null; timeZone: string };
}
export interface AchievementRecord { id: 'longest-streak' | 'most-active-month'; title: string; value: number; unit: string; achievedOn: string | null; period?: string }
export interface AnnualFootprint { year: number; activeDays: number; activeMonths: number; tokens: number; costUsd: number; topSource: string | null; fromDate: string | null; toDate: string | null; complete: boolean }
export interface AchievementSummary { activeDays: number; currentStreak: number; longestStreak: number; totalTokens: number; totalCostUsd: number; sessionCount: number; durationSeconds: number }
export interface AchievementEvaluation { progress: AchievementProgress[]; records: AchievementRecord[]; annual: AnnualFootprint[]; summary: AchievementSummary }
export interface AchievementPreferences { showcaseIds: string[]; celebrationsEnabled: boolean }
export interface AchievementSnapshot extends AchievementEvaluation {
  earned: EarnedAchievement[]; preferences: AchievementPreferences; unreadIds: string[];
  projects?: AchievementProjectRecord[]; projectSettings?: AchievementProjectSetting[];
  coverage: { fromDate: string | null; asOfDate: string; timeZone: string; missingSessionSources: string[]; projectSources: string[] };
}
export interface AchievementNotice { ids: string[]; historical: boolean }
export type AchievementOperation = { operation: 'claim-notice' } | { operation: 'seen'; ids: string[] } | { operation: 'preferences'; showcaseIds?: string[]; celebrationsEnabled?: boolean }
  | { operation: 'project'; id: string; name?: string | null; confirmed?: boolean; ignored?: boolean; mergeInto?: string | null };
