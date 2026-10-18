import { Lock, ShieldCheck } from '@gravity-ui/icons';
import { Button, Modal } from '@heroui/react';
import { useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';

export function PrivacySettingsModal() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onPress={() => setIsOpen(true)} variant="tertiary">
        <Lock />
        {t('rank.privacy.button')}
      </Button>

      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        variant="blur"
      >
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t('rank.privacy.close')} />
            <Modal.Header>
              <Modal.Icon className="bg-success-soft text-success-soft-foreground">
                <ShieldCheck />
              </Modal.Icon>
              <Modal.Heading>{t('rank.privacy.heading')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-3 text-sm leading-6 text-muted">
              <p>
                {t('rank.privacy.summary')}
              </p>
              <p>
                {t('rank.privacy.exclusions')}
              </p>
              <p>
                {t('rank.privacy.optOut')}
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close">{t('rank.privacy.gotIt')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
