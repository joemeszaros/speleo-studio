import { test, expect } from '@playwright/test';
import path from 'path';

const fixturesDir = path.resolve('tests/fixtures');

async function createProject(page, name = 'Test Project') {
  let dialogCount = 0;
  const dialogHandler = async (dialog) => {
    dialogCount++;
    if (dialogCount === 1) await dialog.accept(name);
    else await dialog.accept('');
  };
  page.on('dialog', dialogHandler);
  await page.keyboard.press('Control+Shift+n');
  await page.waitForTimeout(1000);
  page.off('dialog', dialogHandler);
}

test.describe('Nested cave (multi-level Therion)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('first-visit', 'false'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);
    await createProject(page);
  });

  test('imports a multi-level .th into a nested cave tree and renders all surveys', async ({ page }) => {
    await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'nested-cave.th'));

    const explorerTree = page.locator('#explorer-tree');
    // Root cave keeps the file title
    await expect(explorerTree.locator('text=Nested System')).toBeVisible({ timeout: 10000 });

    // The scene must contain all 3 leaf surveys (passage1, passage2, caveB), keyed by id
    const sceneSurveyCount = await page.evaluate(() => {
      const co = window.speleo.scene.speleo.caveObjects;
      let n = 0;
      for (const inner of co.values()) n += inner.size;
      return n;
    });
    expect(sceneSurveyCount).toBe(3);

    // The cave model is nested: root has a child cave (caveA) and a leaf survey (caveB)
    const shape = await page.evaluate(() => {
      const caves = [...window.speleo.db.caves.values()];
      const root = caves.find((c) => c.name === 'Nested System');
      return {
        rootSurveys  : root.surveys.map((s) => s.name),
        childNames   : root.children.map((c) => c.name),
        allSurveys   : root.getAllSurveys().length,
        caveAName    : root.children[0]?.name,
        caveASurveys : root.children[0]?.surveys.map((s) => s.name).sort()
      };
    });
    expect(shape.childNames).toContain('caveA');
    expect(shape.rootSurveys).toContain('caveB');
    expect(shape.allSurveys).toBe(3);
    expect(shape.caveASurveys).toEqual(['passage1', 'passage2']);
  });

  test('imports a grouping of unconnected caves as separate top-level caves', async ({ page }) => {
    await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'grouping-caves.th'));

    const explorerTree = page.locator('#explorer-tree');
    // The two unconnected caves (no equates) become separate top-level caves, not one.
    await expect(explorerTree.locator('.models-tree-category-label', { hasText: /^alpha$/ })).toBeVisible({ timeout: 10000 });
    await expect(explorerTree.locator('.models-tree-category-label', { hasText: /^beta$/ })).toBeVisible();

    const shape = await page.evaluate(() => {
      const names = [...window.speleo.db.caves.values()].map((c) => c.name).sort();
      return { caveCount: window.speleo.db.caves.size, names };
    });
    expect(shape.caveCount).toBe(2);
    expect(shape.names).toEqual(['alpha', 'beta']);
  });

  test('expanding the tree reveals nested sub-cave and its surveys', async ({ page }) => {
    await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'nested-cave.th'));
    const explorerTree = page.locator('#explorer-tree');
    await expect(explorerTree.locator('text=Nested System')).toBeVisible({ timeout: 10000 });

    // Expand the root cave (scope the toggle to the root cave's own header)
    const rootHeader = explorerTree.locator('.models-tree-category-header', {
      has : page.locator('.models-tree-category-label', { hasText: 'Nested System' })
    });
    await rootHeader.locator('.models-tree-toggle').click();

    // The nested sub-cave caveA and leaf survey caveB should now be visible
    await expect(explorerTree.locator('.models-tree-category-label', { hasText: /^caveA$/ })).toBeVisible();
    await expect(explorerTree.locator('.explorer-tree-label', { hasText: /^caveB$/ })).toBeVisible();

    // Expand caveA (scope the toggle to caveA's own header) → its passages appear
    const caveAHeader = explorerTree.locator('.models-tree-category-header', {
      has : page.locator('.models-tree-category-label', { hasText: /^caveA$/ })
    });
    await caveAHeader.locator('.models-tree-toggle').click();
    await expect(explorerTree.locator('.explorer-tree-label', { hasText: /^passage1$/ })).toBeVisible();
    await expect(explorerTree.locator('.explorer-tree-label', { hasText: /^passage2$/ })).toBeVisible();
  });

  test('filter finds a survey nested deep under sub-caves (recursive search)', async ({ page }) => {
    await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'nested-cave.th'));
    const explorerTree = page.locator('#explorer-tree');
    await expect(explorerTree.locator('text=Nested System')).toBeVisible({ timeout: 10000 });

    // `passage1` is two levels deep (Nested System → caveA → passage1). The previous filter
    // only searched a cave's direct children, so deep matches were missed.
    const filterInput = page.locator('.explorer-filter-input');
    await filterInput.fill('passage1');
    await page.waitForTimeout(300);

    await expect(explorerTree.locator('.explorer-tree-label', { hasText: /^passage1$/ })).toBeVisible();
    // The non-matching sibling survey is filtered out.
    await expect(explorerTree.locator('.explorer-tree-label', { hasText: /^passage2$/ })).toHaveCount(0);
    // The ancestor caves are kept (so the match is reachable in the tree).
    await expect(explorerTree.locator('.models-tree-category-label', { hasText: /^caveA$/ })).toBeVisible();
  });

  test('shot-name (station) search matches stations in deeply nested surveys', async ({ page }) => {
    await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'nested-cave.th'));
    const explorerTree = page.locator('#explorer-tree');
    await expect(explorerTree.locator('text=Nested System')).toBeVisible({ timeout: 10000 });

    // Switch to station/shot-name search mode and look up a station that exists only in a
    // deeply nested survey (passage1 has stations 10,11,12).
    await page.evaluate(() => {
      const ex = window.speleo.explorerTree;
      ex.setSearchMode('shotNames');
      ex.filterText = '11';
      ex.applyFilter();
      ex.render();
    });
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      const ex = window.speleo.explorerTree;
      let surveys = 0;
      const walk = (n) => (n.children || []).forEach((c) => { if (c.type === 'survey') surveys++; walk(c); });
      ex.filteredNodes.forEach(walk);
      return { matchedSurveys: surveys };
    });
    expect(result.matchedSurveys).toBeGreaterThan(0);
  });

  test('move-to-top reorders a survey within its nested sub-cave', async ({ page }) => {
    await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'nested-cave.th'));
    await expect(page.locator('#explorer-tree').locator('text=Nested System')).toBeVisible({ timeout: 10000 });

    // caveA contains [passage1, passage2]; move passage2 to the top of its sub-cave and
    // verify BOTH the tree node order and the model surveys array updated (the old code
    // reordered the wrong — top-level — cave's flat array and silently failed).
    const result = await page.evaluate(() => {
      const ex = window.speleo.explorerTree;
      // locate the passage2 node and caveA node
      let caveA = null, p2 = null;
      const walk = (n) => {
        if (n.label === 'caveA') caveA = n;
        (n.children || []).forEach((c) => { if (c.label === 'passage2') p2 = c; walk(c); });
      };
      ex.nodes.forEach(walk);
      const before = caveA.data.surveys.map((s) => s.name);
      ex.moveSurveyToTop(p2.id);
      const afterModel = caveA.data.surveys.map((s) => s.name);
      const afterTree = caveA.children.filter((c) => c.type === 'survey').map((c) => c.label);
      return { before, afterModel, afterTree };
    });
    expect(result.before).toEqual(['passage1', 'passage2']);
    expect(result.afterModel).toEqual(['passage2', 'passage1']);
    expect(result.afterTree).toEqual(['passage2', 'passage1']);
  });
});
