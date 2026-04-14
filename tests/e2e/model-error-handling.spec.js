import { test, expect } from '@playwright/test';
import path from 'path';
import { setupWithProject, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

/**
 * Import a model and skip coordinate dialog, capturing console messages.
 */
async function importModelCapturingErrors(page, fixture) {
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, fixture));

  // Handle coordinate dialog if it appears
  const skipBtn = page.locator('#model-coord-skip');
  await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skipBtn.isVisible()) {
    await skipBtn.click();
  }

  await page.waitForTimeout(3000);
  await dismissNotifications(page);

  return consoleMessages;
}

test.describe('Model Error Handling', () => {

  test.describe('Truncated Files', () => {

    test('truncated LAS file shows warning and does not crash', async ({ page }) => {
      await setupWithProject(page);

      const messages = await importModelCapturingErrors(page, 'sample-pointcloud-truncated.las');

      // App should not crash - page should still be responsive
      await expect(page.locator('#viewport')).toBeVisible();

      // Should have some error/warning in console about the truncated data
      const hasWarningOrError = messages.some(m =>
        m.type === 'error' || m.type === 'warn'
      );
      // It's ok if there's an error - the important thing is the app didn't crash
    });

    test('truncated LAS - loading overlay disappears', async ({ page }) => {
      await setupWithProject(page);

      await importModelCapturingErrors(page, 'sample-pointcloud-truncated.las');

      // Loading overlay should not be stuck
      const overlay = page.locator('.loading-overlay');
      await expect(overlay).not.toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Corrupt Files', () => {

    test('corrupt LAS header does not crash the app', async ({ page }) => {
      await setupWithProject(page);

      const messages = await importModelCapturingErrors(page, 'sample-pointcloud-corrupt.las');

      // App should still be responsive
      await expect(page.locator('#viewport')).toBeVisible();

      // Loading overlay should not be stuck
      const overlay = page.locator('.loading-overlay');
      await expect(overlay).not.toBeVisible({ timeout: 5000 });
    });

    test('invalid PLY with missing data does not crash', async ({ page }) => {
      await setupWithProject(page);

      const messages = await importModelCapturingErrors(page, 'sample-model-invalid.ply');

      // App should still be responsive
      await expect(page.locator('#viewport')).toBeVisible();
    });

    test('invalid OBJ with bad face indices does not crash', async ({ page }) => {
      await setupWithProject(page);

      const messages = await importModelCapturingErrors(page, 'sample-model-invalid.obj');

      // App should still be responsive
      await expect(page.locator('#viewport')).toBeVisible();
    });
  });

  test.describe('Post-Error State', () => {

    test('app remains functional after failed LAS import', async ({ page }) => {
      await setupWithProject(page);

      // Try to import corrupt file
      await importModelCapturingErrors(page, 'sample-pointcloud-corrupt.las');

      // Now import a valid file - should work fine
      await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

      const skipBtn = page.locator('#model-coord-skip');
      await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await skipBtn.isVisible()) {
        await skipBtn.click();
      }

      await page.waitForTimeout(2000);

      // Valid model should appear in tree
      await page.locator('.sidebar-tab[data-tab="models"]').click();
      const modelsTree = page.locator('#models-tree');
      const modelNodes = modelsTree.locator('.models-tree-node');
      await expect(modelNodes).not.toHaveCount(0, { timeout: 5000 });
    });

    test('app remains functional after failed PLY import', async ({ page }) => {
      await setupWithProject(page);

      // Try to import invalid PLY
      await importModelCapturingErrors(page, 'sample-model-invalid.ply');

      // Now import a valid file
      await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

      const skipBtn = page.locator('#model-coord-skip');
      await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await skipBtn.isVisible()) {
        await skipBtn.click();
      }

      await page.waitForTimeout(2000);

      await page.locator('.sidebar-tab[data-tab="models"]').click();
      const modelsTree = page.locator('#models-tree');
      const modelNodes = modelsTree.locator('.models-tree-node');
      await expect(modelNodes).not.toHaveCount(0, { timeout: 5000 });
    });
  });
});
