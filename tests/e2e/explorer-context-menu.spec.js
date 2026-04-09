import { test, expect } from '@playwright/test';
import { setupWithCave, expandCaveNode, rightClickCave, rightClickSurvey } from './helpers.js';

test.describe('Explorer Context Menus & Visibility', () => {

  test('right-click cave shows context menu', async ({ page }) => {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');

    const contextMenu = page.locator('#explorer-context-menu');
    await expect(contextMenu).toBeVisible();

    const options = contextMenu.locator('.context-menu-option');
    await expect(options).not.toHaveCount(0);
  });

  test('cave context menu has expected items', async ({ page }) => {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');

    const contextMenu = page.locator('#explorer-context-menu');
    await expect(contextMenu).toBeVisible();

    // Context menu items use title attribute for translated text
    await expect(contextMenu.locator('.context-menu-option[title*="cave sheet"]')).toBeAttached();
    await expect(contextMenu.locator('.context-menu-option[title="New survey"]')).toBeAttached();
    await expect(contextMenu.locator('.context-menu-option[title*="elete cave"]')).toBeAttached();
  });

  test('right-click survey shows context menu', async ({ page }) => {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

    await rightClickSurvey(page, 'Main Survey');

    const contextMenu = page.locator('#explorer-context-menu');
    await expect(contextMenu).toBeVisible();
  });

  test('survey context menu has expected items', async ({ page }) => {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

    await rightClickSurvey(page, 'Main Survey');

    const contextMenu = page.locator('#explorer-context-menu');
    await expect(contextMenu.locator('.context-menu-option[title*="survey editor"]')).toBeAttached();
    await expect(contextMenu.locator('.context-menu-option[title*="survey sheet" i]')).toBeAttached();
    await expect(contextMenu.locator('.context-menu-option[title*="elete"]')).toBeAttached();
  });

  test('clicking away closes context menu', async ({ page }) => {
    await setupWithCave(page);
    await rightClickCave(page, 'Test Cave');

    const contextMenu = page.locator('#explorer-context-menu');
    await expect(contextMenu).toBeVisible();

    await page.locator('#viewport').click();
    await expect(contextMenu).toBeHidden();
  });

  test('cave visibility toggle exists', async ({ page }) => {
    await setupWithCave(page);

    const caveCategory = page.locator('.models-tree-category', { has: page.locator('text=Test Cave') });
    const visibilityToggle = caveCategory.locator('.explorer-tree-visibility');
    await expect(visibilityToggle).toBeVisible();
  });

  test('clicking cave visibility toggle changes state', async ({ page }) => {
    await setupWithCave(page);

    const caveCategory = page.locator('.models-tree-category', { has: page.locator('text=Test Cave') });
    const visibilityToggle = caveCategory.locator('.explorer-tree-visibility').first();

    const classBefore = await visibilityToggle.getAttribute('class');
    await visibilityToggle.click();
    await page.waitForTimeout(300);
    const classAfter = await visibilityToggle.getAttribute('class');

    expect(classAfter).not.toBe(classBefore);
  });

  test('survey visibility toggle exists after expanding', async ({ page }) => {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

    const surveyNode = page.locator('.explorer-tree-node', { has: page.locator('text=Main Survey') });
    const visibilityToggle = surveyNode.locator('.explorer-tree-visibility');
    await expect(visibilityToggle).toBeVisible();
  });

  test('delete cave via context menu', async ({ page }) => {
    await setupWithCave(page);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await rightClickCave(page, 'Test Cave');
    const contextMenu = page.locator('#explorer-context-menu');

    const deleteOption = contextMenu.locator('.context-menu-option[title*="elete"]');
    await deleteOption.click();

    await expect(page.locator('#explorer-tree').locator('text=Test Cave')).toBeHidden({ timeout: 5000 });
  });

  test('selecting a cave node highlights it', async ({ page }) => {
    await setupWithCave(page);

    const caveHeader = page
      .locator('.models-tree-category', { has: page.locator('text=Test Cave') })
      .locator('.models-tree-category-header');

    await caveHeader.click();
    await expect(caveHeader).toHaveClass(/selected/);
  });

  test('selecting a survey node highlights it', async ({ page }) => {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

    const surveyNode = page.locator('.explorer-tree-node', { has: page.locator('text=Main Survey') });
    await surveyNode.click();
    await expect(surveyNode).toHaveClass(/selected/);
  });
});
