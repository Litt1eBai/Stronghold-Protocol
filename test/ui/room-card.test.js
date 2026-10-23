// test/ui/room-card.test.js — the room's 名片干员 (server/lobby.js setCard, public/js/screens/room.js):
// the picker follows the room's content set (a gameplay plugin may add operators), and a refused room.card puts the
// local pick back to the card the room acknowledges instead of leaving "mine changed, teammates' not".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardOperators } from '../../public/js/ui/seatArt.js';

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

// Synchronization retries and rejected selections are now covered by test/ui/card-sync.test.js
// through the upstream installCardSync engine, rather than the retired room-screen helper.
