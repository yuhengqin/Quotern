import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TITLEBAR_HEIGHT,
  WINDOW_CONTROLS_OVERLAY_WIDTH,
} from '../shared/window-chrome.js';
import {
  WINDOW_BACKGROUND_COLORS,
  WINDOW_CONTROLS_OVERLAY_COLORS,
  titleBarOverlayFor,
  windowChromeFor,
} from './window-chrome.js';

test('macOS keeps native traffic lights inside the hidden title strip', () => {
  for (const theme of ['light', 'dark'] as const) {
    const options = windowChromeFor('darwin', theme);
    assert.equal(options.frame, true);
    assert.equal(options.titleBarStyle, 'hidden');
    assert.deepEqual(options.trafficLightPosition, { x: 12, y: 10 });
    assert.equal(options.titleBarOverlay, undefined);
  }
});

test('Windows uses titleBarStyle hidden without disabling the frame', () => {
  for (const theme of ['light', 'dark'] as const) {
    const options = windowChromeFor('win32', theme);
    assert.equal(options.titleBarStyle, 'hidden');
    // No `frame: false`: the native caption buttons / system menu must survive.
    assert.notEqual(options.frame, false);
    assert.equal(options.trafficLightPosition, undefined);
    assert.ok(options.titleBarOverlay);
  }
});

test('Windows Window Controls Overlay is TITLEBAR_HEIGHT tall and theme-colored', () => {
  for (const theme of ['light', 'dark'] as const) {
    const overlay = windowChromeFor('win32', theme).titleBarOverlay;
    assert.ok(overlay);
    assert.equal(overlay.height, TITLEBAR_HEIGHT);
    assert.equal(overlay.color, WINDOW_BACKGROUND_COLORS[theme]);
    assert.equal(overlay.symbolColor, WINDOW_CONTROLS_OVERLAY_COLORS[theme].symbolColor);
    // Caption glyphs must contrast with the overlay background.
    assert.notEqual(overlay.symbolColor, overlay.color);
  }
  assert.equal(WINDOW_CONTROLS_OVERLAY_COLORS.light.color, '#f5f5f5');
  assert.equal(WINDOW_CONTROLS_OVERLAY_COLORS.dark.color, '#050607');
});

test('titleBarOverlayFor matches the Windows overlay from windowChromeFor', () => {
  for (const theme of ['light', 'dark'] as const) {
    const overlay = titleBarOverlayFor(theme);
    assert.deepEqual(windowChromeFor('win32', theme).titleBarOverlay, overlay);
    assert.equal(overlay.height, TITLEBAR_HEIGHT);
  }
});

test('Linux stays frameless with renderer-drawn window controls', () => {
  for (const theme of ['light', 'dark'] as const) {
    const options = windowChromeFor('linux', theme);
    assert.equal(options.frame, false);
    assert.equal(options.titleBarStyle, undefined);
    assert.equal(options.titleBarOverlay, undefined);
    assert.equal(options.trafficLightPosition, undefined);
  }
});

test('native overlay is wide enough for three caption buttons', () => {
  assert.ok(WINDOW_CONTROLS_OVERLAY_WIDTH > TITLEBAR_HEIGHT);
  assert.equal(WINDOW_CONTROLS_OVERLAY_WIDTH, 46 * 3);
});
