import { test, expect } from '@playwright/test';
import { setupWithCave, rightClickCave } from './helpers.js';

test.describe('Cycle Editor', () => {

  async function openCycleEditor(page, fixture = 'sample-cave.json', caveName = 'Test Cave') {
    await setupWithCave(page, fixture, caveName);
    await rightClickCave(page, caveName);
    await page.locator('#explorer-context-menu .context-menu-option[title*="ycle"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    return editor;
  }

  test('opens from cave context menu', async ({ page }) => {
    const editor = await openCycleEditor(page);
    await expect(editor.locator('#cycle-table')).toBeVisible();
  });

  test('has show/hide all cycles buttons', async ({ page }) => {
    const editor = await openCycleEditor(page);
    await expect(editor.locator('#show-all-cycles')).toBeAttached();
    await expect(editor.locator('#hide-all-cycles')).toBeAttached();
  });

  test('has show/hide deviating shots buttons', async ({ page }) => {
    const editor = await openCycleEditor(page);
    await expect(editor.locator('#show-all-deviating-shots')).toBeAttached();
    await expect(editor.locator('#hide-all-deviating-shots')).toBeAttached();
  });

  test('table has expected columns', async ({ page }) => {
    const editor = await openCycleEditor(page);

    const columns = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator
        .getColumns()
        .map((c) => c.getField())
        .filter(Boolean);
    });

    expect(columns).toContain('visible');
    expect(columns).toContain('color');
    expect(columns).toContain('distance');
    expect(columns).toContain('errorPercentage');
    expect(columns).toContain('path');
  });

  test('show all cycles button is clickable', async ({ page }) => {
    const editor = await openCycleEditor(page);
    await editor.locator('#show-all-cycles').click();
  });

  test('hide all cycles button is clickable', async ({ page }) => {
    const editor = await openCycleEditor(page);
    await editor.locator('#hide-all-cycles').click();
  });

  test('path column has header filter', async ({ page }) => {
    const editor = await openCycleEditor(page);

    const hasFilter = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const pathCol = tabulator.getColumn('path');
      return pathCol.getDefinition().headerFilter !== undefined;
    });
    expect(hasFilter).toBe(true);
  });
});

test.describe('Cycle Detection', () => {

  async function openCycleEditorForLoopCave(page) {
    await setupWithCave(page, 'cave-with-loops.json', 'Loop Cave');
    await rightClickCave(page, 'Loop Cave');
    await page.locator('#explorer-context-menu .context-menu-option[title*="ycle"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    // Wait for table to have rows
    await page.waitForFunction(() => {
      const table = document.querySelector('#cycle-table');
      if (!table) return false;
      const tabs = window.Tabulator?.findTable?.(table);
      return tabs?.[0]?.getRows()?.length > 0;
    }, { timeout: 10000 });
    return editor;
  }

  test('detects cycles in cave with loops', async ({ page }) => {
    await openCycleEditorForLoopCave(page);

    const rowCount = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().length;
    });

    // Cave has 2 loops: A0-A1-A2-A3 square + A1-B1-B2-A2 side passage
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  test('detected cycles have correct path stations', async ({ page }) => {
    await openCycleEditorForLoopCave(page);

    const paths = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map((r) => r.getData().path);
    });

    // Each path should be an array of station names
    for (const path of paths) {
      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThanOrEqual(3);
    }

    // All paths combined should contain the main loop stations
    const allStations = paths.flat();
    expect(allStations).toContain('A0');
    expect(allStations).toContain('A1');
    expect(allStations).toContain('A2');
  });

  test('cycles have non-zero distance', async ({ page }) => {
    await openCycleEditorForLoopCave(page);

    const distances = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map((r) => r.getData().distance);
    });

    for (const dist of distances) {
      expect(dist).toBeGreaterThan(0);
    }
  });

  test('cycles have error percentage values', async ({ page }) => {
    await openCycleEditorForLoopCave(page);

    const errorPercentages = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map((r) => r.getData().errorPercentage);
    });

    for (const ep of errorPercentages) {
      expect(typeof ep).toBe('number');
    }
  });

  test('show all cycles makes all rows visible', async ({ page }) => {
    const editor = await openCycleEditorForLoopCave(page);
    await editor.locator('#show-all-cycles').click();
    await page.waitForTimeout(300);

    const allVisible = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().every((r) => r.getData().visible === true);
    });
    expect(allVisible).toBe(true);
  });

  test('hide all cycles makes all rows invisible', async ({ page }) => {
    const editor = await openCycleEditorForLoopCave(page);

    // First show all, then hide all
    await editor.locator('#show-all-cycles').click();
    await page.waitForTimeout(300);
    await editor.locator('#hide-all-cycles').click();
    await page.waitForTimeout(300);

    const allHidden = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().every((r) => r.getData().visible === false);
    });
    expect(allHidden).toBe(true);
  });

  test('cave without loops shows empty table', async ({ page }) => {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');
    await page.locator('#explorer-context-menu .context-menu-option[title*="ycle"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const rowCount = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().length;
    });
    expect(rowCount).toBe(0);
  });
});

