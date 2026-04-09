import { test, expect } from '@playwright/test';

test.describe('Menu Interactions', () => {

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

  test('clicking menu opens dropdown', async ({ page }) => {
    const projectMenu = page.locator('.mydropdown').filter({ hasText: 'Project' });
    await projectMenu.locator('.dropbtn').click();

    const dropdown = projectMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);
  });

  test('clicking outside closes menu dropdown', async ({ page }) => {
    const projectMenu = page.locator('.mydropdown').filter({ hasText: 'Project' });
    await projectMenu.locator('.dropbtn').click();

    const dropdown = projectMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    // Click on viewport to close
    await page.locator('#viewport').click();
    await expect(dropdown).not.toHaveClass(/mydropdown-show/);
  });

  test('Project menu has correct items', async ({ page }) => {
    const projectMenu = page.locator('.mydropdown').filter({ hasText: 'Project' });
    await projectMenu.locator('.dropbtn').click();

    const dropdown = projectMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const items = await dropdown.locator('a').allTextContents();
    const itemTexts = items.map((t) => t.trim());

    expect(itemTexts.some((t) => t.includes('New Project'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Project Manager'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Export Project'))).toBeTruthy();
  });

  test('Tools menu has correct items', async ({ page }) => {
    const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
    await toolsMenu.locator('.dropbtn').click();

    const dropdown = toolsMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const items = await dropdown.locator('a').allTextContents();
    const itemTexts = items.map((t) => t.trim());

    expect(itemTexts.some((t) => t.includes('Dip & Strike'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Shortest path'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Rose Diagram'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Google Drive'))).toBeTruthy();
  });

  test('Help menu has correct items', async ({ page }) => {
    const helpMenu = page.locator('.mydropdown').filter({ hasText: 'Help' });
    await helpMenu.locator('.dropbtn').click();

    const dropdown = helpMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const items = await dropdown.locator('a').allTextContents();
    const itemTexts = items.map((t) => t.trim());

    expect(itemTexts.some((t) => t.includes('User Manual'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('About'))).toBeTruthy();
  });

  test('opening one menu closes another', async ({ page }) => {
    // Open Project menu
    const projectMenu = page.locator('.mydropdown').filter({ hasText: 'Project' });
    await projectMenu.locator('.dropbtn').click();

    const projectDropdown = projectMenu.locator('.mydropdown-content');
    await expect(projectDropdown).toHaveClass(/mydropdown-show/);

    // Open Tools menu
    const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
    await toolsMenu.locator('.dropbtn').click();

    const toolsDropdown = toolsMenu.locator('.mydropdown-content');
    await expect(toolsDropdown).toHaveClass(/mydropdown-show/);

    // Project menu should now be closed
    await expect(projectDropdown).not.toHaveClass(/mydropdown-show/);
  });

  test('Export Project is disabled when no active project exists', async ({ page }) => {
    const projectMenu = page.locator('.mydropdown').filter({ hasText: 'Project' });
    await projectMenu.locator('.dropbtn').click();

    const dropdown = projectMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const exportItem = dropdown.locator('a').filter({ hasText: 'Export Project' });
    await expect(exportItem).toHaveAttribute('disabled', '');
    await expect(exportItem).toHaveClass(/disabled/);
  });

  test('Export Project becomes enabled after creating project', async ({ page }) => {
    // Create project
    let dialogCount = 0;
    page.on('dialog', async (dialog) => {
      dialogCount++;
      if (dialogCount === 1) {
        await dialog.accept('Export Test Project');
      } else {
        await dialog.accept('');
      }
    });
    await page.keyboard.press('Control+Shift+n');
    await page.waitForTimeout(1000);

    const projectMenu = page.locator('.mydropdown').filter({ hasText: 'Project' });
    await projectMenu.locator('.dropbtn').click();

    const dropdown = projectMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const exportItem = dropdown.locator('a').filter({ hasText: 'Export Project' });
    await expect(exportItem).not.toHaveAttribute('disabled', '');
    await expect(exportItem).not.toHaveClass(/disabled/);
  });

  test('Shortest Path is disabled when no caves are loaded', async ({ page }) => {
    const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
    await toolsMenu.locator('.dropbtn').click();

    const dropdown = toolsMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const shortestPathItem = dropdown.locator('a').filter({ hasText: 'Shortest path' });
    await expect(shortestPathItem).toHaveAttribute('disabled', '');
    await expect(shortestPathItem).toHaveClass(/disabled/);
  });

  test('Rose Diagram is disabled when no caves are loaded', async ({ page }) => {
    const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
    await toolsMenu.locator('.dropbtn').click();

    const dropdown = toolsMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const roseDiagramItem = dropdown.locator('a').filter({ hasText: 'Rose Diagram' });
    await expect(roseDiagramItem).toHaveAttribute('disabled', '');
    await expect(roseDiagramItem).toHaveClass(/disabled/);
  });

  test('File menu is disabled when no project exists', async ({ page }) => {
    const fileBtn = page.locator('.dropbtn:text("File")');
    await expect(fileBtn).toBeDisabled();
  });

  test('File menu becomes enabled after creating project', async ({ page }) => {
    const fileBtn = page.locator('.dropbtn:text("File")');
    await expect(fileBtn).toBeDisabled();

    // Create project
    let dialogCount = 0;
    page.on('dialog', async (dialog) => {
      dialogCount++;
      if (dialogCount === 1) {
        await dialog.accept('Menu Test Project');
      } else {
        await dialog.accept('');
      }
    });

    await page.keyboard.press('Control+Shift+n');
    await page.waitForTimeout(1000);

    await expect(fileBtn).toBeEnabled();
  });

  test('File menu has correct items when project exists', async ({ page }) => {
    // Create project first
    let dialogCount = 0;
    page.on('dialog', async (dialog) => {
      dialogCount++;
      if (dialogCount === 1) {
        await dialog.accept('File Menu Test');
      } else {
        await dialog.accept('');
      }
    });
    await page.keyboard.press('Control+Shift+n');
    await page.waitForTimeout(1000);

    const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
    await fileMenu.locator('.dropbtn').click();

    const dropdown = fileMenu.locator('.mydropdown-content');
    await expect(dropdown).toHaveClass(/mydropdown-show/);

    const items = await dropdown.locator('a').allTextContents();
    const itemTexts = items.map((t) => t.trim());

    expect(itemTexts.some((t) => t.includes('New cave'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Open cave'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Export cave'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Open model'))).toBeTruthy();
    expect(itemTexts.some((t) => t.includes('Print'))).toBeTruthy();
  });
});
