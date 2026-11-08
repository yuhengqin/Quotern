import { ArrowDownToLine } from '@gravity-ui/icons';
import { Button, ToastQueue } from '@heroui/react';
import { Copy } from 'lucide-react';
import { normalizeLocale, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import {
  copyShareCardPng,
  downloadShareCardPng,
  renderShareCardPng,
} from '../lib/share-card-image';
import { shareDimensions, type SharePresentation, type ShareCostEvidence } from '../lib/share-presentation';
import { ShareCardArtwork } from './ShareCardCarousel';
import { AppToastRegion } from './AppToastRegion';
import type { SharePosterDetails, ShareCardTheme } from './SharePosterArtwork';

type ShareAction = 'copy' | 'download';
type ShareActionState = 'error' | 'idle' | 'pending' | 'success';
const MINIMUM_PENDING_TIME_MS = 1000;

async function withMinimumPendingTime<T>(operation: Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation;
  } finally {
    const remaining = MINIMUM_PENDING_TIME_MS - (performance.now() - startedAt);
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, remaining);
      });
    }
  }
}

interface ExportRequest {
  presentation?: SharePresentation;
  costEvidence?: ShareCostEvidence | null;
  backgroundImage?: string;
  theme: ShareCardTheme;
  details?: SharePosterDetails;
  avatarUrl?: string;
  color: string;
  id: number;
  locale: SupportedLocale;
  rangeLabel?: string;
  reject: (reason?: unknown) => void;
  resolve: (blob: Blob) => void;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}

const ACTION_LABEL_KEYS: Record<ShareAction, Record<ShareActionState, string>> = {
  download: {
    error: 'share.action.downloadError',
    idle: 'share.action.download',
    pending: 'share.action.downloadPending',
    success: 'share.action.downloadSuccess',
  },
  copy: {
    error: 'share.action.copyError',
    idle: 'share.action.copy',
    pending: 'share.action.copyPending',
    success: 'share.action.copySuccess',
  },
};

