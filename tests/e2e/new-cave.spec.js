import { test, expect } from '@playwright/test';
import { setupWithProject, dismissNotifications } from './helpers.js';

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

test.describe('New Cave Dialog', () => {

  test.describe('Opening the dialog', () => {

    test.beforeEach(async ({ page }) => {
      await setupWithProject(page);
    });

    test('opens from File > New cave menu', async ({ page }) => {
      const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
      await fileMenu.locator('.dropbtn').click();
      await fileMenu.locator('.mydropdown-content a').filter({ hasText: 'New cave' }).click();

      await expect(page.locator('#fixed-size-editor')).toBeVisible({ timeout: 5000 });
    });

    test('opens via Ctrl+N shortcut', async ({ page }) => {
      await page.keyboard.press('Control+n');
      await expect(page.locator('#fixed-size-editor')).toBeVisible({ timeout: 5000 });
    });

    test('title shows "New cave"', async ({ page }) => {
      await page.keyboard.press('Control+n');
      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });
      await expect(editor.locator('.popup-header')).toContainText('New cave');
    });
  });

  test.describe('Form fields', () => {

    test.beforeEach(async ({ page }) => {
      await setupWithProject(page);
      await page.keyboard.press('Control+n');
      await expect(page.locator('#fixed-size-editor')).toBeVisible({ timeout: 5000 });
    });

    test('has name, cataster code, date, creator fields', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await expect(editor.locator('input#name')).toBeVisible();
      await expect(editor.locator('input#name')).toHaveValue('');
      await expect(editor.locator('input#catasterCode')).toBeVisible();
      await expect(editor.locator('input#date')).toHaveAttribute('type', 'date');
      await expect(editor.locator('input#creator')).toBeVisible();
    });

    test('has country, region, settlement fields', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await expect(editor.locator('input#country')).toBeVisible();
      await expect(editor.locator('input#region')).toBeVisible();
      await expect(editor.locator('input#settlement')).toBeVisible();
    });

    test('has coordinate system dropdown defaulting to None', async ({ page }) => {
      const select = page.locator('#fixed-size-editor select#coord-system');
      await expect(select).toBeVisible();

      const options = await select.locator('option').allTextContents();
      expect(options.map(o => o.trim())).toEqual(expect.arrayContaining(['EOV', 'UTM']));

      const selectedText = await select.evaluate(el => el.options[el.selectedIndex].text);
      expect(selectedText.toLowerCase()).toContain('none');
    });

    test('has GPS convert button', async ({ page }) => {
      await expect(page.locator('#fixed-size-editor #convert-gps-button')).toBeVisible();
    });

    test('has save and cancel buttons', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await expect(editor.locator('button[type="submit"]')).toBeVisible();
      await expect(editor.getByRole('button', { name: 'Cancel' })).toBeVisible();
    });

    test('has two-column grid layout', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await expect(editor.locator('.sheet-editor-grid')).toBeVisible();
      await expect(editor.locator('.sheet-editor-column')).toHaveCount(2);
    });
  });

  test.describe('Coordinate system selection', () => {

    test.beforeEach(async ({ page }) => {
      await setupWithProject(page);
      await page.keyboard.press('Control+n');
      await expect(page.locator('#fixed-size-editor')).toBeVisible({ timeout: 5000 });
    });

    test('selecting UTM shows zone and hemisphere inputs', async ({ page }) => {
      const select = page.locator('#fixed-size-editor select#coord-system');
      await select.selectOption('utm');
      await select.evaluate(el => el.onchange({ target: el }));

      await expect(page.locator('#fixed-size-editor #utm-zone-selection')).toBeVisible();
      await expect(page.locator('#fixed-size-editor #utm-zone')).toHaveValue('34');
      await expect(page.locator('#fixed-size-editor #utm-hemisphere')).toBeVisible();
    });

    test('selecting EOV hides UTM zone selection', async ({ page }) => {
      const select = page.locator('#fixed-size-editor select#coord-system');
      await select.selectOption('eov');
      await select.evaluate(el => el.onchange({ target: el }));

      await expect(page.locator('#fixed-size-editor #utm-zone-selection')).toBeHidden();
    });

    test('switching from UTM to None hides zone inputs', async ({ page }) => {
      const select = page.locator('#fixed-size-editor select#coord-system');
      await select.selectOption('utm');
      await select.evaluate(el => el.onchange({ target: el }));

      await select.selectOption({ index: 0 });
      await select.evaluate(el => el.onchange({ target: el }));

      await expect(page.locator('#fixed-size-editor #utm-zone-selection')).toBeHidden();
    });

    test('clicking Add coordinate creates input row with 4 fields', async ({ page }) => {
      const select = page.locator('#fixed-size-editor select#coord-system');
      await select.selectOption('utm');
      await select.evaluate(el => el.onchange({ target: el }));

      await page.locator('#fixed-size-editor .coords-list button', { hasText: 'Add' }).click();

      const coordRows = page.locator('#fixed-size-editor .coords-list .list-row');
      await expect(coordRows).toHaveCount(1);
      await expect(coordRows.first().locator('input')).toHaveCount(4);
    });
  });

  test.describe('Saving a new cave', () => {

    test.beforeEach(async ({ page }) => {
      await setupWithProject(page);
      await page.keyboard.press('Control+n');
      await expect(page.locator('#fixed-size-editor')).toBeVisible({ timeout: 5000 });
    });

    test('saving with required fields adds cave to explorer tree', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await fillRequiredFields(editor, 'Baradla');

      await editor.locator('button[type="submit"]').click();
      await dismissNotifications(page);

      await expect(page.locator('#explorer-tree')).toContainText('Baradla', { timeout: 5000 });
    });

    test('saving with all metadata fields', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await fillRequiredFields(editor, 'Meteor Cave', {
        catasterCode: '4321-01',
        date: '2025-06-15',
        creator: 'Joe'
      });
      await fillInput(editor.locator('input#country'), 'Hungary');
      await fillInput(editor.locator('input#region'), 'Aggtelek');
      await fillInput(editor.locator('input#settlement'), 'Josvafo');

      await editor.locator('button[type="submit"]').click();
      await dismissNotifications(page);

      await expect(page.locator('#explorer-tree')).toContainText('Meteor Cave', { timeout: 5000 });
    });

    test('cancel button closes editor without adding cave', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await fillInput(editor.locator('input#name'), 'Ghost Cave');

      await editor.getByRole('button', { name: 'Cancel' }).click();

      await expect(editor).toBeHidden({ timeout: 5000 });
      await expect(page.locator('#explorer-tree')).not.toContainText('Ghost Cave');
    });

    test('saving with UTM coordinates', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await fillRequiredFields(editor, 'UTM Cave');

      // Select UTM
      const select = editor.locator('select#coord-system');
      await select.selectOption('utm');
      await select.evaluate(el => el.onchange({ target: el }));

      // Add and fill coordinate
      await editor.locator('.coords-list button', { hasText: 'Add' }).click();
      const inputs = editor.locator('.coords-list .list-row').first().locator('input');
      await fillInput(inputs.nth(0), 'A0');
      await fillInput(inputs.nth(1), '352394.31');
      await fillInput(inputs.nth(2), '5262357.87');
      await fillInput(inputs.nth(3), '120');

      await editor.locator('button[type="submit"]').click();
      await dismissNotifications(page);

      await expect(page.locator('#explorer-tree')).toContainText('UTM Cave', { timeout: 5000 });
    });

    test('saving with EOV coordinates', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await fillRequiredFields(editor, 'EOV Cave');

      // Select EOV
      const select = editor.locator('select#coord-system');
      await select.selectOption('eov');
      await select.evaluate(el => el.onchange({ target: el }));

      // Add and fill coordinate
      await editor.locator('.coords-list button', { hasText: 'Add' }).click();
      const inputs = editor.locator('.coords-list .list-row').first().locator('input');
      await fillInput(inputs.nth(0), 'B1');
      await fillInput(inputs.nth(1), '650123.45');
      await fillInput(inputs.nth(2), '234567.89');
      await fillInput(inputs.nth(3), '350');

      await editor.locator('button[type="submit"]').click();
      await dismissNotifications(page);

      await expect(page.locator('#explorer-tree')).toContainText('EOV Cave', { timeout: 5000 });
    });
  });

  test.describe('Validation', () => {

    test.beforeEach(async ({ page }) => {
      await setupWithProject(page);
      await page.keyboard.press('Control+n');
      await expect(page.locator('#fixed-size-editor')).toBeVisible({ timeout: 5000 });
    });

    test('coordinate system with empty station name blocks submit via HTML5 validation', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await fillRequiredFields(editor, 'Bad Coord Cave');

      const select = editor.locator('select#coord-system');
      await select.selectOption('utm');
      await select.evaluate(el => el.onchange({ target: el }));

      // Add coordinate but leave station name empty
      await editor.locator('.coords-list button', { hasText: 'Add' }).click();
      const inputs = editor.locator('.coords-list .list-row').first().locator('input');
      await fillInput(inputs.nth(1), '352394.31');
      await fillInput(inputs.nth(2), '5262357.87');
      await fillInput(inputs.nth(3), '120');

      await editor.locator('button[type="submit"]').click();

      // Form should still be visible (submit was blocked by HTML5 required validation)
      await expect(editor).toBeVisible();
      await expect(page.locator('#explorer-tree')).not.toContainText('Bad Coord Cave');
    });

    test('duplicate cave name shows error', async ({ page }) => {
      const editor = page.locator('#fixed-size-editor');
      await fillRequiredFields(editor, 'Duplicate Cave');
      await editor.locator('button[type="submit"]').click();
      await dismissNotifications(page);

      await page.keyboard.press('Control+n');
      await expect(editor).toBeVisible({ timeout: 5000 });
      await fillRequiredFields(editor, 'Duplicate Cave');
      await editor.locator('button[type="submit"]').click();

      await expect(page.locator('#cautionpanel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#cautionpanel')).toContainText('Duplicate Cave');
    });
  });

  test.describe('Multiple caves', () => {

    test('creating multiple caves sequentially', async ({ page }) => {
      await setupWithProject(page);
      const editor = page.locator('#fixed-size-editor');

      await page.keyboard.press('Control+n');
      await expect(editor).toBeVisible({ timeout: 5000 });
      await fillRequiredFields(editor, 'Cave Alpha');
      await editor.locator('button[type="submit"]').click();
      await dismissNotifications(page);

      await page.keyboard.press('Control+n');
      await expect(editor).toBeVisible({ timeout: 5000 });
      await fillRequiredFields(editor, 'Cave Beta');
      await editor.locator('button[type="submit"]').click();
      await dismissNotifications(page);

      const explorer = page.locator('#explorer-tree');
      await expect(explorer).toContainText('Cave Alpha');
      await expect(explorer).toContainText('Cave Beta');
    });
  });
});
