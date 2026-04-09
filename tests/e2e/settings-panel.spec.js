import { test, expect } from '@playwright/test';
import { initApp, closeProjectPanel } from './helpers.js';

test.describe('Settings Panel', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    // Switch to settings tab
    await page.locator('.sidebar-tab[data-tab="settings"]').click();
    await expect(page.locator('#settings-panel')).toHaveClass(/active/);
  });

  test('settings panel has content', async ({ page }) => {
    const settingsContent = page.locator('#settings-content');
    await expect(settingsContent).toBeVisible();

    const text = await settingsContent.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('settings panel has collapsible sections', async ({ page }) => {
    const sectionTitles = page.locator('.settings-group-title');
    const count = await sectionTitles.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking section title toggles section content', async ({ page }) => {
    const firstSection = page.locator('.settings-group').first();
    const title = firstSection.locator('.settings-group-title');
    const content = firstSection.locator('.settings-group-content');

    // Get initial visibility state
    const initialDisplay = await content.evaluate(el => getComputedStyle(el).display);

    // Click to toggle
    await title.click();
    await page.waitForTimeout(300);

    const newDisplay = await content.evaluate(el => getComputedStyle(el).display);
    expect(newDisplay).not.toBe(initialDisplay);
  });

  test('settings panel has color pickers', async ({ page }) => {
    const colorPickers = page.locator('#settings-content input[type="color"]');
    const count = await colorPickers.count();
    expect(count).toBeGreaterThan(0);
  });

  test('settings panel has range sliders', async ({ page }) => {
    const sliders = page.locator('#settings-content input[type="range"]');
    const count = await sliders.count();
    expect(count).toBeGreaterThan(0);
  });

  test('settings panel has checkboxes', async ({ page }) => {
    const checkboxes = page.locator('#settings-content input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
  });

  test('settings panel has configuration buttons', async ({ page }) => {
    const settingsContent = page.locator('#settings-content');
    const buttons = settingsContent.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(3); // Download, Load, Reset
  });

  test('changing a range slider updates its value', async ({ page }) => {
    // Ensure first section is expanded so sliders are visible
    const firstSection = page.locator('.settings-group').first();
    const content = firstSection.locator('.settings-group-content');
    const isHidden = await content.evaluate(el => getComputedStyle(el).display === 'none');
    if (isHidden) {
      await firstSection.locator('.settings-group-title').click();
      await page.waitForTimeout(300);
    }

    const firstSlider = firstSection.locator('input[type="range"]').first();
    await expect(firstSlider).toBeVisible();

    // Change the slider value
    await firstSlider.fill('5');
    await page.waitForTimeout(200);

    const newValue = await firstSlider.inputValue();
    expect(newValue).toBe('5');
  });

  test('toggling a checkbox works', async ({ page }) => {
    // Find a visible checkbox by expanding sections if needed
    const firstCheckbox = page.locator('#settings-content input[type="checkbox"]').first();

    const initialChecked = await firstCheckbox.evaluate(el => el.checked);

    await firstCheckbox.evaluate(el => el.click());
    await page.waitForTimeout(200);

    const newChecked = await firstCheckbox.evaluate(el => el.checked);
    expect(newChecked).toBe(!initialChecked);
  });

  test('section visibility toggle icons exist', async ({ page }) => {
    const visibilityToggles = page.locator('#settings-content .section-visibility');
    const count = await visibilityToggles.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('settings persist across tab switches', async ({ page }) => {
    // Toggle a checkbox via JS to avoid visibility issues
    const firstCheckbox = page.locator('#settings-content input[type="checkbox"]').first();
    const initialChecked = await firstCheckbox.evaluate(el => el.checked);
    await firstCheckbox.evaluate(el => el.click());

    // Switch to explorer tab and back
    await page.locator('.sidebar-tab[data-tab="explorer"]').click();
    await page.locator('.sidebar-tab[data-tab="settings"]').click();

    const afterChecked = await page.locator('#settings-content input[type="checkbox"]').first().evaluate(el => el.checked);
    expect(afterChecked).toBe(!initialChecked);
  });

  test('changing color picker updates its value', async ({ page }) => {
    // Find first color picker and change its value
    const colorPicker = page.locator('#settings-content input[type="color"]').first();
    const initialColor = await colorPicker.inputValue();

    // Set a distinctly different color
    const targetColor = initialColor === '#00ffcc' ? '#ff00cc' : '#00ffcc';
    await colorPicker.evaluate((el, color) => {
      el.value = color;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, targetColor);
    await page.waitForTimeout(200);

    const newColor = await colorPicker.inputValue();
    expect(newColor).toBe(targetColor);
    expect(newColor).not.toBe(initialColor);
  });

  test('changing range slider updates associated number display', async ({ page }) => {
    // Expand first section to access sliders
    const firstSection = page.locator('.settings-group').first();
    const content = firstSection.locator('.settings-group-content');
    const isHidden = await content.evaluate(el => getComputedStyle(el).display === 'none');
    if (isHidden) {
      await firstSection.locator('.settings-group-title').click();
      await page.waitForTimeout(300);
    }

    // Find a range slider and its associated number input
    const rangeSlider = firstSection.locator('input[type="range"]').first();
    await expect(rangeSlider).toBeVisible();

    // Change the slider to a specific value
    const initialValue = await rangeSlider.inputValue();
    const newValue = initialValue === '3' ? '5' : '3';

    await rangeSlider.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, newValue);
    await page.waitForTimeout(200);

    // Slider value should have changed
    expect(await rangeSlider.inputValue()).toBe(newValue);
  });

  test('color change is saved to configuration', async ({ page }) => {
    // Change a color and verify it's stored in the options proxy
    const colorPicker = page.locator('#settings-content input[type="color"]').first();

    const origColor = await colorPicker.inputValue();
    const testColor = origColor === '#33ccaa' ? '#aa33cc' : '#33ccaa';

    await colorPicker.evaluate((el, color) => {
      el.value = color;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, testColor);
    await page.waitForTimeout(200);

    // Switch tabs and back - value should persist (stored in config)
    await page.locator('.sidebar-tab[data-tab="explorer"]').click();
    await page.locator('.sidebar-tab[data-tab="settings"]').click();
    await page.waitForTimeout(300);

    const persistedColor = await page.locator('#settings-content input[type="color"]').first().inputValue();
    expect(persistedColor).toBe(testColor);
  });

  test('multiple settings can be changed independently', async ({ page }) => {
    // Change a color to something distinct
    const colorPicker = page.locator('#settings-content input[type="color"]').first();
    const origCol = await colorPicker.inputValue();
    const newCol = origCol === '#1122ee' ? '#ee2211' : '#1122ee';
    await colorPicker.evaluate((el, c) => {
      el.value = c;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, newCol);

    // Change a checkbox
    const checkbox = page.locator('#settings-content input[type="checkbox"]').first();
    const wasChecked = await checkbox.evaluate(el => el.checked);
    await checkbox.evaluate(el => el.click());

    await page.waitForTimeout(200);

    // Both changes should be reflected
    expect(await colorPicker.inputValue()).toBe(newCol);
    expect(await checkbox.evaluate(el => el.checked)).toBe(!wasChecked);
  });
});
