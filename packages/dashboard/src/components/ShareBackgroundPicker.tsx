import { Button, Modal, Spinner } from '@heroui/react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import { cropRect, MAX_BACKGROUND_BYTES, MAX_SHARE_BACKGROUNDS, replacementSuggestion } from '../lib/share-backgrounds';
import type { useShareBackgrounds } from '../hooks/useShareBackgrounds';
import type { ShareCardVariant } from './ShareCardCarousel';

type BackgroundLibrary = ReturnType<typeof useShareBackgrounds>;
type CropSource = { name: string; image: File | string; replaceId?: string };
class ShareImageError extends Error {
  constructor(readonly key: string) { super(key); }
}

export function ShareBackgroundPicker({ library, selectedVariant, children, deletingId, onCancelDelete }: {
  library: BackgroundLibrary;
  selectedVariant: ShareCardVariant;
  children: (onUpload: () => void, onAdjust: () => void) => ReactNode;
  deletingId: string | null;
  onCancelDelete: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<CropSource | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const disabled = !library.ready || library.busy || library.loading;
  useEffect(() => {
    if (source) library.setEditing(true);
    return () => library.setEditing(false);
  }, [source, library.setEditing]);
  useEffect(() => {
    const element = input.current;
    const cancel = () => library.setEditing(false);
    element?.addEventListener('cancel', cancel);
    return () => element?.removeEventListener('cancel', cancel);
  }, [library.setEditing]);
  return (
    <div className="flex w-full flex-col items-center gap-1 pb-2">
      {children(
        () => { if (!disabled) { onCancelDelete(); setFileError(null); library.setEditing(true); input.current?.click(); } },
        () => {
          if (disabled || !selectedVariant.backgroundImage) return;
          onCancelDelete(); setFileError(null);
          setSource({ name: selectedVariant.label, image: selectedVariant.backgroundImage, replaceId: selectedVariant.id });
        },
      )}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label={t('share.chooseBackgroundImage')}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            setFileError(null);
            if (!chosen) { library.setEditing(false); return; }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(chosen.type)) { library.setEditing(false); setFileError('share.invalidImageType'); return; }
            if (chosen.size > 20 * 1024 * 1024) { library.setEditing(false); setFileError('share.originalTooLarge'); return; }
            setSource({ name: chosen.name, image: chosen });
          }} />
      {!library.ready && <div className="flex items-center justify-center gap-1" role="group" aria-label={t('share.backgroundManagement')}>
        {!library.error && <Spinner size="sm" aria-label={t('share.backgroundLoading')} />}
        {library.error && <Button size="sm" variant="tertiary" onPress={() => void library.reload()}>{t('share.backgroundRetry')}</Button>}
      </div>}
      {deletingId && <div className="flex items-center gap-2 text-xs" role="group" aria-label={t('share.confirmDeleteBackground')}>
        <span>{t('share.deleteBackgroundQuestion')}</span>
        <Button size="sm" variant="danger" isDisabled={disabled} onPress={() => void library.remove(deletingId).then(onCancelDelete).catch(() => undefined)}>{t('share.delete')}</Button>
        <Button size="sm" variant="tertiary" isDisabled={library.busy} onPress={onCancelDelete}>{t('share.cancel')}</Button>
      </div>}
      {(fileError || library.error) && <p className="max-w-full text-center text-xs text-danger" role="alert">{t((fileError || library.error)!)}</p>}
      {library.migrationNotice && <div className="flex max-w-full flex-wrap items-center justify-center gap-2 text-center text-xs text-muted" role="status">
        <p>{library.migrationNotice}</p>
        <Button size="sm" variant="tertiary" isDisabled={disabled} onPress={() => void library.reload()}>{t('share.migrationRetry')}</Button>
      </div>}
      {source && <BackgroundCropModal source={source} library={library} onClose={() => setSource(null)} />}
    </div>
  );
}

