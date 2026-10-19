// Apply guarded integration fixes without modifying the audited upstream snapshot.
export function patchDshPetChat(source) {
  const required = (from, to) => {
    if (!source.includes(from)) throw new Error('unsupported upstream chat patch');
    source = source.replace(from, to);
  };
  required("if (e.key === 'Enter') {", "if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {");
  required(`  const resizeInput = (): void => {
    const textW = measureText(input.value || ' ');
    const w = Math.max(CHAT_MIN_W, Math.min(Math.ceil(textW + CHAT_H_PAD), CHAT_MAX_W));
    root.style.width = w + 'px'; // 根宽度跟随（含 err 行）→ 夹回仍按实际宽
    input.style.height = 'auto';
    input.style.height = Math.max(input.scrollHeight, 22) + 'px';
  };`, `  const resizeInput = (): void => {
    const left = Math.max(0, c.x), top = Math.max(0, c.y);
    const right = Math.min(window.innerWidth, c.x + c.w), bottom = Math.min(window.innerHeight, c.y + c.h);
    const availableW = Math.max(1, right - left - 8), availableH = Math.max(1, bottom - top - 8);
    const textW = measureText(input.value || ' ');
    const w = Math.min(availableW, Math.max(CHAT_MIN_W, Math.min(Math.ceil(textW + CHAT_H_PAD), CHAT_MAX_W)));
    root.style.boxSizing = 'border-box';
    root.style.width = w + 'px';
    root.style.maxWidth = availableW + 'px';
    root.style.maxHeight = availableH + 'px';
    root.style.overflowY = 'auto';
    const errorHeight = root.querySelector<HTMLElement>('.dsh-pet-chat-err')?.offsetHeight ?? 0;
    input.style.maxHeight = Math.max(22, availableH - errorHeight - 4) + 'px';
    input.style.overflowY = 'auto';
    input.style.height = 'auto';
    input.style.height = Math.max(input.scrollHeight, 22) + 'px';
    if (root.isConnected) {
      const rect = root.getBoundingClientRect();
      root.style.left = Math.max(left + 4, Math.min(x, right - rect.width - 4)) + 'px';
      root.style.top = Math.max(top + 4, Math.min(y, bottom - rect.height - 4)) + 'px';
    }
  };`);
  required("  input.addEventListener('input', resizeInput);", "  input.addEventListener('input', resizeInput);\n  window.addEventListener('resize', resizeInput);");
  required("    document.removeEventListener('keydown', onDocKeyDown, true);", "    document.removeEventListener('keydown', onDocKeyDown, true);\n    window.removeEventListener('resize', resizeInput);");
  required(`  const rr = root.getBoundingClientRect();
  root.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rr.width - 4)) + 'px';
  root.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rr.height - 4)) + 'px';`, '  // resizeInput also clamps the mounted dialog to the visible area.');
  const errorShown = "err.style.display = 'block';";
  if (source.split(errorShown).length !== 3) throw new Error('unsupported upstream chat error layout');
  source = source.replaceAll(errorShown, errorShown + '\n          resizeInput();');
  return source;
}
