import assert from 'node:assert/strict';
import test from 'node:test';

import { createPollBackoff } from '../src/sync/poll-backoff.js';

const LADDER = [60_000, 120_000, 300_000];

test('poll backoff escalates after consecutive empty rounds and caps at the ladder top', () => {
  const backoff = createPollBackoff(LADDER, 3);

  assert.equal(backoff.currentDelayMs(), 60_000);
  assert.equal(backoff.noteRound(false), 60_000);
  assert.equal(backoff.noteRound(false), 60_000);
  // 3rd consecutive empty round → escalate to 2min.
  assert.equal(backoff.noteRound(false), 120_000);
  assert.equal(backoff.noteRound(false), 120_000);
  assert.equal(backoff.noteRound(false), 120_000);
  // 3 empty rounds at 2min → escalate to 5min cap.
  assert.equal(backoff.noteRound(false), 300_000);
  // Stays capped no matter how many empty rounds follow.
  for (let i = 0; i < 10; i++) {
    assert.equal(backoff.noteRound(false), 300_000);
  }
});

test('poll backoff snaps back to the fastest interval when a round writes data', () => {
  const backoff = createPollBackoff(LADDER, 3);
  for (let i = 0; i < 6; i++) backoff.noteRound(false);
  assert.equal(backoff.currentDelayMs(), 300_000);

  assert.equal(backoff.noteRound(true), 60_000);
  assert.equal(backoff.currentDelayMs(), 60_000);
  // Escalation counter restarts from zero after activity.
  assert.equal(backoff.noteRound(false), 60_000);
  assert.equal(backoff.noteRound(false), 60_000);
  assert.equal(backoff.noteRound(false), 120_000);
});

test('poll backoff reset() restores the fastest interval without a round', () => {
  const backoff = createPollBackoff(LADDER, 3);
  for (let i = 0; i < 3; i++) backoff.noteRound(false);
  assert.equal(backoff.currentDelayMs(), 120_000);

  backoff.reset();
  assert.equal(backoff.currentDelayMs(), 60_000);
  assert.equal(backoff.noteRound(false), 60_000);
});

test('poll backoff uses default ladder constants', () => {
  const backoff = createPollBackoff();
  assert.equal(backoff.currentDelayMs(), 60_000);
  for (let i = 0; i < 3; i++) backoff.noteRound(false);
  assert.equal(backoff.currentDelayMs(), 120_000);
});
