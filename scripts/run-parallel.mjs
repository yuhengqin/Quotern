#!/usr/bin/env node
/**
 * Run multiple root package.json scripts in parallel.
 * pnpm `run --parallel a b` treats `b` as argv to `a`; this avoids that.
 *
 * Usage: node scripts/run-parallel.mjs dev:cli:api dev:cli:ui
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = process.argv.slice(2);

if (scripts.length === 0) {
  console.error('usage: node scripts/run-parallel.mjs <script> [script...]');
  process.exit(1);
}

const children = scripts.map((name) =>
  spawn('pnpm', ['-w', 'run', name], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  }),
);

let shuttingDown = false;

function shutdown(signal = 'SIGINT') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal) return;
    if (code !== 0) {
      shutdown('SIGTERM');
      process.exit(code ?? 1);
    }
  });
}
