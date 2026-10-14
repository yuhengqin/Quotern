import { useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Link } from '@tanstack/react-router';
import { Check, Share2 } from 'lucide-react';
import { useAchievements } from './AchievementProvider';
import { BadgeArtwork } from './BadgeArtwork';
import { achievementProgressText, formatAchievementAmount, achievementUnit } from './view-model';
import { AchievementShareModal } from './AchievementShareModal';

export function AchievementOverlays() {
  const { snapshot, detailIds, closeDetails, shareSelection, closeShare, share } = useAchievements();
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => setActiveIndex(0), [detailIds]);
  const items = detailIds.map(id => snapshot?.progress.find(item => item.id === id)).filter(item => item !== undefined);
  const item = items[Math.min(activeIndex, Math.max(0, items.length - 1))];
  const owned = item ? snapshot?.earned.find(earned => earned.id === item.id) : undefined;
  return <>
    <Modal.Backdrop isOpen={Boolean(item)} onOpenChange={open => { if (!open) closeDetails(); }}>
      <Modal.Container size="md" scroll="inside">
        <Modal.Dialog aria-label={owned ? '成就收藏详情' : '成就目标详情'} className="max-h-[90dvh] overflow-hidden">
          <Modal.CloseTrigger aria-label="关闭成就详情" />
          <Modal.Body className="px-5 pb-2 pt-8 text-center">
            {item && <>
              <p className="text-[10px] uppercase tracking-[.25em] text-muted">{owned ? 'A MOMENT TO KEEP' : 'YOUR NEXT CHAPTER'}</p>
              <BadgeArtwork family={item.family} tier={item.tier} locked={!owned} size={168} className="mx-auto my-2" />
              <h2 className="text-2xl font-semibold tracking-tight">{item.title}</h2>
              {item.scopeLabel && <p className="mt-1 text-sm text-muted">{item.scopeLabel}</p>}
              <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-accent">{owned ? <><Check size={15} />已于 {owned.achievedOn ?? owned.unlockedAt.slice(0, 10)} 达成</> : achievementProgressText(item)}</p>
              <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted">{item.description}</p>
              {owned && <p className="mt-3 text-xs text-muted">达成记录：{formatAchievementAmount(owned.snapshot.value, owned.unit)} {achievementUnit(owned)} · 永久收藏</p>}
              {items.length > 1 && <div className="mt-5 flex flex-wrap justify-center gap-2" aria-label="这一批成就">
                {items.map((badge, index) => <button type="button" key={badge.id} aria-label={'查看' + badge.title} aria-pressed={activeIndex === index} onClick={() => setActiveIndex(index)} className={'rounded-xl border p-1 transition-colors ' + (activeIndex === index ? 'border-accent bg-accent/10' : 'border-border')}>
                  <BadgeArtwork family={badge.family} tier={badge.tier} size={52} />
                </button>)}
              </div>}
            </>}
          </Modal.Body>
          <Modal.Footer className="flex-wrap justify-center gap-2 px-5 pb-5">
            {owned && <Button variant="primary" onPress={() => share({ kind: 'single', id: owned.id })}><Share2 size={15} />分享这枚成就</Button>}
            <Button variant="secondary" onPress={closeDetails}>{owned ? '收下' : '知道了'}</Button>
            <Link to="/achievements" onClick={closeDetails} className="w-full py-1 text-center text-xs text-muted hover:text-accent">查看全部收藏</Link>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
    {snapshot && shareSelection && <AchievementShareModal snapshot={snapshot} selection={shareSelection} onClose={closeShare} />}
  </>;
}
