import type { ComponentPropsWithRef } from 'react';
import { Link } from '@tanstack/react-router';
import { Tooltip } from '@heroui/react';
import { Award, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { useAchievements } from './AchievementProvider';
import { CHROME_ICON_BUTTON_CLASS_NAME } from '../components/chrome-action-styles';

export function AchievementEntry() {
  const { t } = useTranslation();
  const { snapshot } = useAchievements();
  const unread = (snapshot?.unreadIds.length ?? 0) > 0;
  return <Tooltip closeDelay={80} delay={100}>
    <Tooltip.Trigger
      aria-label={t(unread ? 'achievement.entry.unreadAria' : 'achievement.page.title')}
      className={CHROME_ICON_BUTTON_CLASS_NAME}
      render={props => <Link {...(props as ComponentPropsWithRef<'a'>)} role="link" to="/achievements" />}
    >
      <Award className="size-4" aria-hidden="true" />
      {unread && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 rounded-full bg-accent ring-2 ring-background" />}
    </Tooltip.Trigger>
    <Tooltip.Content placement="bottom"><p>{t(unread ? 'achievement.entry.unreadTooltip' : 'achievement.page.title')}</p></Tooltip.Content>
  </Tooltip>;
}
export function AchievementActivityLink() {
  const { t } = useTranslation();
  const { snapshot } = useAchievements();
  if (!snapshot || snapshot.summary.activeDays === 0) return null;
  return <Link to="/achievements" className="mt-3 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent">
    <Award size={13} aria-hidden="true" />{t('achievement.entry.activityLink', { count: snapshot.summary.activeDays })}<ArrowUpRight size={12} aria-hidden="true" />
  </Link>;
}
