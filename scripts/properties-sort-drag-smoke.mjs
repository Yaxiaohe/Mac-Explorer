import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-properties-'));
for (const folder of ['Documents', 'Desktop', 'Downloads']) await fs.mkdir(path.join(root, folder));
const docs = path.join(root, 'Documents');
await fs.writeFile(path.join(docs, 'a.txt'), 'a'.repeat(200));
await fs.writeFile(path.join(docs, 'b.txt'), 'b');
await fs.mkdir(path.join(docs, '子文件夹'));
const flags = (process.env.EXPLORER_SMOKE_ARGS || '').split(' ').filter(Boolean);
const app = await electron.launch({ ...(process.env.EXPLORER_APP_PATH ? { executablePath: process.env.EXPLORER_APP_PATH, args: flags } : { args: [process.cwd(), ...flags] }), env: { ...process.env, EXPLORER_TEST_ROOT: root } });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const row = name => page.getByRole('option', { name, exact: true });
  const dialog = page.getByRole('dialog');
  const closeDialog = async () => { await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); };

  // Alt+double-click opens the Windows-style properties dialog.
  await row('a.txt').dblclick({ modifiers: ['Alt'] });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('heading', { name: '属性', exact: true }).count(), 1);
  const values = await dialog.locator('.properties-list dd').allInnerTexts();
  assert.ok(values.includes('a.txt'), `name row: ${values.join(' | ')}`);
  assert.ok(values.includes('文本文档'), `type row: ${values.join(' | ')}`);
  assert.ok(values.some(value => value === docs), `location row: ${values.join(' | ')}`);
  assert.equal(await dialog.locator('.properties-list > div').count(), 7);
  await closeDialog();

  // Alt+Enter on the selection opens the same dialog, folders included.
  await row('子文件夹').click();
  await page.keyboard.press('Alt+Enter');
  await dialog.waitFor();
  assert.ok((await dialog.locator('.properties-list dd').allInnerTexts()).includes('文件夹'));
  await closeDialog();

  // The empty-area context menu gains 排序方式, and picking a key re-sorts the listing.
  const box = await page.locator('.file-content').boundingBox();
  await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30, { button: 'right' });
  const menu = page.locator('.context-menu').first();
  await menu.waitFor();
  await menu.locator('button').filter({ hasText: '排序方式' }).first().click();
  const submenu = page.locator('.context-submenu');
  await submenu.waitFor();
  await submenu.locator('button').filter({ hasText: '大小' }).first().click();
  await page.waitForFunction(() => localStorage.getItem('sort') === '"size"');
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll('.file-row')].map(element => element.getAttribute('aria-label'));
    return names.indexOf('b.txt') >= 0 && names.indexOf('b.txt') < names.indexOf('a.txt');
  });

  // Alt-drag hands the paths to the native drag session; a plain drag still fills the HTML5 payload.
  const dragged = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.file-row')].find(element => element.getAttribute('aria-label') === 'a.txt');
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, altKey: true, dataTransfer: new DataTransfer() }));
  });
  assert.equal(dragged, undefined);
  await page.waitForTimeout(400);
  const nativePaths = await app.evaluate(() => globalThis.__lastDrag);
  assert.ok(Array.isArray(nativePaths) && nativePaths.some(p => p.endsWith('a.txt')), `native drag: ${JSON.stringify(nativePaths)}`);
  const html5 = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.file-row')].find(element => element.getAttribute('aria-label') === 'a.txt');
    const transfer = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return transfer.getData('application/x-explorer-paths');
  });
  assert.ok(JSON.parse(html5).some(p => p.endsWith('a.txt')), `html5 payload: ${html5}`);
  console.log('PASS: Alt+double-click and Alt+Enter open the properties dialog (file and folder), the empty-area menu sorts, Alt-drag starts a native drag and a plain drag keeps the HTML5 payload.');
} finally {
  await app.close(); await fs.rm(root, { recursive: true, force: true });
}
