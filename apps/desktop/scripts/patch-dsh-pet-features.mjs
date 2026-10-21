// Remove model-driven UI only in generated files; keep the audited snapshot intact.
export function withoutPetChat(sprite) {
  const replace = (from, to) => {
    const next = sprite.replace(from, to);
    if (next === sprite) throw new Error('unsupported upstream chat removal');
    sprite = next;
  };
  replace(/      \{ label: '碎碎念', action: 'whisper' \},\r?\n      \{ label: '对话', action: 'chat' \},\r?\n/, '');
  replace(/    if \(leaf\.action === 'whisper'\) \{[\s\S]*?(?=    if \(leaf\.action === 'home'\))/, '');
  replace(/  \/\/ 「碎碎念」菜单：[\s\S]*?(?=  \/\/ 「回到初始位置」菜单：)/, '');
  replace(/    \/\/ 对话弹窗（shared 组件）：[\s\S]*?    this\.chatOpen = false;\r?\n/, '');
  replace(/    if \(this\.chatClose\) \{[\s\S]*?\r?\n    \}\r?\n/, '');
  replace(/this\.menuOpen \|\| this\.chatOpen/g, 'this.menuOpen');
  replace('if (!this.chatOpen) this.setInteractive(false);', 'this.setInteractive(false);');
  replace('!this.chatOpen && !this.dragState.active', '!this.dragState.active');
  replace('.dsh-pet-menu-column, .dsh-pet-chat', '.dsh-pet-menu-column');
  return sprite;
}
