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
        window.shellReports = []; window.nativeUpdateCalls = 0;
        window.nativeDisplay = { highRefresh: true, edgePaddingPx: 0 };
        window.nativeDisplayWrites = [];
        window.AndroidNative = {
          reportClientState: json => window.shellReports.push(JSON.parse(json)),
          getDisplaySettings: () => JSON.stringify(window.nativeDisplay),
          setDisplaySettings: (highRefresh, edgePaddingPx) => {
            window.nativeDisplay = { highRefresh, edgePaddingPx };
            window.nativeDisplayWrites.push({ highRefresh, edgePaddingPx });
          },
          checkAppUpdate: () => { window.nativeUpdateCalls++; },
          getAppVersion: () => '0.2.5',
          openServerSettings: () => { throw new Error('Independent native settings must not open'); },
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
        assert.ok(await page.$('.lobby-screen .topbar__tools .lobby-settings'), 'the upstream lobby puts settings in its left toolbar');
        assert.equal(await page.$$eval('.lobby-settings, .sp-shell-settings', es => es.length), 1, 'the shell recognizes the relocated web settings button');
        // An old deployed lobby lacks this entry. The shell must supply one
        // without replacing that server's account or settings implementation.
        await page.evaluate(() => document.querySelector('.lobby-settings').remove());
        await page.waitForSelector('.sp-shell-settings', { visible: true });
        // Simulate the web button arriving after the shell fallback. This was
        // the login rendering race that left two buttons on the updated server.
        await page.evaluate(() => {
          const button = document.createElement('button');
          button.className = 'lobby-settings'; button.textContent = '设置';
          document.querySelector('.lobby-screen .topbar__right').appendChild(button);
        });
        await page.waitForFunction(() => !document.querySelector('.sp-shell-settings'));
        assert.equal(await page.$$eval('.lobby-settings, .sp-shell-settings', es => es.length), 1);
        await page.evaluate(() => document.querySelector('.lobby-settings').remove());
        await page.waitForSelector('.sp-shell-settings', { visible: true });
        await page.click('.sp-shell-settings');
      } else await page.click('.lobby-settings');
      await page.waitForSelector('.modal .set-range', { visible: true });
      assert.equal(await page.$('.set-guide'), null, 'settings no longer include a guide button');
      if (android) {
        assert.equal(await page.$$eval('.set-hint kbd', es => es.length), 0, 'native Android has no keyboard shortcut description');
        // The APK also adapts an older served settings modal without requiring
        // a server deployment: its guide and keyboard-only hint remain hidden.
        await page.evaluate(() => {
          const guide = document.createElement('button'); guide.className = 'set-guide'; guide.textContent = '玩法说明';
          document.querySelector('.modal__actions').prepend(guide);
          const hint = document.createElement('p'); hint.className = 'set-hint'; hint.innerHTML = '快捷键：<kbd>R</kbd> 刷新';
          document.querySelector('.set-list').appendChild(hint);
        });
        await page.waitForFunction(() => [...document.querySelectorAll('.set-hint')].filter(e => e.querySelector('kbd')).every(e => getComputedStyle(e).display === 'none'));
        assert.equal(await page.$eval('.set-guide', e => getComputedStyle(e).display), 'none');
        await page.waitForSelector('[data-testid="native-settings"]', { visible: true });
        assert.equal(await page.$('.native-display-settings, .sp-shell-display-settings'), null);
        await page.click('[data-testid="native-settings"] [role="switch"]');
        await page.waitForFunction(() => window.nativeDisplay.highRefresh === false);
        await page.$eval('[data-testid="native-edge-padding"]', el => {
          el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => window.nativeDisplay.edgePaddingPx === 80);
        assert.deepEqual(await page.evaluate(() => window.nativeDisplay), { highRefresh: false, edgePaddingPx: 80 });
        await page.click('[data-testid="native-check-update"]');
        assert.equal(await page.evaluate(() => window.nativeUpdateCalls), 1);
        // The Back menu must reuse an existing settings modal, never stack another one.
        await page.evaluate(() => window.__SP_OPEN_SETTINGS__());
        assert.equal(await page.$$eval('.modal .set-list', es => es.length), 1);
      }
      await page.$eval('.set-range', el => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('sp.pref.settings')).bgm === 0.35);
      await page.evaluate(() => [...document.querySelectorAll('.modal__actions button')].find(b => b.textContent.trim() === '完成').click());
      await page.waitForFunction(() => !document.querySelector('.modal'));
      await page.evaluate(() => window.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }));
      await page.waitForSelector('.room-settings', { visible: true });
      if (android) {
        await page.waitForFunction(() => !document.querySelector('.sp-shell-settings'));
        assert.equal(await page.$$eval('.room-settings, .sp-shell-settings', es => es.length), 1);
      }
      await page.click('.room-settings');
      await page.waitForSelector('.modal .set-range', { visible: true });
      if (android) {
        assert.equal(await page.$eval('[data-testid="native-edge-padding"]', el => el.value), '80');
        assert.equal(await page.$eval('[data-testid="native-settings"] [role="switch"]', el => el.getAttribute('aria-checked')), 'false');
      } else assert.equal(await page.$('[data-testid="native-settings"]'), null);
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
