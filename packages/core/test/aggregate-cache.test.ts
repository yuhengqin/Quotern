import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AggregateCache, touchedLocalDates } from '../src/aggregate-cache.js';
import {
  BucketStore,
  createAggregateCache,
  createApplyAfterSync,
} from '../src/server/state.js';
import type { SyncResult } from '../src/sync/index.js';
import { addLocalDays, localDateNow } from '../src/timezone.js';
import type { QueueBucket } from '../src/types.js';

function makeRow(
  hourStart: string,
  totalTokens: number,
  source = 'codex',
  model = 'gpt-5',
  project = 'ai-usage',
): QueueBucket {
  return {
    hour_start: hourStart,
    source,
    model,
    project,
    input_tokens: totalTokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
    conversation_count: 1,
  };
}

test('touchedLocalDates collects unique local dates', () => {
  const today = localDateNow();
  const yesterday = addLocalDays(today, -1);
  const dates = touchedLocalDates([
    makeRow(`${yesterday}T02:00:00.000Z`, 10),
    makeRow(`${yesterday}T08:00:00.000Z`, 20),
  ]);
  assert.ok(dates.length >= 1);
});

test('AggregateCache seals history and serves daily without rescanning today-only changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-agg-cache-'));
  try {
    const today = localDateNow();
    const yesterday = addLocalDays(today, -1);
    const twoDaysAgo = addLocalDays(today, -2);

    const rows = [
      makeRow(`${twoDaysAgo}T04:00:00.000Z`, 100),
      makeRow(`${yesterday}T04:00:00.000Z`, 200),
      makeRow(`${today}T04:00:00.000Z`, 50),
    ];

    const cache = new AggregateCache(dir);
    await cache.rebuildFromRows(rows);
    assert.ok(cache.sealedDayCount() >= 1);

    const daily = cache.getDaily(rows, 30, '1970-01-01T00:00:00.000Z');
    const dates = daily.days.map((d) => d.date);
    assert.ok(dates.includes(yesterday) || dates.includes(twoDaysAgo));
    assert.ok(dates.includes(today));

    const before = cache.sealedDayCount();
    // Today-only apply must not grow sealed history.
    await cache.onBucketsChanged(rows, [
      makeRow(`${today}T06:00:00.000Z`, 75),
    ]);
    assert.equal(cache.sealedDayCount(), before);

    const raw = await readFile(join(dir, 'cache', 'daily-sealed.json'), 'utf8');
    assert.ok(raw.includes('"version":7'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AggregateCache reseals only touched historical dates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-agg-reseal-'));
  try {
    const today = localDateNow();
    const yesterday = addLocalDays(today, -1);

    const rows = [makeRow(`${yesterday}T04:00:00.000Z`, 100)];
    const cache = new AggregateCache(dir);
    await cache.rebuildFromRows(rows);

    const updated = [makeRow(`${yesterday}T04:00:00.000Z`, 999)];
    await cache.onBucketsChanged(updated, updated);

    const daily = cache.getDaily(updated, 7, '1970-01-01T00:00:00.000Z');
    const y = daily.days.find((d) => d.date === yesterday);
    assert.ok(y);
    assert.equal(y.tokens, 999);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('startup repairs a historical day missing from a nonempty sealed cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-agg-startup-gap-'));
  try {
    const today = localDateNow();
    const twoDaysAgo = addLocalDays(today, -2);
    const missingDay = addLocalDays(today, -3);
    const existing = makeRow(`${twoDaysAgo}T04:00:00.000Z`, 100);
    const missing = makeRow(`${missingDay}T04:00:00.000Z`, 200);

    await new AggregateCache(dir).rebuildFromRows([existing]);
    const cache = await createAggregateCache(dir, [existing, missing]);
    const daily = cache.getDaily([existing, missing], 7, '1970-01-01T00:00:00.000Z');
    assert.equal(daily.days.find((day) => day.date === missingDay)?.tokens, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resuming after several days seals every recorded day in the gap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-agg-multi-day-gap-'));
  try {
    const today = localDateNow();
    const firstDay = addLocalDays(today, -5);
    const missedDays = [addLocalDays(today, -4), addLocalDays(today, -2)];
    const first = makeRow(`${firstDay}T04:00:00.000Z`, 100);
    const missed = missedDays.map((date, index) =>
      makeRow(`${date}T04:00:00.000Z`, (index + 2) * 100),
    );
    await new AggregateCache(dir).rebuildFromRows([first]);

    const path = join(dir, 'cache', 'daily-sealed.json');
    const saved = JSON.parse(await readFile(path, 'utf8')) as { sealedAsOf: string };
    saved.sealedAsOf = firstDay;
    await writeFile(path, JSON.stringify(saved));

    const cache = new AggregateCache(dir);
    await cache.onBucketsChanged([first, ...missed]);
    const daily = cache.getDaily([first, ...missed], 7, '1970-01-01T00:00:00.000Z');
    for (const [index, date] of missedDays.entries()) {
      assert.equal(daily.days.find((day) => day.date === date)?.tokens, (index + 2) * 100);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AggregateCache merge keeps 8-decimal costs so two 4.516 days do not become 9.04', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-agg-cost-'));
  try {
    const today = localDateNow();
    const yesterday = addLocalDays(today, -1);
    const twoDaysAgo = addLocalDays(today, -2);

    const rows: QueueBucket[] = [
      {
        hour_start: `${twoDaysAgo}T04:00:00.000Z`,
        source: 'cursor',
        model: 'composer-1',
        project: 'ai-usage',
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1,
        conversation_count: 1,
        reported_cost_usd: 4.516,
      },
      {
        hour_start: `${yesterday}T04:00:00.000Z`,
        source: 'cursor',
        model: 'composer-1',
        project: 'ai-usage',
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1,
        conversation_count: 1,
        reported_cost_usd: 4.516,
      },
    ];

    const cache = new AggregateCache(dir);
    await cache.rebuildFromRows(rows);
    const breakdown = cache.getModelBreakdown(
      rows,
      30,
      '1970-01-01T00:00:00.000Z',
    );
    assert.equal(breakdown.models.length, 1);
    assert.equal(breakdown.models[0]?.costUsd, 9.032);
    assert.notEqual(breakdown.models[0]?.costUsd, 9.04);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function emptySyncResult(): SyncResult {
  return {
    source: 'codex',
    eventsParsed: 0,
    filesProcessed: 0,
    bucketsWritten: 0,
    writtenBuckets: [],
  };
}

test('empty sync seals every unsealed day after the calendar rolls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-agg-empty-seal-'));
  try {
    const today = localDateNow();
    const yesterday = addLocalDays(today, -1);
    const twoDaysAgo = addLocalDays(today, -2);
    const fourDaysAgo = addLocalDays(today, -4);
    const fiveDaysAgo = addLocalDays(today, -5);
    const rows = [
      makeRow(`${fiveDaysAgo}T04:00:00.000Z`, 50),
      makeRow(`${fourDaysAgo}T04:00:00.000Z`, 80),
      makeRow(`${twoDaysAgo}T04:00:00.000Z`, 120),
      makeRow(`${yesterday}T04:00:00.000Z`, 200),
    ];

    await new AggregateCache(dir).rebuildFromRows(rows);
    const path = join(dir, 'cache', 'daily-sealed.json');
    const saved = JSON.parse(await readFile(path, 'utf8')) as {
      sealedAsOf: string;
      days: Record<string, unknown>;
    };
    // Last seal ran while fourDaysAgo was still "today", then the process
    // stayed up with no new buckets.
    saved.sealedAsOf = fourDaysAgo;
    delete saved.days[fourDaysAgo];
    delete saved.days[twoDaysAgo];
    delete saved.days[yesterday];
    await writeFile(path, JSON.stringify(saved));

    const cache = new AggregateCache(dir);
    await cache.ensureLoaded();
    const store = new BucketStore();
    store.apply(rows);
    const before = cache.getDaily(store.getRows(), 7, '1970-01-01T00:00:00.000Z');
    assert.equal(before.days.find((day) => day.date === fiveDaysAgo)?.tokens, 50);
    assert.equal(before.days.find((day) => day.date === fourDaysAgo), undefined);
    assert.equal(before.days.find((day) => day.date === yesterday), undefined);

    const apply = createApplyAfterSync({
      getBucketStore: () => store,
      getAggregateCache: () => cache,
    });
    await apply([emptySyncResult()]);

    const after = cache.getDaily(store.getRows(), 7, '1970-01-01T00:00:00.000Z');
    assert.equal(after.days.find((day) => day.date === fiveDaysAgo)?.tokens, 50);
    assert.equal(after.days.find((day) => day.date === fourDaysAgo)?.tokens, 80);
    assert.equal(after.days.find((day) => day.date === twoDaysAgo)?.tokens, 120);
    assert.equal(after.days.find((day) => day.date === yesterday)?.tokens, 200);
    assert.equal(cache.needsCalendarSeal(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('empty sync leaves days already sealed through today in place', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-agg-empty-noop-'));
  try {
    const today = localDateNow();
    const yesterday = addLocalDays(today, -1);
    const rows = [makeRow(`${yesterday}T04:00:00.000Z`, 200)];
    const cache = new AggregateCache(dir);
    await cache.rebuildFromRows(rows);
    const sealed = cache.sealedDayCount();
    const store = new BucketStore();
    store.apply(rows);

    const apply = createApplyAfterSync({
      getBucketStore: () => store,
      getAggregateCache: () => cache,
    });
    await apply([emptySyncResult()]);

    const daily = cache.getDaily(store.getRows(), 7, '1970-01-01T00:00:00.000Z');
    assert.equal(cache.sealedDayCount(), sealed);
    assert.equal(daily.days.find((day) => day.date === yesterday)?.tokens, 200);
    assert.equal(cache.needsCalendarSeal(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
