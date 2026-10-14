import { Link } from '@tanstack/react-router';
import { Tooltip } from '@heroui/react';
import { Award, ArrowUpRight } from 'lucide-react';
import { useAchievements } from './AchievementProvider';

export function AchievementEntry() {
  const { snapshot } = useAchievements();
  const unread = (snapshot?.unreadIds.length ?? 0) > 0;
  return <Tooltip closeDelay={80} delay={100}>
    <Link to="/achievements" aria-label={unread ? '成就，有新成就' : '成就'} className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-default focus-visible:outline-2 focus-visible:outline-accent">
      <Award size={17} aria-hidden="true" />
      {unread && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 rounded-full bg-accent ring-2 ring-background" />}
    </Link>
    <Tooltip.Content placement="bottom"><p>{unread ? '成就 · 有新收藏' : '成就'}</p></Tooltip.Content>
  </Tooltip>;
}
export function AchievementActivityLink() {
  const { snapshot } = useAchievements();
  if (!snapshot || snapshot.summary.activeDays === 0) return null;
  return <Link to="/achievements" className="mt-3 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent">
    <Award size={13} aria-hidden="true" />累计活跃 {snapshot.summary.activeDays} 天 · 查看成就<ArrowUpRight size={12} aria-hidden="true" />
  </Link>;
}
