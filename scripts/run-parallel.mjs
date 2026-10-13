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
// Lifecycle scripts receive pnpm's JS entry. Launch it with Node so Windows
// does not need to execute the pnpm.cmd shim (which spawn cannot run directly).
const pnpmEntry = process.env.npm_execpath;
const command = pnpmEntry ? process.execPath : 'pnpm';
const commandArgs = pnpmEntry ? [pnpmEntry, '-w', 'run'] : ['-w', 'run'];

if (scripts.length === 0) {
  console.error('usage: node scripts/run-parallel.mjs <script> [script...]');
  process.exit(1);
}

const children = scripts.map((name) =>
  spawn(command, [...commandArgs, name], {
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

for (const [index, child] of children.entries()) {
  child.on('error', (err) => {
    console.error(`Failed to start ${scripts[index]}: ${err.message}`);
    shutdown('SIGTERM');
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal) return;
    if (code !== 0) {
      shutdown('SIGTERM');
      process.exitCode = code ?? 1;
    }
  });
}
