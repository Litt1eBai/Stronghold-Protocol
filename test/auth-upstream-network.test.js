// Local authentication composed with upstream admission caps, deltas and spectator AI handover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { AuthStore } from '../server/auth.js';
import { TestClient } from './helpers/wsClient.js';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-auth-network-'));
  const auth = new AuthStore({ required: true, file: join(dir, 'accounts.json'), secret: 'auth-network-regression' });
  const users = new Map();
  for (const username of ['host', 'mate', 'late']) {
    const user = auth.createUser({ username, displayName: username, password: 'regression-password' });
    users.set(username, auth.issue(user));
  }
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth, botRehearsal: 0, ...options });
  const clients = [];
  t.after(async () => {
    for (const client of clients) await client.terminate().catch(() => {});
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const connect = async (username, token = null) => {
    const client = await TestClient.connect(`${srv.url.replace('http', 'ws')}/ws`);
    clients.push(client);
    const welcome = await client.hello(username, token, { auth: users.get(username), delta: 1 });
    return { client, welcome };
  };
  return { srv, auth, connect };
}
const ok = async (client, msg) => assert.equal((await client.request(msg)).t, 'ok', msg.t);

test('required accounts retain identity and resume tokens at the online cap with delta negotiation', async t => {
  const { connect } = await fixture(t, { maxOnline: 1 });
  const host = await connect('host');
  assert.equal(host.welcome.account.username, 'host');
  await assert.rejects(connect('mate'), /SERVER_FULL/);
  await host.client.terminate();
  const mate = await connect('mate');
  const resumed = await connect('host', host.welcome.token);
  assert.equal(resumed.welcome.playerId, host.welcome.playerId);
  assert.equal(resumed.welcome.resumed, true);
  assert.equal(resumed.welcome.account.username, 'host');
  assert.equal(mate.welcome.account.username, 'mate');
  await ok(resumed.client, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await resumed.client.waitFor('room.state');
  await ok(resumed.client, { t: 'room.addBot' });
  const changed = await resumed.client.waitFor('room.state', state => state.seats.filter(Boolean).length === 2);
  assert.equal(changed.code, room.code);
  assert.equal(changed.seats.find(seat => seat?.playerId === host.welcome.playerId).name, 'host');
});

test('an authenticated spectator keeps the account and reconnect token after a voted AI handover', async t => {
  const { srv, connect } = await fixture(t);
  const host = await connect('host');
  await ok(host.client, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const initial = await host.client.waitFor('room.state');
  await ok(host.client, { t: 'room.setAiTakeover', on: true });
  const mate = await connect('mate');
  await ok(mate.client, { t: 'room.join', code: initial.code });
  await ok(mate.client, { t: 'room.ready', ready: true });
  await ok(host.client, { t: 'room.addBot' });
  await ok(host.client, { t: 'room.start' });
  const room = srv.lobby.getRoom(initial.code), match = room.match;
  match.startRound(1);
  match.phase = 'PREP';
  match.setDeadline(0);
  for (const player of match.order) player._botPrepToken = (player._botPrepToken || 0) + 1;
  const bot = match.order.find(player => player.isBot);
  const late = await connect('late');
  await ok(late.client, { t: 'room.spectate', code: room.code });
  await ok(late.client, { t: 'room.aiRequest', botId: bot.playerId });
  const vote = room.aiTakeoverVotes[0];
  await ok(host.client, { t: 'room.aiVote', voteId: vote.id, approve: true });
  await ok(mate.client, { t: 'room.aiVote', voteId: vote.id, approve: true });
  const handed = await late.client.waitFor('welcome', message => message.playerId === bot.playerId);
  assert.equal(handed.account.username, 'late');
  assert.equal(handed.takeoverFrom, late.welcome.playerId);
  assert.equal(handed.token, late.welcome.token);
  assert.equal(srv.registry.byId(bot.playerId).account.username, 'late');
  await late.client.terminate();
  const back = await connect('late', late.welcome.token);
  assert.equal(back.welcome.playerId, bot.playerId);
  assert.equal(back.welcome.resumed, true);
  assert.equal(back.welcome.account.username, 'late');
});
