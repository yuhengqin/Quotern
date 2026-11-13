const xml = (value: string) => Array.from(value).filter(char => {
  const code = char.codePointAt(0)!;
  return code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
}).join('').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

export function buildWindowsToast(value: { title: string; body: string; viewUrl: string; snoozeUrl?: string; viewLabel: string; snoozeLabel: string }): string {
  return `<toast activationType="protocol" launch="${xml(value.viewUrl)}"><visual><binding template="ToastGeneric"><text>${xml(value.title)}</text><text>${xml(value.body)}</text></binding></visual><actions><action content="${xml(value.viewLabel)}" activationType="protocol" arguments="${xml(value.viewUrl)}"/>${value.snoozeUrl ? `<action content="${xml(value.snoozeLabel)}" activationType="protocol" arguments="${xml(value.snoozeUrl)}"/>` : ''}</actions><audio silent="true"/></toast>`;
}
