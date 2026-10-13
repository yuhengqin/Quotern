import { Button, Modal, Spinner } from '@heroui/react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { cropRect, MAX_BACKGROUND_BYTES, MAX_SHARE_BACKGROUNDS, replacementSuggestion } from '../lib/share-backgrounds';
import type { useShareBackgrounds } from '../hooks/useShareBackgrounds';
import type { ShareCardVariant } from './ShareCardCarousel';

type BackgroundLibrary = ReturnType<typeof useShareBackgrounds>;
type CropSource = { name: string; image: File | string; replaceId?: string };

export function ShareBackgroundPicker({ library, selectedVariant, children, deletingId, onCancelDelete }: {
  library: BackgroundLibrary;
  selectedVariant: ShareCardVariant;
  children: (onUpload: () => void, onAdjust: () => void) => ReactNode;
  deletingId: string | null;
  onCancelDelete: () => void;
}) {
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
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="选择背景图片"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            setFileError(null);
            if (!chosen) { library.setEditing(false); return; }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(chosen.type)) { library.setEditing(false); setFileError('请选择 PNG、JPEG 或 WebP 图片'); return; }
            if (chosen.size > 20 * 1024 * 1024) { library.setEditing(false); setFileError('原图不能超过 20 MB，请先缩小图片'); return; }
            setSource({ name: chosen.name, image: chosen });
          }} />
      <div className="flex items-center justify-center gap-1" role="group" aria-label="背景管理">
        {!library.ready && !library.error && <Spinner size="sm" aria-label="正在读取背景" />}
        {!library.ready && library.error && <Button size="sm" variant="tertiary" onPress={() => void library.reload()}>重试图库</Button>}
        {library.ready && <Button size="sm" variant="tertiary" isDisabled={disabled} onPress={() => void library.reload()}>刷新图库</Button>}
      </div>
      {deletingId && <div className="flex items-center gap-2 text-xs" role="group" aria-label="确认删除背景">
        <span>删除这张背景？</span>
        <Button size="sm" variant="danger" isDisabled={disabled} onPress={() => void library.remove(deletingId).then(onCancelDelete).catch(() => undefined)}>删除</Button>
        <Button size="sm" variant="tertiary" isDisabled={library.busy} onPress={onCancelDelete}>取消</Button>
      </div>}
      {(fileError || library.error) && <p className="max-w-full text-center text-xs text-danger" role="alert">{fileError || library.error}</p>}
      {library.migrationNotice && <div className="flex max-w-full flex-wrap items-center justify-center gap-2 text-center text-xs text-muted" role="status">
        <p>{library.migrationNotice}</p>
        <Button size="sm" variant="tertiary" isDisabled={disabled} onPress={() => void library.reload()}>重试迁移</Button>
      </div>}
      {source && <BackgroundCropModal source={source} library={library} onClose={() => setSource(null)} />}
    </div>
  );
}

