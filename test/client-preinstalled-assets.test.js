import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { stageAndroidAssets } from '../tools/prepare-android-assets.mjs';
import { createAssetIndex } from '../server/http/assetIndex.js';
import { rewriteManifest } from '../server/http/assetViews.js';
import { splitHashedPath } from '../shared/assetPaths.js';

test('staging includes static files with exact hashes, removes stale output and excludes account/web code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-preinstalled-'));
  try {
    const publicDir = path.join(root, 'public'), outputDir = path.join(root, 'build');
    for (const folder of ['assets/audio', 'fonts', 'js']) await fs.mkdir(path.join(publicDir, folder), { recursive: true });
    await fs.writeFile(path.join(publicDir, 'assets/audio/test.mp3'), 'test-audio');
    await fs.writeFile(path.join(publicDir, 'fonts/fonts.css'), 'font-css');
    await fs.writeFile(path.join(publicDir, 'js/main.js'), 'web-account-code');
    const manifestFile = path.join(root, 'assets.json');
    await fs.writeFile(manifestFile, JSON.stringify({ audio: '/assets/audio/test.mp3', fonts: '/fonts/fonts.css' }));
    await fs.mkdir(outputDir);
    await fs.writeFile(path.join(outputDir, 'stale'), 'old');
    const index = await stageAndroidAssets({ publicDir, manifestFile, outputDir });
    assert.equal(index.files.length, 2);
    const audio = index.files.find(file => file.url.endsWith('.mp3'));
    assert.equal(audio.mime, 'audio/mpeg');
    assert.equal(audio.sha256, crypto.createHash('sha256').update('test-audio').digest('hex'));
    assert.deepEqual(audio.urlHashes, [audio.sha256.slice(0, 16)]);
    assert.equal(index.totalBytes, 18);
    assert.equal(await fs.readFile(path.join(outputDir, 'preinstalled/assets/audio/test.mp3'), 'utf8'), 'test-audio');
    await assert.rejects(fs.stat(path.join(outputDir, 'stale')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(outputDir, 'preinstalled/js/main.js')), { code: 'ENOENT' });
    await fs.writeFile(manifestFile, JSON.stringify({ missing: '/assets/missing.png' }));
    await assert.rejects(stageAndroidAssets({ publicDir, manifestFile, outputDir }), /Missing 1 static assets/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('packaged URL hashes match the served manifest and invalidate every Spine member when one changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-packaged-hashes-'));
  const publicDir = path.join(root, 'public');
  const index = createAssetIndex({ publicDir, delayMs: 0 });
  try {
    await fs.mkdir(path.join(publicDir, 'assets/model'), { recursive: true });
    await fs.mkdir(path.join(publicDir, 'fonts'));
    for (const name of ['test.skel', 'test.atlas', 'test.png']) {
      await fs.writeFile(path.join(publicDir, 'assets/model', name), name);
    }
    await fs.writeFile(path.join(publicDir, 'fonts/test.woff2'), 'font');
    const model = { skel: '/assets/model/test.skel', atlas: '/assets/model/test.atlas', textures: ['/assets/model/test.png'] };
    const manifest = { model, font: '/fonts/test.woff2' };
    const local = { groups: { 'spine/test': { skeleton: { path: model.skel }, atlas: { path: model.atlas } } } };
    const manifestFile = path.join(root, 'assets.json'), outputDir = path.join(root, 'build');
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await fs.writeFile(path.join(root, 'local-assets.json'), JSON.stringify(local));
    const staged = await stageAndroidAssets({ publicDir, manifestFile, outputDir });
    const inventory = new Map(staged.files.map(file => [file.url, file]));
    await index.refresh();
    const served = rewriteManifest(manifest, 'assets.json', index).doc;
    const localServed = rewriteManifest(local, 'local-assets.json', index).doc;
    for (const url of [served.model.skel, served.model.atlas, ...served.model.textures, served.font,
      localServed.groups['spine/test'].skeleton.path, localServed.groups['spine/test'].atlas.path]) {
      const { path: plain, hash } = splitHashedPath(url);
      assert.ok(hash && inventory.get(plain).urlHashes.includes(hash), url);
    }
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'preinstalled/index.json'), 'utf8')).files, staged.files);
    await fs.writeFile(path.join(publicDir, 'assets/model/test.png'), 'updated texture');
    await index.refresh();
    const updated = rewriteManifest(manifest, 'assets.json', index).doc;
    for (const url of [updated.model.skel, updated.model.atlas, ...updated.model.textures]) {
      const { path: plain, hash } = splitHashedPath(url);
      assert.equal(inventory.get(plain).urlHashes.includes(hash), false, 'changed models must use the server');
    }
  } finally { index.close(); await fs.rm(root, { recursive: true, force: true }); }
});
