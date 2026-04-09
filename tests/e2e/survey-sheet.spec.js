import { test, expect } from '@playwright/test';
import { setupWithCave, rightClickCave, expandCaveNode, rightClickSurvey, dismissNotifications } from './helpers.js';

test.describe('Survey Sheet Editor', () => {

  test.describe('New Survey', () => {

    test('opens new survey form from cave context menu', async ({ page }) => {
      await setupWithCave(page);
      await rightClickCave(page, 'Test Cave');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey" i]').first().click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Form should have name, date, declination fields
      await expect(editor.locator('#name')).toBeVisible();
      await expect(editor.locator('#date')).toBeVisible();
      await expect(editor.locator('#declination')).toBeVisible();
    });

    test('fill and save creates new survey in explorer tree', async ({ page }) => {
      await setupWithCave(page);
      await rightClickCave(page, 'Test Cave');
      await page.locator('#explorer-context-menu .context-menu-option[title*="ew survey" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      await editor.locator('#name').fill('New Test Survey');
      await editor.locator('#date').fill('2025-06-15');
      await editor.locator('#declination').fill('3.5');

      await editor.locator('button[type="submit"]').click();
      await page.waitForTimeout(1000);
      await dismissNotifications(page);

      // Expand cave and verify new survey appears
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=New Test Survey')).toBeVisible({ timeout: 5000 });
    });

    test('cancel does not create new survey', async ({ page }) => {
      await setupWithCave(page);
      await rightClickCave(page, 'Test Cave');
      await page.locator('#explorer-context-menu .context-menu-option[title*="ew survey" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      await editor.locator('#name').fill('Should Not Exist');

      await editor.getByRole('button', { name: /cancel/i }).click();
      await expect(editor).toBeHidden();

      // Expand cave - survey should NOT exist
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Should Not Exist')).toBeHidden();
    });

    test('required fields prevent save when empty', async ({ page }) => {
      await setupWithCave(page);
      await rightClickCave(page, 'Test Cave');
      await page.locator('#explorer-context-menu .context-menu-option[title*="ew survey" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Try to save with empty name
      await editor.locator('button[type="submit"]').click();
      await page.waitForTimeout(500);

      // Editor should still be open (HTML5 validation blocked submit)
      await expect(editor).toBeVisible();
    });
  });

  test.describe('Edit Existing Survey', () => {

    test('opens survey sheet from survey context menu', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });
    });

    test('fields are pre-populated with existing values', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      const name = await editor.locator('#name').inputValue();
      expect(name).toBe('Main Survey');

      const date = await editor.locator('#date').inputValue();
      expect(date).toBe('2023-11-14');
    });

    test('shows survey statistics', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      const stats = editor.locator('.survey-stats');
      await expect(stats).toBeVisible();

      const statsText = await stats.textContent();

      // Length: 4 center shots (5.2 + 3.8 + 6.1 + 4.0 = 19.10 m)
      expect(statsText).toContain('19.10 m');
      // Vertical extent: maxZ - minZ = 1.58 m
      expect(statsText).toContain('1.58 m');
      // 6 total shots (4 center + 2 splay)
      expect(statsText).toContain('Shots: 6');
      // 5 stations (A0, A1, A2, A3, A4)
      expect(statsText).toContain('Stations: 5');
      // 2 splay shots
      expect(statsText).toContain('Splays: 2');
      // No orphan, invalid, or auxiliary shots
      expect(statsText).toContain('Length (orphan): 0.00 m');
      expect(statsText).toContain('Length (invalid): 0.00 m');
      expect(statsText).toContain('Length (auxiliary): 0.00 m');
      // Deepest and highest points
      expect(statsText).toContain('Deepest point: -1.23 m');
      expect(statsText).toContain('Highest point: 0.34 m');
    });

    test('has team members section', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      const membersSection = editor.locator('.team-members-section');
      await expect(membersSection).toBeVisible();
    });

    test('has instruments section', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      const instrumentsSection = editor.locator('.instruments-section');
      await expect(instrumentsSection).toBeVisible();
    });

    test('add team member with name and role', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Click add member button
      const membersSection = editor.locator('.team-members-section');
      const addBtn = membersSection.getByRole('button', { name: /add/i });
      await addBtn.click();
      await page.waitForTimeout(300);

      // Fill name and role
      const inputs = membersSection.locator('.members-list input');
      const count = await inputs.count();
      expect(count).toBeGreaterThanOrEqual(2);

      await inputs.nth(0).fill('Joe');
      await inputs.nth(1).fill('Surveyor');
    });

    test('add instrument with name and value', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      const instrumentsSection = editor.locator('.instruments-section');
      const addBtn = instrumentsSection.getByRole('button', { name: /add/i });
      await addBtn.click();
      await page.waitForTimeout(300);

      const inputs = instrumentsSection.locator('.instruments-list input');
      const count = await inputs.count();
      expect(count).toBeGreaterThanOrEqual(2);

      await inputs.nth(0).fill('DistoX2');
      await inputs.nth(1).fill('Laser');
    });

    test('cancel closes editor without saving changes', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      await editor.getByRole('button', { name: /cancel/i }).click();
      await expect(editor).toBeHidden();
    });

    test('has save and cancel buttons', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      await expect(editor.locator('button[type="submit"]')).toBeVisible();
      await expect(editor.getByRole('button', { name: /cancel/i })).toBeVisible();
    });

    test('rename survey updates explorer tree', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Change name
      await editor.locator('#name').fill('Renamed Survey');
      await editor.locator('button[type="submit"]').click();
      await page.waitForTimeout(1000);

      // Explorer tree should show new name
      await expect(page.locator('#explorer-tree').locator('text=Renamed Survey')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeHidden();
    });

    test('declination field is editable', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      const declInput = editor.locator('#declination');
      await expect(declInput).toBeVisible();
      await declInput.fill('5.5');
      expect(await declInput.inputValue()).toBe('5.5');
    });

    test('start station field is visible for first survey', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // First survey should have start station field with value "A0"
      const startInput = editor.locator('#start');
      await expect(startInput).toBeVisible();
      expect(await startInput.inputValue()).toBe('A0');
    });

    test('start station field is hidden for non-first survey in multi-survey cave', async ({ page }) => {
      await setupWithCave(page, 'multi-survey-cave.json', 'Multi Survey Cave');
      await expandCaveNode(page, 'Multi Survey Cave');
      await expect(page.locator('#explorer-tree').locator('text=Inner Survey')).toBeVisible({ timeout: 5000 });

      // Open the second survey (Inner Survey) sheet editor
      await rightClickSurvey(page, 'Inner Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Non-first survey should NOT have start station field
      const startInput = editor.locator('#start');
      await expect(startInput).toBeHidden();
    });

    test('first survey in multi-survey cave has start station field', async ({ page }) => {
      await setupWithCave(page, 'multi-survey-cave.json', 'Multi Survey Cave');
      await expandCaveNode(page, 'Multi Survey Cave');
      await expect(page.locator('#explorer-tree').locator('text=Entrance Survey')).toBeVisible({ timeout: 5000 });

      // Open the first survey (Entrance Survey)
      await rightClickSurvey(page, 'Entrance Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // First survey should have start station field with value "E0"
      const startInput = editor.locator('#start');
      await expect(startInput).toBeVisible();
      expect(await startInput.inputValue()).toBe('E0');
    });

    test('saving with non-existent start station shows error', async ({ page }) => {
      await setupWithCave(page);
      await expandCaveNode(page, 'Test Cave');
      await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });

      await rightClickSurvey(page, 'Main Survey');
      await page.locator('#explorer-context-menu .context-menu-option[title*="urvey sheet" i]').click();

      const editor = page.locator('#fixed-size-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Change start station to a non-existent one via evaluate to trigger oninput
      await editor.locator('#start').evaluate(el => {
        el.value = 'NONEXISTENT';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(200);

      // Try to save
      await editor.locator('button[type="submit"]').click();
      await page.waitForTimeout(500);

      // Editor should still be open (save was blocked by validation)
      await expect(editor).toBeVisible();
    });
  });
});
