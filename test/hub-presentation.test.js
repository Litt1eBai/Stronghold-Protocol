import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { AuthStore } from '../server/auth.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';

test('room portraits synchronize, survive reconnect and stay out of match inputs; counts include AI seats', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth: new AuthStore({ required: false }) });
  const clients = [];
  const connect = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    c.welcome = await c.hello(name, token); return c;
  };
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
  try {
    const host = await connect('Host'), guest = await connect('Guest'), observer = await connect('Observer');
    assert.equal((await host.request({ t: 'room.card', charId: 'char_498_inside' })).code, 'NOT_IN_ROOM');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const { code } = await host.waitFor('room.state');
    await ok(guest, { t: 'room.join', code });
    await ok(observer, { t: 'room.spectate', code });
    assert.equal((await observer.request({ t: 'room.card', charId: 'char_498_inside' })).code, 'NOT_IN_ROOM');
    assert.equal((await host.request({ t: 'room.card', charId: 'char_unknown' })).code, 'BAD_MSG');
    for (const charId of ['../secret', '<svg>', 'x'.repeat(65), null]) assert.ok(validateC2S({ t: 'room.card', charId }));
    await ok(host, { t: 'room.card', charId: 'char_498_inside' });
    await guest.waitFor('room.state', r => r.seats.some(s => s?.card === 'char_498_inside'));
    await host.terminate();
    const resumed = await connect('Host', host.welcome.token);
    assert.equal(resumed.welcome.playerId, host.welcome.playerId);
    await resumed.waitFor('room.state', r => r.seats.some(s => s?.card === 'char_498_inside'));
    await ok(resumed, { t: 'room.addBot' });
    await ok(resumed, { t: 'room.list' });
    const list = await resumed.waitFor('room.list');
    const room = list.rooms.find(r => r.code === code);
    assert.equal(list.online, 3);
    assert.equal(list.roomsCount, 1);
    assert.equal(list.matchesCount, 0);
    assert.equal(room.players, 3);
    assert.equal(room.humans, 2);
    assert.equal(room.bots, 1);
    assert.equal(room.spectators, 1);
    assert.ok(!JSON.stringify(list).includes('token'));
    await ok(resumed, { t: 'room.card', charId: '' });
    await guest.waitFor('room.state', r => !r.seats.some(s => s?.card));
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(resumed, { t: 'room.start' });
    const pub = await resumed.waitFor('m.public');
    assert.ok(pub.players.every(p => !Object.hasOwn(p, 'card')));
  } finally { for (const c of clients) await c.terminate(); await srv.close(); }
});

test('chat is room-scoped plain text with bounded history, rate limits and spectator/reconnect support', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth: new AuthStore({ required: false }) });
  const clients = [];
  let now = Date.now(); srv.lobby.now = () => now;
  const connect = async name => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    c.welcome = await c.hello(name); return c;
  };
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
  try {
    const host = await connect('Host'), viewer = await connect('Viewer'), outsider = await connect('Outsider');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const { code } = await host.waitFor('room.state');
    await ok(viewer, { t: 'room.spectate', code });
    assert.equal((await outsider.request({ t: 'room.chat.history', code })).code, 'NOT_IN_ROOM');
    assert.equal((await outsider.request({ t: 'room.chat', code, text: 'private' })).code, 'NOT_IN_ROOM');
    const text = '<img src=x onerror=alert(1)>';
    await ok(host, { t: 'room.chat', code, text: text + '\u0007' });
    const line = await viewer.waitFor('room.chat');
    assert.equal(line.text, text);
    assert.equal(line.name, 'Host');
    assert.equal(line.isSpectator, false);
    assert.equal((await host.request({ t: 'room.chat', code, text: 'flood' })).code, 'RATE');
    assert.ok(validateC2S({ t: 'room.chat', code, text: 'x'.repeat(201) }));
    await ok(viewer, { t: 'room.chat', code, text: 'watching' });
    assert.equal((await host.waitFor('room.chat', m => m.text === 'watching')).isSpectator, true);
    const session = srv.registry.byId(host.welcome.playerId);
    for (let i = 0; i < 85; i++) {
      now += 1001;
      assert.equal(srv.lobby.chat(session, { code, text: String(i) }).ok, true);
    }
    await ok(viewer, { t: 'room.chat.history', code });
    const history = await viewer.waitFor('room.chat.history');
    assert.equal(history.messages.length, 80);
    assert.equal(history.messages[0].text, '5');
    assert.equal(history.messages.at(-1).text, '84');
    assert.equal((await viewer.request({ t: 'room.chat.history', code })).code, 'RATE');
    await outsider.expectNone('room.chat');
    assert.ok(!Object.hasOwn(srv.lobby.getRoom(code).toState(), 'chatMessages'));
  } finally { for (const c of clients) await c.terminate(); await srv.close(); }
});
