// Local preinstalled skins and preference migration beside the upstream 0.3.1 skin protocol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA } from './match/harness.js';
import { migrateLegacySkins } from '../public/js/ui/skins.js';
import { skinChoiceCharId } from '../shared/protocol.js';
import { writePlugin } from './helpers/pluginFixtures.js';

const ID = 'chess_char_1_01_a';
const CHAR = DATA.chess[ID].charId;
const SKIN = 'char_498_inside@kitchen#2';

test('legacy chess-key preferences migrate to operator keys without replacing explicit operator choices', () => {
  const legacy = { [ID]: SKIN, char_112_siege: 'siege@winter#1' };
  assert.equal(migrateLegacySkins(legacy, null), legacy, 'wait for data before migrating');
  assert.deepEqual(migrateLegacySkins(legacy, DATA.chess), { [CHAR]: SKIN, char_112_siege: 'siege@winter#1' });
  const explicit = { [ID]: SKIN, [CHAR]: 'chosen-plugin-skin', chess_deleted: 'old' };
  assert.deepEqual(migrateLegacySkins(explicit, DATA.chess), { [CHAR]: 'chosen-plugin-skin' });
  assert.equal(skinChoiceCharId(ID, DATA), CHAR, 'old import files retain their choices');
  assert.equal(skinChoiceCharId(CHAR, DATA), CHAR, 'new export files can be imported again');
  assert.equal(skinChoiceCharId('char_112_siege', DATA), 'char_112_siege');
});

test('the preinstalled catalogue is usable by the upstream model-based picker', () => {
  const skin = DATA.assets.chars[CHAR]?.skins?.[SKIN];
  assert.ok(skin?.spine?.front?.skel);
  assert.ok(skin?.avatar);
  assert.equal(skin.portrait, skin.avatar, 'bundled skins use their own art even without a full illustration');
});

for (const isolated of [false, true]) {
  test(`preinstalled skin choices survive reconnect and update a ${isolated ? 'content-isolated' : 'vanilla'} match`, { timeout: 40000 }, async () => {
    const { startServer } = await import('../server/index.js');
    const { AuthStore } = await import('../server/auth.js');
    const { TestClient } = await import('./helpers/wsClient.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-installed-skins-'));
    if (isolated) writePlugin(path.join(dir, 'skin-room'), { manifest: 2, version: '1.0.0', app: '*', api: 1,
      class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['patch.json'] },
    { 'patch.json': { patch: 1, ops: [] } });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: dir, assetIndex: false,
      auth: new AuthStore({ required: false }) });
    const clients = [];
    const connect = async token => {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
      c.welcome = await c.hello('skin-test', token); return c;
    };
    const ok = async (c, msg) => { const r = await c.request(msg, 20000); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); };
    try {
      const first = await connect();
      await ok(first, { t: 'room.skins', skins: { [CHAR]: SKIN } });
      assert.equal((await first.request({ t: 'room.skins', skins: { [ID]: SKIN } })).code, 'BAD_MSG');
      await ok(first, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      const initial = await first.waitFor('room.state');
      await first.terminate();
      const client = await connect(first.welcome.token);
      assert.equal(client.welcome.playerId, first.welcome.playerId);
      if (isolated) {
        await ok(client, { t: 'room.setPlugins', plugins: [{ id: 'skin-room' }] });
        const room = await client.waitFor('room.state', r => r.content?.vanilla === false, 20000);
        await ok(client, { t: 'room.contentReady', cs: room.content.cs });
      }
      await ok(client, { t: 'room.start' });
      const pub = await client.waitFor('m.public', m => m.players.some(p => p.playerId === client.welcome.playerId), 20000);
      assert.deepEqual(pub.players.find(p => p.playerId === client.welcome.playerId).skins, { [CHAR]: SKIN });
      if (isolated) assert.equal(srv.lobby.getRoom(initial.code).match.hosted, true);
      await ok(client, { t: 'room.skins', skins: {} });
      await client.waitFor('m.public', m => !m.players.find(p => p.playerId === client.welcome.playerId)?.skins, 20000);
      await ok(client, { t: 'room.skins', skins: { [CHAR]: SKIN } });
      await client.waitFor('m.public', m => m.players.find(p => p.playerId === client.welcome.playerId)?.skins?.[CHAR] === SKIN, 20000);
    } finally {
      for (const client of clients) await client.terminate();
      await srv.close(); fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
