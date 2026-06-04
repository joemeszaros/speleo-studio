import { test, expect } from '@playwright/test';
import { setupWithCave, expandCaveNode, rightClickCave, dismissNotifications } from './helpers.js';

/**
 * Fill an input using pressSequentially to trigger real keyboard events
 * (needed for property-assigned oninput/onchange handlers).
 */
async function fillInput(locator, value) {
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(value);
}

/**
 * Fill the required fields (name, cataster code, date, creator) in the cave editor.
 */
async function fillRequiredFields(editor, name, extras = {}) {
  await fillInput(editor.locator('input#name'), name);
  await fillInput(editor.locator('input#catasterCode'), extras.catasterCode ?? '0000-01');
  await editor.locator('input#date').fill(extras.date ?? '2025-01-01');
  await fillInput(editor.locator('input#creator'), extras.creator ?? 'Test');
}

/**
 * Open the cave context menu and click the "New sub-cave" item.
 */
async function openNewSubCaveEditor(page, caveName) {
  await rightClickCave(page, caveName);
  const contextMenu = page.locator('#explorer-context-menu');
  await expect(contextMenu).toBeVisible();
  await contextMenu.locator('.context-menu-option[title="New sub-cave"]').click();
  await expect(page.locator('#fixed-size-editor')).toBeVisible({ timeout: 5000 });
}

/**
 * Create a sub-cave under `parentName` by driving the New sub-cave editor.
 */
async function createSubCave(page, parentName, subCaveName) {
  await openNewSubCaveEditor(page, parentName);
  const editor = page.locator('#fixed-size-editor');
  await fillRequiredFields(editor, subCaveName);
  await editor.locator('button[type="submit"]').click();
  await dismissNotifications(page);
  await expect.poll(() => childCaveNames(page, parentName)).toContain(subCaveName);
}

/**
 * Right-click a (possibly nested) sub-cave node, identified by its own label.
 * The parent must be expanded so the sub-cave node is rendered.
 */
async function rightClickSubCave(page, subCaveName) {
  const header = page
    .locator('#explorer-tree .models-tree-category-header')
    .filter({ has: page.locator('.models-tree-category-label', { hasText: subCaveName }) });
  await header.click({ button: 'right' });
}

/**
 * Read the names of the direct child caves of a top-level cave from the live app state.
 */
function childCaveNames(page, caveName) {
  return page.evaluate((name) => {
    const cave = window.speleo.db.getCave(name);
    return cave ? cave.children.map((c) => c.name) : null;
  }, caveName);
}

