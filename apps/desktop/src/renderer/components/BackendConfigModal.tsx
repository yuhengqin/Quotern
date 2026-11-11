import { Gear } from "@gravity-ui/icons";
import { Button, Modal } from "@heroui/react";
import { useTranslation } from "quotern-i18n/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import type { PetSettingsRequest } from '../../shared/settings-navigation';
import {
  getDefaultSettingsTab,
  OPEN_SETTINGS_EVENT,
  type OpenSettingsDetail,
  type SettingsTabId,
} from "@/lib/shell-events";

interface BackendConfigModalProps {
  /** Custom trigger; when omitted and uncontrolled, renders a default tertiary button. */
  trigger?: ReactNode;
  /** Controlled open state. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Listen for `tud:open-settings` to open (default true when uncontrolled or when shell mounts). */
  listenForOpenEvent?: boolean;
  /** Hide the default trigger (shell-owned modal with event / external open only). */
  hideTrigger?: boolean;
  /** Controlled settings tab. */
  activeTab?: SettingsTabId;
  onTabChange?: (tab: SettingsTabId) => void;
}

/** Backend configuration trigger and controlled modal. */
export function BackendConfigModal({
  trigger,
  isOpen: controlledOpen,
  onOpenChange,
  listenForOpenEvent = true,
  hideTrigger = false,
  activeTab: controlledTab,
  onTabChange,
}: BackendConfigModalProps = {}) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [uncontrolledTab, setUncontrolledTab] = useState<SettingsTabId>(getDefaultSettingsTab);
  const [petRequest, setPetRequest] = useState<PetSettingsRequest>();
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const activeTab = controlledTab ?? uncontrolledTab;

  const setOpen = useCallback(
    (open: boolean) => {
      if (!isControlled) setUncontrolledOpen(open);
      onOpenChange?.(open);
    },
    [isControlled, onOpenChange],
  );

  const setTab = useCallback(
    (tab: SettingsTabId) => {
      if (controlledTab === undefined) setUncontrolledTab(tab);
      onTabChange?.(tab);
    },
    [controlledTab, onTabChange],
  );

  useEffect(() => {
    if (!listenForOpenEvent) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenSettingsDetail>).detail;
      if (detail?.tab) setTab(detail.tab);
      setPetRequest(detail?.pet);
      setOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, [listenForOpenEvent, setOpen, setTab]);

  return (
    <>
      {!hideTrigger &&
        (trigger ?? (
          <Button
            aria-label={t('shell.settings')}
            onPress={() => setOpen(true)}
            variant="tertiary"
          >
            <Gear />
            {t('shell.settings')}
          </Button>
        ))}

      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={setOpen}
        variant="opaque"
      >
        <Modal.Container
          className="sm:p-4"
          scroll="inside"
        >
          <Modal.Dialog
            aria-label={t('shell.settings')}
            className="h-[min(42rem,90vh)] max-w-[46rem] overflow-hidden p-0"
          >
            <Modal.CloseTrigger aria-label={t('shell.closeSettings')} />
            <Modal.Header className="shrink-0 border-b border-separator py-4 ps-5 pe-14">
              <Modal.Heading>{t('shell.settings')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="m-0 flex min-h-0 flex-1 overflow-hidden p-0">
              <SettingsPanel
                activeTab={activeTab}
                onTabChange={setTab}
                petRequest={petRequest}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
