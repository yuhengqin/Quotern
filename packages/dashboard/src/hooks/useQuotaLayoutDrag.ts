import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { moveQuotaProvider, quotaDropTarget, type QuotaDropTarget } from '../lib/quota-layout';
import type { QuotaLayoutEditor } from './useQuotaLayout';

export function useQuotaLayoutDrag(id: string, editor: QuotaLayoutEditor) {
  const itemRef = useRef<HTMLDivElement>(null), handleRef = useRef<HTMLButtonElement>(null);
  const latest = useRef(editor); latest.current = editor;
  const stopRef = useRef<(() => void) | null>(null), suppressClick = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => { if (!editor.editing) stopRef.current?.(); }, [editor.editing]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary || !editor.editing || editor.busy || editor.dragOwner.current || !itemRef.current) return;
    const item = itemRef.current, handle = event.currentTarget, pointer = event.pointerId;
    const start = { x: event.clientX, y: event.clientY }, rect = item.getBoundingClientRect();
    const grab = { x: start.x - rect.left, y: start.y - rect.top };
    let point = start, active = false, frame = 0, lastFrame = 0, target: QuotaDropTarget | null = null;
    let scroller: HTMLElement = item.parentElement!;
    while (scroller.parentElement && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    editor.dragOwner.current = id;
    handle.setPointerCapture(pointer);

    const update = () => {
      if (!item.isConnected) { cleanup(); return; }
      const bounds = item.getBoundingClientRect();
      setOffset({ x: point.x - bounds.left - grab.x, y: point.y - bounds.top - grab.y });
      const cards = [...(latest.current.rootRef.current?.querySelectorAll<HTMLElement>('[data-quota-layout-item]') ?? [])];
      target = quotaDropTarget(cards.map(card => ({ id: card.dataset.quotaLayoutItem!, ...rectData(card.getBoundingClientRect()) })), point.x, point.y);
      const ids = latest.current.ordered.map(provider => provider.id);
      if (target && moveQuotaProvider(ids, id, target.id, target.placement).every((value, index) => value === ids[index])) target = null;
      latest.current.setDropTarget(previous => previous?.id === target?.id && previous?.placement === target?.placement && previous?.axis === target?.axis ? previous : target);
    };
    const scroll = (at: number) => {
      const bounds = scroller === document.documentElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
      const edge = Math.min(48, (bounds.bottom - bounds.top) / 3);
      const speed = point.y < bounds.top + edge ? -Math.min(1, (bounds.top + edge - point.y) / edge)
        : point.y > bounds.bottom - edge ? Math.min(1, (point.y - bounds.bottom + edge) / edge) : 0;
      if (speed) { scroller.scrollTop += speed * Math.min(32, at - (lastFrame || at)) * 0.5; update(); }
      lastFrame = at; frame = requestAnimationFrame(scroll);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      point = { x: next.clientX, y: next.clientY };
      if (!active && Math.hypot(point.x - start.x, point.y - start.y) < 6) return;
      if (next.cancelable) next.preventDefault();
      if (!active) { active = true; document.documentElement.setAttribute('data-quota-dragging', ''); frame = requestAnimationFrame(scroll); }
      update();
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key); window.removeEventListener('blur', cleanup); handle.removeEventListener('lostpointercapture', cleanup);
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      document.documentElement.removeAttribute('data-quota-dragging');
      latest.current.dragOwner.current = null; latest.current.setDropTarget(null); setOffset(null); stopRef.current = null;
      if (active) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const destination = target;
      cleanup();
      if (active && destination) latest.current.move(id, destination.id, destination.placement);
      if (active) requestAnimationFrame(() => { item.scrollIntoView({ block: 'nearest', inline: 'nearest' }); handleRef.current?.focus({ preventScroll: true }); });
    };
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointer) cleanup(); };
    const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); cleanup(); } };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key); window.addEventListener('blur', cleanup); handle.addEventListener('lostpointercapture', cleanup);
    stopRef.current = cleanup;
  };
  return { itemRef, handleRef, onPointerDown, offset, suppressClick };
}

function rectData(rect: DOMRect) { return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; }
