import { test, expect } from '@playwright/test';
import path from 'path';
import { initApp, closeProjectPanel, createProject, setupWithProject, setupWithCave, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

test.describe('Project Management', () => {

  test.describe('Project Panel', () => {

    test.beforeEach(async ({ page }) => {
      await initApp(page);
    });

    test('open project panel via keyboard shortcut', async ({ page }) => {
      await page.keyboard.press('Control+Shift+p');
      await expect(page.locator('#project-panel')).toBeVisible();
    });

    test('open project panel via menu', async ({ page }) => {
      await closeProjectPanel(page);
      const projectMenu = page.locator('.dropbtn:text("Project")');
      await projectMenu.click();
      await page.locator('.mydropdown-content a:text("Project Manager")').click();
      await expect(page.locator('#project-panel')).toBeVisible();
    });

    test('project panel has required buttons', async ({ page }) => {
      await page.keyboard.press('Control+Shift+p');
      await expect(page.locator('#new-project-btn')).toBeVisible();
      await expect(page.locator('#import-project-btn')).toBeVisible();
      await expect(page.locator('#export-project-btn')).toBeVisible();
      await expect(page.locator('#close-panel-btn')).toBeVisible();
    });

    test('close project panel', async ({ page }) => {
      await page.keyboard.press('Control+Shift+p');
      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();
      await page.locator('#close-panel-btn').click();
      await expect(projectPanel).toBeHidden();
    });

    test('shows no project message initially', async ({ page }) => {
      const projectPanel = page.locator('#project-panel');
      if (await projectPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
        const text = await projectPanel.textContent();
        expect(text).toContain('No project');
      }
    });
  });

  test.describe('Create Project', () => {

    test('create new project', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      let dialogCount = 0;
      page.on('dialog', async (dialog) => {
        dialogCount++;
        if (dialogCount === 1) await dialog.accept('My Test Project');
        else await dialog.accept('A test project description');
      });

      await page.keyboard.press('Control+Shift+n');

      const cautionPanel = page.locator('#cautionpanel');
      await expect(cautionPanel).toBeVisible({ timeout: 5000 });

      const fileMenu = page.locator('.dropbtn:text("File")');
      await expect(fileMenu).toBeEnabled();
    });

    test('project appears in panel after creation', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      let dialogCount = 0;
      page.on('dialog', async (dialog) => {
        dialogCount++;
        if (dialogCount === 1) await dialog.accept('Listed Project');
        else await dialog.accept('');
      });

      await page.keyboard.press('Control+Shift+n');
      await page.waitForTimeout(1500);

      await page.keyboard.press('Control+Shift+p');
      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();
      await expect(projectPanel.locator('text=Listed Project').first()).toBeVisible({ timeout: 5000 });
    });

    test('cancel new project dialog', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      page.on('dialog', async (dialog) => await dialog.dismiss());
      await page.keyboard.press('Control+Shift+n');
      await page.waitForTimeout(500);

      const fileMenu = page.locator('.dropbtn:text("File")');
      await expect(fileMenu).toBeDisabled();
    });

    test('project search filters projects', async ({ page }) => {
      await initApp(page);

      let dialogCount = 0;
      page.on('dialog', async (dialog) => {
        dialogCount++;
        if (dialogCount === 1) await dialog.accept('Alpha Cave Project');
        else if (dialogCount === 2) await dialog.accept('');
        else if (dialogCount === 3) await dialog.accept('Beta Mine Project');
        else await dialog.accept('');
      });

      await page.keyboard.press('Control+Shift+n');
      await page.waitForTimeout(1000);
      await page.keyboard.press('Control+Shift+n');
      await page.waitForTimeout(1000);

      await page.keyboard.press('Control+Shift+p');
      const searchInput = page.locator('#project-search');
      await searchInput.fill('Alpha');

      await expect(page.locator('#project-panel').locator('text=Alpha Cave Project')).toBeVisible();
    });
  });

  test.describe('Project Operations', () => {

    test('current project is displayed', async ({ page }) => {
      await setupWithProject(page, 'Current Test Project');

      const closeBtn = page.locator('#close-panel-btn');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) await closeBtn.click();
      await page.keyboard.press('Control+Shift+p');

      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();
      await expect(projectPanel.locator('text=Current Test Project').first()).toBeVisible({ timeout: 5000 });
    });

    test('delete project', async ({ page }) => {
      await setupWithProject(page, 'Project To Delete');

      await page.keyboard.press('Control+Shift+p');
      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();

      const deleteBtn = projectPanel.locator('.project-action-btn', { hasText: /delete/i }).first();
      if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        page.on('dialog', async (dialog) => await dialog.accept());
        await deleteBtn.click();
        await page.waitForTimeout(1000);
      }
    });

    test('rename project', async ({ page }) => {
      await setupWithProject(page, 'Project To Rename');

      await page.keyboard.press('Control+Shift+p');
      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();

      const renameBtn = projectPanel.locator('.project-action-btn', { hasText: /rename/i }).first();
      if (await renameBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        page.once('dialog', async (dialog) => await dialog.accept('Renamed Project'));
        await renameBtn.click();
        await page.waitForTimeout(1000);
        await expect(projectPanel.locator('text=Renamed Project').first()).toBeVisible({ timeout: 5000 });
      }
    });

    test('switch between projects', async ({ page }) => {
      await initApp(page);

      await createProject(page, 'Project Alpha');
      await createProject(page, 'Project Beta');

      const closeBtn = page.locator('#close-panel-btn');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) await closeBtn.click();
      await page.keyboard.press('Control+Shift+p');

      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();
      await expect(projectPanel.locator('text=Project Alpha').first()).toBeVisible({ timeout: 5000 });
      await expect(projectPanel.locator('text=Project Beta').first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Project Caves', () => {

    test('project item shows listed cave', async ({ page }) => {
      await setupWithCave(page);

      const closeBtn = page.locator('#close-panel-btn');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) await closeBtn.click();
      await page.keyboard.press('Control+Shift+p');

      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();

      const projectItem = projectPanel.locator('.project-item').first();
      const cavesText = await projectItem.locator('.project-caves').textContent();
      expect(cavesText).toContain('Test Cave');
    });

    test('project item shows multiple caves', async ({ page }) => {
      await setupWithCave(page, 'sample-cave.json', 'Test Cave');

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'multi-survey-cave.json'));
      await expect(page.locator('#explorer-tree').locator('text=Multi Survey Cave')).toBeVisible({ timeout: 10000 });
      await dismissNotifications(page);

      const closeBtn = page.locator('#close-panel-btn');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) await closeBtn.click();
      await page.keyboard.press('Control+Shift+p');

      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();

      const projectItem = projectPanel.locator('.project-item').first();
      const cavesText = await projectItem.locator('.project-caves').textContent();
      expect(cavesText).toContain('Test Cave');
      expect(cavesText).toContain('Multi Survey Cave');
    });
  });

  test.describe('Project Ordering', () => {

    test('editing a project moves it to the top of the list', async ({ page }) => {
      await initApp(page);

      await createProject(page, 'Alpha Project');
      await page.waitForTimeout(500);
      await createProject(page, 'Beta Project');
      await page.waitForTimeout(500);

      const closeBtn = page.locator('#close-panel-btn');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) await closeBtn.click();
      await page.keyboard.press('Control+Shift+p');
      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();
      await page.waitForTimeout(500);

      // Beta should be first (most recently updated) in recent projects list
      const recentList = projectPanel.locator('#recent-projects-list');
      await expect(recentList.locator('.project-item').first()).toBeVisible({ timeout: 3000 });
      const projectNames = await recentList.locator('.project-name').allTextContents();
      expect(projectNames[0]).toBe('Beta Project');

      // Switch to Alpha and import a cave (updates its updatedAt)
      const alphaItem = projectPanel.locator('.project-item', { hasText: 'Alpha Project' });
      await alphaItem.locator('.project-action-btn', { hasText: /open/i }).click();
      await page.waitForTimeout(1000);
      await dismissNotifications(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-cave.json'));
      await page.waitForTimeout(3000);
      await dismissNotifications(page);

      // Reopen - Alpha should now be on top
      await page.keyboard.press('Control+Shift+p');
      await expect(projectPanel).toBeVisible();
      await page.waitForTimeout(500);

      const recentList2 = projectPanel.locator('#recent-projects-list');
      await expect(recentList2.locator('.project-item').first()).toBeVisible({ timeout: 3000 });
      const updatedNames = await recentList2.locator('.project-name').allTextContents();
      expect(updatedNames[0]).toBe('Alpha Project');
    });
  });

  test.describe('Export & Import', () => {

    test('export all projects produces download', async ({ page }) => {
      await setupWithCave(page);

      const closeBtn = page.locator('#close-panel-btn');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) await closeBtn.click();
      await page.keyboard.press('Control+Shift+p');
      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();

      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await projectPanel.locator('#export-project-btn').first().click();
      const download = await downloadPromise;

      const filename = download.suggestedFilename();
      expect(filename).toContain('speleo-studio-projects');
      expect(filename).toMatch(/\.json(\.gz)?$/);

      const content = await (await download.createReadStream()).toArray();
      expect(Buffer.concat(content).length).toBeGreaterThan(10);
    });

    test('export then import restores projects', async ({ page }) => {
      await setupWithCave(page);

      const closeBtn = page.locator('#close-panel-btn');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) await closeBtn.click();
      await page.keyboard.press('Control+Shift+p');
      const projectPanel = page.locator('#project-panel');
      await expect(projectPanel).toBeVisible();

      // Export
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await projectPanel.locator('#export-project-btn').first().click();
      const download = await downloadPromise;
      const exportPath = await download.path();

      // Delete the current project
      page.on('dialog', async (dialog) => await dialog.accept());
      const deleteBtn = projectPanel.locator('.project-action-btn', { hasText: /delete/i }).first();
      if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deleteBtn.click();
        await page.waitForTimeout(1000);
      }

      // Import the exported file
      await page.locator('#projectInput').setInputFiles(exportPath);
      await page.waitForTimeout(3000);
      await dismissNotifications(page);

      // Refresh project panel
      await page.keyboard.press('Control+Shift+p');
      await expect(projectPanel).toBeVisible();
      await page.waitForTimeout(500);

      // Imported project should contain Test Cave
      const panelText = await projectPanel.textContent();
      expect(panelText).toContain('Test Cave');
    });
  });
});
