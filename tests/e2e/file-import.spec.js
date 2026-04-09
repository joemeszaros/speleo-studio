import { test, expect } from '@playwright/test';
import path from 'path';

const fixturesDir = path.resolve('tests/fixtures');

/**
 * Helper: set up project handling both prompt() dialogs for name + description
 */
async function createProject(page, name = 'Test Project') {
  let dialogCount = 0;
  const dialogHandler = async (dialog) => {
    dialogCount++;
    if (dialogCount === 1) {
      await dialog.accept(name);
    } else {
      await dialog.accept('');
    }
  };
  page.on('dialog', dialogHandler);

  await page.keyboard.press('Control+Shift+n');
  await page.waitForTimeout(1000);
  page.off('dialog', dialogHandler);
}

test.describe('File Import', () => {

  test.beforeEach(async ({ page }) => {
    // Skip welcome panel by pre-setting localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('first-visit', 'false'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);

    // Create a project so file operations work
    await createProject(page);
  });

  test('import JSON cave file', async ({ page }) => {
    const fileInput = page.locator('#caveInput');

    await fileInput.setInputFiles(path.join(fixturesDir, 'sample-cave.json'));

    // Wait for the cave to be processed and appear in explorer
    const explorerTree = page.locator('#explorer-tree');
    await expect(explorerTree.locator('text=Test Cave')).toBeVisible({ timeout: 10000 });
  });

  test('imported cave shows surveys in explorer tree', async ({ page }) => {
    const fileInput = page.locator('#caveInput');
    await fileInput.setInputFiles(path.join(fixturesDir, 'sample-cave.json'));

    const explorerTree = page.locator('#explorer-tree');
    await expect(explorerTree.locator('text=Test Cave')).toBeVisible({ timeout: 10000 });

    // Expand cave node by clicking the toggle arrow
    const caveCategory = explorerTree.locator('.models-tree-category', { has: page.locator('text=Test Cave') });
    await caveCategory.locator('.models-tree-toggle').click();

    await expect(explorerTree.locator('text=Main Survey')).toBeVisible({ timeout: 5000 });
  });

  test('imported cave renders in 3D viewport', async ({ page }) => {
    const fileInput = page.locator('#caveInput');
    await fileInput.setInputFiles(path.join(fixturesDir, 'sample-cave.json'));

    // Wait for cave to load
    await expect(page.locator('#explorer-tree').locator('text=Test Cave')).toBeVisible({ timeout: 10000 });

    // Canvas should exist in viewport
    const canvas = page.locator('#viewport canvas');
    await expect(canvas).toBeAttached();
  });

  test('import multi-survey cave file', async ({ page }) => {
    const fileInput = page.locator('#caveInput');
    await fileInput.setInputFiles(path.join(fixturesDir, 'multi-survey-cave.json'));

    const explorerTree = page.locator('#explorer-tree');
    await expect(explorerTree.locator('text=Multi Survey Cave')).toBeVisible({ timeout: 10000 });

    // Expand to see both surveys
    const caveCategory = explorerTree.locator('.models-tree-category', { has: page.locator('text=Multi Survey Cave') });
    await caveCategory.locator('.models-tree-toggle').click();
    await expect(explorerTree.locator('text=Entrance Survey')).toBeVisible({ timeout: 5000 });
    await expect(explorerTree.locator('text=Inner Survey')).toBeVisible({ timeout: 5000 });
  });

  test('scene overview has canvas after import', async ({ page }) => {
    const fileInput = page.locator('#caveInput');
    await fileInput.setInputFiles(path.join(fixturesDir, 'sample-cave.json'));

    // Wait for import
    await expect(page.locator('#explorer-tree').locator('text=Test Cave')).toBeVisible({ timeout: 10000 });

    // Scene overview section should contain a canvas (3D mini-view)
    const overviewCanvas = page.locator('#scene-overview canvas');
    await expect(overviewCanvas).toBeAttached();
  });

  test('duplicate cave import shows error', async ({ page }) => {
    const fileInput = page.locator('#caveInput');

    // Import once
    await fileInput.setInputFiles(path.join(fixturesDir, 'sample-cave.json'));
    await expect(page.locator('#explorer-tree').locator('text=Test Cave')).toBeVisible({ timeout: 10000 });

    // Import same file again - should show error
    await fileInput.setInputFiles(path.join(fixturesDir, 'sample-cave.json'));

    const cautionPanel = page.locator('#cautionpanel');
    await expect(cautionPanel).toBeVisible({ timeout: 5000 });
  });
});
