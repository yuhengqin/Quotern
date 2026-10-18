import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(path.join(root, 'UPSTREAM.json'), 'utf8'));
let bytes = 0;
const videos = manifest.files.filter(file => /^assets\/webm\/.+\.webm$/.test(file.path));
for (const file of videos) { const data = await readFile(path.join(root, file.path)); assert.equal(data.length, file.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256, file.path); bytes += data.length; }
const visit = async directory => { for (const file of await readdir(directory, { withFileTypes: true })) { assert.equal(file.isSymbolicLink(), false); const target = path.join(directory, file.name); if (file.isDirectory()) await visit(target); else assert.doesNotMatch(path.relative(root, target), /\.gif$|\.ttf$|(^|[\\/])(reference|models\.json|memory\.json|preferences\.json|main-config\.jsonc)([\\/]|$)/i); } };
await visit(root);
for (const file of ['LICENSE', 'MEDIA-LICENSE.md', 'PATCHES.md', 'runtime/main.js', 'runtime/shared-core.js', 'runtime/quotern-adapter.cjs', 'host.cjs']) assert.ok((await readFile(path.join(root, file))).length);
assert.equal(videos.length, 106); assert.equal(bytes, 54351332);
console.log(JSON.stringify({ ok: true, videos: videos.length, bytes, excludedPrivateStateAndFonts: true }));
