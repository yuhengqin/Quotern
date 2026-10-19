// Keep the helper branch free of normal Quotern startup (single-instance lock, collectors, updates).
import { app } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

if (process.argv.includes('--quotern-dsh-pet-helper')) {
  const directory = process.env.QUOTERN_DSH_USER_DATA;
  if (!directory || !path.isAbsolute(directory)) app.exit(2);
  else {
    mkdirSync(directory, { recursive: true });
    app.setPath('userData', directory); app.setPath('sessionData', path.join(directory, 'session'));
    const runtime = app.isPackaged ? path.join(process.resourcesPath, 'dsh-pet/runtime') : path.join(__dirname, '../dsh-pet/runtime');
    createRequire(__filename)(path.join(runtime, 'main.js'));
  }
} else {
  createRequire(__filename)('./index.js');
}
