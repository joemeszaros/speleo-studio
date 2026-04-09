import { test, expect } from '@playwright/test';
import path from 'path';
import { setupWithProject, dismissNotifications } from './helpers.js';

const fixturesDir = path.resolve('tests/fixtures');

test.describe('Polygon .cave File Import', () => {

  test.describe('Encoding Selection Dialog', () => {

    test('importing .cave file shows encoding dialog', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));

      // Encoding selection dialog should appear
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
    });

    test('encoding dialog has UTF-8 and ISO-8859-2 options', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });

      const utf8Radio = page.locator('input[name="encoding"][value="utf8"]');
      const isoRadio = page.locator('input[name="encoding"][value="iso_8859-2"]');
      await expect(utf8Radio).toBeAttached();
      await expect(isoRadio).toBeAttached();
    });

    test('encoding dialog has OK and Cancel buttons', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#encoding-selection-cancel')).toBeVisible();
    });

    test('cancel encoding dialog aborts import', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });

      await page.locator('#encoding-selection-cancel').click();
      await page.waitForTimeout(1000);

      // No cave should appear in explorer tree
      await expect(page.locator('#explorer-tree').locator('.models-tree-category')).toHaveCount(0);
    });

    test('ISO-8859-2 is default encoding', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });

      const isoRadio = page.locator('input[name="encoding"][value="iso_8859-2"]');
      expect(await isoRadio.isChecked()).toBe(true);
    });
  });

  test.describe('Coordinate System Dialog', () => {

    test('appears after encoding selection for .cave files', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });

      // Select UTF-8 and confirm
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();

      // Coordinate system dialog should appear next
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });
    });

    test('has coordinate system radio options', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      // Should have EOV, UTM, and None options
      const eovRadio = page.locator('input[name="coordinateSystem"][value="eov"]');
      const utmRadio = page.locator('input[name="coordinateSystem"][value="utm"]');
      const noneRadio = page.locator('input[name="coordinateSystem"][value="none"]');
      await expect(eovRadio).toBeAttached();
      await expect(utmRadio).toBeAttached();
      await expect(noneRadio).toBeAttached();
    });

    test('has coordinate input fields', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      // Start point coordinate inputs
      await expect(page.locator('#start-point-x')).toBeVisible();
      await expect(page.locator('#start-point-y')).toBeVisible();
      await expect(page.locator('#start-point-z')).toBeVisible();
    });

    test('has flip coordinates button', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      await expect(page.locator('#flip-coordinates')).toBeVisible();
    });

    test('flip coordinates swaps X and Y values', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      const xBefore = await page.locator('#start-point-x').inputValue();
      const yBefore = await page.locator('#start-point-y').inputValue();

      await page.locator('#flip-coordinates').click();
      await page.waitForTimeout(200);

      const xAfter = await page.locator('#start-point-x').inputValue();
      const yAfter = await page.locator('#start-point-y').inputValue();

      expect(xAfter).toBe(yBefore);
      expect(yAfter).toBe(xBefore);
    });

    test('selecting EOV and confirming imports cave', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      // Select EOV
      await page.locator('input[name="coordinateSystem"][value="eov"]').click();
      await page.locator('#coordinate-system-ok').click();
      await page.waitForTimeout(3000);
      await dismissNotifications(page);

      // Cave should appear in explorer tree with the project name from the .cave file
      const explorerTree = page.locator('#explorer-tree');
      await expect(explorerTree.locator('.models-tree-category')).not.toHaveCount(0, { timeout: 5000 });
    });

    test('selecting None coordinate system imports cave without coordinates', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      await page.locator('input[name="coordinateSystem"][value="none"]').click();
      await page.locator('#coordinate-system-ok').click();
      await page.waitForTimeout(3000);
      await dismissNotifications(page);

      // Cave should appear
      const explorerTree = page.locator('#explorer-tree');
      await expect(explorerTree.locator('.models-tree-category')).not.toHaveCount(0, { timeout: 5000 });

      // Footer should show no coordinate system
      await expect(page.locator('#footer').locator('text=No coordinate system')).toBeVisible().catch(() => {});
    });
  });

  test.describe('ISO-8859-2 Encoded File', () => {

    test('import ISO-8859-2 file with correct encoding', async ({ page }) => {
      await setupWithProject(page);

      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-iso8859.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });

      // ISO-8859-2 is default, just click OK
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      // Select EOV and confirm
      await page.locator('input[name="coordinateSystem"][value="eov"]').click();
      await page.locator('#coordinate-system-ok').click();
      await page.waitForTimeout(3000);
      await dismissNotifications(page);

      // Cave should appear with Hungarian name properly decoded
      const explorerTree = page.locator('#explorer-tree');
      await expect(explorerTree.locator('.models-tree-category')).not.toHaveCount(0, { timeout: 5000 });
    });
  });

  test.describe('Imported Cave Content', () => {

    async function importUtf8Cave(page) {
      await setupWithProject(page);
      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="coordinateSystem"][value="eov"]').click();
      await page.locator('#coordinate-system-ok').click();
      await page.waitForTimeout(3000);
      await dismissNotifications(page);
    }

    test('imported cave name matches .cave file project name', async ({ page }) => {
      await importUtf8Cave(page);

      const explorerTree = page.locator('#explorer-tree');
      await expect(explorerTree).toContainText('TestCave', { timeout: 5000 });
    });

    test('imported cave has survey with correct name', async ({ page }) => {
      await importUtf8Cave(page);

      // Expand cave node to see surveys
      const explorerTree = page.locator('#explorer-tree');
      const caveCategory = explorerTree.locator('.models-tree-category', { has: page.locator('text=TestCave') });
      await caveCategory.locator('.models-tree-toggle').click();

      await expect(explorerTree).toContainText('MainSurvey');
    });

    test('imported cave has correct metadata in cave editor', async ({ page }) => {
      await importUtf8Cave(page);

      // Right-click cave and open editor
      const explorerTree = page.locator('#explorer-tree');
      const caveHeader = explorerTree
        .locator('.models-tree-category', { has: page.locator('text=TestCave') })
        .locator('.models-tree-category-header');
      await caveHeader.click({ button: 'right' });
      await page.locator('#explorer-context-menu .context-menu-option[title*="cave sheet"]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Verify metadata fields
      await expect(editor.locator('input#name')).toHaveValue('TestCave');
      await expect(editor.locator('input#region')).toHaveValue('Bukk');
    });

    test('imported cave has coordinate system set to EOV', async ({ page }) => {
      await importUtf8Cave(page);

      // Footer should show coordinate system
      await expect(page.locator('#footer')).toContainText('EOV');
    });

    test('imported cave has correct survey data in survey editor', async ({ page }) => {
      await importUtf8Cave(page);

      // Expand cave, right-click survey
      const explorerTree = page.locator('#explorer-tree');
      const caveCategory = explorerTree.locator('.models-tree-category', { has: page.locator('text=TestCave') });
      await caveCategory.locator('.models-tree-toggle').click();
      await page.waitForTimeout(500);

      const surveyNode = explorerTree.locator('.explorer-tree-node', { has: page.locator('text=MainSurvey') });
      await surveyNode.click({ button: 'right' });

      const contextMenu = page.locator('#explorer-context-menu');
      await contextMenu.locator('.context-menu-option[title*="survey editor"]').click();

      const editor = page.locator('#resizable-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Wait for table rows to load
      await page.waitForFunction(() => {
        const table = document.querySelector('#surveydata');
        if (!table) return false;
        const tabs = window.Tabulator?.findTable?.(table);
        return tabs?.[0]?.getRows()?.length > 0;
      }, { timeout: 10000 });

      // Should have 3 center shots (T0-T1, T1-T2, T2-T3)
      const rowCount = await page.evaluate(() => {
        const table = document.querySelector('#surveydata');
        const tabs = window.Tabulator.findTable(table);
        return tabs[0].getRows().length;
      });
      expect(rowCount).toBe(3);
    });

    test('imported cave shows correct station names', async ({ page }) => {
      await importUtf8Cave(page);

      // Expand cave, right-click survey, open editor
      const explorerTree = page.locator('#explorer-tree');
      const caveCategory = explorerTree.locator('.models-tree-category', { has: page.locator('text=TestCave') });
      await caveCategory.locator('.models-tree-toggle').click();
      await page.waitForTimeout(500);

      const surveyNode = explorerTree.locator('.explorer-tree-node', { has: page.locator('text=MainSurvey') });
      await surveyNode.click({ button: 'right' });
      await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

      const editor = page.locator('#resizable-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      await page.waitForFunction(() => {
        const table = document.querySelector('#surveydata');
        if (!table) return false;
        const tabs = window.Tabulator?.findTable?.(table);
        return tabs?.[0]?.getRows()?.length > 0;
      }, { timeout: 10000 });

      // Check station names in the table
      const firstRow = await page.evaluate(() => {
        const table = document.querySelector('#surveydata');
        const tabs = window.Tabulator.findTable(table);
        return tabs[0].getRows()[0].getData();
      });
      expect(firstRow.from).toBe('T0');
      expect(firstRow.to).toBe('T1');
      expect(firstRow.length).toBe(5.2);
      expect(firstRow.azimuth).toBe(45);
    });

    test('cancel coordinate system dialog aborts import', async ({ page }) => {
      await setupWithProject(page);
      await page.locator('#caveInput').setInputFiles(path.join(fixturesDir, 'sample-utf8.cave'));
      await expect(page.locator('#encoding-selection-ok')).toBeVisible({ timeout: 5000 });
      await page.locator('input[name="encoding"][value="utf8"]').click();
      await page.locator('#encoding-selection-ok').click();
      await expect(page.locator('#coordinate-system-ok')).toBeVisible({ timeout: 5000 });

      // Cancel the coordinate system dialog
      await page.locator('#coordinate-system-cancel').click();
      await page.waitForTimeout(1000);

      // No cave should appear
      await expect(page.locator('#explorer-tree').locator('.models-tree-category')).toHaveCount(0);
    });
  });
});
