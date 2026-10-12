import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { androidRelease } from './android-release.mjs';

export function releaseIdentity(gradle, tag) {
  const applicationId = gradle.match(/applicationId\s*=\s*"([^"]+)"/)?.[1];
  const versionCode = Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1]);
  const versionName = gradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
  const minSdk = Number(gradle.match(/minSdk\s*=\s*(\d+)/)?.[1]);
  if (!applicationId || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2147483647
      || !versionName || !Number.isInteger(minSdk) || tag !== `android-v${versionName}-${versionCode}`) {
    throw new Error('Release tag must match Android versionName/versionCode: android-v<VERSION>-<CODE>');
  }
  return { applicationId, versionCode, versionName, minSdk };
}

export function releaseAsset(release, expectedSize) {
  const asset = release.assets?.find((a) => a.name === 'Stronghold-Protocol-release.apk');
  if (!asset || asset.size !== expectedSize || typeof asset.browser_download_url !== 'string') throw new Error('Published APK is missing or has the wrong size');
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Published APK needs a public HTTPS URL');
  return url.href;
}

/** Check anonymous access and ZIP magic without downloading the entire APK twice. */
export async function verifyPublicApk(address, size, fetchFn = fetch) {
  let url = address;
  for (let attempt = 0; attempt < 6; attempt++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Unsafe APK redirect');
    const res = await fetchFn(url, { headers: { Range: 'bytes=0-3', 'Accept-Encoding': 'identity' },
      redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel();
      const next = res.headers.get('location');
      if (!next) throw new Error('APK redirect is missing a destination');
      url = new URL(next, url).href;
      continue;
    }
    try {
      if (![200, 206].includes(res.status)) throw new Error('APK must be downloadable without authentication');
      const total = res.status === 206 ? res.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] : res.headers.get('content-length');
      if (Number(total) !== size) throw new Error('Public APK response has the wrong size');
      if (!res.body) throw new Error('Empty APK response');
      const reader = res.body.getReader();
      const prefix = [];
      try {
        while (prefix.length < 4) {
          const { value, done } = await reader.read();
          if (done) break;
          for (let i = 0; i < value.length && prefix.length < 4; i++) prefix.push(value[i]);
        }
      } finally { await reader.cancel(); }
      if (prefix.join(',') !== '80,75,3,4') throw new Error('Public download is not an APK (possibly a login page)');
      return;
    } finally { if (res.body && !res.body.locked) await res.body.cancel(); }
  }
  throw new Error('Too many APK redirects');
}

async function main() {
  const tag = process.env.CNB_BRANCH;
  const gradle = await readFile(new URL('../client/android/app/build.gradle.kts', import.meta.url), 'utf8');
  const identity = releaseIdentity(gradle, tag);
  const out = 'client/artifacts/android';
  await mkdir(out, { recursive: true });
  if (process.argv[2] === 'identity') {
    const notePath = new URL('../.cnb/release-notes.txt', import.meta.url);
    const notes = await readFile(notePath, 'utf8');
    await writeFile(`${out}/release-notes.txt`, `${tag}\n\n${notes}`);
    await writeFile(`${out}/identity.json`, `${JSON.stringify(identity)}\n`);
    console.log(`Validated ${tag}`);
  } else if (process.argv[2] === 'announcement') {
    const slug = process.env.CNB_REPO_SLUG;
    if (!slug || !/^[\w./-]+$/.test(slug) || slug.includes('..')) throw new Error('Invalid CNB repository slug');
    const api = new URL(process.env.CNB_API_ENDPOINT || 'https://api.cnb.cool');
    if (api.protocol !== 'https:' || api.username || api.password) throw new Error('CNB API must use HTTPS');
    const response = await fetch(new URL(`/${slug}/-/releases/tags/${encodeURIComponent(tag)}`, api), {
      headers: { Authorization: `Bearer ${process.env.CNB_TOKEN || ''}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Could not read published release (HTTP ${response.status})`);
    const release = await response.json();
    // Get the local size/hash before accepting the API's URL.
    const notes = await readFile(`${out}/release-notes.txt`, 'utf8');
    const manifest = await androidRelease({ ...identity, apk: `${out}/Stronghold-Protocol-release.apk`,
      url: 'https://invalid.example/placeholder.apk', notes });
    manifest.apkUrl = releaseAsset(release, manifest.size);
    await verifyPublicApk(manifest.apkUrl, manifest.size);
    await writeFile(`${out}/android.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log('Public APK verified; Android announcement generated');
  } else throw new Error('Use identity or announcement');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
