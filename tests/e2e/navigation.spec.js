import { test, expect } from '@playwright/test';

test.describe('3D Navigation Controls', () => {

  test.beforeEach(async ({ page }) => {
    // Skip welcome panel by pre-setting localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('first-visit', 'false'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);
    // Close project panel that opens on startup
    const closeBtn = page.locator('#close-panel-btn');
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    }
  });

  test('switch to Plan view', async ({ page }) => {
    const viewButtons = page.locator('a[selectGroup="view"]');
    // Plan is the first view button
    await viewButtons.nth(0).click();

    await expect(viewButtons.nth(0)).toHaveClass(/selected/);
    // 3D should no longer be selected
    await expect(viewButtons.nth(2)).not.toHaveClass(/selected/);
  });

  test('switch to Profile view', async ({ page }) => {
    const viewButtons = page.locator('a[selectGroup="view"]');
    // Profile is the second view button
    await viewButtons.nth(1).click();

    await expect(viewButtons.nth(1)).toHaveClass(/selected/);
  });

  test('switch to 3D view', async ({ page }) => {
    const viewButtons = page.locator('a[selectGroup="view"]');

    // Switch to plan first
    await viewButtons.nth(0).click();
    await expect(viewButtons.nth(0)).toHaveClass(/selected/);

    // Switch back to 3D
    await viewButtons.nth(2).click();
    await expect(viewButtons.nth(2)).toHaveClass(/selected/);
    await expect(viewButtons.nth(0)).not.toHaveClass(/selected/);
  });

  test('keyboard shortcut Ctrl+Shift+1 switches to Plan', async ({ page }) => {
    const viewButtons = page.locator('a[selectGroup="view"]');

    await page.keyboard.press('Control+Shift+1');

    await expect(viewButtons.nth(0)).toHaveClass(/selected/);
  });

  test('keyboard shortcut Ctrl+Shift+2 switches to Profile', async ({ page }) => {
    const viewButtons = page.locator('a[selectGroup="view"]');

    await page.keyboard.press('Control+Shift+2');

    await expect(viewButtons.nth(1)).toHaveClass(/selected/);
  });

  test('keyboard shortcut Ctrl+Shift+3 switches to 3D', async ({ page }) => {
    const viewButtons = page.locator('a[selectGroup="view"]');

    // Switch away first
    await page.keyboard.press('Control+Shift+1');
    await expect(viewButtons.nth(0)).toHaveClass(/selected/);

    await page.keyboard.press('Control+Shift+3');
    await expect(viewButtons.nth(2)).toHaveClass(/selected/);
  });

  test('only one view mode is selected at a time', async ({ page }) => {
    const viewButtons = page.locator('a[selectGroup="view"]');

    for (let i = 0; i < 3; i++) {
      await viewButtons.nth(i).click();
      const selectedCount = await page.locator('a[selectGroup="view"].selected').count();
      expect(selectedCount).toBe(1);
    }
  });

  test('zoom in button exists and is clickable', async ({ page }) => {
    // Icon buttons are a.mytooltip.dropbtn with tooltip in .mytooltiptext span
    const zoomIn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Zoom in"))');
    await expect(zoomIn).toBeVisible();
    await zoomIn.click();
  });

  test('zoom out button exists and is clickable', async ({ page }) => {
    const zoomOut = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Zoom out"))');
    await expect(zoomOut).toBeVisible();
    await zoomOut.click();
  });

  test('zoom fit button exists and is clickable', async ({ page }) => {
    const zoomFit = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Zoom to fit"))');
    await expect(zoomFit).toBeVisible();
    await zoomFit.click();
  });
});
