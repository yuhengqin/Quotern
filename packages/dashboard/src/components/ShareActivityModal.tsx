import { Modal } from '@heroui/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import { useShareSnapshot, type ShareSnapshot } from '../hooks/ShareSnapshotContext';
import { OPEN_SHARE_EVENT } from '@/lib/shell-events';
import { DeferredContent } from './DeferredContent';

const loadShareSession = () => import('./ShareActivityModalContent').then(module => module.ShareSession);

/** Capture the opening event and scope before loading the optional share editor. */
export function ShareActivityModal() {
  const { t } = useTranslation();
  const [session, setSession] = useState<{ snapshot: ShareSnapshot | null } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { snapshot } = useShareSnapshot();
  useEffect(() => {
    const open = () => setSession({ snapshot });
    window.addEventListener(OPEN_SHARE_EVENT, open);
    return () => window.removeEventListener(OPEN_SHARE_EVENT, open);
  }, [snapshot]);
  return <Modal.Backdrop isOpen={session !== null} onOpenChange={open => { if (!open) setSession(null); }}>
    <Modal.Container className="p-4 sm:p-4" scroll="inside" size="lg">
      <Modal.Dialog aria-label={t('shell.share')} className="max-h-[90dvh] overflow-hidden p-4 sm:max-w-[720px] sm:p-5">
        <Modal.CloseTrigger aria-label={t('shell.closeDialog')} />
        {session && <DeferredContent load={loadShareSession} componentProps={{ activeIndex, initial: session.snapshot, onActiveIndexChange: setActiveIndex }} />}
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
