// Stage only static art/audio and fonts for the native Android APK. No server or account data.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', json: 'application/json', atlas: 'text/plain', css: 'text/css',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };

export async function stageAndroidAssets({ publicDir, manifestFile, outputDir }) {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const required = new Set();
  function collect(value) {
    if (typeof value === 'string' && /^\/(assets|fonts)\//.test(value)) {
      required.add(decodeURIComponent(value.split(/[?#]/, 1)[0]));
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) collect(entry);
    }
  }
  collect(manifest);
  if (!required.size) throw new Error('Static asset manifest contains no asset/font references');

  const files = [];
  async function walk(directory, prefix) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Static assets must not contain symlinks: ${relative}`);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  for (const folder of ['assets', 'fonts']) await walk(path.join(publicDir, folder), folder);
  const present = new Set(files.map(file => `/${file}`));
  const missing = [...required].filter(file => !present.has(file));
  if (missing.length) throw new Error(`Missing ${missing.length} static assets: ${missing.slice(0, 5).join(', ')}`);

  // This is a generated build directory; refresh it so deleted assets cannot leak into a later APK.
  await fs.rm(outputDir, { recursive: true, force: true });
  const inventory = [];
  let totalBytes = 0;
  for (const file of files.sort()) {
    const contents = await fs.readFile(path.join(publicDir, file));
    const destination = path.join(outputDir, 'preinstalled', file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
    inventory.push({ url: `/${file}`, size: contents.length,
      mime: MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream',
      sha256: crypto.createHash('sha256').update(contents).digest('hex') });
    totalBytes += contents.length;
  }
  const index = { totalBytes, files: inventory };
  await fs.writeFile(path.join(outputDir, 'preinstalled', 'index.json'), JSON.stringify(index));
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const index = await stageAndroidAssets({ publicDir: path.join(root, 'public'),
    manifestFile: path.join(root, 'data/assets.json'),
    outputDir: path.join(root, 'client/android/app/build/generated/preinstalled-assets') });
  console.log(`[android] preinstalled ${index.files.length} static assets, ${(index.totalBytes / 1024 / 1024).toFixed(2)} MiB`);
}