function BackgroundCropModal({ source, library, onClose }: { source: CropSource; library: BackgroundLibrary; onClose: () => void }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cropped, setCropped] = useState<Blob | null>(null);
  const [replaceId, setReplaceId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const dragging = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const active = useRef(true);
  const busy = processing || library.busy;

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const url = typeof source.image === 'string' ? source.image : URL.createObjectURL(source.image);
    const decoded = new Image();
    decoded.src = url;
    void decoded.decode().then(() => {
      if (cancelled) return;
      if (decoded.naturalWidth * decoded.naturalHeight > 40_000_000) { setError('share.imageResolutionError'); return; }
      setImage(decoded);
    }).catch(() => { if (!cancelled) setError('share.imageDecodeError'); });
    return () => { cancelled = true; active.current = false; if (typeof source.image !== 'string') URL.revokeObjectURL(url); };
  }, [source]);

  useEffect(() => {
    if (!canvas.current || !image || cropped) return;
    const rect = cropRect(image.naturalWidth, image.naturalHeight, zoom, pan.x, pan.y);
    const context = canvas.current.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 300, 450);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, 300, 450);
  }, [image, zoom, pan, cropped]);

  const save = async (blob: Blob, replacing?: string) => {
    try {
      await library.add(source.name.slice(0, 200), blob, replacing);
      if (active.current) onClose();
    } catch { if (active.current) setError('share.backgroundSaveError'); }
  };

  const confirmCrop = async () => {
    if (!image || busy) return;
    setProcessing(true);
    setError(null);
    try {
      const output = document.createElement('canvas');
      output.width = 1440; output.height = 2160;
      const context = output.getContext('2d');
      if (!context) throw new ShareImageError('share.cropUnavailable');
      const rect = cropRect(image.naturalWidth, image.naturalHeight, zoom, pan.x, pan.y);
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);
      let blob: Blob | null = null;
      for (const quality of [0.92, 0.82, 0.7, 0.6]) {
        blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_BACKGROUND_BYTES) break;
      }
      if (!blob || blob.size > MAX_BACKGROUND_BYTES) throw new ShareImageError('share.croppedTooLarge');
      if (!active.current) return;
      if (!source.replaceId && library.items.length >= MAX_SHARE_BACKGROUNDS) {
        setCropped(blob);
        setReplaceId(replacementSuggestion(library.items)?.id);
      } else { await save(blob, source.replaceId); }
    } catch (failure) { if (active.current) setError(failure instanceof ShareImageError ? failure.key : 'share.cropError'); }
    finally { if (active.current) setProcessing(false); }
  };

  const drag = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = dragging.current;
    if (!start || !image || busy) return;
    const rect = cropRect(image.naturalWidth, image.naturalHeight, zoom);
    const bounds = event.currentTarget.getBoundingClientRect();
    const xTravel = image.naturalWidth - rect.width;
    const yTravel = image.naturalHeight - rect.height;
    setPan({
      x: xTravel > 0 ? Math.max(-1, Math.min(1, start.panX - 2 * (event.clientX - start.x) * rect.width / bounds.width / xTravel)) : 0,
      y: yTravel > 0 ? Math.max(-1, Math.min(1, start.panY - 2 * (event.clientY - start.y) * rect.height / bounds.height / yTravel)) : 0,
    });
  };

  return (
    <Modal.Backdrop isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Modal.Container size="md" scroll="inside" className="p-3">
        <Modal.Dialog aria-label={t(cropped ? 'share.replaceDialog' : source.replaceId ? 'share.adjustBackground' : 'share.cropDialog')} className="max-h-[90dvh] p-4">
          {!busy && <Modal.CloseTrigger aria-label={t('share.cancelBackground')} />}
          <Modal.Header className="pr-8"><Modal.Heading>{t(cropped ? 'share.replaceDialog' : source.replaceId ? 'share.adjustBackground' : 'share.cropDialog')}</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col items-center gap-3">
            {cropped ? <>
              <p className="text-sm text-muted">{t('share.replaceGuidance')}</p>
              <div className="flex flex-wrap justify-center gap-3" role="group" aria-label={t('share.chooseReplacement')}>
                {library.items.map((item) => <button key={item.id} type="button" aria-pressed={replaceId === item.id} aria-label={t('share.replaceNamedBackground', { name: item.name })}
                  disabled={busy} onClick={() => setReplaceId(item.id)} className="w-24 overflow-hidden rounded-lg border-2 border-transparent p-1 data-[selected=true]:border-accent" data-selected={replaceId === item.id}>
                  <img alt={item.name} src={item.image} className="aspect-2/3 w-full rounded object-cover" />
                  {replacementSuggestion(library.items)?.id === item.id && <span className="text-xs text-muted">{t('share.replacementSuggested')}</span>}
                </button>)}
              </div>
            </> : <>
              <p className="text-center text-xs text-muted">{t('share.cropGuidance')}</p>
              {source.replaceId && <p className="text-center text-xs text-muted">{t('share.adjustSavedGuidance')}</p>}
              {!image && !error && <Spinner aria-label={t('share.imageLoading')} />}
              <canvas ref={canvas} width={300} height={450} role="img" aria-label={t('share.cropPreview')} tabIndex={0}
                className="max-w-full touch-none rounded-lg border border-border outline-offset-2" style={{ width: 'min(280px, calc((90dvh - 250px) * 2 / 3))', aspectRatio: '2 / 3', display: image ? 'block' : 'none', cursor: busy ? 'wait' : 'grab' }}
                onPointerDown={(event) => { if (busy) return; event.currentTarget.setPointerCapture(event.pointerId); dragging.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; }}
                onPointerMove={drag} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
                onKeyDown={(event) => {
                  if (busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  setPan((current) => ({ x: Math.max(-1, Math.min(1, current.x + (event.key === 'ArrowLeft' ? -0.05 : event.key === 'ArrowRight' ? 0.05 : 0))), y: Math.max(-1, Math.min(1, current.y + (event.key === 'ArrowUp' ? -0.05 : event.key === 'ArrowDown' ? 0.05 : 0))) }));
                }} />
              <label className="flex w-full max-w-72 items-center gap-3 text-xs">{t('share.zoom')}
                <input aria-label={t('share.zoomBackground')} type="range" min={1} max={3} step={0.01} value={zoom} disabled={!image || busy} className="min-w-0 flex-1 accent-accent" onChange={(event) => setZoom(Number(event.target.value))} />
                <span className="w-9 text-right">{zoom.toFixed(1)}×</span>
              </label>
            </>}
            {error && <p role="alert" className="text-center text-sm text-danger">{t(error)}</p>}
          </Modal.Body>
          <Modal.Footer className="justify-center">
            <Button variant="secondary" isDisabled={busy} onPress={onClose}>{t('share.cancel')}</Button>
            <Button isDisabled={cropped ? !replaceId : !image} isPending={busy} onPress={() => { if (busy) return; setError(null); void (cropped ? save(cropped, replaceId) : confirmCrop()); }}>{t(cropped ? 'share.replaceAndUse' : 'share.saveAndUse')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
