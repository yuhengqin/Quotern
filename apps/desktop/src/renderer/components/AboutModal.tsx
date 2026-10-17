import { CircleInfo } from '@gravity-ui/icons';
import { Button, Modal } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AboutContent } from '@/components/AboutContent';
import { OPEN_ABOUT_EVENT } from '@/lib/shell-events';

interface AboutModalProps {
  trigger?: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  listenForOpenEvent?: boolean;
  hideTrigger?: boolean;
}

/** Product about dialog — version + supported tool series. */
export function AboutModal({
  trigger,
  isOpen: controlledOpen,
  onOpenChange,
  listenForOpenEvent = true,
  hideTrigger = false,
}: AboutModalProps = {}) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = useCallback(
    (open: boolean) => {
      if (!isControlled) setUncontrolledOpen(open);
      onOpenChange?.(open);
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    if (!listenForOpenEvent) return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_ABOUT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ABOUT_EVENT, onOpen);
  }, [listenForOpenEvent, setOpen]);

  return (
    <>
      {!hideTrigger &&
        (trigger ?? (
          <Button
            aria-label={t('shell.about')}
            onPress={() => setOpen(true)}
            variant="tertiary"
          >
            <CircleInfo />
            {t('shell.about')}
          </Button>
        ))}

      <Modal.Backdrop isOpen={isOpen} onOpenChange={setOpen} variant="blur">
        <Modal.Container
          className="w-[840px] max-w-[min(840px,92vw)]"
          scroll="outside"
          size="lg"
        >
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t('shell.closeAbout')} />
            <Modal.Header>
              <Modal.Heading>{t('shell.about')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="pt-2">
              <AboutContent />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
