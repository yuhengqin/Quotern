import { useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Link } from '@tanstack/react-router';
import { Check, Plus, Share2 } from 'lucide-react';
import { normalizeLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { useAchievements } from './AchievementProvider';
import { BadgeArtwork } from './BadgeArtwork';
import { achievementPeriodState, achievementProgressText, formatAchievementAmount, formatAchievementDate, achievementUnit, achievementDisplayName, achievementDescription } from './view-model';
import { AchievementShareModal } from './AchievementShareModal';
import { AchievementSeriesModal } from './AchievementSeriesModal';

export function AchievementOverlays() {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const { snapshot, detailIds, closeDetails, shareSelection, closeShare, share, familyDetail, openFamily, closeFamily, busy: updating, updatePreferences, readOnly } = useAchievements();
  const busy = updating || readOnly;
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => setActiveIndex(0), [detailIds]);
  const items = detailIds.map(id => snapshot?.progress.find(item => item.id === id)).filter(item => item !== undefined);
  const item = items[Math.min(activeIndex, Math.max(0, items.length - 1))];
  const owned = item ? snapshot?.earned.find(earned => earned.id === item.id) : undefined;
  const pinned = Boolean(owned && snapshot?.preferences.showcaseIds.includes(owned.id));
  const periodState = item && snapshot ? achievementPeriodState(item, snapshot.coverage.asOfDate) : 'current';
  return <>
    {familyDetail && <AchievementSeriesModal key={familyDetail}/>}
    <Modal.Backdrop isOpen={Boolean(item)} onOpenChange={open => { if (!open) closeDetails(); }}>
      <Modal.Container size="md" scroll="inside">
        <Modal.Dialog aria-label={t(owned ? 'achievement.detail.ownedAria' : 'achievement.detail.goalAria')} className="max-h-[90dvh] overflow-hidden">
          <Modal.CloseTrigger aria-label={t('achievement.detail.close')} />
          <Modal.Body className="px-5 pb-2 pt-8 text-center">
            {item && <>
              <p className="text-[10px] uppercase tracking-[.25em] text-muted">{t(owned ? 'achievement.detail.ownedEyebrow' : periodState === 'current' ? 'achievement.detail.goalEyebrow' : `achievement.detail.${periodState}`)}</p>
              <BadgeArtwork family={item.family} tier={item.tier} locked={!owned} size={168} className="mx-auto my-2" />
              <h2 className="break-words text-2xl font-semibold tracking-tight">{achievementDisplayName(item, true, locale)}</h2>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-accent">{owned ? <><Check size={15} />{t('achievement.detail.earnedOn', { date: formatAchievementDate(owned.achievedOn ?? owned.unlockedAt.slice(0, 10), locale) })}</> : achievementProgressText(item, locale)}</p>
              <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted">{achievementDescription(item, locale)}</p>
              {!owned && periodState !== 'current' && <p className="mx-auto mt-3 max-w-sm text-xs leading-5 text-muted">{t(`achievement.detail.${periodState}Note`)}</p>}
              {owned && <p className="mt-3 text-xs text-muted">{t('achievement.detail.earnedSnapshot', { amount: formatAchievementAmount(owned.snapshot.value, owned.family, locale), unit: achievementUnit(owned, locale) })}</p>}
              {items.length > 1 && <div className="mt-5 flex flex-wrap justify-center gap-2" aria-label={t('achievement.detail.batchAria')}>
                {items.map((badge, index) => <button type="button" key={badge.id} aria-label={t('achievement.page.viewBadge', { name: achievementDisplayName(badge, true, locale) })} aria-pressed={activeIndex === index} onClick={() => setActiveIndex(index)} className={'rounded-xl border p-1 transition-colors ' + (activeIndex === index ? 'border-accent bg-accent/10' : 'border-border')}>
                  <BadgeArtwork family={badge.family} tier={badge.tier} size={52} />
                </button>)}
              </div>}
            </>}
          </Modal.Body>
          <Modal.Footer className="flex-wrap justify-center gap-2 px-5 pb-5">
            {owned && <Button variant="primary" onPress={() => share({ kind: 'single', id: owned.id })}><Share2 size={15} />{t('achievement.detail.share')}</Button>}
            {owned && <Button variant="secondary" aria-pressed={pinned} isDisabled={busy || !pinned && (snapshot?.preferences.showcaseIds.length ?? 0) >= 3} onPress={() => { if (!snapshot) return; const ids = snapshot.preferences.showcaseIds; void updatePreferences({ showcaseIds: pinned ? ids.filter(id => id !== owned.id) : [...ids, owned.id] }).catch(() => undefined); }}>{pinned ? <Check size={15}/> : <Plus size={15}/>} {t(pinned ? 'achievement.detail.remove' : 'achievement.detail.add')}</Button>}
            <Button variant="secondary" onPress={closeDetails}>{t(familyDetail ? 'achievement.detail.back' : owned ? 'achievement.detail.accept' : 'achievement.detail.ok')}</Button>
            {item && !familyDetail && <Button variant="tertiary" className="w-full" onPress={() => openFamily(item.family)}>{t('achievement.detail.viewSeries')}</Button>}
            <Link to="/achievements" onClick={() => { closeDetails(); closeFamily(); }} className="w-full py-1 text-center text-xs text-muted hover:text-accent">{t('achievement.detail.viewCollection')}</Link>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
    {snapshot && shareSelection && <AchievementShareModal snapshot={snapshot} selection={shareSelection} onClose={closeShare} />}
  </>;
}
