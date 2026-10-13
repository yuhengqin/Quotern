import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectMacArch,
  detectOsFamily,
  fallbackReleasePage,
  fetchDesktopReleaseAssets,
  GITHUB_RELEASES_API,
  hasInstallerAssets,
  matchReleaseAsset,
  pickLatestPublishedRelease,
  resolveDefaultTarget,
  type ReleaseAsset,
} from './downloads.ts';

const assets: ReleaseAsset[] = [
  {
    name: 'Quotern-0.1.1-beta.9-arm64.dmg',
    browser_download_url: 'https://example.test/arm64.dmg',
  },
  {
    name: 'Quotern-0.1.1-beta.9-arm64.dmg.blockmap',
    browser_download_url: 'https://example.test/arm64.blockmap',
  },
  {
    name: 'Quotern-0.1.1-beta.9-x64.dmg',
    browser_download_url: 'https://example.test/x64.dmg',
  },
  {
    name: 'Quotern Setup 0.1.1-beta.9.exe',
    browser_download_url: 'https://example.test/setup.exe',
  },
  {
    name: 'Quotern 0.1.1-beta.9.exe',
    browser_download_url: 'https://example.test/portable.exe',
  },
  {
    name: 'latest.yml',
    browser_download_url: 'https://example.test/latest.yml',
  },
];

describe('detectOsFamily', () => {
  it('detects Windows from UA and platform strings', () => {
    assert.equal(
      detectOsFamily(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Win32',
      ),
      'windows',
    );
  });

  it('detects macOS from Macintosh UA', () => {
    assert.equal(
      detectOsFamily(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'MacIntel',
      ),
      'macos',
    );
  });

  it('treats iPad as macOS for desktop download targeting', () => {
    assert.equal(
      detectOsFamily('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'),
      'macos',
    );
  });

  it('returns other for Linux', () => {
    assert.equal(
      detectOsFamily('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'),
      'other',
    );
  });
});

describe('detectMacArch / resolveDefaultTarget', () => {
  it('uses Intel UA as x64 and selects the Intel build', () => {
    assert.equal(
      detectMacArch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
      'x64',
    );
    assert.equal(resolveDefaultTarget('macos', 'x64'), 'macos-intel');
  });

  it('uses UA-CH architecture for Apple Silicon', () => {
    assert.equal(detectMacArch('Macintosh', 'arm'), 'arm');
    assert.equal(resolveDefaultTarget('macos', 'arm'), 'macos-arm');
  });

  it('defaults unknown Mac / other OS to Apple Silicon', () => {
    assert.equal(detectMacArch('Macintosh'), 'unknown');
    assert.equal(resolveDefaultTarget('macos', 'unknown'), 'macos-arm');
    assert.equal(resolveDefaultTarget('other'), 'macos-arm');
  });

  it('selects Windows regardless of Mac arch', () => {
    assert.equal(resolveDefaultTarget('windows', 'arm'), 'windows');
  });
});

