// Host-side preparation of the official board and eleven battlefield scenes. Art stays outside Git.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipFiles, unzipFiles } from '../server/plugins/zip.js';
import { EXPECTED_LOCAL_GROUPS, EXPECTED_SCENE } from './local-extract/expected.mjs';
import { PACK_IMAGES, PACK_MESHES, parseSceneChunks, SCENE_VERSION } from '../public/js/render/board3d/load.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'data/local-assets.json';
const selected = group => /^(map|mesh|scene)\//.test(group);
export const SCENE_GROUPS = EXPECTED_LOCAL_GROUPS.filter(selected);
export const SCENE_STAGES = SCENE_GROUPS.filter(g => g.startsWith('scene/') && g !== 'scene/tex');
const allowedFile = name => /^public\/assets\/local\/(map|mesh|scene)\//.test(name)
  && !name.split('/').some(p => !p || p === '.' || p === '..') && !/[\\\x00]/.test(name);

function assetFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/assets/local/') || /[?#%]/.test(url)) {
    throw new Error(`Invalid scene asset URL: ${url}`);
  }
  const name = `public${url}`;
  if (!allowedFile(name)) throw new Error(`Invalid scene asset path: ${url}`);
  return name;
}

/** Validate references, geometry, lightmaps and every named material texture before packaging or restoring. */
export async function inspectSceneAssets(manifest, read) {
  const groups = manifest?.groups || {};
  for (const name of SCENE_GROUPS) {
    if (!groups[name] || !Object.keys(groups[name]).length) throw new Error(`Missing scene asset group: ${name}`);
  }
  const paths = new Set();
  for (const [group, records] of Object.entries(groups)) {
    if (!selected(group)) continue;
    for (const record of Object.values(records)) {
      const name = assetFile(record.path);
      if (!paths.has(name)) {
        if (!(await read(name)).length) throw new Error(`Empty scene asset: ${name}`);
        paths.add(name);
      }
    }
  }
  for (const [group, key] of [...Object.values(PACK_IMAGES), ...Object.values(PACK_MESHES)]) {
    if (!groups[group]?.[key]?.path) throw new Error(`Missing board asset: ${group}/${key}`);
  }
  // Loaded next to the atlas, rather than through a manifest entry.
  const tiles = JSON.parse(await read('public/assets/local/map/autochess/tiles.json'));
  if (!tiles.board3d || !tiles.materials) throw new Error('Missing board atlas crop definitions');
  for (const group of SCENE_STAGES) {
    const records = groups[group];
    if (records.scene?.version !== EXPECTED_SCENE.version) throw new Error(`Stale scene extraction: ${group}`);
    const doc = JSON.parse(await read(assetFile(records.scene.path)));
    const bytes = await read(assetFile(records.bin?.path));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (doc.stage !== group.slice(6) || doc.version !== SCENE_VERSION || doc.binBytes !== bytes.length
        || !doc.chunks?.length || !parseSceneChunks(doc, buffer)) throw new Error(`Invalid scene geometry: ${group}`);
    if (doc.env && !records.env?.path) throw new Error(`Missing scene reflection: ${group}`);
    for (const chunk of doc.chunks) {
      if (chunk.lightmap >= 0 && !records[`lm${chunk.lightmap}`]?.path) throw new Error(`Missing scene lightmap: ${group}/${chunk.lightmap}`);
      const material = doc.materials?.[chunk.material];
      if (!material) throw new Error(`Missing scene material: ${group}/${chunk.material}`);
      for (const key of ['map', 'normalMap', 'glossMap', 'emissionMap']) {
        if (material[key] && !groups['scene/tex']?.[material[key]]?.path) throw new Error(`Missing scene texture: ${material[key]}`);
      }
    }
  }
  return { stages: SCENE_STAGES.length, groups: SCENE_GROUPS.length, references: paths.size, extractionVersion: EXPECTED_SCENE.version };
}

async function readInside(root, name) {
  const file = path.resolve(root, name);
  if (await fs.realpath(file) !== file || !(await fs.stat(file)).isFile()) throw new Error(`Unsafe scene file: ${name}`);
  return fs.readFile(file);
}

