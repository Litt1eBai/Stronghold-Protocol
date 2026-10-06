import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clientServerOrigin } from '../tools/client-server-url.mjs';
import { registerAccount, defaultWsUrl } from '../public/js/net.js';

const shell = readFileSync(new URL('../client/android/app/src/main/assets/shell.js', import.meta.url), 'utf8');

test('fixed server origin is mandatory and excludes credentials, paths and URL suffixes', () => {
  assert.equal(clientServerOrigin(' http://203.135.99.28:30089/ '), 'http://203.135.99.28:30089');
  assert.equal(clientServerOrigin('https://game.example.com/'), 'https://game.example.com');
  for (const invalid of ['', 'file:///tmp/app', 'ftp://example.com', 'http://u:p@example.com',
    'https://example.com/game', 'http://example.com/?server=x', 'http://example.com/#x', 'http://example.com:99999']) {
    assert.throws(() => clientServerOrigin(invalid), /SP_SERVER_URL/);
  }
});

function harness() {
  const reports = [], timers = [], listeners = new Map();
  const size = { width: 0, height: 0 };
  const surface = { getBoundingClientRect: () => size };
  const root = { childElementCount: 0, clientWidth: 0, clientHeight: 0, querySelector: () => surface };
  const context = vm.createContext({
    document: { getElementById: (id) => id === 'app' ? root : null, querySelectorAll: () => [] },
    navigator: { userAgent: 'test WebView' },
    AndroidNative: { reportClientState: (json) => reports.push(JSON.parse(json)) },
    addEventListener: (event, fn) => listeners.set(event, fn),
    setTimeout: (fn) => timers.push(fn),
  });
  context.window = context;
  vm.runInContext(shell, context);
  return { context, root, size, reports, timers, listeners };
}

test('readiness waits for the original app to boot and lay out its login or game screen', () => {
  const h = harness();
  assert.equal(h.reports.at(-1).ready, false);
  h.root.childElementCount = 1;
  h.size.width = 900;
  h.size.height = 600;
  h.timers.shift()();
  assert.equal(h.reports.at(-1).ready, false, 'HTML alone does not mean the original client booted');
  h.context.__SP__ = { net: {}, store: {} };
  h.timers.shift()();
  assert.equal(h.reports.at(-1).ready, true);
  assert.equal(h.timers.length, 0);
});

test('collapsed layout and script failures still reach native diagnostics without reporting ready', () => {
  const h = harness();
  h.context.__SP__ = {};
  h.root.childElementCount = 1;
  h.listeners.get('error')({ message: 'boot failed' });
  assert.equal(h.reports.at(-1).ready, false);
  assert.equal(h.reports.at(-1).error, 'boot failed');
  h.listeners.get('unhandledrejection')({ reason: new Error('network failed') });
  assert.match(h.reports.at(-1).error, /network failed/);
});

test('document-start and page-finished injection share one readiness loop, which stops on navigation', () => {
  const h = harness();
  vm.runInContext(shell, h.context);
  assert.equal(h.timers.length, 1);
  h.listeners.get('pagehide')();
  h.timers.shift()();
  assert.equal(h.reports.length, 1);
  assert.equal(h.timers.length, 0);
});

test('Android uses the original same-origin registration API and account errors', async () => {
  const previous = { location: globalThis.location, fixed: globalThis.__SP_SERVER_URL__, tauri: globalThis.__TAURI__ };
  const origin = 'http://203.135.99.28:30089';
  globalThis.location = { origin, protocol: 'http:', host: '203.135.99.28:30089' };
  delete globalThis.__SP_SERVER_URL__;
  delete globalThis.__TAURI__;
  try {
    assert.equal(defaultWsUrl(), 'ws://203.135.99.28:30089/ws');
    const fields = { username: 'doctor', qq: '12345678', password: 'example' };
    let response = { status: 201, ok: true, json: async () => ({ ok: true, auth: 'server-account-token' }) };
    const fetch = async (url, options) => {
      assert.equal(url, `${origin}/api/auth/register`);
      assert.equal(options.credentials, 'same-origin');
      assert.deepEqual(JSON.parse(options.body), fields);
      return response;
    };
    assert.equal((await registerAccount(fields, fetch)).auth, 'server-account-token');
    response = { status: 409, ok: false, json: async () => ({ ok: false, error: 'ALREADY_EXISTS' }) };
    await assert.rejects(registerAccount(fields, fetch), { code: 'ALREADY_EXISTS', status: 409 });
  } finally {
    for (const [key, value] of Object.entries({ location: previous.location, __SP_SERVER_URL__: previous.fixed, __TAURI__: previous.tauri })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
