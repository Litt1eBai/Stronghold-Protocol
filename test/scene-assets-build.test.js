import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { SCENE_GROUPS, SCENE_STAGES, checkSceneAssets, packSceneAssets, restoreSceneAssets } from '../tools/scene-assets.mjs';
import { PACK_IMAGES, PACK_MESHES } from '../public/js/render/board3d/load.js';
import { EXPECTED_SCENE } from '../tools/local-extract/expected.mjs';
import { zipFiles, unzipFiles } from '../server/plugins/zip.js';

async function fixture(root) {
  const shared = '/assets/local/map/autochess/[opt]shared.webp';
  const record = { path: shared };
  const groups = Object.fromEntries(SCENE_GROUPS.map(g => [g, { shared: record }]));
  for (const [g, key] of [...Object.values(PACK_IMAGES), ...Object.values(PACK_MESHES)]) groups[g][key] = record;
  groups['scene/tex'] = { surface: record };
  const manifest = { version: 1, source: 'local-client', groups };
  const files = new Map([
    [`public${shared}`, Buffer.from('texture')],
    ['public/assets/local/map/autochess/tiles.json', Buffer.from('{"board3d":{},"materials":{}}')],
  ]);
  for (const group of SCENE_STAGES) {
    const base = `/assets/local/${group}`;
    const doc = { version: 1, stage: group.slice(6), binBytes: 42, materials: { floor: { map: 'surface' } },
      chunks: [{ material: 'floor', lightmap: 0, verts: 1, tris: 1, offset: 0 }] };
    groups[group] = { scene: { path: `${base}/scene.json`, version: EXPECTED_SCENE.version },
      bin: { path: `${base}/scene.bin` }, lm0: record };
    files.set(`public${base}/scene.json`, Buffer.from(JSON.stringify(doc)));
    files.set(`public${base}/scene.bin`, Buffer.alloc(42));
  }
  files.set('data/local-assets.json', Buffer.from(JSON.stringify(manifest)));
  for (const dir of ['map', 'mesh', 'scene']) await fs.mkdir(path.join(root, 'public/assets/local', dir), { recursive: true });
  for (const [name, bytes] of files) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), bytes);
  }
  return manifest;
}

test('scene archive is reproducible, restores all eleven boards, and keeps other local art', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-scenes-'));
  try {
    const source = path.join(root, 'source'), target = path.join(root, 'target');
    await fixture(source);
    const archive = path.join(root, 'scenes.zip');
    const pin = await packSceneAssets(source, archive);
    assert.equal(pin.stages, 11);
    assert.deepEqual(await packSceneAssets(source, path.join(root, 'second.zip')), pin);
    await fs.mkdir(path.join(target, 'data'), { recursive: true });
    const unrelated = { 'ui/custom': { icon: { path: '/assets/custom.png' } } };
    await fs.writeFile(path.join(target, 'data/local-assets.json'), JSON.stringify({ groups: unrelated, chars: { preserved: {} } }));
    await restoreSceneAssets(target, archive, pin);
    assert.equal((await checkSceneAssets(target)).stages, 11);
    const restored = JSON.parse(await fs.readFile(path.join(target, 'data/local-assets.json')));
    assert.deepEqual(restored.groups['ui/custom'], unrelated['ui/custom']);
    assert.deepEqual(restored.chars, { preserved: {} });
    await assert.rejects(restoreSceneAssets(target, archive, { ...pin, sha256: '0'.repeat(64) }), /SHA-256/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('incomplete or stale scenes fail validation even with otherwise correct geometry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-scene-gaps-'));
  try {
    const manifest = await fixture(root), file = path.join(root, 'data/local-assets.json');
    const first = manifest.groups[SCENE_STAGES[0]];
    first.scene.version = EXPECTED_SCENE.version - 1;
    await fs.writeFile(file, JSON.stringify(manifest));
    await assert.rejects(checkSceneAssets(root), /Stale scene/);
    first.scene.version = EXPECTED_SCENE.version;
    delete first.lm0;
    await fs.writeFile(file, JSON.stringify(manifest));
    await assert.rejects(checkSceneAssets(root), /Missing scene lightmap/);
    first.lm0 = { path: '/assets/local/map/autochess/missing.webp' };
    await fs.writeFile(file, JSON.stringify(manifest));
    await assert.rejects(checkSceneAssets(root), /ENOENT/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a hash-pinned archive with unrelated files is rejected before writing anything', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-scene-scope-'));
  try {
    await fixture(root);
    const file = path.join(root, 'scenes.zip');
    await packSceneAssets(root, file);
    const entries = unzipFiles(await fs.readFile(file));
    entries.push({ name: 'server/index.js', data: Buffer.from('unexpected code') });
    const archive = zipFiles(entries);
    await fs.writeFile(file, archive);
    const pin = { format: 1, size: archive.length, sha256: createHash('sha256').update(archive).digest('hex') };
    const target = path.join(root, 'target');
    await assert.rejects(restoreSceneAssets(target, file, pin), /Unexpected scene archive entry/);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
