import { createLocalApiApp } from '../../src/server/local-api.js';
import { BucketStore } from '../../src/server/state.js';
const app = createLocalApiApp({ dataDir: process.argv[2], getConfig: () => { throw new Error('unused config'); }, bucketStore: new BucketStore() });
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const response = await app.request('/functions/tud-share-backgrounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'add', input: { name: process.argv[3], image } }) });
process.send?.(response.status);
