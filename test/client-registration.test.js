import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAccount } from '../public/js/net.js';

test('native registration uses IPC and preserves server rejection codes', async () => {
  const previous = globalThis.__TAURI__;
  const fields = { username: 'doctor', qq: '12345678', password: 'example' };
  let result = { status: 201, body: { ok: true, auth: 'test-token' } };
  globalThis.__TAURI__ = { core: { invoke: async (command, args) => {
    assert.equal(command, 'register_account');
    assert.deepEqual(args, { fields });
    return result;
  } } };
  try {
    const noBrowserFetch = () => { throw new Error('Native registration must not use browser fetch'); };
    assert.deepEqual(await registerAccount(fields, noBrowserFetch), result.body);
    result = { status: 409, body: { ok: false, error: 'ALREADY_EXISTS' } };
    await assert.rejects(registerAccount(fields, noBrowserFetch), { code: 'ALREADY_EXISTS', status: 409 });
  } finally {
    if (previous === undefined) delete globalThis.__TAURI__;
    else globalThis.__TAURI__ = previous;
  }
});

test('browser registration still posts JSON to the fixed server', async () => {
  const previous = globalThis.__SP_SERVER_URL__;
  globalThis.__SP_SERVER_URL__ = 'http://203.135.99.28:30089';
  const fields = { username: 'doctor' };
  try {
    const body = { ok: true, auth: 'test-token' };
    assert.deepEqual(await registerAccount(fields, async (url, options) => {
      assert.equal(url, 'http://203.135.99.28:30089/api/auth/register');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(options.body), fields);
      return { status: 201, ok: true, json: async () => body };
    }), body);
  } finally {
    if (previous === undefined) delete globalThis.__SP_SERVER_URL__;
    else globalThis.__SP_SERVER_URL__ = previous;
  }
});
