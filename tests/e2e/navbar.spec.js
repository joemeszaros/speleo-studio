import { test, expect } from '@playwright/test';
import { initApp, closeProjectPanel } from './helpers.js';

test.describe('Additional Navbar Controls', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
  });

  test('bounding box toggle is clickable', async ({ page }) => {
    const bbBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Bounding box"))');
    await expect(bbBtn).toBeVisible();
    await bbBtn.click();
  });

  test('line color mode dropdown opens', async ({ page }) => {
    const lineColorBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Line color"))');
    await expect(lineColorBtn).toBeVisible();
    await lineColorBtn.click();

    // Dropdown should show color mode options
    const dropdown = lineColorBtn.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const options = await dropdown.locator('a').allTextContents();
    expect(options.length).toBeGreaterThan(0);
  });

  test('line color mode options are present', async ({ page }) => {
    const lineColorBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Line color"))');
    await lineColorBtn.click();

    const dropdown = lineColorBtn.locator('.mydropdown-content');
    const optionTexts = await dropdown.locator('a').allTextContents();

    expect(optionTexts.some((t) => t.includes('Global'))).toBeTruthy();
    expect(optionTexts.some((t) => t.includes('Gradient by Z'))).toBeTruthy();
  });

  test('selecting line color mode marks it selected', async ({ page }) => {
    const lineColorBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Line color"))');
    await lineColorBtn.click();

    const dropdown = lineColorBtn.locator('.mydropdown-content');
    const secondOption = dropdown.locator('a').nth(1);
    await secondOption.click();

    // Reopen to verify selection
    await lineColorBtn.click();
    const selectedOption = dropdown.locator('a.selected');
    await expect(selectedOption).toHaveCount(1);
  });

  test('grid toggle is clickable', async ({ page }) => {
    const gridBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Grid"))');
    await expect(gridBtn).toBeVisible();
    await gridBtn.click();
  });

  test('raycasting toggle is clickable', async ({ page }) => {
    const rayBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Point selection"))');
    await expect(rayBtn).toBeVisible();

    const classBefore = await rayBtn.getAttribute('class');
    await rayBtn.click();
    await page.waitForTimeout(200);
    const classAfter = await rayBtn.getAttribute('class');

    // Class should change (toggle selected)
    expect(classAfter).not.toBe(classBefore);
  });

  test('locate station opens tool panel', async ({ page }) => {
    const locateBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Locate"))');
    await expect(locateBtn).toBeVisible();
    await locateBtn.click();

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });
  });

  test('locate station panel has search input', async ({ page }) => {
    const locateBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Locate"))');
    await locateBtn.click();

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });

    const searchInput = toolPanel.locator('#pointtolocate');
    await expect(searchInput).toBeVisible();
  });

  test('keyboard shortcut Ctrl+R opens rotation tool', async ({ page }) => {
    await page.keyboard.press('Control+r');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });
  });

  test('keyboard shortcut Ctrl+L opens locate panel', async ({ page }) => {
    await page.keyboard.press('Control+l');

    const toolPanel = page.locator('#tool-panel');
    await expect(toolPanel).toBeVisible({ timeout: 5000 });
  });

  test('keyboard shortcut Ctrl+G toggles scene overview', async ({ page }) => {
    const overviewContent = page.locator('#sidebar-overview-content-wrapper');

    await page.keyboard.press('Control+g');
    await page.waitForTimeout(200);

    const stateAfterFirst = await overviewContent.getAttribute('class');

    await page.keyboard.press('Control+g');
    await page.waitForTimeout(200);

    const stateAfterSecond = await overviewContent.getAttribute('class');

    // States should differ (toggled)
    expect(stateAfterFirst).not.toBe(stateAfterSecond);
  });
});
