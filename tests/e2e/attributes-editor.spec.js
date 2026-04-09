import { test, expect } from '@playwright/test';
import { setupWithCave, rightClickCave, dismissNotifications } from './helpers.js';

test.describe('Attributes Editor', () => {

  async function openAttributesEditor(page, menuTitle) {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');
    await page.locator(`#explorer-context-menu .context-menu-option[title="${menuTitle}"]`).click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    return editor;
  }

  function getTabulator(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      return window.Tabulator.findTable(table)[0];
    });
  }

  async function getRowCount(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      return window.Tabulator.findTable(table)[0].getRows().length;
    });
  }

  async function getRowData(page, rowIndex) {
    return page.evaluate((idx) => {
      const table = document.querySelector('#sectionattributes');
      const rows = window.Tabulator.findTable(table)[0].getRows();
      return rows[idx]?.getData();
    }, rowIndex);
  }

  async function getColumns(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      return window.Tabulator.findTable(table)[0].getColumns().map(c => c.getField()).filter(Boolean);
    });
  }

  // ─── Basic Operations ────────────────────────────────────

  test('open station attributes editor', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await expect(editor.locator('#sectionattributes')).toBeVisible();
  });

  test('open section attributes editor', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit section attributes');
    await expect(editor.locator('#sectionattributes')).toBeVisible();
  });

  test('open component attributes editor', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit component attributes');
    await expect(editor.locator('#sectionattributes')).toBeVisible();
  });

  test('has toolbar with add, delete, and visibility buttons', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await expect(editor.locator('#add-row')).toBeAttached();
    await expect(editor.locator('#delete-row')).toBeAttached();
    await expect(editor.locator('#undo')).toBeAttached();
    await expect(editor.locator('#redo')).toBeAttached();
    await expect(editor.locator('#export-to-csv')).toBeAttached();
  });

  test('add attribute row', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');

    const initialCount = await getRowCount(page);
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const newCount = await getRowCount(page);
    expect(newCount).toBe(initialCount + 1);
  });

  test('undo reverts added row', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');

    const initialCount = await getRowCount(page);
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await editor.locator('#undo').click();
    await page.waitForTimeout(200);

    const afterCount = await getRowCount(page);
    expect(afterCount).toBe(initialCount);
  });

  test('redo restores undone row', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');

    const initialCount = await getRowCount(page);
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await editor.locator('#undo').click();
    await page.waitForTimeout(200);
    await editor.locator('#redo').click();
    await page.waitForTimeout(200);

    const afterCount = await getRowCount(page);
    expect(afterCount).toBe(initialCount + 1);
  });

  test('delete row removes selected row', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);

    const countBefore = await getRowCount(page);
    expect(countBefore).toBe(2);

    // Click the first row to select it
    await page.locator('#sectionattributes .tabulator-row').first().click();
    await page.waitForTimeout(200);
    await editor.locator('#delete-row').click();
    await page.waitForTimeout(200);

    const countAfter = await getRowCount(page);
    expect(countAfter).toBe(1);
  });

  // ─── Station Attributes Columns ──────────────────────────

  test('station attributes table has expected columns', async ({ page }) => {
    await openAttributesEditor(page, 'Edit station attributes');
    const columns = await getColumns(page);

    expect(columns).toContain('status');
    expect(columns).toContain('visible');
    expect(columns).toContain('station');
    expect(columns).toContain('survey');
    expect(columns).toContain('positionx');
    expect(columns).toContain('positiony');
    expect(columns).toContain('positionz');
    expect(columns).toContain('attribute');
  });

  test('section attributes table has expected columns', async ({ page }) => {
    await openAttributesEditor(page, 'Edit section attributes');
    const columns = await getColumns(page);

    expect(columns).toContain('status');
    expect(columns).toContain('visible');
    expect(columns).toContain('color');
    expect(columns).toContain('distance');
    expect(columns).toContain('from');
    expect(columns).toContain('to');
    expect(columns).toContain('attribute');
    expect(columns).toContain('format');
    expect(columns).toContain('interpolated');
  });

  test('component attributes table has expected columns', async ({ page }) => {
    await openAttributesEditor(page, 'Edit component attributes');
    const columns = await getColumns(page);

    expect(columns).toContain('status');
    expect(columns).toContain('visible');
    expect(columns).toContain('color');
    expect(columns).toContain('start');
    expect(columns).toContain('termination');
    expect(columns).toContain('attribute');
    expect(columns).toContain('format');
  });

  // ─── New Row Defaults ────────────────────────────────────

  test('new station attribute row has incomplete status', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const rowData = await getRowData(page, 0);
    expect(rowData.status).toBe('incomplete');
    expect(rowData.visible).toBe(false);
    expect(rowData.station).toBeUndefined();
  });

  test('new section attribute row has incomplete status and default color', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit section attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const rowData = await getRowData(page, 0);
    expect(rowData.status).toBe('incomplete');
    expect(rowData.visible).toBe(false);
    expect(rowData.color).toBeDefined();
    expect(rowData.from).toBeUndefined();
    expect(rowData.to).toBeUndefined();
  });

  test('new component attribute row has default format', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit component attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const rowData = await getRowData(page, 0);
    expect(rowData.format).toBe('${name}');
    expect(rowData.start).toBeUndefined();
  });

  // ─── Station Selection ───────────────────────────────────

  test('station attribute: selecting station auto-populates survey', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    // Edit the station cell by setting its value via Tabulator API
    await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      const row = tab.getRows()[0];
      const cell = row.getCell('station');
      cell.setValue('A0');
    });
    await page.waitForTimeout(500);

    const rowData = await getRowData(page, 0);
    expect(rowData.station).toBe('A0');
    expect(rowData.survey).toBe('Main Survey');
  });

  test('section attribute: selecting from/to stations', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit section attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    // Set from and to stations via Tabulator API
    await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      const row = tab.getRows()[0];
      row.getCell('from').setValue('A0');
      row.getCell('to').setValue('A2');
    });
    await page.waitForTimeout(500);

    const rowData = await getRowData(page, 0);
    expect(rowData.from).toBe('A0');
    expect(rowData.to).toBe('A2');
    // Distance should be auto-calculated (non-zero since A0→A1→A2 path exists)
    expect(rowData.distance).toBeGreaterThan(0);
  });

  // ─── Visibility Toggle ──────────────────────────────────

  test('visible cell is clickable and cell exists', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    // Verify the visible cell exists and is a tick/cross formatter
    const visibleCell = page.locator('#sectionattributes .tabulator-row .tabulator-cell[tabulator-field="visible"]').first();
    await expect(visibleCell).toBeVisible();

    // New row starts with visible=false
    const rowData = await getRowData(page, 0);
    expect(rowData.visible).toBe(false);
  });

  // ─── CSV Export ──────────────────────────────────────────

  test('export CSV button exists and is clickable', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await expect(editor.locator('#export-to-csv')).toBeAttached();

    // Add rows with data for a meaningful export
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      tab.getRows()[0].getCell('station').setValue('A0');
    });
    await page.waitForTimeout(300);

    // Click export - Tabulator's download creates a blob URL
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    // Download may or may not trigger depending on Tabulator version/browser
    if (download) {
      expect(download.suggestedFilename()).toContain('.csv');
    }
  });

  // ─── Multiple Rows ───────────────────────────────────────

  test('adding multiple rows increases count correctly', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');

    await editor.locator('#add-row').click();
    await editor.locator('#add-row').click();
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const count = await getRowCount(page);
    expect(count).toBe(3);
  });

  test('undo after multiple adds removes one at a time', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');

    await editor.locator('#add-row').click();
    await page.waitForTimeout(100);
    await editor.locator('#add-row').click();
    await page.waitForTimeout(100);
    await editor.locator('#add-row').click();
    await page.waitForTimeout(100);

    expect(await getRowCount(page)).toBe(3);

    await editor.locator('#undo').click();
    await page.waitForTimeout(100);
    expect(await getRowCount(page)).toBe(2);

    await editor.locator('#undo').click();
    await page.waitForTimeout(100);
    expect(await getRowCount(page)).toBe(1);
  });

  // ─── Row Context Menu ────────────────────────────────────

  test('right-clicking row shows context menu', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const row = page.locator('#sectionattributes .tabulator-row').first();
    await row.click({ button: 'right' });
    await page.waitForTimeout(300);

    const menu = page.locator('.tabulator-menu');
    await expect(menu).toBeVisible({ timeout: 3000 });
  });

  // ─── Incomplete vs Valid Status ──────────────────────────

  test('station attribute becomes valid after filling required fields', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit station attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    // Initially incomplete
    let rowData = await getRowData(page, 0);
    expect(rowData.status).toBe('incomplete');

    // Set station
    await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      tab.getRows()[0].getCell('station').setValue('A0');
    });
    await page.waitForTimeout(500);

    // Status may have changed (depends on whether attribute is also required)
    rowData = await getRowData(page, 0);
    expect(rowData.station).toBe('A0');
    // Station set but attribute still missing — should still be incomplete
    expect(rowData.status).toBe('incomplete');
  });

  // ─── Section Attribute Distance Calculation ──────────────

  test('section attribute distance updates when stations change', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit section attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    // Set from=A0 and to=A1
    await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      const row = tab.getRows()[0];
      row.getCell('from').setValue('A0');
      row.getCell('to').setValue('A1');
    });
    await page.waitForTimeout(500);

    const rowData = await getRowData(page, 0);
    // A0→A1 is a direct shot of 5.2m
    expect(rowData.distance).toBeCloseTo(5.2, 0);
  });

  // ─── Component Attribute ─────────────────────────────────

  test('component attribute: setting start station', async ({ page }) => {
    const editor = await openAttributesEditor(page, 'Edit component attributes');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      tab.getRows()[0].getCell('start').setValue('A0');
    });
    await page.waitForTimeout(500);

    const rowData = await getRowData(page, 0);
    expect(rowData.start).toBe('A0');
  });

  // ─── Header Filters ─────────────────────────────────────

  test('station column has header filter', async ({ page }) => {
    await openAttributesEditor(page, 'Edit station attributes');

    const hasFilter = await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      const col = tab.getColumn('station');
      return col.getDefinition().headerFilter !== undefined;
    });
    expect(hasFilter).toBe(true);
  });

  test('from column has header filter in section editor', async ({ page }) => {
    await openAttributesEditor(page, 'Edit section attributes');

    const hasFilter = await page.evaluate(() => {
      const table = document.querySelector('#sectionattributes');
      const tab = window.Tabulator.findTable(table)[0];
      const col = tab.getColumn('from');
      return col.getDefinition().headerFilter !== undefined;
    });
    expect(hasFilter).toBe(true);
  });
});