function BackgroundCropModal({ source, library, onClose }: { source: CropSource; library: BackgroundLibrary; onClose: () => void }) {
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
      if (decoded.naturalWidth * decoded.naturalHeight > 40_000_000) { setError('图片分辨率过大，请先缩小到 4000 万像素以内'); return; }
      setImage(decoded);
    }).catch(() => { if (!cancelled) setError('无法解码这张图片，请选择有效的 PNG、JPEG 或 WebP 图片'); });
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
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : '背景保存失败，请重试'); }
  };

  const confirmCrop = async () => {
    if (!image || busy) return;
    setProcessing(true);
    setError(null);
    try {
      const output = document.createElement('canvas');
      output.width = 1440; output.height = 2160;
      const context = output.getContext('2d');
      if (!context) throw new Error('当前环境无法裁剪图片');
      const rect = cropRect(image.naturalWidth, image.naturalHeight, zoom, pan.x, pan.y);
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);
      let blob: Blob | null = null;
      for (const quality of [0.92, 0.82, 0.7, 0.6]) {
        blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_BACKGROUND_BYTES) break;
      }
      if (!blob || blob.size > MAX_BACKGROUND_BYTES) throw new Error('裁剪后的图片超过 2 MB，请选择更简单或更小的图片');
      if (!active.current) return;
      if (!source.replaceId && library.items.length >= MAX_SHARE_BACKGROUNDS) {
        setCropped(blob);
        setReplaceId(replacementSuggestion(library.items)?.id);
      } else { await save(blob, source.replaceId); }
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : '裁剪失败，请重试'); }
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
        <Modal.Dialog aria-label={cropped ? '选择要替换的背景' : source.replaceId ? '调整背景图片' : '裁剪背景图片'} className="max-h-[90dvh] p-4">
          {!busy && <Modal.CloseTrigger aria-label="取消背景图片" />}
          <Modal.Header className="pr-8"><Modal.Heading>{cropped ? '选择要替换的背景' : source.replaceId ? '调整背景图片' : '裁剪背景图片'}</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col items-center gap-3">
            {cropped ? <>
              <p className="text-sm text-muted">最多保存三张。已为你选中最久未使用的一张，也可以选择其他背景替换。</p>
              <div className="flex flex-wrap justify-center gap-3" role="group" aria-label="选择替换对象">
                {library.items.map((item) => <button key={item.id} type="button" aria-pressed={replaceId === item.id} aria-label={`替换背景：${item.name}`}
                  disabled={busy} onClick={() => setReplaceId(item.id)} className="w-24 overflow-hidden rounded-lg border-2 border-transparent p-1 data-[selected=true]:border-accent" data-selected={replaceId === item.id}>
                  <img alt={item.name} src={item.image} className="aspect-2/3 w-full rounded object-cover" />
                  <span className="mt-1 block truncate text-xs">{item.name}</span>
                  {replacementSuggestion(library.items)?.id === item.id && <span className="text-xs text-muted">建议替换</span>}
                </button>)}
              </div>
            </> : <>
              <p className="text-center text-xs text-muted">固定 2:3 · 拖动图片或使用方向键调整位置，再缩放取景</p>
              {source.replaceId && <p className="text-center text-xs text-muted">基于已保存的图片调整，保存后替换当前背景</p>}
              {!image && !error && <Spinner aria-label="正在读取图片" />}
              <canvas ref={canvas} width={300} height={450} role="img" aria-label="背景裁剪预览，可用方向键调整取景位置" tabIndex={0}
                className="max-w-full touch-none rounded-lg border border-border outline-offset-2" style={{ width: 'min(280px, calc((90dvh - 250px) * 2 / 3))', aspectRatio: '2 / 3', display: image ? 'block' : 'none', cursor: busy ? 'wait' : 'grab' }}
                onPointerDown={(event) => { if (busy) return; event.currentTarget.setPointerCapture(event.pointerId); dragging.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; }}
                onPointerMove={drag} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
                onKeyDown={(event) => {
                  if (busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  setPan((current) => ({ x: Math.max(-1, Math.min(1, current.x + (event.key === 'ArrowLeft' ? -0.05 : event.key === 'ArrowRight' ? 0.05 : 0))), y: Math.max(-1, Math.min(1, current.y + (event.key === 'ArrowUp' ? -0.05 : event.key === 'ArrowDown' ? 0.05 : 0))) }));
                }} />
              <label className="flex w-full max-w-72 items-center gap-3 text-xs">缩放
                <input aria-label="缩放背景图片" type="range" min={1} max={3} step={0.01} value={zoom} disabled={!image || busy} className="min-w-0 flex-1 accent-accent" onChange={(event) => setZoom(Number(event.target.value))} />
                <span className="w-9 text-right">{zoom.toFixed(1)}×</span>
              </label>
            </>}
            {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}
          </Modal.Body>
          <Modal.Footer className="justify-center">
            <Button variant="secondary" isDisabled={busy} onPress={onClose}>取消</Button>
            <Button isDisabled={cropped ? !replaceId : !image} isPending={busy} onPress={() => { if (busy) return; setError(null); void (cropped ? save(cropped, replaceId) : confirmCrop()); }}>{cropped ? '替换并使用' : '保存并使用'}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
