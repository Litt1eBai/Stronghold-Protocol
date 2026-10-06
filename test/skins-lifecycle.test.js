import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './match/harness.js';
import { unitInfo } from '../server/sim/snapshot.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { validateC2S } from '../shared/protocol.js';
import { skinsStore, setSkins, installSkinsSync } from '../public/js/ui/skins.js';
import { loadoutStore } from '../public/js/ui/loadoutSync.js';

const ID = 'chess_char_1_01_a';
const SKIN = 'char_498_inside@kitchen#2';
const CH = DATA.chess[ID];
const fixture = { ...DATA, assets: { ...DATA.assets, chars: { ...DATA.assets.chars,
  [CH.charId]: { ...DATA.assets.chars[CH.charId], skins: { [SKIN]: { avatar: '/test.png' } } } } } };

test('skin selection reaches public/prep views, promoted chess, battle specs and snapshots; resets and bots stay default', () => {
  const h = makeMatch({ data: fixture, seats: [
    { seat: 0, playerId: 'p_0', isBot: false, connected: true, skins: { [ID]: SKIN } },
    { seat: 1, playerId: 'ai_0', isBot: true, connected: true, skins: { [ID]: SKIN } },
  ] });
  try {
    const ps = h.m.players.get('p_0');
    const piece = ps.newPiece('chess', CH.goldenId);
    ps.board.set('7,3', piece);
    assert.equal(ps.pieceView(piece).skin, SKIN);
    assert.deepEqual(h.m.publicView().players.find(p => p.playerId === 'p_0').skins, { [ID]: SKIN });
    assert.deepEqual(h.m.players.get('ai_0').skins, {});
    const input = ps.battleInput('normal');
    assert.equal(input.units[0].skin, SKIN);
    const spec = buildBattleSpec({ battleId: 'skins', seed: 1, stageId: 'act2autochess_m01', fieldKind: 'normal', players: [input], waves: [] }, { data: fixture });
    assert.equal(spec.players[0].units[0].skin, SKIN);
    const battle = createBattleFromSpec(spec, fixture);
    const unit = [...battle.units.values()].find(u => u.side === 'ally');
    assert.equal(unit.skin, SKIN);
    assert.equal(unitInfo(unit).skin, SKIN);
    assert.equal(h.m.setSkins('p_0', { [ID]: 'not-an-installed-skin', [CH.goldenId]: SKIN }).ok, true);
    assert.deepEqual(ps.skins, {});
    assert.equal(ps.pieceView(piece).skin, undefined);
    assert.equal(h.m.publicView().players.find(p => p.playerId === 'p_0').skins, undefined);
    assert.ok(h.m.setSkins('ai_0', { [ID]: SKIN }).error);
  } finally { h.m.dispose(); }
});

test('skin protocol limits reject malformed or oversized maps', () => {
  assert.equal(validateC2S({ t: 'room.skins', skins: { [ID]: SKIN } }), null);
  assert.ok(validateC2S({ t: 'room.skins', skins: { [ID]: 'a/b' } }));
  assert.ok(validateC2S({ t: 'room.skins', skins: Object.fromEntries(Array.from({ length: 161 }, (_, i) => ['chess_' + i, SKIN])) }));
  assert.ok(validateC2S({ t: 'room.skin.install', skinId: SKIN }));
});

test('skin sync sends edits when the overlay closes, keeps latest replies, and resends after reconnect', async () => {
  const sent = []; const callbacks = {}; const jobs = new Map(); let id = 0;
  const sync = installSkinsSync({ net: { status: 'online', on: (name, fn) => { callbacks[name] = fn; return () => {}; },
    request: async (t, payload) => { sent.push({ t, ...payload }); } }, timers: {
      setTimeout: fn => { jobs.set(++id, fn); return id; }, clearTimeout: n => jobs.delete(n),
    } });
  try {
    loadoutStore.set({ open: true }); setSkins({ [ID]: SKIN }); loadoutStore.set({ open: false });
    await Promise.resolve();
    assert.equal(sent.length, 1); assert.deepEqual(sent[0], { t: 'room.skins', skins: { [ID]: SKIN } });
    await sync.flush(); assert.equal(sent.length, 1);
    callbacks.welcome(); await sync.flush(); assert.equal(sent.length, 2);
    setSkins({}); await sync.flush(); assert.deepEqual(sent.at(-1).skins, {});
  } finally { sync.dispose(); setSkins({}); loadoutStore.set({ open: false }); }
});

test('room.skins validates selection, survives session resume, and follows the player into a room', async () => {
  const { startServer } = await import('../server/index.js');
  const { TestClient } = await import('./helpers/wsClient.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  try {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    const welcome = await c.hello('skin-test');
    const selected = await c.request({ t: 'room.skins', skins: { [ID]: SKIN, [CH.goldenId]: SKIN } });
    assert.equal(selected.t, 'ok');
    await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const room = await c.waitFor('room.state');
    assert.ok(room.code);
    await c.terminate();
    const resumed = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(resumed);
    const w = await resumed.hello('skin-test', welcome.token);
    assert.equal(w.playerId, welcome.playerId);
    // Start a real match: public state is the teammate/observer wire format.
    assert.equal((await resumed.request({ t: 'room.start' })).t, 'ok');
    const pub = await resumed.waitFor('m.public');
    assert.deepEqual(pub.players.find(p => p.playerId === w.playerId).skins, { [ID]: SKIN });
    assert.equal((await resumed.request({ t: 'room.skins', skins: {} })).t, 'ok');
    const cleared = await resumed.waitFor('m.public', p => !p.players.find(x => x.playerId === w.playerId)?.skins);
    assert.equal(cleared.players.find(p => p.playerId === w.playerId).skins, undefined);
  } finally { for (const c of clients) await c.terminate(); await srv.close(); }
});
