import { test, expect } from '@playwright/test';
import path from 'path';
import { setupWithProject, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

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

async function getFirstModelName(page) {
  return page.evaluate(() => window.speleo?.modelsTree?.categories?.get('3d-models')?.children?.[0]?.label ?? null);
}

async function getMaterialWireframeStates(page, name) {
  return page.evaluate((n) => {
    const entry = window.speleo?.scene?.models?.meshObjects?.get(n);
    if (!entry) return null;
    const out = [];
    entry.object3D.traverse((c) => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => out.push({ wireframe: m.wireframe, vertexColors: m.vertexColors }));
      }
    });
    return out;
  }, name);
}

test.describe('Model Wireframe Mode', () => {

  test('wireframe entry appears in context menu for untextured mesh', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.obj');
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });
    await modelNode.click({ button: 'right' });

    const menu = page.locator('#models-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.context-menu-option[title="Show as wireframe"]')).toHaveCount(1);
  });

  test('wireframe entry is hidden for point cloud', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.ply');
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });
    await modelNode.click({ button: 'right' });

    const menu = page.locator('#models-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.context-menu-option[title*="wireframe" i]')).toHaveCount(0);
    await expect(menu.locator('.context-menu-option[title*="solid" i]')).toHaveCount(0);
  });

  test('wireframe entry is hidden for textured mesh', async ({ page }) => {
    await setupWithProject(page);
    await importModelWithTextures(page, ['sample-model-with-mtl.obj', 'sample-model.mtl']);
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });
    await modelNode.click({ button: 'right' });

    const menu = page.locator('#models-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.context-menu-option[title*="wireframe" i]')).toHaveCount(0);
    await expect(menu.locator('.context-menu-option[title*="solid" i]')).toHaveCount(0);
  });

  test('clicking wireframe entry enables wireframe on mesh materials', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.obj');
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });
    const name = await getFirstModelName(page);
    expect(name).not.toBeNull();

    const before = await getMaterialWireframeStates(page, name);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(s => s.wireframe === false)).toBe(true);

    await modelNode.click({ button: 'right' });
    await page.locator('#models-context-menu .context-menu-option[title="Show as wireframe"]').click();
    await page.waitForTimeout(200);

    const after = await getMaterialWireframeStates(page, name);
    expect(after.length).toBe(before.length);
    expect(after.every(s => s.wireframe === true)).toBe(true);
  });

  test('after enabling wireframe, menu shows solid toggle on next open', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.obj');
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });

    await modelNode.click({ button: 'right' });
    await page.locator('#models-context-menu .context-menu-option[title="Show as wireframe"]').click();
    await page.waitForTimeout(200);

    await modelNode.click({ button: 'right' });
    const menu = page.locator('#models-context-menu');
    await expect(menu.locator('.context-menu-option[title="Show as solid"]')).toHaveCount(1);
    await expect(menu.locator('.context-menu-option[title="Show as wireframe"]')).toHaveCount(0);
  });

  test('clicking solid entry disables wireframe on mesh materials', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.obj');
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });
    const name = await getFirstModelName(page);

    await modelNode.click({ button: 'right' });
    await page.locator('#models-context-menu .context-menu-option[title="Show as wireframe"]').click();
    await page.waitForTimeout(200);

    await modelNode.click({ button: 'right' });
    await page.locator('#models-context-menu .context-menu-option[title="Show as solid"]').click();
    await page.waitForTimeout(200);

    const vals = await getMaterialWireframeStates(page, name);
    expect(vals.length).toBeGreaterThan(0);
    expect(vals.every(s => s.wireframe === false)).toBe(true);
  });

  test('wireframe flag is saved to modelFileSettings', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.obj');
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });

    await modelNode.click({ button: 'right' });
    await page.locator('#models-context-menu .context-menu-option[title="Show as wireframe"]').click();
    // Debounced save runs at 500ms
    await page.waitForTimeout(1000);

    const saved = await page.evaluate(async () => {
      const tree = window.speleo.modelsTree;
      const node = tree.categories.get('3d-models').children[0];
      const proj = tree.projectSystem.getCurrentProject();
      return await tree.modelSystem.getModelFileSettings(node.modelFileId, proj.id);
    });

    expect(saved?.wireframe).toBe(true);
  });

  test('wireframe survives color mode change to gradient by Z', async ({ page }) => {
    await setupWithProject(page);
    await importModelSkipCoords(page, 'sample-model.obj');
    await page.locator('.sidebar-tab[data-tab="models"]').click();

    const modelNode = page.locator('#models-tree .models-tree-node').first();
    await expect(modelNode).toBeVisible({ timeout: 5000 });
    const name = await getFirstModelName(page);

    // Enable wireframe
    await modelNode.click({ button: 'right' });
    await page.locator('#models-context-menu .context-menu-option[title="Show as wireframe"]').click();
    await page.waitForTimeout(200);

    // Switch color mode; gradient writes vertexColors but must not touch material.wireframe
    await page.evaluate(async () => {
      await window.speleo.scene.models.updateModelColorMode('gradientByZ');
    });
    await page.waitForTimeout(200);

    const state = await getMaterialWireframeStates(page, name);
    expect(state.length).toBeGreaterThan(0);
    for (const s of state) {
      expect(s.wireframe).toBe(true);
      expect(s.vertexColors).toBe(true);
    }
  });
});
