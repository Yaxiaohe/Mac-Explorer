import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-move-'));
await fs.mkdir(path.join(root, 'Documents/target'), { recursive: true });
await fs.mkdir(path.join(root, 'Desktop'));
for (const name of ['move.txt', 'collision.txt']) await fs.writeFile(path.join(root, 'Documents', name), 'source');
await fs.writeFile(path.join(root, 'Documents/target/collision.txt'), 'destination');
const flags = (process.env.EXPLORER_SMOKE_ARGS || '').split(' ').filter(Boolean);
const app = await electron.launch({ ...(process.env.EXPLORER_APP_PATH ? { executablePath: process.env.EXPLORER_APP_PATH, args: flags } : { args: [process.cwd(), ...flags] }), env: { ...process.env, EXPLORER_TEST_ROOT: root, EXPLORER_TEST_HIDDEN: '1' } });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const row = name => page.getByRole('option', { name, exact: true });
  await row('move.txt').waitFor();
  // One gesture serves both purposes: the drag itself is a native session (so it can leave the
  // window), and the window reports its drop targets so the main process can tell whether the
  // release landed back inside. These helpers drive the two IPC messages that path produces.
  const grab = name => page.evaluate(name => {
    const file = [...document.querySelectorAll('.file-row')].find(element => element.getAttribute('aria-label') === name);
    file.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  }, name);
  const land = destination => app.evaluate(({ BrowserWindow }, destination) => {
    BrowserWindow.getAllWindows()[0].webContents.send('drag-drop', destination);
  }, destination);
  const hover = key => app.evaluate(({ BrowserWindow }, key) => {
    BrowserWindow.getAllWindows()[0].webContents.send('drag-hover', key);
  }, key);

  await grab('move.txt');
  await land(path.join(root, 'Documents/target'));
  await row('move.txt').waitFor({ state: 'detached' });
  assert.equal(await fs.readFile(path.join(root, 'Documents/target/move.txt'), 'utf8'), 'source');
  await page.evaluate(() => window.explorer.undo());
  await row('move.txt').waitFor();
  // A drop coming from another app still travels the HTML5 route and keeps its file list.
  async function dropFile(input, target) {
    const data = await page.evaluateHandle(input => { const data = new DataTransfer(); data.setData('application/x-explorer-paths', JSON.stringify([input])); return data; }, input);
    await target.dispatchEvent('drop', { dataTransfer: data });
    await data.dispose();
  }
  const collision = await page.evaluate(root => window.explorer.moveTo([root + '/Documents/collision.txt'], root + '/Documents/target'), root);
  assert.equal(collision.errors.length, 1);
  assert.equal(await fs.readFile(path.join(root, 'Documents/collision.txt'), 'utf8'), 'source');
  assert.equal(await fs.readFile(path.join(root, 'Documents/target/collision.txt'), 'utf8'), 'destination');
  // Sidebar place and empty background both take the release.
  await grab('move.txt');
  await land(path.join(root, 'Desktop'));
  await row('move.txt').waitFor({ state: 'detached' });
  assert.equal(await fs.readFile(path.join(root, 'Desktop/move.txt'), 'utf8'), 'source');
  await dropFile(path.join(root, 'Desktop/move.txt'), page.locator('.file-content'));
  await row('move.txt').waitFor();
  await assert.rejects(fs.access(path.join(root, 'Desktop/move.txt')));
  const opened = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.dock.getMenu().items.find(item => item.label === '新建窗口').click());
  const second = await opened; await second.getByRole('tab').waitFor();
  const closed = second.waitForEvent('close');
  await second.locator('.tab-close').click(); await closed;
  assert.equal(page.isClosed(), false);
  const settle = async file => {
    for (let attempt = 0; attempt < 60; attempt++) { try { await fs.access(file); return; } catch { await page.waitForTimeout(100); } }
    throw new Error(`missing ${file}`);
  };
  // Hovering an inactive tab during the drag switches to it, and releasing over it moves the
  // files into that tab's folder. The drag starts while the file is still in view.
  await grab('move.txt');
  await page.getByRole('button', { name: '桌面', exact: true }).click();
  await page.getByRole('button', { name: '新建标签页 (⌘T)', exact: true }).click();
  assert.equal(await page.getByRole('tab').count(), 2);
  const desktopTab = page.locator('.tab').filter({ hasText: '桌面' }).first();
  const desktopKey = await desktopTab.evaluate(element => element.dataset.dropKey);
  assert.ok(desktopKey, 'the tab advertises where a drop would land');
  await hover(desktopKey);
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === '桌面', undefined, { timeout: 5000 });
  await land(path.join(root, 'Desktop'));
  await settle(path.join(root, 'Desktop/move.txt'));
  assert.equal(await fs.readFile(path.join(root, 'Desktop/move.txt'), 'utf8'), 'source');
  await assert.rejects(fs.access(path.join(root, 'Documents/move.txt')));
  console.log('PASS: row/sidebar/background/tab drops move, hover switches tabs, undo restores, collisions preserve both files, closing last tab closes only its window.');
} finally { await app.close(); await fs.rm(root, { recursive: true, force: true }); }
