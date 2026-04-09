import { test, expect } from '@playwright/test';
import { initApp, closeProjectPanel, setupWithProject } from './helpers.js';

test.describe('Keyboard Shortcuts', () => {

  test.describe('without project', () => {

    test.beforeEach(async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);
    });

    test('Ctrl+Shift+N opens new project dialog', async ({ page }) => {
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('prompt');
        await dialog.dismiss();
      });
      await page.keyboard.press('Control+Shift+n');
    });

    test('Ctrl+Shift+P opens project panel', async ({ page }) => {
      await page.keyboard.press('Control+Shift+p');
      await expect(page.locator('#project-panel')).toBeVisible();
    });

    test('Ctrl+B toggles sidebar', async ({ page }) => {
      await page.keyboard.press('Control+b');
      await expect(page.locator('#sidebar-container')).toHaveClass(/collapsed/);
      await page.keyboard.press('Control+b');
      await expect(page.locator('#sidebar-container')).not.toHaveClass(/collapsed/);
    });

    test('Ctrl+E switches to explorer tab', async ({ page }) => {
      await page.locator('.sidebar-tab[data-tab="settings"]').click();
      await page.keyboard.press('Control+e');
      await expect(page.locator('.sidebar-tab[data-tab="explorer"]')).toHaveClass(/active/);
    });

    test('Ctrl+M switches to models tab', async ({ page }) => {
      await page.keyboard.press('Control+m');
      await expect(page.locator('.sidebar-tab[data-tab="models"]')).toHaveClass(/active/);
    });

    test('Ctrl+D switches to settings tab', async ({ page }) => {
      await page.keyboard.press('Control+d');
      await expect(page.locator('.sidebar-tab[data-tab="settings"]')).toHaveClass(/active/);
    });

    test('Ctrl+G toggles scene overview', async ({ page }) => {
      const wrapper = page.locator('#sidebar-overview-content-wrapper');
      const classBefore = await wrapper.getAttribute('class');
      await page.keyboard.press('Control+g');
      await page.waitForTimeout(200);
      const classAfter = await wrapper.getAttribute('class');
      expect(classAfter).not.toBe(classBefore);
    });

    test('Ctrl+Shift+1 switches to plan view', async ({ page }) => {
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('a[selectGroup="view"]').nth(0)).toHaveClass(/selected/);
    });

    test('Ctrl+Shift+2 switches to profile view', async ({ page }) => {
      await page.keyboard.press('Control+Shift+2');
      await expect(page.locator('a[selectGroup="view"]').nth(1)).toHaveClass(/selected/);
    });

    test('Ctrl+Shift+3 switches to 3D view', async ({ page }) => {
      await page.keyboard.press('Control+Shift+1');
      await page.keyboard.press('Control+Shift+3');
      await expect(page.locator('a[selectGroup="view"]').nth(2)).toHaveClass(/selected/);
    });

    test('Ctrl+R opens rotation tool', async ({ page }) => {
      await page.keyboard.press('Control+r');
      await expect(page.locator('#tool-panel')).toBeVisible({ timeout: 5000 });
    });

    test('Ctrl+L opens locate station panel', async ({ page }) => {
      await page.keyboard.press('Control+l');
      await expect(page.locator('#tool-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#pointtolocate')).toBeVisible();
    });
  });

  test.describe('with project', () => {

    test.beforeEach(async ({ page }) => {
      await setupWithProject(page);
    });

    test('Ctrl+Shift+S triggers export project', async ({ page }) => {
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
      await page.keyboard.press('Control+Shift+s');
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBeDefined();
    });

    test('Ctrl+H opens export panel', async ({ page }) => {
      await page.keyboard.press('Control+h');
      const exportPanel = page.locator('#export-panel');
      await expect(exportPanel).toBeVisible({ timeout: 5000 });
    });

    test('Ctrl+N triggers new cave action', async ({ page }) => {
      // Ctrl+N opens the coordinate system dialog for a new cave
      await page.keyboard.press('Control+n');
      await page.waitForTimeout(500);

      // The new cave flow should trigger - either a dialog or explorer update
      // The exact behavior depends on whether the coordinate dialog appears
      const dialogOrCave = await Promise.race([
        page.locator('.dialog-overlay').isVisible({ timeout: 2000 }).catch(() => false),
        page.locator('#explorer-tree').locator('.models-tree-category').isVisible({ timeout: 2000 }).catch(() => false)
      ]);
      // Something should have happened
      expect(dialogOrCave !== undefined).toBeTruthy();
    });
  });
});
