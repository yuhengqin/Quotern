import { ArrowDownToLine } from '@gravity-ui/icons';
import { Button, Toast, ToastQueue } from '@heroui/react';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DashboardUsageSummary } from '../lib/dashboard-mock-data';
import {
  copyShareCardPng,
  downloadShareCardPng,
  renderShareCardPng,
  SHARE_CARD_DESIGN_HEIGHT,
  SHARE_CARD_DESIGN_WIDTH,
} from '../lib/share-card-image';
import { ShareCardArtwork } from './ShareCardCarousel';
import type { SharePosterDetails } from './SharePosterArtwork';

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
  details?: SharePosterDetails;
  avatarUrl?: string;
  color: string;
  id: number;
  rangeLabel?: string;
  reject: (reason?: unknown) => void;
  resolve: (blob: Blob) => void;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}

const ACTION_LABELS: Record<ShareAction, Record<ShareActionState, string>> = {
  download: {
    error: '下载失败',
    idle: '下载',
    pending: '生成中…',
    success: '已下载',
  },
  copy: {
    error: '复制失败',
    idle: '复制',
    pending: '复制中…',
    success: '已复制',
  },
};

export function ShareCardActions({
  details,
  avatarUrl,
  color,
  rangeLabel,
  summary,
  toolLabel,
  userName,
}: {
  details?: SharePosterDetails;
  avatarUrl?: string;
  color: string;
  rangeLabel?: string;
  summary: DashboardUsageSummary | null;
  toolLabel?: string;
  userName?: string;
}) {
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
    void renderShareCardPng(exportNodeRef.current)
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
    pendingRequestRef.current?.reject(new Error('分享弹窗已关闭'));
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
        details,
        avatarUrl,
        color,
        id,
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
    if (activeAction) return;
    setActiveAction('download');
    setResult(null);
    try {
      const blob = await withMinimumPendingTime(createExportBlob());
      downloadShareCardPng(blob);
      finish('download', 'success');
      toastQueue.add({
        description: '卡片图片已保存到本地',
        title: '下载成功',
        variant: 'success',
      });
    } catch (error) {
      console.error('[share-card] download failed', error);
      finish('download', 'error');
    }
  };

  const handleCopy = async () => {
    if (activeAction) return;
    setActiveAction('copy');
    setResult(null);
    try {
      const blob = createExportBlob();
      await withMinimumPendingTime(copyShareCardPng(blob));
      finish('copy', 'success');
      toastQueue.add({
        description: '卡片图片已复制，可直接粘贴',
        title: '复制成功',
        variant: 'success',
      });
    } catch (error) {
      console.error('[share-card] clipboard write failed', error);
      finish('copy', 'error');
    }
  };

  const getLabel = (action: ShareAction) => {
    if (activeAction === action) return ACTION_LABELS[action].pending;
    if (result?.action === action) return ACTION_LABELS[action][result.state];
    return ACTION_LABELS[action].idle;
  };

  return (
    <>
      <Toast.Provider placement="top end" queue={toastQueue} />
      <Button
        isDisabled={activeAction === 'copy'}
        isPending={activeAction === 'download'}
        onPress={() => void handleDownload()}
        variant="primary"
      >
        <ArrowDownToLine className="size-4" />
        {getLabel('download')}
      </Button>
      <Button
        isDisabled={activeAction === 'download'}
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
                height: `${SHARE_CARD_DESIGN_HEIGHT}px`,
                width: `${SHARE_CARD_DESIGN_WIDTH}px`,
              }}
            >
              <div
                className="relative overflow-hidden opacity-100"
                ref={exportNodeRef}
                style={{
                  background: exportRequest.color,
                  borderRadius: '6px',
                  height: `${SHARE_CARD_DESIGN_HEIGHT}px`,
                  width: `${SHARE_CARD_DESIGN_WIDTH}px`,
                }}
              >
                <ShareCardArtwork
                  avatarUrl={exportRequest.avatarUrl}
                  borderRadius={6}
                  color={exportRequest.color}
                  details={exportRequest.details}
                  isHidden
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
