import { useLayoutEffect, useSyncExternalStore } from 'react';
import { Label, Radio, RadioGroup } from '@heroui/react';
import { Check } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import { demoStorageKey } from '@/lib/demo-runtime';
import { PALETTES, validPalette, type PaletteId } from '../lib/palettes';
import type { Theme } from '../lib/theme';
registerMessages({ 'zh-CN': { 'settings.palette': '强调色' }, en: { 'settings.palette': 'Accent color' }, ja: { 'settings.palette': 'アクセントカラー' }, ko: { 'settings.palette': '강조 색상' } });
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
export function PaletteControl({ theme }: { theme: Theme }) {
  const { t, i18n } = useTranslation(), selected = usePalette();
  const showChineseNames = (i18n.resolvedLanguage ?? '').startsWith('zh');

  const selectPalette = (value: string) => {
    if (!validPalette(value)) return;
    fallback = value;
    try { localStorage.setItem(key(), value); } catch {}
    window.dispatchEvent(new Event(event));
  };

  return (
    <RadioGroup name="accent-palette" value={selected} variant="secondary" onChange={selectPalette}>
      <Label>{t('settings.palette')}</Label>
      <div className="appearance-options">
        {PALETTES.map(([id, name, light, dark]) => {
          const names = name.split(' · ');
          return (
            <Radio key={id} value={id}>
              <Radio.Content className="appearance-option appearance-option--palette">
                <span
                  aria-hidden="true"
                  className="appearance-palette-swatch"
                  data-theme={id === 'default' ? 'default' : undefined}
                  style={{ backgroundColor: (theme === 'dark' ? dark : light) || 'var(--accent)' }}
                />
                <span title={showChineseNames && names.length > 1 ? name : undefined}>
                  {showChineseNames ? names[0] : names.at(-1)}
                </span>
                <Check aria-hidden="true" className="appearance-option-check" />
              </Radio.Content>
            </Radio>
          );
        })}
      </div>
    </RadioGroup>
  );
}
