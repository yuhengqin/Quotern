import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBillingTransport } from './billing-transport';
test('billing transport returns headers without pre-buffering the body before Core limits run', async () => {
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array(1024)); } }, { highWaterMark: 0 });
  const response = new Response(stream);
  const fetch = createBillingTransport({ fetch: async () => response });
  const result = await fetch('https://api.openai.com/v1/organization/costs', {});
  assert.equal(reads, 0); assert.equal(result, response);
  await result.body!.cancel();
});
