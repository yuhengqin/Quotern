import { useEffect, useState, type ComponentType } from 'react';
import { Button, Modal, Spinner } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';

/** Keep event listeners in their small host; download feature content only when opened. */
export function DeferredContent<P extends object>({ load, componentProps, onPendingClose }: { load: () => Promise<ComponentType<P>>; componentProps: P; onPendingClose?: () => void }) {
  const { t } = useTranslation();
  const [Content, setContent] = useState<ComponentType<P> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void load().then(value => { if (active) setContent(() => value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [load]);
  if (Content) return <Content {...componentProps} />;
  const pending = <div role="status" className="flex items-center justify-center gap-3 p-6 text-sm text-muted">
    {failed ? <><span>{t('shell.featureLoadFailed')}</span><Button size="sm" variant="secondary" onPress={() => window.location.reload()}>{t('shell.retryFeature')}</Button></>
      : <><Spinner size="sm" /><span>{t('shell.loadingFeature')}</span></>}
  </div>;
  return onPendingClose ? <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onPendingClose(); }}>
    <Modal.Container size="md"><Modal.Dialog aria-label={t('shell.loadingFeature')}>
      <Modal.CloseTrigger aria-label={t('shell.closeDialog')} />
      <Modal.Body>{pending}</Modal.Body>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop> : pending;
}