export async function checkSceneAssets(root = ROOT) {
  const manifest = JSON.parse(await readInside(root, MANIFEST));
  return inspectSceneAssets(manifest, name => readInside(root, name));
}

export async function packSceneAssets(root, output) {
  const original = JSON.parse(await readInside(root, MANIFEST));
  const groups = Object.fromEntries(Object.entries(original.groups).filter(([g]) => selected(g)));
  const manifest = { version: 1, source: 'local-client', count: Object.values(groups).reduce((n, r) => n + Object.keys(r).length, 0), groups };
  const summary = await inspectSceneAssets(manifest, name => readInside(root, name));
  const entries = [{ name: MANIFEST, data: Buffer.from(JSON.stringify(manifest)) }];
  async function walk(name) {
    for (const entry of await fs.readdir(path.join(root, name), { withFileTypes: true })) {
      const file = `${name}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Unsafe scene file: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && allowedFile(file)) entries.push({ name: file, data: await readInside(root, file) });
      else throw new Error(`Unexpected scene file: ${file}`);
    }
  }
  for (const folder of ['map', 'mesh', 'scene']) await walk(`public/assets/local/${folder}`);
  const archive = zipFiles(entries);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, archive);
  return { format: 1, sha256, size: archive.length, ...summary };
}

export async function restoreSceneAssets(root, archiveFile, pin) {
  const archive = await fs.readFile(archiveFile);
  if (pin.format !== 1 || archive.length !== pin.size || createHash('sha256').update(archive).digest('hex') !== pin.sha256) {
    throw new Error('Scene archive size or SHA-256 mismatch');
  }
  // The repository pins these locally produced bytes before decompression. Official filenames such as
  // [opt]merged_textures.png are valid here, but deliberately forbidden by the unrelated plugin installer.
  const entries = unzipFiles(archive);
  if (entries.length > 5000 || entries.reduce((n, e) => n + e.data.length, 0) > 256 * 1024 * 1024) {
    throw new Error('Scene archive exceeds its file or byte limit');
  }
  const files = new Map(entries.map(e => [e.name, e.data]));
  if (files.size !== entries.length) throw new Error('Duplicate scene archive entry');
  for (const name of files.keys()) if (name !== MANIFEST && !allowedFile(name)) throw new Error(`Unexpected scene archive entry: ${name}`);
  const manifest = JSON.parse(files.get(MANIFEST));
  if (Object.keys(manifest.groups).some(g => !selected(g)) || manifest.chars) throw new Error('Unexpected scene manifest content');
  const summary = await inspectSceneAssets(manifest, async name => {
    if (!files.has(name)) throw new Error(`Missing archived scene file: ${name}`);
    return files.get(name);
  });
  // Complete validation precedes every write. Keep unrelated local art/characters and effects intact.
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const [name, bytes] of files) {
    if (name === MANIFEST) continue;
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (await fs.realpath(path.dirname(target)) !== path.dirname(target)) throw new Error(`Unsafe scene destination: ${name}`);
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error(`Unsafe scene destination: ${name}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.writeFile(target, bytes);
  }
  const groups = { ...previous.groups, ...manifest.groups };
  const merged = { ...previous, version: 1, source: 'local-client', groups,
    count: Object.values(groups).reduce((n, r) => n + Object.keys(r).length, 0) };
  const target = path.join(root, MANIFEST);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(`${target}.tmp`, JSON.stringify(merged));
  await fs.rename(`${target}.tmp`, target);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'check', file] = process.argv.slice(2);
  let result;
  if (command === 'check') result = await checkSceneAssets();
  else if (command === 'pack' && file) result = await packSceneAssets(ROOT, path.resolve(file));
  else if (command === 'restore' && file) {
    const pin = JSON.parse(await fs.readFile(path.join(ROOT, '.cnb/scene-assets.json'), 'utf8'));
    result = await restoreSceneAssets(ROOT, path.resolve(file), pin);
  } else throw new Error('Usage: node tools/scene-assets.mjs check|pack <zip>|restore <zip>');
  console.log(JSON.stringify(result));
}