test.describe('Loop Closure Error Fix', () => {

  async function openCycleEditorForErrorCave(page) {
    await setupWithCave(page, 'cave-with-loop-error.json', 'Error Cave');
    await rightClickCave(page, 'Error Cave');
    await page.locator('#explorer-context-menu .context-menu-option[title*="ycle"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    // Wait for table to have at least one row
    await page.waitForFunction(() => {
      const table = document.querySelector('#cycle-table');
      if (!table) return false;
      const tabs = window.Tabulator?.findTable?.(table);
      return tabs?.[0]?.getRows()?.length > 0;
    }, { timeout: 10000 });
    return editor;
  }

  test('triangle loop has non-zero closure error', async ({ page }) => {
    await openCycleEditorForErrorCave(page);

    const errorData = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      if (rows.length === 0) return null;
      const data = rows[0].getData();
      return {
        errorDistance   : data.errorDistance,
        errorPercentage : data.errorPercentage,
        distance        : data.distance
      };
    });

    expect(errorData).not.toBeNull();
    expect(errorData.errorDistance).toBeGreaterThan(0);
    expect(errorData.errorPercentage).toBeGreaterThan(0);
    expect(errorData.distance).toBeGreaterThan(0);
  });

  test('propagate loop closure error reduces error', async ({ page }) => {
    await openCycleEditorForErrorCave(page);

    // Get initial error
    const initialError = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows()[0]?.getData()?.errorDistance ?? 0;
    });
    expect(initialError).toBeGreaterThan(0);

    // Right-click on the first row to open context menu
    const firstRow = page.locator('#cycle-table .tabulator-row').first();
    await firstRow.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Click "Propagate loop closure error"
    const menuItem = page.locator('.tabulator-menu .tabulator-menu-item', { hasText: 'Propagate' });
    await expect(menuItem).toBeVisible({ timeout: 3000 });
    await menuItem.click();
    await page.waitForTimeout(1000);

    // After propagation, error should be reduced to near zero
    const newData = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      if (rows.length === 0) return null;
      const data = rows[0].getData();
      return { errorDistance: data.errorDistance, errorPercentage: data.errorPercentage };
    });

    expect(newData.errorDistance).toBeLessThan(initialError);
    expect(newData.errorPercentage).toBeLessThan(0.1);
  });

  test('context menu has propagate and adjust options', async ({ page }) => {
    await openCycleEditorForErrorCave(page);

    const firstRow = page.locator('#cycle-table .tabulator-row').first();
    await firstRow.click({ button: 'right' });
    await page.waitForTimeout(300);

    const menuItems = page.locator('.tabulator-menu .tabulator-menu-item');
    const texts = await menuItems.allTextContents();
    const hasPropagate = texts.some((t) => t.includes('Propagate'));
    const hasAdjust = texts.some((t) => t.includes('Adjust'));

    expect(hasPropagate).toBe(true);
    expect(hasAdjust).toBe(true);
  });

  test('error cave has exactly one cycle', async ({ page }) => {
    await openCycleEditorForErrorCave(page);

    const rowCount = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().length;
    });

    expect(rowCount).toBe(1);
  });

  test('cycle path contains all triangle stations', async ({ page }) => {
    await openCycleEditorForErrorCave(page);

    const path = await page.evaluate(() => {
      const table = document.querySelector('#cycle-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows()[0]?.getData()?.path ?? [];
    });

    expect(path).toContain('L0');
    expect(path).toContain('L1');
    expect(path).toContain('L2');
    expect(path.length).toBe(3);
  });
});
