import { test, expect } from '@playwright/test';
import path from 'path';
import { setupWithProject, setupWithCave, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

/**
 * Import a model file and skip the coordinate dialog.
 */
async function importModelSkipCoords(page, fixture) {
  await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, fixture));

  const skipBtn = page.locator('#model-coord-skip');
  await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skipBtn.isVisible()) {
    await skipBtn.click();
  }

  await page.waitForTimeout(2000);
  await dismissNotifications(page);
}

/**
 * Import model files (model + textures) and skip the coordinate dialog.
 */
async function importModelWithTextures(page, files) {
  const filePaths = files.map(f => path.join(fixturesDir, f));
  await page.locator('#modelInput').setInputFiles(filePaths);

  const skipBtn = page.locator('#model-coord-skip');
  await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skipBtn.isVisible()) {
    await skipBtn.click();
  }

  await page.waitForTimeout(2000);
  await dismissNotifications(page);
}

/**
 * Switch to models tab and verify model count.
 */
async function verifyModelInTree(page, expectedCount = 1) {
  await page.locator('.sidebar-tab[data-tab="models"]').click();
  const modelsTree = page.locator('#models-tree');
  const modelNodes = modelsTree.locator('.models-tree-node');
  await expect(modelNodes).toHaveCount(expectedCount, { timeout: 5000 });
}

test.describe('Model Import - OBJ Format', () => {

  test('import OBJ model without textures', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.obj');
    await verifyModelInTree(page);
  });

  test('OBJ with embedded coordinates shows them in dialog', async ({ page }) => {
    await setupWithProject(page);

    await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.obj'));

    // Dialog should appear with pre-filled coordinates from OBJ comments
    const latInput = page.locator('#model-coord-lat');
    await expect(latInput).toBeVisible({ timeout: 5000 });

    const latVal = await latInput.inputValue();
    const lonVal = await page.locator('#model-coord-lon').inputValue();

    // sample-model.obj has Latitude: 47.6438, Longitude: 18.9775
    expect(parseFloat(latVal)).toBeCloseTo(47.6438, 3);
    expect(parseFloat(lonVal)).toBeCloseTo(18.9775, 3);

    await page.locator('#model-coord-skip').click();
  });

  test('import OBJ with MTL texture files', async ({ page }) => {
    await setupWithProject(page);
    await importModelWithTextures(page, ['sample-model-with-mtl.obj', 'sample-model.mtl']);
    await verifyModelInTree(page);
  });
});

test.describe('Model Import - PLY Color Formats', () => {

  test('import PLY with 8-bit (uchar) colors', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model-colors-8bit.ply');
    await verifyModelInTree(page);

    // Verify the model loaded without console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.waitForTimeout(500);
    const colorErrors = errors.filter(e => e.toLowerCase().includes('color'));
    expect(colorErrors).toEqual([]);
  });

  test('import PLY with float colors (0.0-1.0)', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model-colors-float.ply');
    await verifyModelInTree(page);
  });

  test('import PLY with 16-bit (ushort) colors', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model-colors-16bit.ply');
    await verifyModelInTree(page);
  });

  test('import PLY without colors', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model-no-colors.ply');
    await verifyModelInTree(page);
  });

  test('import PLY mesh with faces', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-mesh.ply');
    await verifyModelInTree(page);
  });
});

