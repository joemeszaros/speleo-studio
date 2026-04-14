import { test, expect } from '@playwright/test';
import path from 'path';
import { setupWithProject, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

/**
 * Import a LAS model and skip the coordinate dialog.
 */
async function importLasModel(page, fixture = 'sample-pointcloud.las') {
  const skipCoordDialog = async () => {
    const skipBtn = page.locator('#model-coord-skip');
    await skipBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }
  };

  await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, fixture));
  await skipCoordDialog();
  await page.waitForTimeout(3000); // allow worker to parse + build octree
  await dismissNotifications(page);
}

test.describe('LAS Point Cloud Import', () => {

  test.beforeEach(async ({ page }) => {
    await setupWithProject(page, 'LAS Test Project');
  });

  test('import LAS file shows coordinate dialog', async ({ page }) => {
    await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-pointcloud.las'));

    // Coordinate dialog should appear
    const skipBtn = page.locator('#model-coord-skip');
    await expect(skipBtn).toBeVisible({ timeout: 10000 });
  });

  test('import LAS file adds model to models tree', async ({ page }) => {
    // Switch to models tab (🌐 emoji tab)
    const modelsTab = page.getByRole('tab', { name: '🌐' });
    await modelsTab.click();

    await importLasModel(page);

    // Model should appear in models tree
    const sidebar = page.locator('.sidebar-panel');
    await expect(sidebar.locator('text=sample-pointcloud.las')).toBeVisible({ timeout: 10000 });
  });

  test('import LAS file logs point count to console', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log') consoleMessages.push(msg.text());
    });

    await importLasModel(page);

    // Check console for LAS loading message
    const lasLog = consoleMessages.find((m) => m.includes('LAS:') && m.includes('100 points'));
    expect(lasLog).toBeDefined();
  });

  test('import LAS file keeps canvas and viewport intact', async ({ page }) => {
    await importLasModel(page);

    // Canvas should exist in viewport
    const canvas = page.locator('#viewport canvas');
    await expect(canvas).toBeAttached();

    // No errors should have occurred (WebGL context should be valid)
    const hasContext = await page.evaluate(() => {
      const canvas = document.querySelector('#viewport canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return ctx !== null;
    });
    expect(hasContext).toBe(true);
  });

  test('LAS file input accepts .las extension', async ({ page }) => {
    const accept = await page.locator('#modelInput').getAttribute('accept');
    expect(accept).toContain('.las');
    expect(accept).toContain('.laz');
  });
});
