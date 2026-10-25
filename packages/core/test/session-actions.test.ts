import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, win32 } from 'node:path';
import { existingSessionDirectory, findSessionExecutable, nativeSessionActions, sessionTerminalLaunch, windowsResumeScript } from '../src/session-actions.js';
import { formatSessionResumeCommand, sessionResumeCommand } from '../src/session-resume.js';

test('resume commands reject shell syntax, option IDs and prototype property sources', () => {
  assert.deepEqual(sessionResumeCommand('claude', 'safe-id'), { executable: 'claude', args: ['--resume', 'safe-id'] });
  for (const id of ['--help', 's;calc', 's&calc', 's\ncalc', 's%PATH%', 's$(calc)', '', 's x']) assert.equal(sessionResumeCommand('codex', id), null, id);
  for (const source of ['constructor', '__proto__', 'toString', 'dsh']) assert.equal(sessionResumeCommand(source, 'safe'), null, source);
});

test('PI resumes the selected JSONL file and ZCode receives its recorded working directory', () => {
  const resume = sessionResumeCommand as (source: string, id: string, context?: { sessionFile?: string; directory?: string }) => ReturnType<typeof sessionResumeCommand>;
  assert.deepEqual(resume('pi', 'safe-id', { sessionFile: "C:/sessions/project ' &/selected.jsonl" }), { executable: 'pi', args: ['--session', "C:/sessions/project ' &/selected.jsonl"] });
  assert.deepEqual(resume('zcode', 'sess_safe', { directory: 'C:/zcode-project' }), { executable: 'zcode', args: ['--resume', 'sess_safe', '--cwd', 'C:/zcode-project'] });
  assert.equal(resume('pi', 'safe-id'), null);
  assert.equal(resume('pi', 'safe-id', {}), null);
});

test('POSIX copied commands quote literal backslashes in session paths', () => {
  const path = '/tmp/a\\b.jsonl';
  const command = sessionResumeCommand('pi', 'safe-id', { sessionFile: path })!;
  assert.equal(formatSessionResumeCommand(command, 'linux'), `pi --session '${path}'`);
  assert.equal(formatSessionResumeCommand(command, 'darwin'), `pi --session '${path}'`);
});

