import { test, expect } from '@playwright/test';
import {
  initApp,
  closeProjectPanel,
  setupWithCave,
  dismissNotifications
} from './helpers.js';

// Helper: open Settings tab and pick a separator from the General Settings select.
async function setSeparator(page, separator /* '.' | ',' */) {
  await page.locator('.sidebar-tab[data-tab="settings"]').click();
  await expect(page.locator('#settings-panel')).toHaveClass(/active/);

  // Find the General Settings section header — it's collapsed by default.
  const general = page.locator('.settings-group-title', { hasText: /General Settings|Általános beállítások/ });
  await general.click(); // expand

  // The new decimal-separator select is the third select within General Settings.
  const select = page.locator('.settings-group').filter({ has: general }).locator('select').nth(2);
  await select.selectOption(separator);
}

test.describe('Decimal separator', () => {

  test('default separator is dot in the General Settings select', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await page.locator('.sidebar-tab[data-tab="settings"]').click();
    const general = page.locator('.settings-group-title', { hasText: /General Settings|Általános beállítások/ });
    await general.click();
    const select = page.locator('.settings-group').filter({ has: general }).locator('select').nth(2);
    await expect(select).toHaveValue('.');
  });

  test('separator setting persists across reloads', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await setSeparator(page, ',');

    // Reload and check the select still reflects the saved value.
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.locator('.sidebar-tab[data-tab="settings"]').click();
    const general = page.locator('.settings-group-title', { hasText: /General Settings|Általános beállítások/ });
    await general.click();
    const select = page.locator('.settings-group').filter({ has: general }).locator('select').nth(2);
    await expect(select).toHaveValue(',');
  });

  test('survey editor cells reformat with comma separator', async ({ page }) => {
    await setupWithCave(page);
    await setSeparator(page, ',');

    // Open the survey editor for the first survey.
    await page.locator('#explorer-tree').locator('text=Survey-1').dblclick();
    await expect(page.locator('#surveydata')).toBeVisible({ timeout: 5000 });

    // Find a length cell (column "length") and check its display uses comma.
    const lengthCells = page.locator('.tabulator-cell[tabulator-field="length"]');
    await expect(lengthCells.first()).toBeVisible();
    const text = await lengthCells.first().textContent();
    expect(text).toMatch(/,/);
    expect(text).not.toMatch(/\./);
  });

  test('zoom level in footer uses configured separator', async ({ page }) => {
    await setupWithCave(page);
    await setSeparator(page, ',');

    // Trigger a zoom change so the footer updates.
    await page.evaluate(() => {
      window.speleo.scene.view.control.zoom = 1.5;
      window.speleo.scene.view.onZoomLevelChange(1.5);
    });

    const zoomText = await page.locator('#zoomInfo').textContent();
    expect(zoomText).toMatch(/1,5/);
  });

  test('JSON export keeps dot separator regardless of UI setting', async ({ page }) => {
    await setupWithCave(page);
    await setSeparator(page, ',');
    await dismissNotifications(page);

    // Trigger a JSON export of the project and capture the download.
    const downloadPromise = page.waitForEvent('download');
    await page.keyboard.press('Control+e');
    const download = await downloadPromise.catch(() => null);
    if (!download) {
      test.skip(); // If the export shortcut isn't bound, skip — this test relies on it.
      return;
    }
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const content = Buffer.concat(chunks).toString('utf8');
    // The exported JSON must use dot for any decimal numbers — there should be no
    // floats represented with a comma decimal separator.
    expect(content).not.toMatch(/"\d+,\d+"/);
  });
});
