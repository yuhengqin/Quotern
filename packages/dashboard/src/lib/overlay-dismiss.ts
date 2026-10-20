/** Layering bridge for app-level modals opened from transient top-layer UI. */

/**
 * React Aria treats toasts as a top layer: presses inside them never count as
 * an outside interaction, so an open filter menu stays open when a toast action
 * opens a modal. Replay the outside press on the document body so dismissable
 * menus close before the modal mounts.
 *
 * Skipped while a modal is already open, where the same press would instead
 * dismiss that modal.
 */
export function dismissTransientOverlays(): void {
  if (typeof document === 'undefined' || document.querySelector('[data-slot="modal-backdrop"]')) return;
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0 }));
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
}
