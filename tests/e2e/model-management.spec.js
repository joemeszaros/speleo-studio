import { test, expect } from '@playwright/test';
import path from 'path';
import { setupWithProject, setupWithCave, initApp, closeProjectPanel, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

/**
 * Import a PLY model and skip the coordinate dialog.
 */
async function importModel(page, fixture = 'sample-model.ply') {
  // Set up handler to skip the coordinate dialog when it appears
  const skipCoordDialog = async () => {
    const skipBtn = page.locator('#model-coord-skip');
    await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }
  };

  // Trigger file input
  await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, fixture));

  // Handle the coordinate dialog
  await skipCoordDialog();

  // Wait for model to appear in models tree
  await page.waitForTimeout(2000);
  await dismissNotifications(page);
}

/**
 * Import a PLY model with coordinates.
 */
async function importModelWithCoords(page, fixture = 'sample-model.ply', lat = '47.5', lon = '19.0', elev = '200') {
  await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, fixture));

  // Fill coordinate dialog
  const okBtn = page.locator('#model-coord-ok');
  await okBtn.waitFor({ state: 'visible', timeout: 5000 });

  await page.locator('#model-coord-lat').fill(lat);
  await page.locator('#model-coord-lon').fill(lon);
  await page.locator('#model-coord-elev').fill(elev);
  await okBtn.click();

  await page.waitForTimeout(2000);
  await dismissNotifications(page);
}

