import { test, expect } from '@playwright/test';

test.describe('Application Loading', () => {

  test('page loads without console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });

  test('page title is correct', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Speleo studio');
  });

  test('viewport logo is visible on empty scene', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const logo = page.locator('#viewport-logo');
    await expect(logo).toBeVisible();
  });

  test('navbar is present with all menus', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const navbar = page.locator('#navbarcontainer');
    await expect(navbar).toBeVisible();

    const menuButtons = page.locator('.dropbtn');
    const menuTexts = await menuButtons.allTextContents();
    expect(menuTexts).toContain('File');
    expect(menuTexts).toContain('Project');
    expect(menuTexts).toContain('Tools');
    expect(menuTexts).toContain('Help');
  });

  test('sidebar is visible with all tabs', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('#sidebar-container');
    await expect(sidebar).toBeVisible();

    await expect(page.locator('.sidebar-tab[data-tab="explorer"]')).toBeVisible();
    await expect(page.locator('.sidebar-tab[data-tab="models"]')).toBeVisible();
    await expect(page.locator('.sidebar-tab[data-tab="settings"]')).toBeVisible();
  });

  test('explorer tab is active by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const explorerTab = page.locator('.sidebar-tab[data-tab="explorer"]');
    await expect(explorerTab).toHaveClass(/active/);
    await expect(explorerTab).toHaveAttribute('aria-selected', 'true');

    const explorerPanel = page.locator('#explorer-panel');
    await expect(explorerPanel).toHaveClass(/active/);
  });

  test('viewport canvas exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const viewport = page.locator('#viewport');
    await expect(viewport).toBeVisible();

    const canvas = page.locator('#viewport canvas');
    await expect(canvas).toBeAttached();
  });

  test('footer is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const footer = page.locator('#footer');
    await expect(footer).toBeVisible();
  });

  test('scene overview section exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const overview = page.locator('#sidebar-overview-header');
    await expect(overview).toBeVisible();
  });

  test('icon bar has view mode buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const viewButtons = page.locator('a[selectGroup="view"]');
    await expect(viewButtons).toHaveCount(3);

    // 3D view should be selected by default
    const selected = page.locator('a[selectGroup="view"].selected');
    await expect(selected).toHaveCount(1);
  });
});
