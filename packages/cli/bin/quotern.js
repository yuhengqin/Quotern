#!/usr/bin/env node
if (process.argv[2] === 'service' && process.argv[3] === 'start') {
  process.stdout.write('正在等待检测进程与面板 /health …\n');
}
if (process.argv[2] === 'prompt') await (await import('../dist/prompt-entry.js')).runPromptEntry();
else await import('../dist/index.js');
