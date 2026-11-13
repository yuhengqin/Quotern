import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APPEARANCE_STYLES,
  hasAppearanceDecoration,
  normalizeAppearancePreferences,
  isAppearancePreferences,
  resolveAppearanceTokens,
  appearanceChrome,
} from '../../../../apps/desktop/src/shared/appearance.ts';

test('legacy accent choices survive appearance migration and invalid styles', () => {
  assert.deepEqual(normalizeAppearancePreferences(null, 'rose'), { style: 'default', palette: 'rose' });
  assert.deepEqual(normalizeAppearancePreferences(null, 'default'), { style: 'default', palette: 'default' });
  assert.deepEqual(normalizeAppearancePreferences({ style: 'unknown', palette: 'teal' }), { style: 'default', palette: 'teal' });
  assert.deepEqual(normalizeAppearancePreferences(null), { style: 'default', palette: 'theme' });
  assert.equal(isAppearancePreferences({ style: 'win95', palette: 'theme' }), true);
  assert.equal(isAppearancePreferences({ style: 'win95', palette: 'url(untrusted)' }), false);
  assert.equal(isAppearancePreferences({ style: '__proto__', palette: 'theme' }), false);
});

test('decoration opt-in is validated, survives old preferences and never changes the default tokens', () => {
  assert.deepEqual(normalizeAppearancePreferences({ style: 'matrix', palette: 'rose', decorations: true }), { style: 'matrix', palette: 'rose', decorations: true });
  assert.deepEqual(normalizeAppearancePreferences({ style: 'origami', palette: 'theme', decorations: false }), { style: 'origami', palette: 'theme', decorations: false });
  assert.deepEqual(normalizeAppearancePreferences({ style: 'matrix', palette: 'theme', decorations: 'true' }), { style: 'matrix', palette: 'theme' });
  assert.equal(isAppearancePreferences({ style: 'matrix', palette: 'theme', decorations: 'true' }), false);
  assert.deepEqual(resolveAppearanceTokens({ style: 'default', palette: 'theme', decorations: true }, 'dark'), {});
  const animated = ['matrix', 'cloud_observation', 'aquarium', 'prism_arcade', 'stained_glass', 'migration', 'heart_monitor', 'origami', 'black_hole', 'lepidoptera', 'world_cup'];
  for (const style of APPEARANCE_STYLES) assert.equal(hasAppearanceDecoration(style), animated.includes(style), style);
});

test('default recommendation emits no overrides and retains the existing native background', () => {
  for (const theme of ['light', 'dark'] as const) {
    assert.deepEqual(resolveAppearanceTokens({ style: 'default', palette: 'theme' }, theme), {});
    assert.deepEqual(resolveAppearanceTokens({ style: 'default', palette: 'default' }, theme), {});
  }
  assert.equal(appearanceChrome('light', 'default').background, '#f5f5f5');
  assert.equal(appearanceChrome('dark', 'default').background, '#050607');
});

test('explicit accent overrides a style recommendation without discarding its surfaces', () => {
  const light = resolveAppearanceTokens({ style: 'catppuccin', palette: 'rose' }, 'light');
  const dark = resolveAppearanceTokens({ style: 'catppuccin', palette: 'rose' }, 'dark');
  assert.equal(light['--background'], '#eff1f5');
  assert.equal(light['--accent'], '#be123c');
  assert.equal(light['--focus'], '#be123c');
  assert.equal(light['--accent-foreground'], '#ffffff');
  assert.equal(dark['--accent'], '#fda4af');
  assert.equal(dark['--accent-foreground'], '#101010');
  const original = resolveAppearanceTokens({ style: 'catppuccin', palette: 'default' }, 'light');
  assert.equal(original['--accent'], undefined, 'the original Sky Blue option still uses the library accent');
  assert.equal(original['--background'], '#eff1f5');
});

test('the full reference catalogue remains selectable alongside the unchanged default', () => {
  const reference = ['classic', 'matrix', 'win95', 'newspaper', 'cloud_observation', 'aquarium', 'prism_arcade', 'stained_glass', 'migration', 'sketchbook', 'heart_monitor', 'origami', 'catppuccin', 'black_hole', 'lepidoptera', 'world_cup'];
  assert.deepEqual(new Set(APPEARANCE_STYLES), new Set(['default', ...reference]));
  for (const style of reference) assert.equal(isAppearancePreferences({ style, palette: 'theme' }), true, style);
});

test('every nondefault style provides distinct readable surfaces and matching native chrome', () => {
  for (const style of APPEARANCE_STYLES.filter(style => style !== 'default')) {
    for (const theme of ['light', 'dark'] as const) {
      const tokens = resolveAppearanceTokens({ style, palette: 'theme' }, theme);
      assert.match(tokens['--background'], /^#[0-9a-f]{6}$/i);
      assert.notEqual(tokens['--background'], tokens['--foreground']);
      assert.equal(tokens['--overlay-foreground'], tokens['--foreground']);
      assert.equal(appearanceChrome(theme, style).background, tokens['--background']);
      assert.notEqual(tokens['--warning'], tokens['--danger']);
    }
  }
});

test('new theme text, muted labels and accent labels retain readable contrast', () => {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const style of APPEARANCE_STYLES.filter(style => style !== 'default')) for (const mode of ['light', 'dark'] as const) {
    const tokens = resolveAppearanceTokens({ style, palette: 'theme' }, mode);
    for (const surface of ['--background', '--surface', '--surface-secondary', '--overlay']) {
      for (const text of ['--foreground', '--muted']) assert.ok(contrast(tokens[surface], tokens[text]) >= 4.5, `${style} ${mode} ${text} on ${surface}`);
    }
    assert.ok(contrast(tokens['--accent'], tokens['--accent-foreground']) >= 4.5, `${style} ${mode} accent`);
  }
});
