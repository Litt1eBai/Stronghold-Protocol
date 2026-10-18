// Materialize the reviewed release manifest; validate regenerated output too when a cold cache needs it.
// Download indexes and local FX metadata are build inputs, not replacements for a complete release manifest.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Downloader } from './assets/downloader.mjs';
import { RAW } from './assets/sources.mjs';
import { restartForEnvProxy } from './assets/env-proxy.mjs';

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

/** Release audio may name banks absent from an older cached audio index. Fetch its exact published paths. */
export async function prepareReleaseAssets({ root = ROOT, fetchImpl, log = console.log,
  runTool = (tool) => spawnSync(process.execPath, [tool], { cwd: root, stdio: 'inherit',
    env: { ...process.env, SP_ASSETS_STRICT: '0' } }) } = {}) {
  const manifestFile = path.join(root, 'data/assets.json');
  const original = JSON.parse(await readFile(manifestFile, 'utf8'));
  const audio = new Set();
  function collect(value) {
    if (typeof value === 'string' && value.startsWith('/assets/audio/sfx/')) {
      const suffix = value.slice('/assets/audio/sfx/'.length);
      if (!/^[a-z0-9_/-]+\.mp3$/.test(suffix) || suffix.split('/').some(p => !p || p === '..')) {
        throw new Error('Unsafe release audio path');
      }
      audio.add(suffix);
    } else if (value && typeof value === 'object') for (const entry of Object.values(value)) collect(entry);
  }
  collect(original);
  if (audio.size) {
    const dl = new Downloader({ root: path.join(root, 'public/assets'),
      ledgerPath: path.join(root, '.cache/release-audio-ledger.json'), log, fetchImpl,
      timeoutMs: 30000, retries: 2 });
    await dl.loadLedger();
    await dl.run([...audio].map(suffix => ({ rel: `audio/sfx/${suffix}`, kind: 'mp3', urls: [RAW.aa2voice + suffix] })), 'release audio');
    await dl.saveLedger();
  }
  // The committed manifest already includes reviewed audio modes and parsed skins. A build machine without
  // local FX indexes cannot reproduce those modes: do not regenerate complete, validated release inputs.
  let complete = false;
  let count;
  try { count = await validateAssetReferences(original, path.join(root, 'public')); complete = true; }
  catch { /* A cold cache still needs the ordinary download/model/skin preparation below. */ }
  if (complete) {
    log(`All release assets verified: ${count} committed references; manifest preserved`);
    return count;
  }
  for (const tool of ['tools/fetch-assets.mjs', 'tools/prepare-skins.mjs']) {
    // Keep the downloader's shrink guard and required-resource checks. Independently
    // reject any missing file from the committed or final release manifests below.
    const result = runTool(tool);
    if (!result.error && result.status === 1 && tool === 'tools/fetch-assets.mjs') {
      const report = JSON.parse(await readFile(path.join(root, '.cache/assets-report.json'), 'utf8'));
      if (report.manifestWritten === false && report.droppedEntries?.length && report.requiredMisses?.length === 0) {
        // The shrink guard leaves the committed manifest untouched. Its metadata can be richer than this
        // machine's indexes; accept it only after every published file has actually been materialized.
        const count = await validateAssetReferences(original, path.join(root, 'public'));
        log(`All release assets verified: ${count} committed references; shrink guard preserved reviewed metadata`);
        return count;
      }
    }
    if (result.error || result.status !== 0) throw result.error || new Error(`${tool} failed`);
  }
  const current = JSON.parse(await readFile(manifestFile, 'utf8'));
  const oldCount = await validateAssetReferences(original, path.join(root, 'public'));
  const newCount = await validateAssetReferences(current, path.join(root, 'public'));
  log(`All release assets verified: ${oldCount} committed references, ${newCount} generated references`);
  return newCount;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!restartForEnvProxy()) prepareReleaseAssets().catch(error => { console.error(error.message); process.exitCode = 1; });
}
