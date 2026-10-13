let isQuitting = false;

export function markTrayPopoverQuitting(): void {
  isQuitting = true;
}

export function resetTrayPopoverQuitting(): void {
  isQuitting = false;
}

export function isTrayPopoverQuitting(): boolean {
  return isQuitting;
}

/** Popover hides on close while running; app exit must allow the window to close. */
export function shouldTrayPopoverPreventClose(): boolean {
  return !isQuitting;
}
