// test/ui/room-card.test.js — the room's 名片干员 (server/lobby.js setCard, public/js/screens/room.js):
// the picker follows the room's content set (a gameplay plugin may add operators), and a refused room.card puts the
// local pick back to the card the room acknowledges instead of leaving "mine changed, teammates' not".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardOperators, syncRoomCard } from '../../public/js/screens/room.js';

test('the seat card picker includes a room content set operator (P2)', () => {
  const list = cardOperators([
    { charId: 'char_official', name: 'A', rarity: 6, visible: true },
    { charId: 'char_plugin', name: 'B', rarity: 5, visible: true, pluginId: 'demo' },
    { charId: 'char_plugin', name: 'B elite', rarity: 5, isGolden: true, visible: true },
    { charId: 'char_diy', isDiy: true },
    { charId: 'char_hidden', visible: false },
    { charId: 'char_no_flag', rarity: 4 },
  ]);
  assert.deepEqual(list.map((c) => c.charId).sort(), ['char_no_flag', 'char_official', 'char_plugin']);
  assert.equal(list.find((c) => c.charId === 'char_plugin').name, 'B elite', 'one record per charId, elite preferred');
});

test('a refused room.card falls back to the room card; an unchanged or unknown pick sends nothing (P2)', async () => {
  const sent = [];
  const net = { request: async (t, msg) => { sent.push([t, msg]); if (msg.charId === 'char_bad') throw new Error('BAD_MSG'); return { t: 'ok' }; } };
  assert.equal(await syncRoomCard(net, { charId: 'char_old', roomCard: 'char_old', known: true }), null);
  assert.equal(await syncRoomCard(net, { charId: 'char_unknown', roomCard: '', known: false }), null);
  assert.equal(sent.length, 0, 'unchanged or not in the picker: no request');
  assert.equal(await syncRoomCard(net, { charId: 'char_new', roomCard: 'char_old', known: true }), null);
  assert.deepEqual(sent[0], ['room.card', { charId: 'char_new' }]);
  assert.equal(await syncRoomCard(net, { charId: 'char_bad', roomCard: 'char_old', known: true }), 'char_old');
  assert.equal(await syncRoomCard(net, { charId: '', roomCard: 'char_old', known: true }), null);
  assert.deepEqual(sent.map(([, msg]) => msg.charId), ['char_new', 'char_bad', '']);
});
