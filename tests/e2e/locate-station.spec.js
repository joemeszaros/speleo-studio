import { test, expect } from '@playwright/test';
import { setupWithCave, initApp, closeProjectPanel } from './helpers.js';

test.describe('Locate Station', () => {

  test('opens via Ctrl+L keyboard shortcut', async ({ page }) => {
    await setupWithCave(page);

    await page.keyboard.press('Control+l');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });
    await expect(toolPanel.locator('#pointtolocate')).toBeVisible();
  });

  test('opens via locate icon in navbar', async ({ page }) => {
    await setupWithCave(page);

    const locateBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Locate"))');
    await locateBtn.click();

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });
  });

  test('panel has search input and locate button', async ({ page }) => {
    await setupWithCave(page);
    await page.keyboard.press('Control+l');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });

    await expect(toolPanel.locator('#pointtolocate')).toBeVisible();
    await expect(toolPanel.locator('#locate-button')).toBeVisible();
  });

  test('datalist populated with station names from loaded cave', async ({ page }) => {
    await setupWithCave(page);
    await page.keyboard.press('Control+l');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });

    const options = await toolPanel.locator('#stations option').allTextContents();
    // sample-cave.json has stations A0, A1, A2, A3, A4
    expect(options.length).toBeGreaterThanOrEqual(5);

    const optionValues = await toolPanel.locator('#stations option').evaluateAll(
      els => els.map(el => el.value)
    );
    expect(optionValues).toContain('A0');
    expect(optionValues).toContain('A1');
    expect(optionValues).toContain('A4');
  });

  test('type station name and click locate', async ({ page }) => {
    await setupWithCave(page);
    await page.keyboard.press('Control+l');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });

    await toolPanel.locator('#pointtolocate').fill('A2');
    await toolPanel.locator('#locate-button').click();
    await page.waitForTimeout(500);

    // Panel should hide after locating
    await expect(toolPanel).toBeHidden({ timeout: 3000 });
  });

  test('input is cleared after locating', async ({ page }) => {
    await setupWithCave(page);
    await page.keyboard.press('Control+l');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });

    await toolPanel.locator('#pointtolocate').fill('A0');
    await toolPanel.locator('#locate-button').click();
    await page.waitForTimeout(500);

    // Reopen and check input is cleared
    await page.keyboard.press('Control+l');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });

    const value = await toolPanel.locator('#pointtolocate').inputValue();
    expect(value).toBe('');
  });

  test('no stations available without loaded cave', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await page.keyboard.press('Control+l');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });

    const options = await toolPanel.locator('#stations option').count();
    expect(options).toBe(0);
  });
});
