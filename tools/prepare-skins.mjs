// Adapted skin catalogue: use this repository's verifying downloader and Spine pipeline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Downloader } from './assets/downloader.mjs';
import { processModels } from './assets/spine.mjs';
import { contentHash } from './assets/manifest.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function addSkinAssets(manifest, { root = ROOT, offline = false, log = console.log } = {}) {
  const research = JSON.parse(await fs.readFile(path.join(root, 'docs/research/08-skins.json'), 'utf8'));
  const selected = new Set(JSON.parse(await fs.readFile(path.join(root, 'data/skins-installed.json'), 'utf8')));
  for (const char of Object.values(manifest.chars || {})) delete char.skins;
  const models = new Map();
  const avatars = [];
  const skins = [];
  const assetRoot = path.join(root, 'public/assets');
  const dl = new Downloader({ root: assetRoot, ledgerPath: path.join(root, '.cache/skins-ledger.json'), concurrency: 12, retries: 2, timeoutMs: 30000, log });
  await dl.loadLedger();
  for (const [charId, list] of Object.entries(research.skins)) {
    if (!manifest.chars?.[charId]) continue;
    for (const skin of list) {
      if (!selected.has(skin.skinId)) continue;
      const avatar = { rel: `char/skin_avatar/${skin.stem}.png`, kind: 'png', urls: [skin.avatar.url] };
      avatars.push(avatar);
      const dirs = {};
      for (const [side, rec] of Object.entries(skin.battleSpine || {})) {
        const dir = `spine/op/${charId}/${skin.stem}/${side}/`;
        const job = (ext) => ({ rel: `${dir}${skin.stem}.${ext}`, urls: [rec[ext].url], kind: ext, ...(ext === 'atlas' ? { mutable: true } : {}) });
        const key = `${skin.skinId}:${side}`;
        const skillIndices = Object.keys(manifest.chars[charId].spine?.front?.anims?.skills || {}).map(Number).filter(Number.isFinite);
        models.set(key, { key, kind: 'op', dir, pma: false, skillIndices: skillIndices.length ? skillIndices : [0,1,2],
          baseUrl: rec.atlas.url.slice(0, rec.atlas.url.lastIndexOf('/') + 1), skel: job('skel'), atlas: job('atlas'), pngs: [job('png')] });
        dirs[side] = key;
      }
      skins.push({ charId, skin, avatar, dirs });
    }
  }
  if (skins.length !== selected.size) throw new Error(`Unknown or unavailable skin selection: ${selected.size} selected, ${skins.length} planned`);
  if (!offline) await dl.run(avatars, 'skin avatars');
  const processed = await processModels(models, { root: assetRoot, dl, cachePath: path.join(root, '.cache/skins-spine-cache.json'), download: !offline, log });
  if (processed.problems.length) throw new Error(`Skin Spine validation failed:\n${processed.problems.join('\n')}`);
  for (const { charId, skin, avatar, dirs } of skins) {
    if (await dl.existingSize(avatar) < 0) throw new Error(`Missing skin avatar: ${avatar.rel}`);
    const spine = {};
    for (const [side, key] of Object.entries(dirs)) {
      const entry = processed.entries.get(key);
      if (!entry) throw new Error(`Missing parsed skin model: ${key}`);
      for (const url of entry.textures) await fs.access(path.join(root, 'public', url));
      spine[side] = entry;
    }
    if (!spine.front) throw new Error(`Skin has no Front model: ${skin.skinId}`);
    const char = manifest.chars[charId];
    char.skins ||= {};
    char.skins[skin.skinId] = { name: skin.name, group: skin.group || '', avatar: `/assets/${avatar.rel}`, spine };
  }
  await dl.saveLedger();
  log(`[skins] validated ${skins.length} skins, ${processed.entries.size} models`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(ROOT, 'data/assets.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  await addSkinAssets(manifest, { offline: process.argv.includes('--offline') });
  const { version, hash, generatedAt, stats, ...body } = manifest;
  manifest.hash = contentHash(body);
  const files = new Set();
  function collect(value) {
    if (typeof value === 'string' && value.startsWith('/assets/')) files.add(value);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) collect(v);
  }
  collect(body);
  manifest.stats.bytes = (await Promise.all([...files].map(url => fs.stat(path.join(ROOT, 'public', url)).then(s => s.size)))).reduce((n, size) => n + size, 0);
  manifest.stats.files = files.size;
  manifest.stats.skins = Object.values(manifest.chars).reduce((n, c) => n + Object.keys(c.skins || {}).length, 0);
  await fs.writeFile(file + '.tmp', JSON.stringify(manifest) + '\n');
  await fs.rename(file + '.tmp', file);
}
