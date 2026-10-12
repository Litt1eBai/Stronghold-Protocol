import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseIdentity, releaseAsset, verifyPublicApk } from '../tools/cnb-release.mjs';

const gradle = 'applicationId = "com.strongholdprotocol.client"\nversionCode = 1013\nversionName = "0.2.4"\nminSdk = 24';
test('only a native release tag matching the actual APK version is accepted', () => {
  assert.equal(releaseIdentity(gradle, 'android-v0.2.4-1013').versionCode, 1013);
  for (const tag of ['v0.2.4', 'android-v0.2.4-1012', 'android-v0.2.5-1013', '../bad']) {
    assert.throws(() => releaseIdentity(gradle, tag), /Release tag/);
  }
});

test('published APK needs the expected size and a credential-free HTTPS download URL', () => {
  const asset = { name: 'Stronghold-Protocol-release.apk', size: 100, browser_download_url: 'https://cnb.cool/public.apk' };
  assert.equal(releaseAsset({ assets: [asset] }, 100), asset.browser_download_url);
  assert.throws(() => releaseAsset({ assets: [asset] }, 101), /size/);
  assert.throws(() => releaseAsset({ assets: [] }, 100), /missing/);
  assert.throws(() => releaseAsset({ assets: [{ ...asset, browser_download_url: 'http://example/a.apk' }] }, 100), /HTTPS/);
});

test('anonymous APK check follows only HTTPS redirects and rejects login pages and wrong totals', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'manual');
    if (calls.length === 1) return new Response(null, { status: 302, headers: { Location: 'https://cdn.example/app.apk' } });
    return new Response(new Uint8Array([80, 75, 3, 4]), { status: 206, headers: { 'Content-Range': 'bytes 0-3/100' } });
  };
  await verifyPublicApk('https://cnb.cool/app.apk', 100, fetch);
  assert.deepEqual(calls, ['https://cnb.cool/app.apk', 'https://cdn.example/app.apk']);
  await assert.rejects(verifyPublicApk('https://example/app.apk', 100, async () =>
    new Response('HTML', { headers: { 'Content-Length': '100' } })), /not an APK/);
  await assert.rejects(verifyPublicApk('https://example/app.apk', 100, async () =>
    new Response(null, { status: 302, headers: { Location: 'http://example/app.apk' } })), /Unsafe/);
  await assert.rejects(verifyPublicApk('https://example/app.apk', 100, async () =>
    new Response(null, { status: 401 })), /authentication/);
  await assert.rejects(verifyPublicApk('https://example/app.apk', 100, async () =>
    new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'Content-Length': '99' } })), /size/);
});
