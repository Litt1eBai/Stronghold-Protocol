import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseIdentity, releaseApkName, verifyApkIdentity, releaseAsset, verifyPublicApk } from '../tools/cnb-release.mjs';

const gradle = 'applicationId = "com.strongholdprotocol.client"\nversionCode = 1013\nversionName = "0.2.4"\nminSdk = 24';
test('only a native release tag matching the actual APK version is accepted', () => {
  assert.equal(releaseIdentity(gradle, 'android-v0.2.4-1013').versionCode, 1013);
  for (const tag of ['v0.2.4', 'android-v0.2.4-1012', 'android-v0.2.5-1013', '../bad']) {
    assert.throws(() => releaseIdentity(gradle, tag), /Release tag/);
  }
});

test('APK filenames distinguish native releases and published lookup rejects an older generic file', () => {
  const name = releaseApkName({ versionName: '0.2.5', versionCode: 1020 });
  assert.equal(name, 'Stronghold-Protocol-v0.2.5-1020.apk');
  assert.notEqual(name, releaseApkName({ versionName: '0.2.5', versionCode: 1021 }));
  for (const versionName of ['../bad', 'a/b', 'bad name', '', null, undefined]) {
    assert.throws(() => releaseApkName({ versionName, versionCode: 1020 }), /filename/);
  }
  const generic = { name: 'Stronghold-Protocol-release.apk', size: 100, browser_download_url: 'https://cnb.cool/old.apk' };
  assert.throws(() => releaseAsset({ assets: [generic] }, 100, name), /missing/);
  const current = { ...generic, name, browser_download_url: 'https://cnb.cool/new.apk' };
  assert.equal(releaseAsset({ assets: [generic, current] }, 100, name), current.browser_download_url);
});

test('signed APK manifest must match source identity before publication, including package and min SDK', () => {
  const expected = { applicationId: 'com.strongholdprotocol.client', versionName: '0.2.5', versionCode: 1020, minSdk: 24 };
  const tree = `E: manifest
    A: http://schemas.android.com/apk/res/android:versionCode(0x0101021b)=1020
    A: http://schemas.android.com/apk/res/android:versionName(0x0101021c)="0.2.5" (Raw: "0.2.5")
    A: package="com.strongholdprotocol.client" (Raw: "com.strongholdprotocol.client")
      E: uses-sdk
        A: http://schemas.android.com/apk/res/android:minSdkVersion(0x0101020c)=24
        A: http://schemas.android.com/apk/res/android:targetSdkVersion(0x01010270)=37`;
  assert.deepEqual(verifyApkIdentity(tree, expected), expected);
  assert.deepEqual(verifyApkIdentity(tree.replace('=1020', '=0x3fc'), expected), expected);
  for (const wrong of [tree.replace('="0.2.5"', '="0.2.4"'), tree.replace('=1020', '=1013'),
    tree.replace('package="com.strongholdprotocol.client"', 'package="com.other.app"'),
    tree.replace('=24', '=35'), '']) {
    assert.throws(() => verifyApkIdentity(wrong, expected), /does not match/);
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
