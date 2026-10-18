import { useMemo, useRef, useState } from 'react';
import { Button, Label, Modal, Switch } from '@heroui/react';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import type { AchievementSnapshot } from 'quotern-core/achievements';
import { normalizeLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { copyShareCardPng, downloadShareCardPng, renderSharePosterPng } from '../lib/share-card-image';
import { BadgeArtwork } from './BadgeArtwork';
import { buildAchievementShare, type AchievementSharePayload, type AchievementShareSelection } from './share-model';
import './achievements.css';

export function AchievementShareModal({ snapshot, selection, onClose }: { snapshot: AchievementSnapshot; selection: AchievementShareSelection; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const [showCost, setShowCost] = useState(false), [showProjects, setShowProjects] = useState(false);
  const [action, setAction] = useState<'copy' | 'download' | null>(null), [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const payload = useMemo(() => {
    try { return { data: buildAchievementShare(snapshot, selection, { showCost, showProjects }, locale), error: null }; }
    catch { return { data: null, error: t('achievement.share.unavailable') }; }
  }, [snapshot, selection, showCost, showProjects, locale, t]);
  const exportImage = async (kind: 'copy' | 'download') => {
    if (action || !preview.current || !payload.data) return;
    setAction(kind); setError(null); setSuccess(null);
    try {
      const blob = renderSharePosterPng(preview.current);
      if (kind === 'copy') await copyShareCardPng(blob); else downloadShareCardPng(await blob);
      setSuccess(t(kind === 'copy' ? 'achievement.share.copied' : 'achievement.share.downloaded'));
    } catch { setError(t('achievement.share.exportFailed')); }
    finally { setAction(null); }
  };
  return <Modal.Backdrop isOpen onOpenChange={open => { if (!open && !action) onClose(); }} isDismissable={!action}>
    <Modal.Container size="lg" scroll="inside" className="p-3">
      <Modal.Dialog aria-label={t('achievement.share.dialog')} className="max-h-[94dvh] overflow-hidden p-4 sm:max-w-[560px]">
        <Modal.CloseTrigger aria-label={t('achievement.share.close')} isDisabled={Boolean(action)}/>
        <Modal.Header className="mb-3 px-0 pt-0"><Modal.Heading className="text-base">{t('achievement.share.heading')}</Modal.Heading></Modal.Header>
        <Modal.Body className="px-0 py-0">
          <div className="mx-auto w-full max-w-[360px]">
            {payload.data ? <div ref={preview}><AchievementPoster payload={payload.data}/></div> : <p className="p-8 text-center text-sm text-muted">{payload.error}</p>}
          </div>
          <div className="mx-auto mt-4 flex max-w-[360px] flex-wrap justify-center gap-x-5 gap-y-3">
            <Switch size="sm" isSelected={showCost} onChange={setShowCost} isDisabled={Boolean(action)}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control><Label className="text-xs">{t('achievement.share.showCost')}</Label></Switch.Content></Switch>
            <Switch size="sm" isSelected={showProjects} onChange={setShowProjects} isDisabled={Boolean(action)}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control><Label className="text-xs">{t('achievement.share.showProjects')}</Label></Switch.Content></Switch>
          </div>
          <p className="mt-3 flex items-center justify-center gap-1 text-[10px] text-muted"><ShieldCheck size={11}/>{t('achievement.share.privacyHint')}</p>
          {(error || success) && <p role="status" className={'mt-3 text-center text-xs ' + (error ? 'text-danger' : 'text-success')}>{error ?? success}</p>}
        </Modal.Body>
        <Modal.Footer className="justify-center gap-3 px-0 pb-0 pt-4">
          <Button variant="primary" isPending={action === 'download'} isDisabled={!payload.data || action === 'copy'} onPress={() => void exportImage('download')}><Download size={15}/>{t(action === 'download' ? 'achievement.share.generating' : 'achievement.share.downloading')}</Button>
          <Button variant="secondary" isPending={action === 'copy'} isDisabled={!payload.data || action === 'download'} onPress={() => void exportImage('copy')}><Copy size={15}/>{t(action === 'copy' ? 'achievement.share.copying' : 'achievement.share.copyImage')}</Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}

function AchievementPoster({ payload }: { payload: AchievementSharePayload }) {
  const { t } = useTranslation();
  const single = payload.badges.length === 1 && payload.stats.length === 0;
  return <div className="achievement-poster relative overflow-hidden rounded-[24px] px-6 pb-6 pt-7" data-achievement-poster>
    <div className="flex items-center justify-between border-b border-white/10 pb-4"><span className="text-[11px] font-semibold tracking-[.15em]">QUOTERN</span><span className="text-[8px] tracking-[.2em] text-violet-200/50">{t('achievement.share.posterEyebrow')}</span></div>
    <div className="pt-6 text-center"><p className="text-[10px] tracking-wider text-violet-200/60">{payload.subtitle}</p><h2 className="mt-3 text-[25px] font-semibold leading-tight tracking-tight">{payload.title}</h2></div>
    {single ? <div className="pb-7 pt-3 text-center"><BadgeArtwork family={payload.badges[0]!.family} tier={payload.badges[0]!.tier} size={210} className="mx-auto"/><p className="mt-2 text-[13px] text-violet-100/90">{payload.badges[0]!.subtitle}</p><p className="mt-3 text-[10px] text-violet-200/50">{payload.badges[0]!.date ?? t('achievement.page.earned')}</p></div> : <>
      {payload.stats.length > 0 && <dl className="mt-6 grid grid-cols-2 gap-x-3 gap-y-5">{payload.stats.map(stat => <div key={stat.label} className="border-l border-violet-200/20 pl-3"><dt className="text-[9px] text-violet-200/50">{stat.label}</dt><dd className="mt-1 text-[21px] font-semibold leading-tight tracking-tight">{stat.value}</dd></div>)}</dl>}
      {payload.badges.length > 0 && <div className="mb-4 mt-6 grid grid-cols-3 gap-1">{payload.badges.map((badge, index) => <div className="min-w-0 text-center" key={index}><BadgeArtwork family={badge.family} tier={badge.tier} size={88} className="mx-auto h-auto max-w-full"/><p className="mt-2 text-[10px] font-medium leading-4">{badge.title}</p><p className="mt-1 break-words text-[8px] leading-3 text-violet-200/50">{badge.subtitle}</p></div>)}</div>}
      {payload.range && <p className="mb-6 mt-5 text-center text-[9px] tracking-wide text-violet-200/50">{payload.range}</p>}
    </>}
    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-4"><span className="text-[8px] text-violet-200/45">{payload.note}</span><span className="text-[8px] text-violet-200/55">{t('achievement.share.tagline')}</span></div>
  </div>;
}
