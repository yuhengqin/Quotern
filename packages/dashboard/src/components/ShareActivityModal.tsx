import { Modal } from '@heroui/react';
import { useEffect, useState } from 'react';
import { useShareSnapshot } from '@/hooks/ShareSnapshotContext';
import { OPEN_SHARE_EVENT } from '@/lib/shell-events';
import {
  getShareCardVariant,
  ShareCardCarousel,
} from './ShareCardCarousel';
import { ShareCardActions } from './ShareCardActions';

/** Share-card preview backed by the current dashboard snapshot. */
export function ShareActivityModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const avatarLarge = '';
  const userName = '';
  const { snapshot } = useShareSnapshot();

  useEffect(() => {
    const open = () => {
      setIsOpen(true);
    };
    window.addEventListener(OPEN_SHARE_EVENT, open);
    return () => window.removeEventListener(OPEN_SHARE_EVENT, open);
  }, []);

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setIsOpen}>
      <Modal.Container className="p-4 sm:p-4" scroll="inside" size="lg">
        <Modal.Dialog aria-label="分享" className="max-h-[90dvh] overflow-hidden p-4 sm:max-w-[720px] sm:p-5">
          <Modal.CloseTrigger aria-label="关闭分享" />
          <Modal.Body className="px-0 pb-0 pt-5 sm:px-2">
            <ShareCardCarousel
              activeIndex={activeIndex}
              avatarUrl={avatarLarge}
              onActiveIndexChange={setActiveIndex}
              rangeLabel={snapshot?.rangeLabel}
              summary={snapshot?.summary ?? null}
              details={snapshot?.details}
              toolLabel={snapshot?.toolLabel}
              userName={userName}
            />
          </Modal.Body>
          <Modal.Footer className="mt-4 shrink-0 justify-center">
            <ShareCardActions
              avatarUrl={avatarLarge}
              color={getShareCardVariant(activeIndex).color}
              rangeLabel={snapshot?.rangeLabel}
              summary={snapshot?.summary ?? null}
              details={snapshot?.details}
              toolLabel={snapshot?.toolLabel}
              userName={userName}
            />
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
