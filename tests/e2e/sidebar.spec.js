import { test, expect } from '@playwright/test';

test.describe('Sidebar Interactions', () => {

  test.beforeEach(async ({ page }) => {
    // Skip welcome panel by pre-setting localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('first-visit', 'false'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wait for app initialization (navbar, sidebar rendered)
    await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);
    // Close project panel that opens on startup
    const closeBtn = page.locator('#close-panel-btn');
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    }
  });

  test('switch to Models tab', async ({ page }) => {
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    await expect(page.locator('.sidebar-tab[data-tab="models"]')).toHaveClass(/active/);
    await expect(page.locator('.sidebar-tab[data-tab="explorer"]')).not.toHaveClass(/active/);
    await expect(page.locator('#models-panel')).toHaveClass(/active/);
    await expect(page.locator('#explorer-panel')).not.toHaveClass(/active/);
  });

  test('switch to Settings tab', async ({ page }) => {
    await page.locator('.sidebar-tab[data-tab="settings"]').click();

    await expect(page.locator('.sidebar-tab[data-tab="settings"]')).toHaveClass(/active/);
    await expect(page.locator('#settings-panel')).toHaveClass(/active/);
    await expect(page.locator('#explorer-panel')).not.toHaveClass(/active/);
  });

  test('switch back to Explorer tab', async ({ page }) => {
    // Switch away first
    await page.locator('.sidebar-tab[data-tab="settings"]').click();
    await expect(page.locator('#settings-panel')).toHaveClass(/active/);

    // Switch back
    await page.locator('.sidebar-tab[data-tab="explorer"]').click();
    await expect(page.locator('.sidebar-tab[data-tab="explorer"]')).toHaveClass(/active/);
    await expect(page.locator('#explorer-panel')).toHaveClass(/active/);
  });

  test('collapse and expand sidebar', async ({ page }) => {
    const sidebar = page.locator('#sidebar-container');
    const toggle = page.locator('#sidebar-toggle');

    // Collapse
    await toggle.click();
    await expect(sidebar).toHaveClass(/collapsed/);

    // Expand
    await toggle.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  test('toggle sidebar position left/right', async ({ page }) => {
    const sidebar = page.locator('#sidebar-container');
    const posToggle = page.locator('#sidebar-position-toggle');

    // Move to left
    await posToggle.click();
    await expect(sidebar).toHaveClass(/left/);

    // Move back to right
    await posToggle.click();
    await expect(sidebar).not.toHaveClass(/left/);
  });

  test('collapse and expand scene overview', async ({ page }) => {
    const overviewHeader = page.locator('#sidebar-overview-header');
    const overviewContent = page.locator('#sidebar-overview-content-wrapper');

    // Click to collapse
    await overviewHeader.click();
    await expect(overviewContent).toHaveClass(/collapsed/);

    // Click to expand
    await overviewHeader.click();
    await expect(overviewContent).not.toHaveClass(/collapsed/);
  });

  test('keyboard shortcut Ctrl+B toggles sidebar', async ({ page }) => {
    const sidebar = page.locator('#sidebar-container');

    await page.keyboard.press('Control+b');
    await expect(sidebar).toHaveClass(/collapsed/);

    await page.keyboard.press('Control+b');
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  test('keyboard shortcut Ctrl+E switches to explorer', async ({ page }) => {
    // Switch to settings first
    await page.locator('.sidebar-tab[data-tab="settings"]').click();
    await expect(page.locator('#settings-panel')).toHaveClass(/active/);

    // Use keyboard shortcut
    await page.keyboard.press('Control+e');
    await expect(page.locator('.sidebar-tab[data-tab="explorer"]')).toHaveClass(/active/);
  });

  test('keyboard shortcut Ctrl+M switches to models', async ({ page }) => {
    await page.keyboard.press('Control+m');
    await expect(page.locator('.sidebar-tab[data-tab="models"]')).toHaveClass(/active/);
  });

  test('keyboard shortcut Ctrl+D switches to settings', async ({ page }) => {
    await page.keyboard.press('Control+d');
    await expect(page.locator('.sidebar-tab[data-tab="settings"]')).toHaveClass(/active/);
  });

  test('sidebar tabs have correct ARIA attributes', async ({ page }) => {
    const explorerTab = page.locator('.sidebar-tab[data-tab="explorer"]');
    await expect(explorerTab).toHaveAttribute('role', 'tab');
    await expect(explorerTab).toHaveAttribute('aria-selected', 'true');
    await expect(explorerTab).toHaveAttribute('aria-controls', 'explorer-panel');

    const modelsTab = page.locator('.sidebar-tab[data-tab="models"]');
    await expect(modelsTab).toHaveAttribute('aria-selected', 'false');
  });

  test('scene overview header is visible', async ({ page }) => {
    const header = page.locator('#sidebar-overview-header');
    await expect(header).toBeVisible();
    const text = await header.textContent();
    expect(text).toContain('Scene Overview');
  });

  test('scene overview has canvas element', async ({ page }) => {
    const overview = page.locator('#scene-overview');
    await expect(overview).toBeVisible();
    const canvas = overview.locator('canvas');
    await expect(canvas).toBeAttached();
  });

  test('scene overview toggle arrow changes on collapse', async ({ page }) => {
    const toggle = page.locator('.sidebar-overview-toggle');
    const textBefore = await toggle.textContent();
    expect(textBefore).toBe('▼');

    await page.locator('#sidebar-overview-header').click();
    await page.waitForTimeout(300);

    const textAfter = await toggle.textContent();
    expect(textAfter).toBe('▶');
  });

  test('Ctrl+G toggles scene overview visibility', async ({ page }) => {
    const wrapper = page.locator('#sidebar-overview-content-wrapper');
    await expect(wrapper).not.toHaveClass(/collapsed/);

    await page.keyboard.press('Control+g');
    await page.waitForTimeout(200);
    await expect(wrapper).toHaveClass(/collapsed/);

    await page.keyboard.press('Control+g');
    await page.waitForTimeout(200);
    await expect(wrapper).not.toHaveClass(/collapsed/);
  });
});
