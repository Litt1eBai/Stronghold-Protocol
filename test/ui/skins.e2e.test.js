import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const CHROME = process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && CHROME && existsSync(CHROME);
const ID = 'chess_char_1_01_a';
const SKIN = 'char_498_inside@kitchen#2';

test('skin picker on desktop and touch phone: persist/export/reset, room sync and actual Spine rendering', { skip: !enabled, timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const { AuthStore } = await import('../../server/auth.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth: new AuthStore({ required: false, registration: false }) });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  mkdirSync('test/e2e/out', { recursive: true });
  try {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 844, height: 390, hasTouch: true, isMobile: true }]) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'skin-ui-test'); sessionStorage.setItem('sp.entered', '1'); });
      await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online');
      await page.click('[data-testid="loadout-open"]');
      await page.waitForSelector('.lo-card', { visible: true });
      await page.type('.lo-search input', '隐现');
      await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1);
      await page.click('.lo-card');
      await page.evaluate(() => [...document.querySelectorAll('.lo-dtab')].find(e => e.textContent.includes('换装')).click());
      await page.waitForSelector(`[data-skin="${SKIN}"]`, { visible: true });
      await page.click(`[data-skin="${SKIN}"]`);
      await page.waitForFunction(skin => document.querySelector(`[data-skin="${skin}"]`)?.getAttribute('aria-checked') === 'true', {}, SKIN);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.skins'))), { [ID]: SKIN });
      const rows = await page.$$eval('.lo-skin', els => els.map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
      assert.ok(rows.every(r => r.w > 100 && r.h >= 46));
      await page.screenshot({ path: path.resolve(`test/e2e/out/skins-${viewport.width}.png`) });
      await page.click('[data-testid="loadout-export"]');
      await page.waitForSelector('[data-testid="loadout-io-text"]');
      const preset = JSON.parse(await page.$eval('[data-testid="loadout-io-text"]', e => e.value));
      assert.deepEqual(preset.skins, { [ID]: SKIN });
      await page.evaluate(() => [...document.querySelectorAll('.modal__actions .btn')].find(e => e.textContent.trim() === '关闭').click());
      await page.waitForFunction(() => !document.querySelector('.modal'));
      await page.evaluate(async () => { const { closeLoadout } = await import('/js/ui/loadoutSync.js'); closeLoadout(); });
      await page.evaluate(async () => { await globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }); await globalThis.__SP__.net.request('room.start', {}); });
      await page.waitForFunction(skin => globalThis.__SP__.store.get().match.public?.players?.some(p => p.skins?.chess_char_1_01_a === skin), {}, SKIN);
      const model = await page.evaluate(async ({ id, skin }) => {
        const { createFieldView } = await import('/js/render/app.js');
        const { data } = await import('/js/data.js');
        await data.load('assets'); await data.load('chess');
        const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:640px;height:360px;z-index:100'; document.body.appendChild(host);
        const view = await createFieldView(host, { data, board: '2d' });
        view.setPrep({ board: [{ uid: 900, kind: 'chess', id, row: 7, col: 3, skin }], hand: [], temp: [] });
        const until = Date.now() + 15000;
        while (!view.debug.views.get('p:900')?.actor && Date.now() < until) await new Promise(r => setTimeout(r, 50));
        const unit = view.debug.views.get('p:900');
        const result = { ready: !!unit?.actor, model: unit?.entry?.skel, skin: unit?.info?.skin };
        view.setPrep({ board: [{ uid: 900, kind: 'chess', id, row: 7, col: 3 }], hand: [], temp: [] });
        result.resetSkin = view.debug.views.get('p:900')?.info?.skin;
        view.destroy(); host.remove(); return result;
      }, { id: ID, skin: SKIN });
      assert.equal(model.ready, true); assert.equal(model.skin, SKIN); assert.ok(model.model.includes('char_498_inside_kitchen_2')); assert.equal(model.resetSkin, null);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); await srv.close(); }
});
