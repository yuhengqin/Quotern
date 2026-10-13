import { loadConfig, saveConfig, setLastSyncAt } from '../../src/config.js';

const dir = process.argv[2]!;
const operation = process.argv[3]!;
const rounds = Number(process.argv[4] ?? '1');
const { config } = await loadConfig(dir);
process.send?.({ type: 'ready' });

process.once('message', async () => {
  try {
    // Intentionally keep the snapshot obtained before the parent updates settings.
    for (let i = 0; i < rounds; i++) {
      if (operation === 'sync') {
        await setLastSyncAt(dir, config);

      } else {
        config.serverPort = 8452 + i;
        await saveConfig(dir, config);
      }
    }
    process.send?.({ type: 'done' });
  } catch (error) {
    process.exitCode = 1;
    process.send?.({ type: 'error', error: String(error) });
  } finally {
    process.disconnect();
  }
});