test.describe('3D Model Management', () => {

  test.describe('Model Import', () => {

    test('import PLY model shows coordinate dialog', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

      // Coordinate dialog should appear
      const dialog = page.locator('#model-coord-lat');
      await expect(dialog).toBeVisible({ timeout: 5000 });
    });

    test('coordinate dialog has lat/lon/elev inputs', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

      await expect(page.locator('#model-coord-lat')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#model-coord-lon')).toBeVisible();
      await expect(page.locator('#model-coord-elev')).toBeVisible();
    });

    test('coordinate dialog has OK and Skip buttons', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

      await expect(page.locator('#model-coord-ok')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#model-coord-skip')).toBeVisible();
    });

    test('skip coordinate dialog imports model without coordinates', async ({ page }) => {
      await setupWithProject(page);
      await importModel(page);

      // Switch to models tab
      await page.locator('.sidebar-tab[data-tab="models"]').click();

      // Model should appear in models tree
      const modelsTree = page.locator('#models-tree');
      const modelNodes = modelsTree.locator('.models-tree-node');
      await expect(modelNodes).not.toHaveCount(0, { timeout: 5000 });
    });

    test('model appears in models tree after import', async ({ page }) => {
      await setupWithProject(page);
      await importModel(page);

      // Should auto-switch to models tab
      await page.locator('.sidebar-tab[data-tab="models"]').click();

      const modelsTree = page.locator('#models-tree');
      // The model name should be visible (derived from filename)
      await expect(modelsTree.locator('.models-tree-node-label')).not.toHaveCount(0, { timeout: 5000 });
    });

    test('import model via File menu Open Model', async ({ page }) => {
      await setupWithProject(page);

      // Open File menu
      const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
      await fileMenu.locator('.dropbtn').click();

      // Click Open Model
      const openModelItem = page.locator('.mydropdown-content a', { hasText: 'Open model' });
      await expect(openModelItem).toBeVisible();
      // Just verify the menu item exists - clicking would open native file dialog
    });
  });

  test.describe('Models Tree', () => {

    test.beforeEach(async ({ page }) => {
      await setupWithProject(page);
      await importModel(page);
      await page.locator('.sidebar-tab[data-tab="models"]').click();
    });

    test('model node has visibility toggle', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const visibilityToggle = modelsTree.locator('.models-tree-visibility').first();
      await expect(visibilityToggle).toBeVisible({ timeout: 5000 });
    });

    test('clicking visibility toggle changes state', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const visibilityToggle = modelsTree.locator('.models-tree-visibility').first();
      await expect(visibilityToggle).toBeVisible({ timeout: 5000 });

      const classBefore = await visibilityToggle.getAttribute('class');
      await visibilityToggle.click();
      await page.waitForTimeout(300);
      const classAfter = await visibilityToggle.getAttribute('class');

      expect(classAfter).not.toBe(classBefore);
    });

    test('clicking model node selects it', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });

      await modelNode.click();
      await expect(modelNode).toHaveClass(/selected/);
    });

    test('selecting model shows properties panel', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });

      await modelNode.click();

      // Properties panel should show content (not empty message)
      const properties = page.locator('#models-properties');
      const content = properties.locator('.models-properties-content');
      await expect(content).toBeVisible({ timeout: 3000 });
    });

    test('properties panel has position/rotation/scale sections', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });
      await modelNode.click();

      const properties = page.locator('#models-properties');
      await expect(properties.locator('.models-properties-content')).toBeVisible({ timeout: 3000 });

      // Should have Position, Rotation, Scale sections
      const sectionLabels = properties.locator('.models-properties-section-label');
      const texts = await sectionLabels.allTextContents();
      expect(texts.some(t => t.includes('Position'))).toBeTruthy();
      expect(texts.some(t => t.includes('Rotation'))).toBeTruthy();
      expect(texts.some(t => t.includes('Scale'))).toBeTruthy();
    });

    test('properties panel has number inputs for position', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });
      await modelNode.click();

      const properties = page.locator('#models-properties');
      await expect(properties.locator('.models-properties-content')).toBeVisible({ timeout: 3000 });

      const inputs = properties.locator('.models-properties-input');
      const count = await inputs.count();
      // At least 9 inputs: 3 for position, 3 for rotation, 3 for scale
      expect(count).toBeGreaterThanOrEqual(9);
    });

    test('properties panel has opacity slider', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });
      await modelNode.click();

      const properties = page.locator('#models-properties');
      await expect(properties.locator('.models-properties-content')).toBeVisible({ timeout: 3000 });

      const slider = properties.locator('.models-properties-slider');
      await expect(slider).toBeVisible();
    });

    test('right-click model shows context menu', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });

      await modelNode.click({ button: 'right' });

      const contextMenu = page.locator('#models-context-menu');
      await expect(contextMenu).toBeVisible();

      const options = contextMenu.locator('.context-menu-option');
      await expect(options).not.toHaveCount(0);
    });

    test('model context menu has delete option', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });

      await modelNode.click({ button: 'right' });

      const contextMenu = page.locator('#models-context-menu');
      await expect(contextMenu).toBeVisible();

      // Delete option should be in the menu (🗑️ emoji)
      await expect(contextMenu.locator('.context-menu-option[title*="elete"]')).toBeAttached();
    });

    test('delete model via context menu', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const modelNode = modelsTree.locator('.models-tree-node').first();
      await expect(modelNode).toBeVisible({ timeout: 5000 });

      const modelCountBefore = await modelsTree.locator('.models-tree-node').count();

      // Handle confirmation dialog
      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      await modelNode.click({ button: 'right' });
      const contextMenu = page.locator('#models-context-menu');
      const deleteOption = contextMenu.locator('.context-menu-option[title*="elete"]');
      await deleteOption.click();

      await page.waitForTimeout(1000);

      const modelCountAfter = await modelsTree.locator('.models-tree-node').count();
      expect(modelCountAfter).toBeLessThan(modelCountBefore);
    });

    test('model node shows filename as label', async ({ page }) => {
      const modelsTree = page.locator('#models-tree');
      const label = modelsTree.locator('.models-tree-node-label').first();
      await expect(label).toBeVisible({ timeout: 5000 });

      const text = await label.textContent();
      expect(text).toContain('sample-model');
    });
  });

  test.describe('Model with Coordinates', () => {

    test('import model with WGS84 coordinates', async ({ page }) => {
      await setupWithCave(page);

      await importModelWithCoords(page);

      await page.locator('.sidebar-tab[data-tab="models"]').click();

      const modelsTree = page.locator('#models-tree');
      const modelNodes = modelsTree.locator('.models-tree-node');
      await expect(modelNodes).not.toHaveCount(0, { timeout: 5000 });
    });
  });
});
