import type { AchievementFamily, AchievementCategory } from './types.js';

export const ACHIEVEMENT_FAMILIES: ReadonlyArray<{ id: AchievementFamily; label: string; category: AchievementCategory; color: string }> = [
  { id: 'first', label: '初次记录', category: 'milestones', color: '#a78bfa' },
  { id: 'tokens', label: 'Token 里程碑', category: 'milestones', color: '#8b5cf6' },
  { id: 'sessions', label: '会话里程碑', category: 'milestones', color: '#38bdf8' },
  { id: 'active-days', label: '累计活跃', category: 'consistency', color: '#34d399' },
  { id: 'streak', label: '连续记录', category: 'consistency', color: '#fb923c' },
  { id: 'monthly-full', label: '月度全勤', category: 'memories', color: '#fbbf24' },
  { id: 'monthly-active', label: '月度活跃', category: 'memories', color: '#f472b6' },
  { id: 'cost', label: '算力足迹', category: 'milestones', color: '#facc15' },
  { id: 'duration', label: '会话时光', category: 'milestones', color: '#22d3ee' },
  { id: 'agent-loyalty', label: '一路同行', category: 'exploration', color: '#818cf8' },
  { id: 'multi-agent', label: '多面手', category: 'exploration', color: '#e879f9' },
  { id: 'project', label: '项目长跑', category: 'exploration', color: '#2dd4bf' },
  { id: 'records', label: '个人纪录', category: 'memories', color: '#fda4af' },
  { id: 'annual', label: '年度足迹', category: 'memories', color: '#c4b5fd' },
];
export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  milestones: '使用里程碑', consistency: '持续记录', exploration: '探索足迹', memories: '纪念收藏',
};
