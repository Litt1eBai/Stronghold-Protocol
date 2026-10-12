import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stageServer, normalizeReleaseTimes } from '../tools/server-release.mjs';
import { computeBuildTag } from '../server/http/buildTag.js';

test('runtime staging excludes credentials, accounts and stale update announcements; fingerprint survives tar', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-server-stage-'));
  try {
    const source = path.join(dir, 'source'), stage = path.join(dir, 'stage'), extracted = path.join(dir, 'extracted');
    for (const folder of ['server', 'shared', 'data', 'public/updates', 'tools', '.cache']) await mkdir(path.join(source, folder), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE.md', 'tools/vendor.mjs',
      'server/index.js', 'shared/constants.js', 'data/chess.json', 'public/index.html', 'public/updates/android.json', '.cache/accounts.json', '.env']) {
      await writeFile(path.join(source, file), '{}');
    }
    await stageServer(source, stage);
    for (const file of ['.cache/accounts.json', '.env', 'public/updates/android.json']) await assert.rejects(access(path.join(stage, file)));
    assert.equal(await readFile(path.join(stage, 'server/index.js'), 'utf8'), '{}');
    await normalizeReleaseTimes(stage, 1700000000);
    await mkdir(extracted);
    const archive = path.join(dir, 'stage.tar');
    assert.equal(spawnSync('tar', ['-cf', archive, '-C', stage, '.']).status, 0);
    assert.equal(spawnSync('tar', ['-xf', archive, '-C', extracted]).status, 0);
    assert.equal(computeBuildTag(stage), computeBuildTag(extracted));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function deploymentFixture(mode) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-deploy-test-'));
  const base = path.join(dir, 'installation'), bin = path.join(dir, 'bin'), stage = path.join(dir, 'stage');
  const old = path.join(base, 'releases', 'old');
  for (const folder of [old, bin, path.join(stage, 'public/updates')]) await mkdir(folder, { recursive: true });
  await symlink(old, path.join(base, 'current'));
  await writeFile(path.join(base, 'accounts-preserved'), 'persistent data');
  const id = 'android-v0.2.4-1013-0123456789ab-test';
  await writeFile(path.join(stage, 'RELEASE.json'), JSON.stringify({ id, app: '0.2.4', build: 'new-build' }));
  await writeFile(path.join(stage, 'public/updates/android.json'), JSON.stringify({ versionCode: 1013 }));
  const archive = path.join(dir, 'server.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', stage, '.']).status, 0);
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
  // Replace only operating-system side effects. Exercise the real deploy transaction and real tar/hash checks.
  await writeFile(path.join(bin, 'chown'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SP_TEST_BASE/restarts"\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(bin, 'curl'), `#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
b=Path(os.environ['SP_TEST_BASE']); current=(b/'current').resolve()
if current.name=='old': print(json.dumps({'ok':True,'matches':1 if os.environ['SP_TEST_MODE']=='active' else 0})); sys.exit(0)
if sys.argv[-1].endswith('/updates/android.json'): print((current/'public/updates/android.json').read_text()); sys.exit(0)
r=json.loads((current/'RELEASE.json').read_text()); r['ok']=True
if os.environ['SP_TEST_MODE']=='failure': r['build']='wrong-build'
print(json.dumps(r))
`, { mode: 0o755 });
  const result = spawnSync('bash', ['scripts/deploy-server.sh', archive, sha, id, 'http://public.example'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SP_DEPLOY_BASE: base,
      SP_TEST_BASE: base, SP_TEST_MODE: mode }, encoding: 'utf8' });
  return { dir, base, old, id, result };
}

for (const mode of ['success', 'failure', 'active']) {
  test(`deploy transaction: ${mode}`, { skip: process.platform === 'win32' }, async () => {
    const f = await deploymentFixture(mode);
    try {
      const { realpath } = await import('node:fs/promises');
      assert.equal(await readFile(path.join(f.base, 'accounts-preserved'), 'utf8'), 'persistent data');
      if (mode === 'success') {
        assert.equal(f.result.status, 0, f.result.stderr);
        assert.equal(path.basename(await realpath(path.join(f.base, 'current'))), f.id);
      } else {
        assert.notEqual(f.result.status, 0);
        assert.equal(await realpath(path.join(f.base, 'current')), f.old);
        if (mode === 'failure') {
          assert.match(f.result.stderr, /previous release restored/);
          assert.equal((await readFile(path.join(f.base, 'restarts'), 'utf8')).trim().split('\n').filter(line => line.startsWith('restart ')).length, 2);
        } else await assert.rejects(access(path.join(f.base, 'restarts')));
      }
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
}
