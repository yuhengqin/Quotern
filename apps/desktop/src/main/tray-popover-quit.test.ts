import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  isTrayPopoverQuitting,
  markTrayPopoverQuitting,
  resetTrayPopoverQuitting,
  shouldTrayPopoverPreventClose,
} from './tray-popover-quit-state.js';

beforeEach(() => {
  resetTrayPopoverQuitting();
});

afterEach(() => {
  resetTrayPopoverQuitting();
});

test('popover close is hidden instead of destroyed while app keeps running', () => {
  assert.equal(isTrayPopoverQuitting(), false);
  assert.equal(shouldTrayPopoverPreventClose(), true);
});

test('markTrayPopoverQuitting lets popover close during app exit', () => {
  markTrayPopoverQuitting();
  assert.equal(isTrayPopoverQuitting(), true);
  assert.equal(shouldTrayPopoverPreventClose(), false);
});

test('resetTrayPopoverQuitting restores hide-on-close after a cancelled exit', () => {
  markTrayPopoverQuitting();
  resetTrayPopoverQuitting();
  assert.equal(isTrayPopoverQuitting(), false);
  assert.equal(shouldTrayPopoverPreventClose(), true);
});
