import { cp, mkdir, mkdtemp, readFile, writeFile, rm, lstat, access, readdir, utimes } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeBuildTag } from '../server/http/buildTag.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Repository-owned author resources only; installed plugins and studio keys never ship. */
export const SERVER_PLUGIN_RESOURCES = ['schemas', 'plugins/_template', 'plugins/README.md', 'plugins/AGENTS.md',
  'docs/PLUGINS.md', 'docs/PLUGIN-GUIDE.md', 'docs/PLUGIN-DSL.md', 'docs/PLUGIN-API.md',
  'docs/plugin-catalog.example.json', 'tools/plugin.mjs', 'tools/assets', 'tools/local-extract/expected.mjs',
  'test/helpers/battleHarness.js'];

/** Explicit runtime allowlist: no account databases, signing keys or development caches. */
export async function stageServer(root, stage) {
  await mkdir(stage, { recursive: true });
  const entries = ['server', 'shared', 'data', 'public', 'package.json', 'package-lock.json', 'LICENSE', 'NOTICE.md',
    'tools/vendor.mjs', ...SERVER_PLUGIN_RESOURCES];
  try { await access(path.join(root, 'packs')); entries.push('packs'); } catch { /* optional content packs */ }
  for (const entry of entries) {
    await cp(path.join(root, entry), path.join(stage, entry), { recursive: true, filter: async (file) => {
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (relative === 'public/updates' || path.basename(file).startsWith('.')) return false;
      if ((await lstat(file)).isSymbolicLink()) throw new Error(`Release source must not contain symlinks: ${relative}`);
      return true;
    } });
  }
}

/** buildTag uses mtimes; GNU tar stores seconds, so normalize before fingerprinting. */
export async function normalizeReleaseTimes(directory, seconds) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalizeReleaseTimes(file, seconds);
    await utimes(file, seconds, seconds);
  }
}

async function main() {
  const commit = process.env.CNB_COMMIT;
  const tag = process.env.CNB_BRANCH;
  const buildId = process.env.CNB_BUILD_ID;
  if (!/^[0-9a-f]{40}$/.test(commit || '') || !/^android-v[\w.-]+-\d+$/.test(tag || '')
      || !/^[A-Za-z0-9_-]{1,64}$/.test(buildId || '')) throw new Error('A release tag, full commit SHA and CNB build ID are required');
  const announcement = JSON.parse(await readFile(path.join(ROOT, 'client/artifacts/android/android.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const id = `${tag}-${commit.slice(0, 12)}-${buildId}`;
  const stage = await mkdtemp(path.join(tmpdir(), 'stronghold-server-release-'));
  const out = path.join(ROOT, 'client/artifacts/server');
  await mkdir(out, { recursive: true });
  try {
    await stageServer(ROOT, stage);
    const npm = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
    if (npm.error || npm.status !== 0) throw npm.error || new Error('Production dependency install failed');
    const vendor = spawnSync(process.execPath, ['tools/vendor.mjs'], { cwd: stage, stdio: 'inherit' });
    if (vendor.error || vendor.status !== 0) throw vendor.error || new Error('Production vendor staging failed');
    await normalizeReleaseTimes(stage, Math.floor(Date.now() / 1000));
    const build = computeBuildTag(stage);
    if (!build) throw new Error('Could not compute server build fingerprint');
    const info = { id, commit, app: pkg.version, build, androidVersionCode: announcement.versionCode };
    await writeFile(path.join(stage, 'RELEASE.json'), `${JSON.stringify(info, null, 2)}\n`);
    // The announcement is served only after this directory is switched into current.
    await mkdir(path.join(stage, 'public/updates'), { recursive: true });
    await cp(path.join(ROOT, 'client/artifacts/android/android.json'), path.join(stage, 'public/updates/android.json'));
    const archive = path.join(out, 'server.tar.gz');
    const tar = spawnSync('tar', ['-czf', archive, '-C', stage, '.'], { stdio: 'inherit' });
    if (tar.error || tar.status !== 0) throw tar.error || new Error('Server archive failed');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    await writeFile(path.join(out, 'SERVER-SHA256SUMS'), `${hash.digest('hex')}  server.tar.gz\n`);
    await writeFile(path.join(out, 'RELEASE.json'), `${JSON.stringify(info, null, 2)}\n`);
    console.log(`Server release staged: ${id}`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
