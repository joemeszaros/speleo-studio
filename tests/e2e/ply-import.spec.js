import { test, expect } from '@playwright/test';
import path from 'path';
import { setupWithProject, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

/**
 * Import a PLY model and skip the coordinate dialog.
 */
async function importPlyModel(page, fixture) {
  const skipCoordDialog = async () => {
    const skipBtn = page.locator('#model-coord-skip');
    await skipBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }
  };

  await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, fixture));
  await skipCoordDialog();
  await page.waitForTimeout(3000);
  await dismissNotifications(page);
}

test.describe('PLY Point Cloud Import', () => {

  test.beforeEach(async ({ page }) => {
    await setupWithProject(page, 'PLY Test Project');
  });

  test.describe('Small PLY (simple THREE.Points path)', () => {

    test('import small PLY shows coordinate dialog', async ({ page }) => {
      await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

      const skipBtn = page.locator('#model-coord-skip');
      await expect(skipBtn).toBeVisible({ timeout: 10000 });
    });

    test('import small PLY adds model to models tree', async ({ page }) => {
      const modelsTab = page.getByRole('tab', { name: '🌐' });
      await modelsTab.click();

      await importPlyModel(page, 'sample-model.ply');

      const sidebar = page.locator('.sidebar-panel');
      await expect(sidebar.locator('text=sample-model.ply')).toBeVisible({ timeout: 10000 });
    });

    test('small PLY keeps canvas and viewport intact', async ({ page }) => {
      await importPlyModel(page, 'sample-model.ply');

      const canvas = page.locator('#viewport canvas');
      await expect(canvas).toBeAttached();

      const hasContext = await page.evaluate(() => {
        const canvas = document.querySelector('#viewport canvas');
        if (!canvas) return false;
        const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return ctx !== null;
      });
      expect(hasContext).toBe(true);
    });
  });

  test.describe('Large PLY (octree path)', () => {

    test('import large PLY adds model to models tree', async ({ page }) => {
      const modelsTab = page.getByRole('tab', { name: '🌐' });
      await modelsTab.click();

      await importPlyModel(page, 'sample-pointcloud-large.ply');

      const sidebar = page.locator('.sidebar-panel');
      await expect(sidebar.locator('text=sample-pointcloud-large.ply')).toBeVisible({ timeout: 10000 });
    });

    test('large PLY logs octree info to console', async ({ page }) => {
      const consoleMessages = [];
      page.on('console', (msg) => {
        if (msg.type() === 'log') consoleMessages.push(msg.text());
      });

      await importPlyModel(page, 'sample-pointcloud-large.ply');

      const plyLog = consoleMessages.find((m) => m.includes('PLY:') && m.includes('6,000 points') && m.includes('octree'));
      expect(plyLog).toBeDefined();
    });

    test('large PLY keeps canvas and viewport intact', async ({ page }) => {
      await importPlyModel(page, 'sample-pointcloud-large.ply');

      const canvas = page.locator('#viewport canvas');
      await expect(canvas).toBeAttached();

      const hasContext = await page.evaluate(() => {
        const canvas = document.querySelector('#viewport canvas');
        if (!canvas) return false;
        const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return ctx !== null;
      });
      expect(hasContext).toBe(true);
    });

    test('large PLY shows coordinate dialog', async ({ page }) => {
      await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-pointcloud-large.ply'));

      const skipBtn = page.locator('#model-coord-skip');
      await expect(skipBtn).toBeVisible({ timeout: 10000 });
    });
  });
});
