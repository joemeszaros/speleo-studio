import { test, expect } from '@playwright/test';
import { setupWithCave, rightClickCave, dismissNotifications } from './helpers.js';

test.describe('Survey Aliases Editor', () => {

  async function openAliasesEditor(page) {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey aliases"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    return editor;
  }

  // Add a row and set its from/to via the Tabulator API.
  async function addAlias(page, from, to) {
    const editor = page.locator('#resizable-editor');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await page.evaluate(({ from, to }) => {
      const table = document.querySelector('#survey-aliases-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      rows[rows.length - 1].update({ from, to });
    }, { from, to });
    await page.waitForTimeout(200);
  }

  test('opens from cave context menu', async ({ page }) => {
    const editor = await openAliasesEditor(page);
    await expect(editor.locator('#survey-aliases-table')).toBeVisible();
  });

  test('has toolbar buttons', async ({ page }) => {
    const editor = await openAliasesEditor(page);
    await expect(editor.locator('#add-row')).toBeAttached();
    await expect(editor.locator('#delete-row')).toBeAttached();
    await expect(editor.locator('#undo')).toBeAttached();
    await expect(editor.locator('#redo')).toBeAttached();
    await expect(editor.locator('#update-aliases')).toBeAttached();
    await expect(editor.locator('#cancel-aliases')).toBeAttached();
    await expect(editor.locator('#export-to-csv')).toBeAttached();
  });

  test('add alias row and fill from + to', async ({ page }) => {
    await openAliasesEditor(page);
    await addAlias(page, 'A0', 'B0');

    const rowData = await page.evaluate(() => {
      const table = document.querySelector('#survey-aliases-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const d = tabulator.getRows().at(-1).getData();
      return { from: d.from, to: d.to };
    });
    expect(rowData.from).toBe('A0');
    expect(rowData.to).toBe('B0');
  });

  test('validate empty row shows incomplete status', async ({ page }) => {
    const editor = await openAliasesEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);

    await editor.locator('#validate-aliases').click();
    await page.waitForTimeout(500);

    const status = await page.evaluate(() => {
      const table = document.querySelector('#survey-aliases-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().at(-1).getData().status;
    });
    expect(status).toBe('incomplete');
  });

  test('from equal to to shows invalid status after validation', async ({ page }) => {
    const editor = await openAliasesEditor(page);
    await addAlias(page, 'A0', 'A0');

    await editor.locator('#validate-aliases').click();
    await page.waitForTimeout(500);

    const status = await page.evaluate(() => {
      const table = document.querySelector('#survey-aliases-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().at(-1).getData().status;
    });
    expect(status).toBe('invalid');
  });

  test('duplicate alias pair shows invalid status after validation', async ({ page }) => {
    const editor = await openAliasesEditor(page);
    await addAlias(page, 'A0', 'B0');
    await addAlias(page, 'A0', 'B0');

    await editor.locator('#validate-aliases').click();
    await page.waitForTimeout(500);

    const statuses = await page.evaluate(() => {
      const table = document.querySelector('#survey-aliases-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows()
        .filter((r) => r.getData().from === 'A0' && r.getData().to === 'B0')
        .map((r) => r.getData().status);
    });
    expect(statuses.length).toBe(2);
    expect(statuses.some((s) => s === 'invalid')).toBe(true);
  });

  test('reversed alias pair is treated as a duplicate (undirected)', async ({ page }) => {
    const editor = await openAliasesEditor(page);
    await addAlias(page, 'A0', 'B0');
    await addAlias(page, 'B0', 'A0');

    await editor.locator('#validate-aliases').click();
    await page.waitForTimeout(500);

    const statuses = await page.evaluate(() => {
      const table = document.querySelector('#survey-aliases-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map((r) => r.getData().status);
    });
    expect(statuses.filter((s) => s === 'invalid').length).toBe(1);
  });

  test('undo reverts added row', async ({ page }) => {
    const editor = await openAliasesEditor(page);

    const initialCount = await page.evaluate(() => {
      const table = document.querySelector('#survey-aliases-table');
      return window.Tabulator.findTable(table)[0].getRows().length;
    });

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);

    await editor.locator('#undo').click();

    const afterCount = await page.evaluate(() => {
      const table = document.querySelector('#survey-aliases-table');
      return window.Tabulator.findTable(table)[0].getRows().length;
    });
    expect(afterCount).toBe(initialCount);
  });

  test('cancel closes editor without saving', async ({ page }) => {
    const editor = await openAliasesEditor(page);
    await addAlias(page, 'A0', 'B0');

    await editor.locator('#cancel-aliases').click();
    await expect(editor).toBeHidden();

    const aliasCount = await page.evaluate(() => window.speleo.db.getCave('Test Cave').aliases.length);
    expect(aliasCount).toBe(0);
  });

  test('update saves aliases to the cave', async ({ page }) => {
    const editor = await openAliasesEditor(page);
    await addAlias(page, 'A1', 'A3');

    await editor.locator('#update-aliases').click();
    await page.waitForTimeout(1000);
    await dismissNotifications(page);

    const aliases = await page.evaluate(() =>
      window.speleo.db.getCave('Test Cave').aliases.map((a) => ({ from: a.from, to: a.to }))
    );
    expect(aliases).toContainEqual({ from: 'A1', to: 'A3' });
  });

  test('export CSV produces download with correct filename', async ({ page }) => {
    const editor = await openAliasesEditor(page);

    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('survey-aliases.csv');
  });

  test('export CSV after adding aliases has correct content', async ({ page }) => {
    await openAliasesEditor(page);
    await addAlias(page, 'A0', 'A2');
    await addAlias(page, 'A1', 'A4');

    const editor = page.locator('#resizable-editor');
    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    const content = await (await download.createReadStream()).toArray();
    const csvText = Buffer.concat(content).toString('utf-8');

    const lines = csvText.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2 data rows

    expect(lines[0]).toContain('From');
    expect(lines[0]).toContain('To');

    expect(csvText).toContain('A0');
    expect(csvText).toContain('A2');
    expect(csvText).toContain('A1');
    expect(csvText).toContain('A4');
  });
});
