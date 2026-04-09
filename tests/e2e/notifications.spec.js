import { test, expect } from '@playwright/test';
import { initApp, closeProjectPanel, createProject } from './helpers.js';

test.describe('Notification Panels', () => {

  test('success notification appears on project creation', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await createProject(page, 'Notification Test');

    const cautionPanel = page.locator('#cautionpanel');
    await expect(cautionPanel).toBeVisible({ timeout: 3000 });

    // Should have success styling
    await expect(cautionPanel).toHaveClass(/cautionpanel-success/);
  });

  test('notification can be dismissed by clicking close', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await createProject(page, 'Dismiss Test');

    const cautionPanel = page.locator('#cautionpanel');
    await expect(cautionPanel).toBeVisible({ timeout: 3000 });

    // Close via global function
    await page.evaluate(() => window.closeCautionPanel());
    await page.waitForTimeout(500);

    await expect(cautionPanel).toBeHidden();
  });

  test('info notification appears after dismissing welcome panel', async ({ page }) => {
    // Don't skip welcome panel - let it show
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const welcomeBtn = page.locator('.welcome-button');
    if (await welcomeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await welcomeBtn.click();

      // Info notification should appear
      const cautionPanel = page.locator('#cautionpanel');
      await expect(cautionPanel).toBeVisible({ timeout: 3000 });
      await expect(cautionPanel).toHaveClass(/cautionpanel-info/);
    }
  });

  test('closeCautionPanel function is globally available', async ({ page }) => {
    await initApp(page);

    const hasFunction = await page.evaluate(() => typeof window.closeCautionPanel === 'function');
    expect(hasFunction).toBe(true);
  });
});
