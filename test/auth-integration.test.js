import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../server/auth.js';
import { startServer } from '../server/index.js';
import { APP_VERSION } from '../shared/constants.js';
import { TestClient } from './helpers/wsClient.js';

test('account HTTP routes and authenticated hello retain upstream capabilities and session settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-auth-merge-'));
  const qqFile = join(dir, 'allowed-qq.txt');
  writeFileSync(qqFile, '12345678\n');
  const auth = new AuthStore({ file: join(dir, 'accounts.json'), secret: 'integration-secret', required: true,
    registration: 'on', allowedQqFile: qqFile });
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth });
  const clients = [];
  const connect = async () => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    return c;
  };
  try {
    const config = await (await fetch(srv.url + '/api/auth/config')).json();
    assert.deepEqual(config, { authRequired: true, registration: true });
    const register = (body) => fetch(srv.url + '/api/auth/register', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const fields = { username: 'doctor', displayName: 'Doctor', password: 'example-password', qq: '12345678' };
    assert.equal((await register({ ...fields, qq: '87654321' })).status, 400);
    const registration = await register(fields);
    assert.equal(registration.status, 201);
    const created = await registration.json();
    assert.equal(auth.verify(created.auth).username, 'doctor');
    assert.equal((await register(fields)).status, 409);
    const anonymous = await connect();
    assert.equal((await anonymous.request({ t: 'hello', name: 'Doctor' })).code, 'AUTH_REQUIRED');
    assert.equal((await anonymous.request({ t: 'hello', name: 'Doctor', username: 'doctor', password: 'wrong' })).code, 'AUTH_INVALID');
    const welcome = await anonymous.request({ t: 'hello', name: 'Doctor', username: 'doctor', password: fields.password });
    assert.equal(welcome.t, 'welcome');
    assert.equal(welcome.account.username, 'doctor');
    assert.ok(welcome.auth);
    assert.ok(welcome.diyKitted.includes('char_112_siege'));
    assert.equal((await anonymous.request({ t: 'room.ownership', notOwned: ['chess_char_4_22_a'] })).t, 'ok');
    assert.equal((await anonymous.request({ t: 'room.diy', picks: {
      chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' },
    } })).t, 'ok');
    await anonymous.terminate();
    const resumed = await connect();
    const resumedWelcome = await resumed.request({ t: 'hello', name: 'Doctor', token: welcome.token });
    assert.equal(resumedWelcome.playerId, welcome.playerId);
    assert.equal(resumedWelcome.account.username, 'doctor');
    const recovery = await connect();
    const occupied = await recovery.request({ t: 'hello', name: 'Doctor', token: welcome.token, noReplace: true, auth: created.auth });
    assert.equal(occupied.code, 'SESSION_IN_USE', 'account login must preserve upstream seat protection');
    assert.equal(srv.registry.byToken(welcome.token).connected, true);
    assert.deepEqual(srv.registry.byToken(welcome.token).notOwned, ['chess_char_4_22_a']);
    assert.equal((await resumed.request({ t: 'room.list' })).t, 'ok');
    const jwtClient = await connect();
    assert.equal((await jwtClient.request({ t: 'hello', name: 'Doctor', auth: created.auth })).account.username, 'doctor');
    const health = await (await fetch(srv.url + '/healthz')).json();
    assert.equal(health.app, APP_VERSION);
    assert.deepEqual(health.auth, { required: true, users: 1 });
  } finally {
    for (const c of clients) await c.terminate();
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
