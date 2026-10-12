// Generate the public announcement AFTER signing and uploading the APK.
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function androidRelease({ apk, url, notes = '', applicationId, versionCode, versionName, minSdk = 24 }) {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || address.hash) throw new Error('APK URL must use HTTPS without credentials or a fragment');
  if (!applicationId || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2147483647
      || typeof versionName !== 'string' || !versionName.trim() || versionName.length > 100
      || !Number.isInteger(minSdk) || minSdk < 24 || minSdk > 1000 || typeof notes !== 'string' || notes.length > 16000) {
    throw new Error('Invalid Android release metadata');
  }
  const info = await stat(apk);
  if (!info.isFile() || info.size < 1 || info.size > 2 * 1024 ** 3) throw new Error('Invalid APK size');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(apk)) hash.update(chunk);
  return { format: 1, applicationId, versionCode, versionName, apkUrl: address.href,
    sha256: hash.digest('hex'), size: info.size, minSdk, notes };
}

async function main() {
  const options = {};
  const names = new Set(['apk', 'url', 'notes-file', 'out']);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !names.has(key) || !args[i + 1]) throw new Error('Usage: node tools/android-release.mjs --apk SIGNED.apk --url HTTPS_URL --out android.json [--notes-file notes.txt]');
    options[key] = args[i + 1];
  }
  if (!options.apk || !options.url || !options.out) throw new Error('--apk, --url and --out are required');
  const gradle = await readFile(new URL('../client/android/app/build.gradle.kts', import.meta.url), 'utf8');
  const manifest = await androidRelease({ apk: options.apk, url: options.url,
    notes: options['notes-file'] ? await readFile(options['notes-file'], 'utf8') : '',
    applicationId: gradle.match(/applicationId\s*=\s*"([^"]+)"/)?.[1],
    versionCode: Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1]),
    versionName: gradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1],
    minSdk: Number(gradle.match(/minSdk\s*=\s*(\d+)/)?.[1]) });
  await mkdir(path.dirname(options.out), { recursive: true });
  const temp = `${options.out}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temp, options.out);
  console.log(`Android ${manifest.versionName} (${manifest.versionCode}): ${options.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
