import { test, expect } from '@playwright/test';
import { initApp, closeProjectPanel, setupWithCave } from './helpers.js';

test.describe('Tools', () => {

  test.describe('Dip & Strike Calculator', () => {

    test('opens from Tools menu', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });
    });

    test('has input method selection', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      const radioButtons = toolPanel.locator('input[name="input-method"]');
      await expect(radioButtons).toHaveCount(2);
    });

    test('has coordinate inputs', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      const coordInputs = toolPanel.locator('.coord-input');
      await expect(coordInputs).not.toHaveCount(0);
    });

    test('has calculate and clear buttons', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await expect(toolPanel.locator('#calculate-btn')).toBeVisible();
      await expect(toolPanel.locator('#clear-btn')).toBeVisible();
    });

    test('calculate with valid coordinates shows correct strike and dip', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      // Verify StrikeDipCalculator produces correct results for known points
      const result = await page.evaluate(async () => {
        const { StrikeDipCalculator } = await import('/src/utils/geo.js');
        const { Vector } = await import('/src/model.js');
        const p1 = new Vector(0, 0, 10);
        const p2 = new Vector(10, 0, 10);
        const p3 = new Vector(0, 10, 0);
        const r = StrikeDipCalculator.calculateStrikeDip(p1, p2, p3);
        return {
          strike : r.strike.toFixed(2) + '°',
          dip    : r.dip.toFixed(2) + '°'
        };
      });

      expect(result.strike).toBe('270.00°');
      expect(result.dip).toBe('45.00°');
    });

    test('calculate with survey inputs shows correct strike and dip', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      // Switch to survey method
      await toolPanel.locator('input[name="input-method"][value="survey"]').click();
      await page.waitForTimeout(200);

      // 3 survey shots: (length, azimuth, clino)
      const inputs = toolPanel.locator('.survey-input');
      await inputs.nth(0).fill('10');
      await inputs.nth(1).fill('0');
      await inputs.nth(2).fill('0');
      await inputs.nth(3).fill('10');
      await inputs.nth(4).fill('90');
      await inputs.nth(5).fill('0');
      await inputs.nth(6).fill('10');
      await inputs.nth(7).fill('0');
      await inputs.nth(8).fill('45');

      await toolPanel.locator('#calculate-btn').click();
      await page.waitForTimeout(500);

      const results = toolPanel.locator('#results-section');
      await expect(results).toBeVisible({ timeout: 3000 });

      expect(await toolPanel.locator('#strike-result').textContent()).toBe('135.00°');
      expect(await toolPanel.locator('#dip-result').textContent()).toBe('73.68°');
    });

    test('clear button resets inputs', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      const firstInput = toolPanel.locator('.coord-input').first();
      await firstInput.fill('42');

      await toolPanel.locator('#clear-btn').click();

      const value = await firstInput.inputValue();
      expect(value).toBe('');
    });

    test('switch to survey input method shows survey inputs', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await toolPanel.locator('input[name="input-method"][value="survey"]').click();

      const surveyInputs = toolPanel.locator('.survey-input');
      await expect(surveyInputs.first()).toBeVisible();
    });

    test('switching input methods preserves values', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Dip & Strike' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await toolPanel.locator('.coord-input').first().fill('42');

      // Switch to survey and back
      await toolPanel.locator('input[name="input-method"][value="survey"]').click();
      await toolPanel.locator('input[name="input-method"][value="coordinates"]').click();

      const value = await toolPanel.locator('.coord-input').first().inputValue();
      expect(value).toBe('42');
    });
  });

  test.describe('Rose Diagram', () => {

    test('opens from Tools menu', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Rose Diagram' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });
    });

    test('has cave selection dropdown', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Rose Diagram' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await expect(toolPanel.locator('#rose-cave-select')).toBeVisible();
    });

    test('has bin count selection', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Rose Diagram' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await expect(toolPanel.locator('#rose-bin-count')).toBeVisible();
    });

    test('selecting a cave renders diagram', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Rose Diagram' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await toolPanel.locator('#rose-cave-select').selectOption({ index: 1 });

      const svg = toolPanel.locator('#rose-diagram-container svg');
      await expect(svg).toBeAttached({ timeout: 3000 });
    });

    test('changing bin count updates diagram', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Rose Diagram' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await toolPanel.locator('#rose-cave-select').selectOption({ index: 1 });
      await page.waitForTimeout(500);

      await toolPanel.locator('#rose-bin-count').selectOption('8');
      await page.waitForTimeout(500);

      const svg = toolPanel.locator('#rose-diagram-container svg');
      await expect(svg).toBeAttached();
    });

    test('all bin count options are available', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Rose Diagram' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      const options = await toolPanel.locator('#rose-bin-count option').evaluateAll(
        els => els.map(el => el.value)
      );
      expect(options).toContain('8');
      expect(options).toContain('16');
      expect(options).toContain('36');
    });
  });

  test.describe('Shortest Path', () => {

    test('opens from Tools menu', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Shortest path' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });
    });

    test('has station inputs when cave is loaded', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Shortest path' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      const inputs = toolPanel.locator('input');
      const count = await inputs.count();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    test('find path between A0 and A4 shows correct result', async ({ page }) => {
      await setupWithCave(page);

      const toolsMenu = page.locator('.mydropdown').filter({ hasText: 'Tools' });
      await toolsMenu.locator('.dropbtn').click();
      await page.locator('.mydropdown-content a', { hasText: 'Shortest path' }).click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      const inputs = toolPanel.locator('input');
      await inputs.nth(0).fill('A0');
      await inputs.nth(1).fill('A4');

      await toolPanel.locator('button[type="submit"], input[type="submit"]').first().click();
      await page.waitForTimeout(1000);

      const resultLabel = toolPanel.locator('#shortest-path-label');
      await expect(resultLabel).toBeVisible();

      const text = await resultLabel.textContent();
      // Path A0→A1→A2→A3→A4 total length = 5.2 + 3.8 + 6.1 + 4.0 = 19.10
      expect(text).toBe('From: A0 To: A4 Length: 19.10');
    });
  });

  test.describe('Rotation Tool', () => {

    test('rotation icon is clickable', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const rotationBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Rotation"))');
      await expect(rotationBtn).toBeVisible();
      await rotationBtn.click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });
    });

    test('rotation tool has angle input', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const rotationBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Rotation"))');
      await rotationBtn.click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await expect(toolPanel.locator('#rotation-angle')).toBeVisible();
    });

    test('rotation tool has canvas', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      const rotationBtn = page.locator('a.mytooltip.dropbtn:has(.mytooltiptext:text("Rotation"))');
      await rotationBtn.click();

      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await expect(toolPanel.locator('#rotation-canvas')).toBeVisible();
    });

    test('changing rotation angle input updates value', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      await page.keyboard.press('Control+r');
      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      const angleInput = toolPanel.locator('#rotation-angle');
      await angleInput.fill('45');
      await page.waitForTimeout(300);

      expect(await angleInput.inputValue()).toBe('45');
    });

    test('dip control visible in 3D view', async ({ page }) => {
      await initApp(page);
      await closeProjectPanel(page);

      await page.keyboard.press('Control+Shift+3');
      await page.waitForTimeout(300);

      await page.keyboard.press('Control+r');
      const toolPanel = page.locator('#tool-panel');
      await expect(toolPanel).toBeVisible({ timeout: 5000 });

      await expect(toolPanel.locator('#dip-angle')).toBeVisible();
    });
  });
});
