import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeDecorationVisibility } from './appearance-motion.ts';

class Page extends EventTarget {
  hidden = false;
  hide(value: boolean) { this.hidden = value; this.dispatchEvent(new Event('visibilitychange')); }
}
class Motion extends EventTarget {
  matches = false;
  reduce(value: boolean) { this.matches = value; this.dispatchEvent(new Event('change')); }
}

test('decoration visibility follows live reduced motion and page visibility with complete cleanup', () => {
  const page = new Page(), motion = new Motion(), values: boolean[] = [];
  const dispose = observeDecorationVisibility({ page, motion }, value => values.push(value));
  assert.equal(values.at(-1), true);
  motion.reduce(true); assert.equal(values.at(-1), false);
  page.hide(true); motion.reduce(false); assert.equal(values.at(-1), false);
  page.hide(false); assert.equal(values.at(-1), true);
  dispose(); const length = values.length;
  page.hide(true); motion.reduce(true); assert.equal(values.length, length);
});

test('native initial hidden windows stay idle even when the document is visible; late events cannot revive disposed observers', () => {
  const page = new Page(), motion = new Motion(), values: boolean[] = [];
  let publish: (value: boolean) => void = () => {}, unsubscribed = 0;
  const dispose = observeDecorationVisibility({ page, motion, native: callback => { publish = callback; return () => { unsubscribed++; }; } }, value => values.push(value));
  assert.equal(values.at(-1), false);
  publish(false); assert.equal(values.at(-1), false);
  publish(true); assert.equal(values.at(-1), true);
  page.hide(true); publish(true); assert.equal(values.at(-1), false);
  page.hide(false); publish(false); assert.equal(values.at(-1), false);
  dispose(); dispose(); const length = values.length;
  publish(true); page.hide(false); motion.reduce(false);
  assert.equal(values.length, length);
  assert.equal(unsubscribed, 1);
});
