import assert from 'node:assert/strict';
import test from 'node:test';
import { restrictWindowsUpdateFiles } from './windows-update-files.js';

// Exercise the locked updater's actual private-asset resolver and NSIS selection function offline.
const { PrivateGitHubProvider } = require('electron-updater/out/providers/PrivateGitHubProvider');
const { findFile } = require('electron-updater/out/providers/Provider');
const provider = new PrivateGitHubProvider({ owner: 'fixture', repo: 'fixture' }, {}, 'fixture-token', { platform: 'win32', executor: {} });
const filenames = ['x64', 'arm64'].map(arch => `Quotern-0.1.14-win-${arch}-setup.exe`);
function metadata() {
  return {
    version: '0.1.14',
    files: filenames.map(url => ({ url, sha512: 'fixture-sha512' })),
    assets: filenames.map((name, index) => ({ name, url: `https://api.github.com/repos/fixture/fixture/releases/assets/${index + 1}` })),
  };
}

test('private GitHub API download URLs select the requested Windows installer architecture', () => {
  // Unfiltered API URLs have no .exe suffix, so the updater falls back to the first file.
  assert.equal(findFile(provider.resolveFiles(metadata()), 'exe').info.url, filenames[0]);
  for (const arch of ['x64', 'arm64']) {
    const info = metadata();
    restrictWindowsUpdateFiles(info, arch);
    const selected = findFile(provider.resolveFiles(info), 'exe');
    assert.equal(selected.info.url, `Quotern-0.1.14-win-${arch}-setup.exe`);
    assert.equal(info.files.length, 1);
  }
});

test('a missing target architecture fails instead of falling back to a different CPU', () => {
  const info = metadata();
  info.files = info.files.slice(0, 1);
  assert.throws(() => restrictWindowsUpdateFiles(info, 'arm64'), /arm64/);
});

test('legacy installers without architecture names retain their original metadata', () => {
  const info = { files: [{ url: 'Quotern Setup 0.1.12.exe', sha512: 'legacy' }] };
  const original = info.files;
  restrictWindowsUpdateFiles(info, 'x64');
  assert.equal(info.files, original);
});
