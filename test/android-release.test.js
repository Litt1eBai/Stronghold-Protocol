import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { androidRelease } from '../tools/android-release.mjs';

test('Android announcement hashes the final bytes and keeps native version independent of game version', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-android-release-'));
  try {
    const apk = path.join(dir, 'release.apk');
    await writeFile(apk, 'abc');
    const input = { apk, url: 'https://downloads.example/app.apk', applicationId: 'com.strongholdprotocol.client',
      versionCode: 1013, versionName: '0.2.4', notes: '更新说明' };
    const release = await androidRelease(input);
    assert.equal(release.size, 3);
    assert.equal(release.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(release.format, 1);
    assert.equal(release.versionCode, 1013);
    assert.equal(release.notes, '更新说明');
    for (const url of ['http://downloads.example/app.apk', 'https://user:password@example/app.apk', 'https://example/app.apk#fragment']) {
      await assert.rejects(androidRelease({ ...input, url }), /HTTPS/);
    }
    for (const versionCode of [0, -1, 1.5, 2147483648, NaN]) {
      await assert.rejects(androidRelease({ ...input, versionCode }), /metadata/);
    }
    await writeFile(apk, '');
    await assert.rejects(androidRelease(input), /size/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
