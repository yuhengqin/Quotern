import { useLayoutEffect, useSyncExternalStore } from 'react';
import { Label, ListBox, Select } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import { demoStorageKey } from '@/lib/demo-runtime';
import { PALETTES, validPalette, type PaletteId } from '../lib/palettes';
import { FilterSelectPopover } from './FilterMenu';
registerMessages({ 'zh-CN': { 'settings.palette': '配色主题' }, en: { 'settings.palette': 'Color palette' }, ja: { 'settings.palette': 'カラーパレット' }, ko: { 'settings.palette': '색상 테마' } });
const event = 'quotern:palette-changed';
let fallback: PaletteId = 'default';
const key = () => demoStorageKey('quotern-palette');
const read = (): PaletteId => { try { const value = localStorage.getItem(key()) ?? 'default'; return validPalette(value) ? value : 'default'; } catch { return fallback; } };
const subscribe = (callback: () => void) => { window.addEventListener('storage', callback); window.addEventListener(event, callback); return () => { window.removeEventListener('storage', callback); window.removeEventListener(event, callback); }; };
function usePalette() { return useSyncExternalStore(subscribe, read, () => 'default' as PaletteId); }
export function PaletteRuntime({ theme }: { theme: 'light' | 'dark' }) {
  const selected = usePalette();
  useLayoutEffect(() => {
    const root = document.documentElement, row = PALETTES.find(row => row[0] === selected)!;
    const properties = ['--accent', '--accent-foreground', '--accent-soft', '--accent-soft-foreground', '--focus'];
    if (selected === 'default') for (const property of properties) root.style.removeProperty(property);
    else {
      const accent = row[theme === 'dark' ? 3 : 2];
      root.style.setProperty('--accent', accent); root.style.setProperty('--focus', accent);
      root.style.setProperty('--accent-foreground', theme === 'dark' ? '#101010' : '#ffffff');
      root.style.setProperty('--accent-soft', 'color-mix(in srgb, var(--accent) 14%, transparent)');
      root.style.setProperty('--accent-soft-foreground', accent);
    }
    root.dataset.palette = selected;
  }, [selected, theme]);
  return null;
}
export function PaletteControl() {
  const { t, i18n } = useTranslation(), selected = usePalette();
  const label = (value: typeof PALETTES[number]) => (i18n.resolvedLanguage ?? '').startsWith('zh') ? value[1] : value[1].split(' · ').at(-1)!;
  return <Select aria-label={t('settings.palette')} value={selected} onChange={value => { if (validPalette(value)) { fallback = value; try { localStorage.setItem(key(), value); } catch {} window.dispatchEvent(new Event(event)); } }}>
    <Label>{t('settings.palette')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><FilterSelectPopover><ListBox aria-label={t('settings.palette')}>
      {PALETTES.map(row => <ListBox.Item key={row[0]} id={row[0]} textValue={label(row)}><span aria-hidden className="mr-2 inline-block size-3 rounded-full" style={{ backgroundColor: row[2] || 'var(--accent)' }} />{label(row)}<ListBox.ItemIndicator /></ListBox.Item>)}
    </ListBox></FilterSelectPopover>
  </Select>;
}
