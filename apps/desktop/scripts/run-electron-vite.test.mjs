import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const launcher = new URL('./run-electron-vite.mjs', import.meta.url).href;
function run(source, args = [], options = {}) {
  const entry = `import { runWithUtf8Output } from ${JSON.stringify(launcher)};
    process.exitCode = await runWithUtf8Output(process.execPath, ${JSON.stringify(['-e', source, ...args])});`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', entry], { encoding: 'utf8', timeout: 10_000, ...options });
}

test('relays split UTF-8 bytes without mixing stdout and stderr', () => {
  const result = run(`
    const output = Buffer.from('服务商配置无效…\\n');
    const error = Buffer.from('中文错误：请检查配置\\n');
    let index = 0;
    function write() {
      if (index < output.length) {
        process.stdout.write(output.subarray(index, ++index));
        setTimeout(write, 1);
      } else process.stderr.write(error);
    }
    write();
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '服务商配置无效…\n');
  assert.equal(result.stderr, '中文错误：请检查配置\n');
});

test('preserves arguments, environment, working directory and stdin', () => {
  const result = run(`
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', value => input += value);
    process.stdin.on('end', () => console.log(JSON.stringify({
      args: process.argv.slice(1), value: process.env.QUOTERN_LOG_TEST,
      cwd: process.cwd(), input,
    })));
  `, ['with spaces', '中文'], { input: '输入内容', env: { ...process.env, QUOTERN_LOG_TEST: 'utf8' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['with spaces', '中文'], value: 'utf8', cwd: process.cwd(), input: '输入内容' });
});

test('preserves the child exit code after flushing its output', () => {
  const result = run("process.stdout.write('退出前日志'); process.stderr.write('失败原因'); process.exitCode = 23;");
  assert.equal(result.status, 23);
  assert.equal(result.stdout, '退出前日志');
  assert.equal(result.stderr, '失败原因');
});

test('drains both output pipes when logs exceed their buffer capacity', () => {
  const result = run("const value = '中文日志…'.repeat(16384); process.stdout.write(value); process.stderr.write(value); process.exitCode = 17;");
  assert.equal(result.status, 17);
  assert.equal(result.stdout, '中文日志…'.repeat(16384));
  assert.equal(result.stderr, '中文日志…'.repeat(16384));
});