describe('release asset matching', () => {
  it('skips drafts when picking the latest published release', () => {
    const latest = pickLatestPublishedRelease([
      { draft: true, tag_name: 'v9' },
      { draft: false, tag_name: 'v8' },
    ]);
    assert.equal(latest?.tag_name, 'v8');
  });

  it('picks the highest semver tag even when the list is unordered', () => {
    const latest = pickLatestPublishedRelease([
      { tag_name: 'v0.1.0' },
      { tag_name: 'v0.1.6' },
      { tag_name: 'v0.1.5' },
    ]);
    assert.equal(latest?.tag_name, 'v0.1.6');
  });

  it('prefers a newer tag over an older one listed first', () => {
    const latest = pickLatestPublishedRelease([
      {
        tag_name: 'v0.1.3',
        created_at: '2026-08-31T12:00:00Z',
      },
      {
        tag_name: 'v0.1.6',
        created_at: '2026-08-28T00:00:00Z',
      },
    ]);
    assert.equal(latest?.tag_name, 'v0.1.6');
  });

  it('breaks equal tags with the later created_at', () => {
    const latest = pickLatestPublishedRelease([
      {
        tag_name: 'v0.1.6',
        created_at: '2026-08-28T00:00:00Z',
      },
      {
        tag_name: 'v0.1.6',
        created_at: '2026-08-29T00:00:00Z',
      },
    ]);
    assert.equal(latest?.created_at, '2026-08-29T00:00:00Z');
  });

  it('prefers a stable tag over an earlier prerelease of the same version', () => {
    const latest = pickLatestPublishedRelease([
      { tag_name: 'v0.1.1-beta.12' },
      { tag_name: 'v0.1.1' },
    ]);
    assert.equal(latest?.tag_name, 'v0.1.1');
  });

  it('prefers NSIS Setup exe and architecture-specific DMGs', () => {
    assert.equal(
      matchReleaseAsset(assets, 'windows'),
      'https://example.test/setup.exe',
    );
    assert.equal(
      matchReleaseAsset(assets, 'macos-arm'),
      'https://example.test/arm64.dmg',
    );
    assert.equal(
      matchReleaseAsset(assets, 'macos-intel'),
      'https://example.test/x64.dmg',
    );
  });

  it('falls back to a generic dmg when x64 is missing', () => {
    assert.equal(
      matchReleaseAsset(
        [
          {
            name: 'Quotern-1.0.0.dmg',
            browser_download_url: 'https://example.test/generic.dmg',
          },
        ],
        'macos-intel',
      ),
      'https://example.test/generic.dmg',
    );
  });

  it('matches dotted installer names', () => {
    const dottedAssets: ReleaseAsset[] = [
      {
        name: 'Quotern.App-0.1.1-beta.12-arm64.dmg',
        browser_download_url: 'https://example.test/arm64.dmg',
      },
      {
        name: 'Quotern.App-0.1.1-beta.12.dmg',
        browser_download_url: 'https://example.test/intel.dmg',
      },
      {
        name: 'Quotern.App.Setup.0.1.1-beta.12.exe',
        browser_download_url: 'https://example.test/setup.exe',
      },
      {
        name: 'Quotern.App.0.1.1-beta.12.exe',
        browser_download_url: 'https://example.test/portable.exe',
      },
    ];
    assert.equal(matchReleaseAsset(dottedAssets, 'macos-arm'), 'https://example.test/arm64.dmg');
    assert.equal(matchReleaseAsset(dottedAssets, 'macos-intel'), 'https://example.test/intel.dmg');
    assert.equal(matchReleaseAsset(dottedAssets, 'windows'), 'https://example.test/setup.exe');
  });
});

describe('GitHub release downloads', () => {
  it('uses the new repository for the fallback even before fetching', () => {
    assert.equal(fallbackReleasePage(), 'https://github.com/yuhengqin/Quotern/releases');
  });

  it('fetches installers only from the configured GitHub repository', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
      { draft: true, tag_name: 'v9.0.0', assets },
      { tag_name: 'v1.0.0', assets },
    ])));
    const release = await fetchDesktopReleaseAssets();
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(fetchMock.mock.calls[0].arguments[0], GITHUB_RELEASES_API);
    assert.equal(GITHUB_RELEASES_API, 'https://api.github.com/repos/yuhengqin/Quotern/releases?per_page=20');
    assert.equal(release.tagName, 'v1.0.0');
    assert.deepEqual(release.assets, assets);
  });

  it('rejects a release containing only update metadata', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
      { tag_name: 'v1.0.0', assets: [{ name: 'latest.yml', browser_download_url: 'https://example.test/latest.yml' }] },
    ])));
    assert.equal(hasInstallerAssets([{ name: 'latest.yml', browser_download_url: 'https://example.test/latest.yml' }]), false);
    await assert.rejects(fetchDesktopReleaseAssets(), /No published desktop release/);
  });

  it('reports an inaccessible repository without trying another host', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
    await assert.rejects(fetchDesktopReleaseAssets(), /github releases 404/);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});
