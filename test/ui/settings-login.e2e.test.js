import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
const chrome = process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && chrome && existsSync(chrome);

test('settings are available after login, including Android adaptation of older deployed pages', { skip: !enabled, timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const { AuthStore } = await import('../../server/auth.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth: new AuthStore({ required: false, registration: false }) });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    for (const android of [false, true]) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setViewport(android ? { width: 844, height: 390, hasTouch: true, isMobile: true } : { width: 1440, height: 900 });
      if (android) await page.evaluateOnNewDocument(() => {
        window.shellReports = []; window.nativeSettingsCalls = 0;
        window.AndroidNative = {
          reportClientState: json => window.shellReports.push(JSON.parse(json)),
          openServerSettings: () => { window.nativeSettingsCalls++; },
        };
      });
      await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'domcontentloaded' });
      if (android) await page.addScriptTag({ path: path.resolve('client/android/app/src/main/assets/shell.js') });
      await page.waitForSelector('.title-screen', { visible: true });
      assert.equal(await page.$('.title-settings, .lobby-settings, .room-settings, .sp-shell-settings'), null);
      await page.type('.title-login input', 'settings-test');
      await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(b => b.textContent.trim() === '开始').click());
      await page.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online');
      await page.waitForSelector('.lobby-settings', { visible: true });
      if (android) {
        await page.waitForFunction(() => window.shellReports.some(s => s.loggedIn));
        // An old deployed lobby lacks this entry. The shell must supply one
        // without replacing that server's account or settings implementation.
        await page.evaluate(() => document.querySelector('.lobby-settings').remove());
        await page.waitForSelector('.sp-shell-settings', { visible: true });
        await page.click('.sp-shell-settings');
      } else await page.click('.lobby-settings');
      await page.waitForSelector('.modal .set-range', { visible: true });
      await page.$eval('.set-range', el => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('sp.pref.settings')).bgm === 0.35);
      if (android) {
        await page.click('.native-display-settings');
        assert.equal(await page.evaluate(() => window.nativeSettingsCalls), 1);
        assert.equal(await page.$$eval('.native-display-settings', es => es.length), 1);
      }
      await page.evaluate(() => [...document.querySelectorAll('.modal__actions button')].find(b => b.textContent.trim() === '完成').click());
      await page.waitForFunction(() => !document.querySelector('.modal'));
      await page.evaluate(() => window.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }));
      await page.waitForSelector('.room-settings', { visible: true });
      await page.click('.room-settings');
      await page.waitForSelector('.modal .set-range', { visible: true });
      await page.evaluate(() => [...document.querySelectorAll('.modal__actions button')].find(b => b.textContent.trim() === '完成').click());
      await page.evaluate(() => window.__SP__.store.set({ session: { entered: false } }));
      await page.waitForSelector('.title-screen', { visible: true });
      assert.equal(await page.$('.title-settings, .lobby-settings, .room-settings, .sp-shell-settings'), null);
      if (android) await page.waitForFunction(() => window.shellReports.at(-1).loggedIn === false);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); await srv.close(); }
});