test('executable discovery skips project-local and relative PATH entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-cli-discovery-'));
  try {
    const project = join(root, 'project'), installed = join(root, 'installed'), projectBin = join(project, 'node_modules', '.bin');
    await mkdir(projectBin, { recursive: true }); await mkdir(installed);
    const suffix = process.platform === 'win32' ? '.cmd' : '';
    await writeFile(join(project, 'codex' + suffix), 'untrusted', { mode: 0o755 });
    await writeFile(join(projectBin, 'codex' + suffix), 'untrusted', { mode: 0o755 });
    await writeFile(join(installed, 'codex' + suffix), 'installed', { mode: 0o755 });
    assert.equal(await findSessionExecutable('codex', project, { PATH: ['.', '', project, installed].join(delimiter) }), join(installed, 'codex' + suffix));
    assert.equal(await findSessionExecutable('codex', project, { PATH: [projectBin, installed].join(delimiter) }), join(installed, 'codex' + suffix));
    assert.equal(await findSessionExecutable('codex', project, { PATH: ['.', '', project].join(delimiter) }), null);
    assert.equal(await existingSessionDirectory('relative/project'), null);
    assert.equal(await existingSessionDirectory(join(project, 'codex' + suffix)), null);
    await assert.rejects(nativeSessionActions.resume(project, { executable: 'quotern-nonexistent-fixture-agent', args: ['resume', 's'] }), /SESSION_CLI_UNAVAILABLE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a PATH executable symlink into the project is not trusted', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-cli-symlink-'));
  try {
    const project = join(root, 'project'), installed = join(root, 'installed');
    await mkdir(project); await mkdir(installed);
    const suffix = process.platform === 'win32' ? '.cmd' : '';
    await writeFile(join(project, 'codex' + suffix), 'untrusted', { mode: 0o755 });
    try { await symlink(join(project, 'codex' + suffix), join(installed, 'codex' + suffix), 'file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('file symlinks require OS permission'); return; } throw error; }
    assert.equal(await findSessionExecutable('codex', project, { PATH: installed }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('macOS and Linux launchers keep directory and argv separate from their static scripts', () => {
  const directory = "/tmp/项目 ' ; $(touch marker)", executable = '/usr/local/bin/codex';
  const mac = sessionTerminalLaunch(directory, executable, ['resume', 'safe-id'], 'darwin');
  assert.equal(mac.executable, '/usr/bin/osascript');
  assert.deepEqual(mac.args.slice(-4), [directory, executable, 'resume', 'safe-id']);
  assert.ok(!mac.args[1]!.includes(directory));
  const linux = sessionTerminalLaunch(directory, executable, ['resume', 'safe-id'], 'linux');
  assert.equal(linux.executable, 'x-terminal-emulator');
  assert.deepEqual(linux.args.slice(-4), [directory, executable, 'resume', 'safe-id']);
  assert.ok(!linux.args[3]!.includes(directory));
});

test('interactive terminals do not inherit the service no-color, CI and dumb-terminal environment', () => {
  const inherited = { TERM: 'dumb', COLORTERM: '', NO_COLOR: '1', FORCE_COLOR: '0', CLICOLOR: '0', CLICOLOR_FORCE: '0', CI: 'true', PATH: 'keep-path', AGENT_CONFIG_HOME: 'keep-agent-config' };
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    const terminal = sessionTerminalLaunch('project', 'codex', ['resume', 'safe-id'], platform, inherited) as ReturnType<typeof sessionTerminalLaunch> & { env?: NodeJS.ProcessEnv };
    assert.equal(terminal.env?.TERM, 'xterm-256color', platform);
    assert.equal(terminal.env?.COLORTERM, 'truecolor', platform);
    for (const key of ['NO_COLOR', 'FORCE_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE', 'CI']) assert.equal(terminal.env?.[key], undefined, `${platform}: ${key}`);
    assert.equal(terminal.env?.PATH, 'keep-path');
    assert.equal(terminal.env?.AGENT_CONFIG_HOME, 'keep-agent-config');
  }
  assert.equal(inherited.TERM, 'dumb');
  assert.equal(inherited.NO_COLOR, '1');
});

test('Windows executes a fixed CLI shim with literal directory and installation paths', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-windows-resume-'));
  try {
    const project = join(root, "项目 ' & $(echo wrong) %QUOTERN_UNSET_TEST%"), installed = join(root, "bin ' & %QUOTERN_UNSET_TEST%");
    await mkdir(project); await mkdir(installed);
    const output = join(root, 'result.json'), recorder = join(root, 'record.cjs'), executable = join(installed, 'codex.cmd');
    await writeFile(recorder, `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));`);
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "${recorder}" %*\r\n`);
    const script = windowsResumeScript(project, executable, ['resume', 'safe-id']);
    const powershell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await promisify(execFile)(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10_000 });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { cwd: project, args: ['resume', 'safe-id'] });
    const sessionFile = join(root, "会话 ' & %QUOTERN_SESSION_ARG_TEST%", 'selected.jsonl');
    const pathArgs = ['--session', sessionFile, 'C:\\NoSpace&Value\\!literal!^value\\session.jsonl', 'D:\\'];
    const piScript = windowsResumeScript(project, executable, pathArgs);
    await promisify(execFile)(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(piScript, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10_000, env: { ...process.env, QUOTERN_SESSION_ARG_TEST: 'must-not-expand' } });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { cwd: project, args: pathArgs });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('copied PI commands preserve a session path with PowerShell metacharacters', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-copy-resume-'));
  try {
    const output = join(root, 'result.json');
    const path = "C:/sessions/项目 ' & $env:PATH `echo/selected.jsonl";
    const command = sessionResumeCommand('pi', 'safe-id', { sessionFile: path })!;
    const script = `function pi { [System.IO.File]::WriteAllText('${output.replace(/'/g, "''")}', (ConvertTo-Json -Compress -InputObject @($args))) }; ${formatSessionResumeCommand(command, 'win32')}`;
    const powershell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await promisify(execFile)(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10_000 });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), ['--session', path]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
