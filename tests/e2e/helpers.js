import { expect } from '@playwright/test';
import path from 'path';

export const fixturesDir = path.resolve('tests/fixtures');

/**
 * Skip welcome panel and wait for app to initialize.
 */
export async function initApp(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('first-visit', 'false'));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);
}

/**
 * Close the project panel that auto-opens on startup.
 */
export async function closeProjectPanel(page) {
  const closeBtn = page.locator('#close-panel-btn');
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
  }
}

/**
 * Create a new project by handling the prompt() dialogs.
 */
export async function createProject(page, name = 'Test Project') {
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

/**
 * Full setup: init app, close project panel, create a project.
 */
export async function setupWithProject(page, projectName = 'Test Project') {
  await initApp(page);
  await closeProjectPanel(page);
  await createProject(page, projectName);
  await dismissNotifications(page);
}

/**
 * Dismiss any visible caution/notification panel immediately.
 */
export async function dismissNotifications(page) {
  await page.evaluate(() => {
    if (window.closeCautionPanel) window.closeCautionPanel();
  });
  await page.waitForTimeout(100);
}

/**
 * Full setup: init app, create project, import a cave fixture.
 */
export async function setupWithCave(page, fixture = 'sample-cave.json', caveName = 'Test Cave') {
  await setupWithProject(page);
  await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, fixture));
  await expect(page.locator('#explorer-tree').locator(`text=${caveName}`)).toBeVisible({ timeout: 10000 });
  // Dismiss success notification so it doesn't intercept clicks
  await dismissNotifications(page);
}

/**
 * Expand a cave node in the explorer tree by clicking the toggle arrow.
 */
export async function expandCaveNode(page, caveName) {
  const explorerTree = page.locator('#explorer-tree');
  const caveCategory = explorerTree.locator('.models-tree-category', { has: page.locator(`text=${caveName}`) });
  await caveCategory.locator('.models-tree-toggle').click();
}

/**
 * Right-click on a cave node to open context menu.
 */
export async function rightClickCave(page, caveName) {
  const explorerTree = page.locator('#explorer-tree');
  const caveHeader = explorerTree
    .locator('.models-tree-category', { has: page.locator(`text=${caveName}`) })
    .locator('.models-tree-category-header');
  await caveHeader.click({ button: 'right' });
}

/**
 * Right-click on a survey node to open context menu.
 */
export async function rightClickSurvey(page, surveyName) {
  const explorerTree = page.locator('#explorer-tree');
  const surveyNode = explorerTree.locator('.explorer-tree-node', { has: page.locator(`text=${surveyName}`) });
  await surveyNode.click({ button: 'right' });
}