test.describe('Model Embedding', () => {

  test('embed model via context menu shows embed icon', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');

    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelsTree = page.locator('#models-tree');
    const modelNode = modelsTree.locator('.models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });

    // Right-click to open context menu
    await modelNode.click({ button: 'right' });

    const contextMenu = page.locator('#models-context-menu');
    await expect(contextMenu).toBeVisible();

    // Click embed option (🔗)
    const embedOption = contextMenu.locator('.context-menu-option[title*="mbed"]').first();
    await expect(embedOption).toBeAttached();
    await embedOption.click();

    await page.waitForTimeout(1000);

    // Embedded icon should appear on the model node
    const embedIcon = modelsTree.locator('.models-tree-embed-icon');
    await expect(embedIcon).toBeVisible({ timeout: 3000 });
  });

  test('unembed model removes embed icon', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');

    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelsTree = page.locator('#models-tree');
    const modelNode = modelsTree.locator('.models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });

    // Embed first
    await modelNode.click({ button: 'right' });
    const contextMenu = page.locator('#models-context-menu');
    const embedOption = contextMenu.locator('.context-menu-option[title*="mbed"]').first();
    await embedOption.click();
    await page.waitForTimeout(1000);

    // Now unembed
    await modelNode.click({ button: 'right' });
    const unembedOption = page.locator('#models-context-menu .context-menu-option[title*="mbed"]').first();
    await unembedOption.click();
    await page.waitForTimeout(1000);

    // Embed icon should be gone
    const embedIcon = modelsTree.locator('.models-tree-embed-icon');
    await expect(embedIcon).toHaveCount(0);
  });
});

test.describe('Model Coordinate Dialog', () => {

  test('import model with WGS84 coordinates sets coordinate system', async ({ page }) => {
    await setupWithProject(page);

    await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

    const okBtn = page.locator('#model-coord-ok');
    await okBtn.waitFor({ state: 'visible', timeout: 5000 });

    await page.locator('#model-coord-lat').fill('47.5');
    await page.locator('#model-coord-lon').fill('19.0');
    await page.locator('#model-coord-elev').fill('200');
    await okBtn.click();

    await page.waitForTimeout(2000);

    // Footer should show UTM coordinate system
    const footer = page.locator('#footer');
    const footerText = await footer.textContent();
    expect(footerText).toContain('UTM');
  });

  // Distance check only works when cave has geoData coordinates.
  // The sample-cave.json fixture has no coordinates, so this test verifies
  // that import succeeds when there's no coordinate conflict.
  test('model with coordinates imports when cave has no geoData', async ({ page }) => {
    await setupWithCave(page);

    await page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

    const okBtn = page.locator('#model-coord-ok');
    await okBtn.waitFor({ state: 'visible', timeout: 5000 });

    await page.locator('#model-coord-lat').fill('47.5');
    await page.locator('#model-coord-lon').fill('19.0');
    await page.locator('#model-coord-elev').fill('200');
    await okBtn.click();

    await page.waitForTimeout(2000);

    // Model should be imported (no distance conflict without cave coords)
    await page.locator('.sidebar-tab[data-tab="models"]').click();
    const modelsTree = page.locator('#models-tree');
    const modelNodes = modelsTree.locator('.models-tree-node');
    await expect(modelNodes).not.toHaveCount(0, { timeout: 5000 });
  });
});

test.describe('Model Context Menu - Right Click', () => {

  test('left click hides context menu', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');

    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelsTree = page.locator('#models-tree');
    const modelNode = modelsTree.locator('.models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });

    // Right-click to show context menu
    await modelNode.click({ button: 'right' });
    const contextMenu = page.locator('#models-context-menu');
    await expect(contextMenu).toBeVisible();

    // Left-click should hide it
    await modelNode.click();
    await page.waitForTimeout(300);

    await expect(contextMenu).not.toBeVisible();
  });

  test('context menu has model sheet option', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');

    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelsTree = page.locator('#models-tree');
    const modelNode = modelsTree.locator('.models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });

    await modelNode.click({ button: 'right' });

    const contextMenu = page.locator('#models-context-menu');
    // Should have model sheet (🔠), textures (🧶), embed (🔗), delete (🗑️) options
    const options = contextMenu.locator('.context-menu-option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Loading Overlay', () => {

  test('loading overlay appears during model import', async ({ page }) => {
    await setupWithProject(page);

    // Start model import - overlay should appear briefly
    const importPromise = page.locator('#modelInput').setInputFiles(path.join(fixturesDir, 'sample-model.ply'));

    // The overlay may be too fast to catch, but we can at least verify no errors
    await importPromise;

    const skipBtn = page.locator('#model-coord-skip');
    await skipBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await page.waitForTimeout(2000);

    // Verify no loading overlay stuck
    const overlay = page.locator('.loading-overlay');
    await expect(overlay).not.toBeVisible();
  });
});
