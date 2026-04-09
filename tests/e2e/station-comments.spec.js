import { test, expect } from '@playwright/test';
import { setupWithCave, rightClickCave, dismissNotifications } from './helpers.js';

test.describe('Station Comments Editor', () => {

  async function openCommentsEditor(page) {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');
    await page.locator('#explorer-context-menu .context-menu-option[title*="omment"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    return editor;
  }

  test('opens from cave context menu', async ({ page }) => {
    const editor = await openCommentsEditor(page);
    await expect(editor.locator('#station-comments-table')).toBeVisible();
  });

  test('has toolbar buttons', async ({ page }) => {
    const editor = await openCommentsEditor(page);
    await expect(editor.locator('#add-row')).toBeAttached();
    await expect(editor.locator('#delete-row')).toBeAttached();
    await expect(editor.locator('#undo')).toBeAttached();
    await expect(editor.locator('#redo')).toBeAttached();
    await expect(editor.locator('#update-comments')).toBeAttached();
    await expect(editor.locator('#cancel-comments')).toBeAttached();
    await expect(editor.locator('#export-to-csv')).toBeAttached();
  });

  test('add comment row and fill station + comment', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      rows[rows.length - 1].update({ station: 'A0', comment: 'Entrance station' });
    });
    await page.waitForTimeout(200);

    const rowData = await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      const d = rows[rows.length - 1].getData();
      return { station: d.station, comment: d.comment };
    });
    expect(rowData.station).toBe('A0');
    expect(rowData.comment).toBe('Entrance station');
  });

  test('validate empty row shows incomplete status', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);

    await editor.locator('#validate-comments').click();
    await page.waitForTimeout(500);

    const status = await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      return rows[rows.length - 1].getData().status;
    });
    expect(status).toBe('incomplete');
  });

  test('undo reverts added row', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    const initialCount = await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      return window.Tabulator.findTable(table)[0].getRows().length;
    });

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);

    await editor.locator('#undo').click();

    const afterCount = await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      return window.Tabulator.findTable(table)[0].getRows().length;
    });
    expect(afterCount).toBe(initialCount);
  });

  test('cancel closes editor without saving', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      tabulator.getRows()[tabulator.getRows().length - 1].update({ station: 'A0', comment: 'Should not persist' });
    });

    await editor.locator('#cancel-comments').click();
    await expect(editor).toBeHidden();
  });

  test('update saves comments', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      tabulator.getRows()[tabulator.getRows().length - 1].update({ station: 'A1', comment: 'Junction point' });
    });
    await page.waitForTimeout(200);

    await editor.locator('#update-comments').click();
    await page.waitForTimeout(1000);
    await dismissNotifications(page);
  });

  test('export CSV produces download with correct filename', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('station-comments.csv');
  });

  test('export CSV after adding comments has correct content', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    // Add two comments
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      tabulator.getRows()[tabulator.getRows().length - 1].update({ station: 'A0', comment: 'Entrance' });
    });

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      tabulator.getRows()[tabulator.getRows().length - 1].update({ station: 'A2', comment: 'Junction point' });
    });
    await page.waitForTimeout(200);

    // Export CSV
    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    const content = await (await download.createReadStream()).toArray();
    const csvText = Buffer.concat(content).toString('utf-8');

    // Verify header and data rows
    const lines = csvText.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2 data rows

    // Header should contain Station and Comment columns
    expect(lines[0]).toContain('Station');
    expect(lines[0]).toContain('Comment');

    // Data rows should contain our comments
    expect(csvText).toContain('A0');
    expect(csvText).toContain('Entrance');
    expect(csvText).toContain('A2');
    expect(csvText).toContain('Junction point');
  });

  test('duplicate station comment shows invalid status after validation', async ({ page }) => {
    const editor = await openCommentsEditor(page);

    // Add first comment for A0
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      tabulator.getRows()[tabulator.getRows().length - 1].update({ station: 'A0', comment: 'First comment' });
    });

    // Add second comment for the same station A0
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      tabulator.getRows()[tabulator.getRows().length - 1].update({ station: 'A0', comment: 'Duplicate comment' });
    });
    await page.waitForTimeout(200);

    // Validate
    await editor.locator('#validate-comments').click();
    await page.waitForTimeout(500);

    // At least one of the duplicate rows should be marked invalid
    const statuses = await page.evaluate(() => {
      const table = document.querySelector('#station-comments-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows()
        .filter(r => r.getData().station === 'A0')
        .map(r => r.getData().status);
    });

    expect(statuses.length).toBe(2);
    expect(statuses.some(s => s === 'invalid')).toBe(true);
  });
});
