import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateAssetReferences, prepareReleaseAssets } from '../tools/prepare-release-assets.mjs';

test('release validation rejects a required file even when regeneration omits its reference', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-release-assets-'));
  try {
    await mkdir(path.join(root, 'assets'));
    await mkdir(path.join(root, 'fonts'));
    await writeFile(path.join(root, 'assets/present.png'), 'png');
    await writeFile(path.join(root, 'fonts/fonts.css'), 'css');
    const generated = { image: '/assets/present.png?v=1', font: '/fonts/fonts.css' };
    assert.equal(await validateAssetReferences(generated, root), 2);
    await assert.rejects(validateAssetReferences({ ...generated, original: '/assets/missing.png' }, root), /missing.png/);
    await writeFile(path.join(root, 'assets/empty.png'), '');
    await assert.rejects(validateAssetReferences({ image: '/assets/empty.png' }, root), /empty.png/);
    await assert.rejects(validateAssetReferences({ image: '/assets/../../secret' }, root), /Unsafe/);
    if (process.platform !== 'win32') {
      await symlink(path.join(root, 'assets/present.png'), path.join(root, 'assets/link.png'));
      await assert.rejects(validateAssetReferences({ image: '/assets/link.png' }, root), /unsafe/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release fetches committed audio without regenerating reviewed modes from stale indexes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-release-cached-'));
  try {
    await mkdir(path.join(root, 'data'), { recursive: true });
    await mkdir(path.join(root, 'public/assets'), { recursive: true });
    const manifest = { audio: { sfx: { hit: '/assets/audio/sfx/player/p_imp/new_sound.mp3',
      pools: { reviewed: { maxSoundAllowed: 3, popOldest: true } } } } };
    const file = path.join(root, 'data/assets.json');
    const original = JSON.stringify(manifest) + '\n';
    await writeFile(file, original);
    const calls = [];
    const bytes = Buffer.alloc(128); bytes.write('ID3');
    const options = { root, log() {}, runTool() { assert.fail('complete release inputs must not be regenerated'); },
      fetchImpl: async url => { calls.push(url); return new Response(bytes); } };
    assert.equal(await prepareReleaseAssets(options), 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/raw\.githubusercontent\.com\/ArknightsAssets\/ArknightsAssets2\/voice\/assets\/dyn\/audio\/sound_beta_2\/player\/p_imp\/new_sound\.mp3$/);
    assert.equal(await readFile(file, 'utf8'), original, 'preserve reviewed bank settings and manifest hash');
    assert.equal(await prepareReleaseAssets(options), 1);
    assert.equal(calls.length, 1, 'a second build reuses the validated audio');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release still refuses missing non-audio assets and unsafe committed audio paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-release-incomplete-'));
  try {
    await mkdir(path.join(root, 'data'), { recursive: true });
    await mkdir(path.join(root, 'public/assets'), { recursive: true });
    const file = path.join(root, 'data/assets.json');
    await writeFile(file, JSON.stringify({ image: '/assets/missing.png' }));
    const tools = [];
    const options = { root, log() {}, runTool(tool) { tools.push(tool); return { status: 0 }; } };
    await assert.rejects(prepareReleaseAssets(options), /missing.png/);
    assert.deepEqual(tools, ['tools/fetch-assets.mjs', 'tools/prepare-skins.mjs']);
    await writeFile(file, JSON.stringify({ hit: '/assets/audio/sfx/../../outside.mp3' }));
    await assert.rejects(prepareReleaseAssets(options), /Unsafe release audio/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cold release accepts a shrink refusal only after all committed files have been downloaded', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-release-shrink-'));
  try {
    for (const dir of ['data', 'public/assets', '.cache']) await mkdir(path.join(root, dir), { recursive: true });
    const file = path.join(root, 'data/assets.json');
    const original = JSON.stringify({ image: '/assets/new.png', reviewedAudioMode: 3 });
    await writeFile(file, original);
    await writeFile(path.join(root, '.cache/assets-report.json'), JSON.stringify({
      manifestWritten: false, droppedEntries: ['audio.sfx.pools.reviewed'], requiredMisses: [] }));
    const options = { root, log() {}, runTool() { return { status: 1 }; } };
    await assert.rejects(prepareReleaseAssets(options), /new.png/, 'a shrink report never excuses a missing file');
    options.runTool = tool => {
      assert.equal(tool, 'tools/fetch-assets.mjs');
      writeFileSync(path.join(root, 'public/assets/new.png'), 'downloaded-image');
      return { status: 1 };
    };
    assert.equal(await prepareReleaseAssets(options), 1);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
