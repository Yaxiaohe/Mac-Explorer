import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-startup-'));
for (const folder of ['Documents', 'Desktop', '固定目录']) await fs.mkdir(path.join(root, folder));
const flags = (process.env.EXPLORER_SMOKE_ARGS || '').split(' ').filter(Boolean);
const app = await electron.launch({ ...(process.env.EXPLORER_APP_PATH ? { executablePath: process.env.EXPLORER_APP_PATH, args: flags } : { args: [process.cwd(), ...flags] }), env: { ...process.env, EXPLORER_TEST_ROOT: root, EXPLORER_TEST_HIDDEN: '1' } });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.locator('.file-content[aria-busy=false]').waitFor();
  // Command+E must stay registered globally so the app can be raised from anywhere.
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Command+E')), true);
  // Keep the fixture home, but remove the test harness's Documents override.
  await app.evaluate(({ ipcMain }) => {
    const bootstrap = ipcMain._invokeHandlers.get('bootstrap');
    ipcMain.removeHandler('bootstrap');
    ipcMain.handle('bootstrap', async (...args) => ({ ...await bootstrap(...args), initialPath: undefined }));
  });
  const personal = page.locator('.file-content[aria-label="个人文件夹"][aria-busy=false]');
  for (const saved of [[], ['home', path.join(root, 'Desktop'), 'home'], ['bad'], { invalid: true }]) {
    await page.evaluate(({ saved, root }) => {
      localStorage.setItem('tabs', JSON.stringify(saved));
      localStorage.setItem('pins', JSON.stringify([root + '/固定目录']));
    }, { saved, root });
    await page.reload(); await personal.waitFor();
    assert.equal(await page.getByRole('tab', { name: '主页', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '主页', exact: true }).count(), 0);
    assert.equal(await page.getByRole('tab', { name: '个人文件夹', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '固定目录', exact: true }).waitFor();
    if (Array.isArray(saved) && saved.includes(path.join(root, 'Desktop'))) await page.getByRole('tab', { name: '桌面', exact: true }).waitFor();
  }
  await page.getByRole('option', { name: 'Desktop', exact: true }).dblclick();
  await page.getByText('此文件夹为空', { exact: true }).waitFor();
  await page.getByRole('button', { name: '新建标签页 (⌘T)', exact: true }).click(); await personal.waitFor();
  await page.keyboard.press('Meta+w'); await page.getByText('此文件夹为空', { exact: true }).waitFor();
  await page.keyboard.press('Meta+t'); await personal.waitFor();
  await page.keyboard.press('Meta+w'); await page.getByText('此文件夹为空', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/personal-folder-startup-fixture.png' });
  const closed = page.waitForEvent('close');
  await page.keyboard.press('Meta+w').catch(error => { if (!page.isClosed()) throw error; }); await closed;
  console.log('PASS: personal-folder startup; migrated legacy Home tabs; preserved directories/pins; toolbar and Command+T; final-tab closes window; malformed saved state.');
} finally { await app.close(); await fs.rm(root, { recursive: true, force: true }); }