test.describe('Sub-cave creation from cave context menu', () => {

  test('cave context menu has New survey and New sub-cave with distinct icons', async ({ page }) => {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');

    const contextMenu = page.locator('#explorer-context-menu');
    await expect(contextMenu).toBeVisible();

    const newSurvey = contextMenu.locator('.context-menu-option[title="New survey"]');
    const newSubCave = contextMenu.locator('.context-menu-option[title="New sub-cave"]');
    await expect(newSurvey).toBeAttached();
    await expect(newSubCave).toBeAttached();

    // The two create actions are visually differentiated: both have a non-empty icon and the
    // icons are not the same.
    const surveyIcon = (await newSurvey.textContent())?.trim();
    const subCaveIcon = (await newSubCave.textContent())?.trim();
    expect(surveyIcon).toBeTruthy();
    expect(subCaveIcon).toBeTruthy();
    expect(surveyIcon).not.toBe(subCaveIcon);
  });

  test('cave context menu has an Export cave item', async ({ page }) => {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');

    const exportItem = page.locator('#explorer-context-menu .context-menu-option[title="Export cave"]');
    await expect(exportItem).toBeAttached();
  });

  test('New sub-cave opens the cave editor titled "New sub-cave"', async ({ page }) => {
    await setupWithCave(page);
    await openNewSubCaveEditor(page, 'Test Cave');

    const editor = page.locator('#fixed-size-editor');
    await expect(editor.locator('.popup-header')).toContainText('New sub-cave');
    await expect(editor.locator('input#name')).toHaveValue('');
  });

  test('sub-cave editor hides the coordinate-system section', async ({ page }) => {
    await setupWithCave(page);
    await openNewSubCaveEditor(page, 'Test Cave');

    // Sub-caves inherit geoData from the root cave, so the coordinate section is hidden.
    await expect(page.locator('#fixed-size-editor .coords-section')).toBeHidden();
  });

  test('saving a new sub-cave nests it under the parent cave', async ({ page }) => {
    await setupWithCave(page);
    await openNewSubCaveEditor(page, 'Test Cave');

    const editor = page.locator('#fixed-size-editor');
    await fillRequiredFields(editor, 'Lower Branch');
    await editor.locator('button[type="submit"]').click();
    await dismissNotifications(page);

    // The new sub-cave is a child of the parent in the live data model...
    await expect.poll(() => childCaveNames(page, 'Test Cave')).toContain('Lower Branch');

    // ...and it has no own geoData (inherited from the root).
    const subCaveHasGeo = await page.evaluate(() => {
      const cave = window.speleo.db.getCave('Test Cave');
      const sub = cave.children.find((c) => c.name === 'Lower Branch');
      return sub?.geoData !== undefined && sub?.geoData !== null;
    });
    expect(subCaveHasGeo).toBe(false);

    // ...and it shows up nested under the parent in the explorer tree.
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree')).toContainText('Lower Branch', { timeout: 5000 });
  });

  test('cancel does not create a sub-cave', async ({ page }) => {
    await setupWithCave(page);
    await openNewSubCaveEditor(page, 'Test Cave');

    const editor = page.locator('#fixed-size-editor');
    await fillInput(editor.locator('input#name'), 'Ghost Branch');
    await editor.getByRole('button', { name: 'Cancel' }).click();

    await expect(editor).toBeHidden({ timeout: 5000 });
    expect(await childCaveNames(page, 'Test Cave')).not.toContain('Ghost Branch');
  });

  test('duplicate sub-cave name within the parent is rejected', async ({ page }) => {
    await setupWithCave(page);

    // Create the first sub-cave.
    await openNewSubCaveEditor(page, 'Test Cave');
    let editor = page.locator('#fixed-size-editor');
    await fillRequiredFields(editor, 'Duplicate Branch');
    await editor.locator('button[type="submit"]').click();
    await dismissNotifications(page);
    await expect.poll(() => childCaveNames(page, 'Test Cave')).toContain('Duplicate Branch');

    // Attempt a second sub-cave with the same name.
    await openNewSubCaveEditor(page, 'Test Cave');
    editor = page.locator('#fixed-size-editor');
    await fillRequiredFields(editor, 'Duplicate Branch');
    await editor.locator('button[type="submit"]').click();

    // An error notification appears and no duplicate is added.
    const errorPanel = page.locator('#cautionpanel .cautionpanel-item[data-type="error"]');
    await expect(errorPanel).toBeVisible({ timeout: 5000 });

    const count = await page.evaluate(() => {
      const cave = window.speleo.db.getCave('Test Cave');
      return cave.children.filter((c) => c.name === 'Duplicate Branch').length;
    });
    expect(count).toBe(1);
  });

  test('a survey can be added to a sub-cave', async ({ page }) => {
    await setupWithCave(page);
    await createSubCave(page, 'Test Cave', 'Branch A');

    // Reveal the sub-cave node, then open its "New survey" sheet.
    await expandCaveNode(page, 'Test Cave');
    await rightClickSubCave(page, 'Branch A');
    const contextMenu = page.locator('#explorer-context-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('.context-menu-option[title="New survey"]').click();

    const editor = page.locator('#fixed-size-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await fillInput(editor.locator('input#name'), 'Sub Survey 1');
    await editor.locator('input#date').fill('2025-01-01');
    await editor.locator('button[type="submit"]').click();
    await dismissNotifications(page);

    // The survey lands on the sub-cave (regression: previously this threw because the sub-cave
    // could not be resolved by name in the top-level cave map).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const sub = window.speleo.db.getCave('Test Cave').children.find((c) => c.name === 'Branch A');
          return sub ? sub.surveys.map((s) => s.name) : [];
        })
      )
      .toContain('Sub Survey 1');
  });

  test('a new sub-cave (and its survey) survive a project reload', async ({ page }) => {
    await setupWithCave(page);
    await createSubCave(page, 'Test Cave', 'Persisted Branch');

    await expandCaveNode(page, 'Test Cave');
    await rightClickSubCave(page, 'Persisted Branch');
    await page.locator('#explorer-context-menu .context-menu-option[title="New survey"]').click();
    const editor = page.locator('#fixed-size-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await fillInput(editor.locator('input#name'), 'Persisted Survey');
    await editor.locator('input#date').fill('2025-01-01');
    await editor.locator('button[type="submit"]').click();
    await dismissNotifications(page);

    // Reload the page and reopen the project from IndexedDB.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {
      const s = window.speleo;
      const proj = await s.projectSystem.loadProjectByName('Test Project');
      s.projectSystem.setCurrentProject(proj);
      await s.projectManager.currentProjectChanged(proj, true);
    });

    const persisted = await page.evaluate(() => {
      const root = window.speleo.db.getCave('Test Cave');
      const sub = root?.children.find((c) => c.name === 'Persisted Branch');
      return { hasSub: !!sub, surveys: sub ? sub.surveys.map((s) => s.name) : [] };
    });
    expect(persisted.hasSub).toBe(true);
    expect(persisted.surveys).toContain('Persisted Survey');
  });
});
