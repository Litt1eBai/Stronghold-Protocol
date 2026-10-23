import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && chrome && existsSync(chrome);

test('required account: bad password stays on login, password login and saved JWT restore the lobby',
  { skip: !enabled, timeout: 60000 }, async () => {
    const { startServer } = await import('../../server/index.js');
    const { AuthStore } = await import('../../server/auth.js');
    const puppeteer = (await import('puppeteer-core')).default;
    const dir = mkdtempSync(join(tmpdir(), 'sp-account-browser-'));
    const auth = new AuthStore({ file: join(dir, 'accounts.json'), required: true, secret: 'browser-test-secret' });
    auth.createUser({ username: 'doctor', displayName: 'Doctor', password: 'example-password' });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, auth });
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.title-login input[type="password"]');
      await page.type('.title-login input:not([type="password"])', 'doctor');
      await page.type('.title-login input[type="password"]', 'wrong');
      const start = () => page.evaluate(() => document.querySelector('.title-login .btn--primary').click());
      await start();
      await page.waitForFunction(() => window.__SP__?.net.lastError?.code === 'AUTH_INVALID'
        && window.__SP__.store.get().session.entered === false);
      assert.equal(await page.$('.lobby-settings'), null);
      await page.$eval('.title-login input[type="password"]', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.type('.title-login input[type="password"]', 'example-password');
      await start();
      await page.waitForSelector('.lobby-settings', { visible: true });
      assert.equal(await page.evaluate(() => window.__SP__.store.get().me.account.username), 'doctor');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.lobby-settings', { visible: true });
      assert.equal(await page.evaluate(() => window.__SP__.store.get().me.account.username), 'doctor');
      await page.evaluate(() => localStorage.setItem('sp.pref.loadout.view', JSON.stringify('deck')));
      await page.click('[data-testid="loadout-open"]');
      await page.waitForSelector('[data-testid="loadout-ownership"]');
      assert.ok(await page.$('[data-diy-tier="5"]'));
      assert.ok(await page.$('[data-diy-tier="6"]'));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await srv.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
