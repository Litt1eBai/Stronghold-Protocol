import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { stageAndroidAssets } from '../tools/prepare-android-assets.mjs';

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
    assert.equal(index.totalBytes, 18);
    assert.equal(await fs.readFile(path.join(outputDir, 'preinstalled/assets/audio/test.mp3'), 'utf8'), 'test-audio');
    await assert.rejects(fs.stat(path.join(outputDir, 'stale')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(outputDir, 'preinstalled/js/main.js')), { code: 'ENOENT' });
    await fs.writeFile(manifestFile, JSON.stringify({ missing: '/assets/missing.png' }));
    await assert.rejects(stageAndroidAssets({ publicDir, manifestFile, outputDir }), /Missing 1 static assets/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
