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
  await page.locator('#openFileInput').setInputFiles(path.join(fixturesDir, fixture));
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

/**
 * Locate a floating window created by the window manager, by its logical key.
 * Prefer this over the variant class (.popup--editor and friends), which matches every window of
 * a family and so is ambiguous when more than one of them is open.
 */
export function windowPanel(page, key) {
  return page.locator(`.popup[data-window-key="${key}"]`);
}

/**
 * Measurements that prove no floating window has managed to make the document scrollable. A
 * window that grows the document pushes the navbar, footer and sidebar out of sight with no
 * scrollbar to bring them back, which is the failure this whole subsystem was rewritten to
 * make impossible.
 */
export function readScrollState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth  : root.scrollWidth,
      clientWidth  : root.clientWidth,
      scrollHeight : root.scrollHeight,
      clientHeight : root.clientHeight,
      scrollTop    : root.scrollTop,
      scrollLeft   : root.scrollLeft
    };
  });
}

export async function expectDocumentNotScrollable(page) {
  const state = await readScrollState(page);
  expect(state.scrollWidth, 'document grew horizontally').toBe(state.clientWidth);
  expect(state.scrollHeight, 'document grew vertically').toBe(state.clientHeight);
  expect(state.scrollTop, 'document scrolled vertically').toBe(0);
  expect(state.scrollLeft, 'document scrolled horizontally').toBe(0);
  await expect(page.locator('.topnavbar')).toBeInViewport();
  await expect(page.locator('#footer')).toBeInViewport();
  await expect(page.locator('#sidebar-container')).toBeInViewport();
}

/**
 * Open a throwaway window through the real Window class. Used by the window manager tests so
 * they exercise the manager rather than any particular editor's quirks.
 */
export async function openTestWindow(page, options = {}) {
  await page.evaluate(async (opts) => {
    const { Window } = await import('/src/ui/window/window.js');
    const win = new Window({
      title : () => opts.title ?? 'Test window',
      ...opts
    });
    win.open((content) => {
      content.innerHTML = opts.contentHtml ?? '<p style="padding:20px">test content</p>';
    });
    window.__testWindows = window.__testWindows ?? {};
    window.__testWindows[win.key] = win;
  }, options);
  return windowPanel(page, options.key);
}
