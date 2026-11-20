/** WebView2 serves registered native protocols through a loopback-free virtual host. */
export function petAsset(url:string) {
  if (!(window as Window & {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__) return url;
  if (url.startsWith('quotern-pet://builtin/')) return '/'+url.slice('quotern-pet://builtin/'.length);
  const imported=/^quotern-pet:\/\/(asset|codex)\/([a-z0-9-]+)\/spritesheet\.webp$/.exec(url);
  if (imported) return 'http://quotern-media.localhost/atlas/'+imported[1]+'/'+imported[2];
  if(url.startsWith('quotern-dsh-pet://preview/')) return 'http://quotern-media.localhost/dsh-pet-7340/thumb/main/'+url.slice('quotern-dsh-pet://preview/'.length);
  return url;
}
