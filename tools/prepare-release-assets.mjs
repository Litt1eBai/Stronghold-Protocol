// Validate both the committed release manifest and the downloader's generated manifest.
// The upstream index also plans optional new resources that this release does not reference.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function validateAssetReferences(manifest, publicDir) {
  const root = await realpath(publicDir);
  const references = new Set();
  function collect(value) {
    if (typeof value === 'string' && /^\/(assets|fonts)\//.test(value)) references.add(decodeURIComponent(value.split(/[?#]/, 1)[0]));
    else if (value && typeof value === 'object') for (const entry of Object.values(value)) collect(entry);
  }
  collect(manifest);
  if (!references.size) throw new Error('Release manifest has no static asset references');
  for (const url of references) {
    const candidate = path.resolve(root, `.${url}`);
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe release asset: ${url}`);
    try {
      if (await realpath(candidate) !== candidate) throw new Error('Symbolic link');
      const info = await stat(candidate);
      if (!info.isFile() || info.size === 0) throw new Error('Empty or non-file');
    } catch {
      throw new Error(`Missing or unsafe release asset: ${url}`);
    }
  }
  return references.size;
}

async function main() {
  const manifestFile = path.join(ROOT, 'data/assets.json');
  const original = JSON.parse(await readFile(manifestFile, 'utf8'));
  for (const tool of ['tools/fetch-assets.mjs', 'tools/prepare-skins.mjs']) {
    // Keep the downloader's shrink guard and required-resource checks. Independently
    // reject any missing file from the committed or final release manifests below.
    const result = spawnSync(process.execPath, [tool], { cwd: ROOT, stdio: 'inherit',
      env: { ...process.env, SP_ASSETS_STRICT: '0' } });
    if (result.error || result.status !== 0) throw result.error || new Error(`${tool} failed`);
  }
  const current = JSON.parse(await readFile(manifestFile, 'utf8'));
  const oldCount = await validateAssetReferences(original, path.join(ROOT, 'public'));
  const newCount = await validateAssetReferences(current, path.join(ROOT, 'public'));
  console.log(`All release assets verified: ${oldCount} committed references, ${newCount} generated references`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
