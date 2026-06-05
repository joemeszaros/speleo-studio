import { test, expect } from '@playwright/test';
import { setupWithCave, rightClickCave, dismissNotifications, initApp, closeProjectPanel } from './helpers.js';

// Picks a station in the last table row (the picker uses a property-assigned editor, so set the
// value via the Tabulator API instead of typing).
async function setRowStation(page, station) {
  await page.evaluate((stn) => {
    const table = document.querySelector('#entrances-table');
    const tabulator = window.Tabulator.findTable(table)[0];
    const rows = tabulator.getRows();
    rows[rows.length - 1].update({ station: stn });
  }, station);
  await page.waitForTimeout(200);
}

test.describe('Cave Entrances Editor', () => {

  async function openEntrancesEditor(page) {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');
    await page.locator('#explorer-context-menu .context-menu-option[title*="ntrance"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    return editor;
  }

  test('opens from cave context menu', async ({ page }) => {
    const editor = await openEntrancesEditor(page);
    await expect(editor.locator('#entrances-table')).toBeVisible();
  });

  test('has toolbar buttons', async ({ page }) => {
    const editor = await openEntrancesEditor(page);
    await expect(editor.locator('#add-row')).toBeAttached();
    await expect(editor.locator('#delete-row')).toBeAttached();
    await expect(editor.locator('#undo')).toBeAttached();
    await expect(editor.locator('#redo')).toBeAttached();
    await expect(editor.locator('#validate-entrances')).toBeAttached();
    await expect(editor.locator('#update-entrances')).toBeAttached();
    await expect(editor.locator('#cancel-entrances')).toBeAttached();
    await expect(editor.locator('#export-to-csv')).toBeAttached();
  });

  test('add entrance row and pick a station', async ({ page }) => {
    const editor = await openEntrancesEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await setRowStation(page, 'A0');

    const station = await page.evaluate(() => {
      const table = document.querySelector('#entrances-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      return rows[rows.length - 1].getData().station;
    });
    expect(station).toBe('A0');
  });

  test('validate empty row shows incomplete status', async ({ page }) => {
    const editor = await openEntrancesEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await editor.locator('#validate-entrances').click();
    await page.waitForTimeout(500);

    const status = await page.evaluate(() => {
      const table = document.querySelector('#entrances-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      return rows[rows.length - 1].getData().status;
    });
    expect(status).toBe('incomplete');
  });

  test('duplicate entrance shows invalid status after validation', async ({ page }) => {
    const editor = await openEntrancesEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await setRowStation(page, 'A0');

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await setRowStation(page, 'A0');

    await editor.locator('#validate-entrances').click();
    await page.waitForTimeout(500);

    const statuses = await page.evaluate(() => {
      const table = document.querySelector('#entrances-table');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows()
        .filter((r) => r.getData().station === 'A0')
        .map((r) => r.getData().status);
    });
    expect(statuses.length).toBe(2);
    expect(statuses.some((s) => s === 'invalid')).toBe(true);
  });

  test('update saves the entrance and renders an entrance marker', async ({ page }) => {
    const editor = await openEntrancesEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await setRowStation(page, 'A0');

    await editor.locator('#update-entrances').click();
    await page.waitForTimeout(1000);
    await dismissNotifications(page);

    const result = await page.evaluate(() => {
      const cave = window.speleo.db.getAllCaves()[0];
      const obj = window.speleo.scene.startPoint.startPointObjects.get(cave.name);
      return { entrances: cave.entrances, entranceMeshCount: obj?.entranceMeshes?.length ?? 0 };
    });
    expect(result.entrances).toContain('A0');
    expect(result.entranceMeshCount).toBeGreaterThan(0);
  });

  test('cancel closes editor without saving', async ({ page }) => {
    const editor = await openEntrancesEditor(page);

    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await setRowStation(page, 'A0');

    await editor.locator('#cancel-entrances').click();
    await expect(editor).toBeHidden();

    const entrances = await page.evaluate(() => window.speleo.db.getAllCaves()[0].entrances);
    expect(entrances).toEqual([]);
  });

  test('export CSV produces download with correct filename', async ({ page }) => {
    const editor = await openEntrancesEditor(page);

    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('entrances.csv');
  });
});

test.describe('Entrance markers vs start points (independent settings)', () => {

  test('settings panel shows entrance controls', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await page.locator('.sidebar-tab[data-tab="settings"]').click();
    await expect(page.locator('#settings-panel')).toHaveClass(/active/);
    const text = await page.locator('#settings-content').textContent();
    expect(text).toContain('Entrance');
  });

  test('entrance color is independent of start point color', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    const before = await page.evaluate(() => {
      const m = window.speleo.scene.startPoint.mats.sphere;
      return { start: m.startPoint.color.getHexString(), entrance: m.entrance.color.getHexString() };
    });

    await page.evaluate(() => {
      window.speleo.options.scene.entrances.color = '#00ff00';
    });
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const m = window.speleo.scene.startPoint.mats.sphere;
      return { start: m.startPoint.color.getHexString(), entrance: m.entrance.color.getHexString() };
    });

    expect(after.entrance).toBe('00ff00');
    expect(after.start).toBe(before.start); // start point color untouched
  });

  test('entrance and start point visibility toggle independently', async ({ page }) => {
    await setupWithCave(page);

    // Flag a station as an entrance, then re-render markers.
    await page.evaluate(() => {
      const cave = window.speleo.db.getAllCaves()[0];
      cave.entrances = ['A0'];
      window.speleo.scene.startPoint.addOrUpdateStartingPoint(cave);
    });
    await page.waitForTimeout(200);

    // Hide start points only — entrance stays visible.
    await page.evaluate(() => {
      window.speleo.options.scene.startPoints.show = false;
    });
    await page.waitForTimeout(200);
    let vis = await page.evaluate(() => {
      const obj = window.speleo.scene.startPoint.startPointObjects.get(window.speleo.db.getAllCaves()[0].name);
      return { start: obj.mesh.visible, entrance: obj.entranceMeshes[0].mesh.visible };
    });
    expect(vis.start).toBe(false);
    expect(vis.entrance).toBe(true);

    // Restore start points, hide entrances only — start point stays visible.
    await page.evaluate(() => {
      window.speleo.options.scene.startPoints.show = true;
      window.speleo.options.scene.entrances.show = false;
    });
    await page.waitForTimeout(200);
    vis = await page.evaluate(() => {
      const obj = window.speleo.scene.startPoint.startPointObjects.get(window.speleo.db.getAllCaves()[0].name);
      return { start: obj.mesh.visible, entrance: obj.entranceMeshes[0].mesh.visible };
    });
    expect(vis.start).toBe(true);
    expect(vis.entrance).toBe(false);
  });
});
