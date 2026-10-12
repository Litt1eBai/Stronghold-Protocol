import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateAssetReferences } from '../tools/prepare-release-assets.mjs';

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