export function ShareCardActions({
  presentation,
  costEvidence,
  onExportSuccess,
  backgroundImage,
  theme = 'neon',
  disabled = false,
  details,
  avatarUrl,
  color,
  rangeLabel,
  summary,
  toolLabel,
  userName,
}: {
  onExportSuccess?: () => void;
  presentation?: SharePresentation;
  costEvidence?: ShareCostEvidence | null;
  backgroundImage?: string;
  theme?: ShareCardTheme;
  disabled?: boolean;
  details?: SharePosterDetails;
  avatarUrl?: string;
  color: string;
  rangeLabel?: string;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
  const { t, i18n } = useTranslation();
  const [toastQueue] = useState(
    () => new ToastQueue({ maxVisibleToasts: 2 }),
  );
  const [activeAction, setActiveAction] = useState<ShareAction | null>(null);
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);
  const [result, setResult] = useState<{
    action: ShareAction;
    state: Exclude<ShareActionState, 'idle' | 'pending'>;
  } | null>(null);
  const exportNodeRef = useRef<HTMLDivElement>(null);
  const nextRequestIdRef = useRef(0);
  const processingRequestIdRef = useRef<number | null>(null);
  const pendingRequestRef = useRef<ExportRequest | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  pendingRequestRef.current = exportRequest;

  useEffect(() => {
    if (
      !exportRequest
      || !exportNodeRef.current
      || processingRequestIdRef.current === exportRequest.id
    ) {
      return;
    }

    const request = exportRequest;
    processingRequestIdRef.current = request.id;
    void renderShareCardPng(exportNodeRef.current, request.presentation?.aspect)
      .then(request.resolve, request.reject)
      .finally(() => {
        processingRequestIdRef.current = null;
        setExportRequest((current) => (
          current?.id === request.id ? null : current
        ));
      });
  }, [exportRequest]);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    pendingRequestRef.current?.reject(new Error('share dialog closed'));
  }, []);

  const finish = (
    action: ShareAction,
    state: Exclude<ShareActionState, 'idle' | 'pending'>,
  ) => {
    setActiveAction(null);
    setResult({ action, state });
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setResult(null), 1800);
  };

  const createExportBlob = () => {
    const id = nextRequestIdRef.current + 1;
    nextRequestIdRef.current = id;
    return new Promise<Blob>((resolve, reject) => {
      setExportRequest({
        presentation: presentation ? { ...presentation } : undefined,
        costEvidence: costEvidence ? { ...costEvidence } : null,
        backgroundImage,
        theme,
        details,
        avatarUrl,
        color,
        id,
        locale: normalizeLocale(i18n.resolvedLanguage ?? i18n.language),
        rangeLabel,
        reject,
        resolve,
        summary,
        toolLabel,
        userName,
      });
    });
  };

  const handleDownload = async () => {
    if (disabled || activeAction) return;
    setActiveAction('download');
    setResult(null);
    try {
      const blob = await withMinimumPendingTime(createExportBlob());
      downloadShareCardPng(blob);
      onExportSuccess?.();
      finish('download', 'success');
      toastQueue.add({
        description: t('share.downloadToastDescription'),
        title: t('share.downloadToastTitle'),
        variant: 'success',
      });
    } catch (error) {
      console.error('[share-card] download failed', error);
      finish('download', 'error');
    }
  };

  const handleCopy = async () => {
    if (disabled || activeAction) return;
    setActiveAction('copy');
    setResult(null);
    try {
      const blob = createExportBlob();
      await withMinimumPendingTime(copyShareCardPng(blob));
      onExportSuccess?.();
      finish('copy', 'success');
      toastQueue.add({
        description: t('share.copyToastDescription'),
        title: t('share.copyToastTitle'),
        variant: 'success',
      });
    } catch (error) {
      console.error('[share-card] clipboard write failed', error);
      finish('copy', 'error');
    }
  };

  const getLabel = (action: ShareAction) => {
    if (activeAction === action) return t(ACTION_LABEL_KEYS[action].pending);
    if (result?.action === action) return t(ACTION_LABEL_KEYS[action][result.state]);
    return t(ACTION_LABEL_KEYS[action].idle);
  };

  return (
    <>
      <AppToastRegion queue={toastQueue} />
      <Button
        isDisabled={disabled || activeAction === 'copy'}
        isPending={activeAction === 'download'}
        onPress={() => void handleDownload()}
        variant="primary"
      >
        <ArrowDownToLine className="size-4" />
        {getLabel('download')}
      </Button>
      <Button
        isDisabled={disabled || activeAction === 'download'}
        isPending={activeAction === 'copy'}
        onPress={() => void handleCopy()}
        variant="outline"
      >
        <Copy className="size-4" />
        {getLabel('copy')}
      </Button>
      {exportRequest
        ? createPortal(
            <div
              aria-hidden="true"
              className="pointer-events-none fixed left-[-10000px] top-0 z-[-1] overflow-hidden opacity-100"
              style={{
                height: `${shareDimensions(exportRequest.presentation?.aspect).height}px`,
                width: `${shareDimensions(exportRequest.presentation?.aspect).width}px`,
              }}
            >
              <div
                className="relative overflow-hidden opacity-100"
                ref={exportNodeRef}
                style={{
                  background: exportRequest.color,
                  borderRadius: '6px',
                  height: `${shareDimensions(exportRequest.presentation?.aspect).height}px`,
                  width: `${shareDimensions(exportRequest.presentation?.aspect).width}px`,
                }}
              >
                <ShareCardArtwork
                  presentation={exportRequest.presentation}
                  costEvidence={exportRequest.costEvidence}
                  backgroundImage={exportRequest.backgroundImage}
                  theme={exportRequest.theme}
                  avatarUrl={exportRequest.avatarUrl}
                  borderRadius={6}
                  details={exportRequest.details}
                  isHidden
                  locale={exportRequest.locale}
                  rangeLabel={exportRequest.rangeLabel}
                  summary={exportRequest.summary}
                  toolLabel={exportRequest.toolLabel}
                  userName={exportRequest.userName}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
