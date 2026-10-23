import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { png } from '../helpers/pluginFixtures.js';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && chrome && existsSync(chrome);

test('paper hub on desktop and touch: local backdrop, reports, quick skins, portrait sync and plain-text chat',
  { skip: !enabled, timeout: 120000 }, async () => {
    const { startServer } = await import('../../server/index.js');
    const { AuthStore } = await import('../../server/auth.js');
    const puppeteer = (await import('puppeteer-core')).default;
    const temp = mkdtempSync(join(tmpdir(), 'sp-hub-browser-'));
    const imageBytes = png(64, 32);
    const image = join(temp, 'backdrop.png'); writeFileSync(image, imageBytes);
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth: new AuthStore({ required: false }) });
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    mkdirSync('test/e2e/out', { recursive: true });
    const errors = [];
    const contexts = [];
    const newPage = async viewport => {
      const context = await browser.createBrowserContext(); contexts.push(context);
      const page = await context.newPage();
      await page.setViewport(viewport);
      page.on('pageerror', e => { errors.push(e.message); console.error('page error:', e.message); });
      await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'hub-test'); sessionStorage.setItem('sp.entered', '1'); });
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.lobby-settings', { visible: true });
      return page;
    };
    try {
      for (const viewport of [{ width: 1600, height: 900 }, { width: 844, height: 390, isMobile: true, hasTouch: true }]) {
        const page = await newPage(viewport);
        // The earlier local picture database must migrate without losing the original blob.
        await page.evaluate(async encoded => {
          localStorage.removeItem('sp.pref.lobby.media');
          localStorage.setItem('sp.pref.hub.backdrop', JSON.stringify({ theme: 'custom', dim: 45 }));
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('sp-hub-backdrop', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
          });
          await new Promise((resolve, reject) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }), 'image');
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
          });
          db.close();
        }, imageBytes.toString('base64'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="own-backdrop"] img');
        const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.lobby.media')));
        assert.equal(migrated.backdrop, true);
        assert.equal(migrated.dim, 0.45);
        await page.click('[data-testid="lobby-media"]');
        await page.waitForSelector('.lmedia', { visible: true });
        await page.click('.bgset__theme[data-scene="frost"]');
        await page.waitForFunction(() => !!document.querySelector('[data-hub-theme="frost"]'));
        const input = await page.$('[data-testid="media-backdrop-file"]'); await input.uploadFile(image);
        await page.waitForSelector('[data-testid="own-backdrop"]');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="own-backdrop"]');
        await page.screenshot({ path: `test/e2e/out/paper-hub-${viewport.width}.png` });
        await page.click('.hub-plate--sweep');
        await page.waitForSelector('.sw-tab');
        const tabs = await page.$$('.sw-tab'); assert.equal(tabs.length, 3);
        for (const tab of tabs) { await tab.click(); await page.waitForFunction(() => !!document.querySelector('.sw-right')?.textContent.trim()); }
        await page.click('.sw-top .sw-back');
        await page.waitForFunction(() => !document.querySelector('.sw'));
        await page.evaluate(() => localStorage.setItem('sp.pref.loadout.view', JSON.stringify('deck')));
        await page.click('[data-testid="loadout-open"]');
        await page.waitForSelector('.lo-op[data-chess="chess_char_1_01_a"]');
        await page.click('[data-testid="loadout-quick"]');
        await page.click('.lo-qseg button:last-child');
        const card = '.lo-op[data-chess="chess_char_1_01_a"]';
        await page.waitForSelector(`${card} .lo-q--skin:nth-child(2)`);
        await page.$eval(`${card} .lo-q--skin:nth-child(2)`, e => e.click());
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('sp.pref.skins') || '{}').char_498_inside === 'char_498_inside@kitchen#2');
        // The card must use the selected manifest URL, not merely store a selection.
        await page.waitForFunction(() => document.querySelector('.lo-op[data-chess="chess_char_1_01_a"] .lo-op__art img')?.src.includes('char_498_inside_kitchen_2'));
        await page.evaluate(async () => (await import('/js/ui/loadoutSync.js')).closeLoadout());
        await page.waitForFunction(() => !document.querySelector('.lo'));
        await page.click('.hub-entry-wrap:nth-child(2) .hub-entry');
        await page.waitForSelector('.ally-card--create', { visible: true });
        await page.click('.ally-card--create');
        await page.waitForSelector('.rseat.is-me .rseat__pick', { visible: true });
        const code = await page.evaluate(() => window.__SP__.store.get().room.code);
        const guest = await newPage(viewport);
        await guest.evaluate(code => window.__SP__.net.request('room.join', { code }), code);
        await guest.waitForSelector('.room-settings', { visible: true });
        // Floating chat can cover a card; fold it while choosing the portrait.
        await page.click('.spchat__fold');
        await guest.click('.spchat__fold');
        await page.click('.rseat.is-me .rseat__pick');
        await page.waitForSelector('.cardpick__search input');
        await page.type('.cardpick__search input', '隐现');
        await page.click('.cardpick__op:not(.cardpick__op--auto)');
        await guest.waitForFunction(() => window.__SP__.store.get().room.seats.some(s => s?.card === 'char_498_inside'));
        await page.click('.spchat__toggle');
        await guest.click('.spchat__toggle');
        await page.waitForSelector('.spchat__input', { visible: true });
        const text = '<img src=x onerror=alert(1)>';
        await page.type('.spchat__input', text);
        await page.click('.spchat__send');
        await guest.waitForFunction(text => [...document.querySelectorAll('.spchat__bubble')].some(e => e.textContent === text), {}, text);
        assert.equal(await guest.$('.spchat__bubble img'), null);
        await guest.click('.spchat__danmaku');
        assert.equal(await guest.$eval('.spchat__danmaku', e => e.getAttribute('aria-pressed')), 'false');
        // Fold chat before touching room controls on a narrow phone.
        await page.click('.spchat__fold'); await guest.click('.spchat__fold');
        await page.screenshot({ path: `test/e2e/out/paper-room-${viewport.width}.png` });
        await page.click('.room-settings');
        await page.waitForSelector('[data-testid="map-brightness"]');
        await page.$eval('[data-testid="map-brightness"]', e => { e.value = '150'; e.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.get().mapBrightness), 1.5);
        await page.close(); await guest.close();
      }
      assert.deepEqual(errors, []);
    } finally {
      for (const context of contexts) await context.close();
      await browser.close(); await srv.close(); rmSync(temp, { recursive: true, force: true });
    }
  });
