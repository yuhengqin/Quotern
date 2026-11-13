const xml = (value: string) => Array.from(value).filter(char => {
  const code = char.codePointAt(0)!;
  return code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
}).join('').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

export function buildWindowsToast(value: { title: string; body: string; viewUrl: string; snoozeUrl?: string; viewLabel: string; snoozeLabel: string; dismissAllUrl?: string; dismissAllLabel?: string }): string {
  const actions = [[value.viewLabel, value.viewUrl], ...(value.snoozeUrl ? [[value.snoozeLabel, value.snoozeUrl]] : []), ...(value.dismissAllUrl ? [[value.dismissAllLabel!, value.dismissAllUrl]] : [])];
  return `<toast activationType="protocol" launch="${xml(value.viewUrl)}"><visual><binding template="ToastGeneric"><text>${xml(value.title)}</text><text>${xml(value.body)}</text></binding></visual><actions>${actions.map(([label, url]) => `<action content="${xml(label!)}" activationType="protocol" arguments="${xml(url!)}"/>`).join('')}</actions><audio silent="true"/></toast>`;
}
