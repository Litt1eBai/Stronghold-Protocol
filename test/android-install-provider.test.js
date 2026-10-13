import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../client/android/app/src/main/', import.meta.url);

test('log and APK authorities use distinct provider components and disjoint private paths', () => {
  const manifest = readFileSync(new URL('AndroidManifest.xml', root), 'utf8');
  const providers = [...manifest.matchAll(/<provider\b([^>]+)>([\s\S]*?)<\/provider>/g)].map((m) => ({
    name: m[1].match(/android:name="([^"]+)"/)?.[1],
    authority: m[1].match(/android:authorities="([^"]+)"/)?.[1],
    paths: m[2].match(/android:resource="@xml\/([^"]+)"/)?.[1],
  }));
  assert.equal(new Set(providers.map((p) => p.name)).size, providers.length,
    'Android caches providers by component name; two authorities must not reuse that component');
  for (const [suffix, directory] of [['logs', 'logs/'], ['updates', 'updates/']]) {
    const provider = providers.find((p) => p.authority === '${applicationId}.' + suffix);
    assert.ok(provider?.paths, `Missing ${suffix} authority`);
    const config = readFileSync(new URL(`res/xml/${provider.paths}.xml`, root), 'utf8');
    const paths = [...config.matchAll(/<(files-path|external-files-path|root-path|external-path)\b[^>]*path="([^"]*)"/g)];
    assert.ok(paths.length > 0);
    for (const [, type, path] of paths) {
      assert.ok(['files-path', 'external-files-path'].includes(type), 'Only app-private directories may be shared');
      assert.equal(path, directory, 'Each authority may expose only its own files');
    }
  }
});
