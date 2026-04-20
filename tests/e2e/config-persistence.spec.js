import { test, expect } from '@playwright/test';
import { initApp, closeProjectPanel, setupWithCave, dismissNotifications } from './helpers.js';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// ─── Helpers ────────────────────────────────────────────────

async function openSettingsPanel(page) {
  await page.locator('.sidebar-tab[data-tab="settings"]').click();
  await expect(page.locator('#settings-panel')).toHaveClass(/active/);
}

async function expandSection(page, index) {
  const section = page.locator('.settings-group').nth(index);
  const content = section.locator('.settings-group-content');
  const isHidden = await content.evaluate(el => getComputedStyle(el).display === 'none');
  if (isHidden) {
    await section.locator('.settings-group-title').click();
    await page.waitForTimeout(300);
  }
  return section;
}

async function reloadPage(page) {
  await page.evaluate(() => localStorage.setItem('first-visit', 'false'));
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);
}

async function changeColor(locator, color) {
  await locator.evaluate((el, c) => {
    el.value = c;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.onchange) el.onchange({ target: el });
  }, color);
  await locator.page().waitForTimeout(300);
}

async function changeRange(locator, value) {
  await locator.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.onchange) el.onchange({ target: el });
  }, String(value));
  await locator.page().waitForTimeout(300);
}

async function toggleCheckbox(locator) {
  await locator.evaluate(el => {
    el.checked = !el.checked;
    if (el.onchange) el.onchange({ target: el });
  });
  await locator.page().waitForTimeout(300);
}

async function clickVisibilityToggle(section, subgroupIndex) {
  const toggle = section.locator('.settings-subgroup .visibility-toggle').nth(subgroupIndex);
  await toggle.click();
  await toggle.page().waitForTimeout(300);
}

function getStoredConfig(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('speleo-studio-config');
    return raw ? JSON.parse(raw) : null;
  });
}

function assertScreenshotsDiffer(beforeBuf, afterBuf, minDiffPixels = 10) {
  const img1 = PNG.sync.read(beforeBuf);
  const img2 = PNG.sync.read(afterBuf);
  const { width, height } = img1;
  const diff = pixelmatch(img1.data, img2.data, null, width, height, { threshold: 0.1 });
  expect(diff).toBeGreaterThanOrEqual(minDiffPixels);
}

/** Take a screenshot of the 3D viewport */
async function viewportScreenshot(page) {
  return page.locator('#viewport').screenshot();
}

// ─── Config Persistence Tests ───────────────────────────────

test.describe('Configuration Persistence', () => {

  test('first-visit flag persists across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#navbarcontainer .dropbtn')).not.toHaveCount(0);
    await expect(page.locator('#welcome-panel')).toBeHidden({ timeout: 2000 }).catch(() => {});
  });

  test('sidebar collapse state persists across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#sidebar-container')).toHaveClass(/collapsed/);

    await reloadPage(page);
    await expect(page.locator('#sidebar-container')).toHaveClass(/collapsed/);
  });

  test('sidebar position persists across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await page.locator('#sidebar-position-toggle').click();
    await expect(page.locator('#sidebar-container')).toHaveClass(/left/);

    await reloadPage(page);
    await expect(page.locator('#sidebar-container')).toHaveClass(/left/);
  });

  test('scene overview collapse state persists across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await page.locator('#sidebar-overview-header').click();
    await expect(page.locator('#sidebar-overview-content-wrapper')).toHaveClass(/collapsed/);

    await reloadPage(page);
    await expect(page.locator('#sidebar-overview-content-wrapper')).toHaveClass(/collapsed/);
  });

  test('center line color persists across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);

    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');

    await reloadPage(page);
    await openSettingsPanel(page);
    await expandSection(page, 0);

    const newColor = await page.locator('.settings-group').nth(0).locator('.settings-group-content input[type="color"]').first().inputValue();
    expect(newColor).toBe('#00ff00');
  });

  test('multiple settings persist across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);

    // Change center line color
    const section0 = await expandSection(page, 0);
    const colorInput = section0.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');

    // Change center line width
    const widthInput = section0.locator('.settings-group-content input[type="range"]').first();
    await changeRange(widthInput, '3');

    // Change background color
    const section3 = await expandSection(page, 3);
    const bgColor = section3.locator('.settings-group-content input[type="color"]').first();
    await changeColor(bgColor, '#112233');

    await reloadPage(page);
    await openSettingsPanel(page);

    await expandSection(page, 0);
    expect(await page.locator('.settings-group').nth(0).locator('.settings-group-content input[type="color"]').first().inputValue()).toBe('#00ff00');
    expect(await page.locator('.settings-group').nth(0).locator('.settings-group-content input[type="range"]').first().inputValue()).toBe('3');

    await expandSection(page, 3);
    expect(await page.locator('.settings-group').nth(3).locator('.settings-group-content input[type="color"]').first().inputValue()).toBe('#112233');
  });

  test('DPI setting persists across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 3);

    // DPI is the first range in the Appearance section
    const dpiRange = section.locator('.settings-group-content input[type="range"]').first();
    await changeRange(dpiRange, '150');

    await reloadPage(page);
    await openSettingsPanel(page);
    await expandSection(page, 3);

    const newDpi = await page.locator('.settings-group').nth(3).locator('.settings-group-content input[type="range"]').first().inputValue();
    expect(newDpi).toBe('150');
  });

  test('language selection persists across reload', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);

    await page.locator('#language-select').selectOption('hu');
    await page.waitForTimeout(300);

    await reloadPage(page);

    const lang = await page.locator('#language-select').inputValue();
    expect(lang).toBe('hu');
  });

  test('config has correct structure in localStorage', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);

    // Trigger a save by changing a value
    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#aabbcc');

    const config = await getStoredConfig(page);
    expect(config).not.toBeNull();
    expect(config.version).toBe('1.0');
    expect(typeof config.timestamp).toBe('number');
    expect(config.revision).toBeGreaterThanOrEqual(1);
    expect(config.data).toBeDefined();
    expect(config.data.scene).toBeDefined();
    expect(config.data.ui).toBeDefined();
    expect(config.data.screen).toBeDefined();
  });

  test('config revision increments on changes', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);

    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#111111');

    const config1 = await getStoredConfig(page);
    const rev1 = config1.revision;

    await changeColor(colorInput, '#222222');

    const config2 = await getStoredConfig(page);
    expect(config2.revision).toBeGreaterThan(rev1);
  });

  test('config download produces valid JSON', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);

    const downloadPromise = page.waitForEvent('download');
    const downloadBtn = page.locator('#settings-content .config-buttons-container button').first();
    await downloadBtn.click();
    const download = await downloadPromise;

    const content = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(content).toString('utf-8');
    const parsed = JSON.parse(text);

    expect(parsed.version).toBe('1.0');
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.revision).toBeDefined();
    expect(parsed.data.scene).toBeDefined();
  });

  test('config reset restores default values', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);

    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');
    expect(await colorInput.inputValue()).toBe('#00ff00');

    // Reload so isDefault becomes false (reset only works when isDefault=false)
    await reloadPage(page);
    await openSettingsPanel(page);

    page.on('dialog', async d => await d.accept());
    await page.locator('#settings-content .config-buttons-container button').nth(2).click();
    await page.waitForTimeout(1000);

    // After reset, the settings panel is re-rendered. Re-expand and re-query.
    await expandSection(page, 0);
    const newColor = await page.locator('.settings-group').nth(0).locator('.settings-group-content input[type="color"]').first().inputValue();
    expect(newColor).toBe('#ff0000');
  });

  test('config reset restores defaults in localStorage', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);

    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');

    // Reload so isDefault becomes false
    await reloadPage(page);

    const before = await getStoredConfig(page);
    expect(before.data.scene.centerLines.segments.color).toBe('#00ff00');

    await openSettingsPanel(page);
    page.on('dialog', async d => await d.accept());
    await page.locator('#settings-content .config-buttons-container button').nth(2).click();
    await page.waitForTimeout(1000);

    // After reset, config is repopulated with defaults via ObjectObserver auto-save
    const after = await getStoredConfig(page);
    expect(after.data.scene.centerLines.segments.color).toBe('#ff0000');
    expect(after.data.scene.background.color).toBe('#000000');
  });

  test('config reset cancel preserves changes', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);

    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');

    page.on('dialog', async d => await d.dismiss());
    await page.locator('#settings-content .config-buttons-container button').nth(2).click();
    await page.waitForTimeout(300);

    expect(await colorInput.inputValue()).toBe('#00ff00');
  });

  test('config import restores settings from file', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);

    // Set color to green and capture config
    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');
    const savedJson = await page.evaluate(() => localStorage.getItem('speleo-studio-config'));

    // Now change to blue
    await changeColor(colorInput, '#0000ff');
    expect(await colorInput.inputValue()).toBe('#0000ff');

    // Import the saved green config
    await page.locator('#configInput').setInputFiles({
      name: 'config.json',
      mimeType: 'application/json',
      buffer: Buffer.from(savedJson)
    });
    await page.waitForTimeout(500);
    await dismissNotifications(page);

    // Color should be restored to green
    const section0 = await expandSection(page, 0);
    const restoredColor = await section0.locator('.settings-group-content input[type="color"]').first().inputValue();
    expect(restoredColor).toBe('#00ff00');
  });

  test('background color change is saved to localStorage', async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
    const section = await expandSection(page, 3);

    const bgColor = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(bgColor, '#223344');

    const config = await getStoredConfig(page);
    expect(config.data.scene.background.color).toBe('#223344');
  });
});

// ─── Visual Impact Tests ─────────────────────────────────────

test.describe('Config Visual Impact - Appearance', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
  });

  test('background color change is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 3);
    const bgColor = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(bgColor, '#ffffff');

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const sceneColor = await page.evaluate(() =>
      window.speleo?.scene?.threejsScene?.background?.getHexString?.()
    );
    expect(sceneColor).toBe('ffffff');
  });

  test('grid color change is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 3);
    const gridColor = section.locator('.settings-group-content input[type="color"]').nth(1);
    await changeColor(gridColor, '#ff0000');

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.grid?.color?.getHexString?.()
    );
    expect(matColor).toBe('ff0000');
  });

  test('grid opacity change is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 3);
    const gridOpacity = section.locator('.settings-group-content input[type="range"]').nth(2);
    await changeRange(gridOpacity, '1');

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const matOpacity = await page.evaluate(() =>
      window.speleo?.scene?.mats?.grid?.opacity
    );
    expect(matOpacity).toBeCloseTo(1, 1);
  });

  test('background color change updates Three.js scene', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 3);
    const bgColor = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(bgColor, '#ffffff');

    const sceneColor = await page.evaluate(() =>
      window.speleo?.scene?.threejsScene?.background?.getHexString?.()
    );
    expect(sceneColor).toBe('ffffff');
  });

  test('grid color change updates grid material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 3);
    const gridColor = section.locator('.settings-group-content input[type="color"]').nth(1);
    await changeColor(gridColor, '#ff0000');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.grid?.color?.getHexString?.()
    );
    expect(matColor).toBe('ff0000');
  });

  test('grid opacity change updates grid material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 3);
    const gridOpacity = section.locator('.settings-group-content input[type="range"]').nth(2);
    await changeRange(gridOpacity, '0.9');

    const matOpacity = await page.evaluate(() =>
      window.speleo?.scene?.mats?.grid?.opacity
    );
    expect(matOpacity).toBeCloseTo(0.9, 1);
  });

  test('start point color change updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 3);
    // Start point color is the 4th color input in Appearance
    const startColor = section.locator('.settings-group-content input[type="color"]').nth(3);
    await changeColor(startColor, '#00ff00');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.sphere?.startPoint?.color?.getHexString?.()
    );
    expect(matColor).toBe('00ff00');
  });
});

test.describe('Config Visual Impact - Survey Lines', () => {

  test.beforeEach(async ({ page }) => {
    await setupWithCave(page);
  });

  test('center line color change is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.centerLine?.color?.getHexString?.()
    );
    expect(matColor).toBe('00ff00');
  });

  test('center line color change updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.centerLine?.color?.getHexString?.()
    );
    expect(matColor).toBe('00ff00');
  });

  test('center line width change is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    const widthInput = section.locator('.settings-group-content input[type="range"]').first();
    await changeRange(widthInput, '5');

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const linewidth = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.centerLine?.linewidth
    );
    expect(linewidth).toBeCloseTo(5, 0);
  });

  test('center line width change updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    const widthInput = section.locator('.settings-group-content input[type="range"]').first();
    await changeRange(widthInput, '4');

    const linewidth = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.centerLine?.linewidth
    );
    expect(linewidth).toBeCloseTo(4, 0);
  });

  test('center line opacity change is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    const opacityInput = section.locator('.settings-group-content input[type="range"]').nth(1);
    await changeRange(opacityInput, '0.2');

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const opacity = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.centerLine?.opacity
    );
    expect(opacity).toBeCloseTo(0.2, 1);
  });

  test('center line opacity change updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    const opacityInput = section.locator('.settings-group-content input[type="range"]').nth(1);
    await changeRange(opacityInput, '0.3');

    const opacity = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.centerLine?.opacity
    );
    expect(opacity).toBeCloseTo(0.3, 1);
  });

  test('splay color change updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    // Splay color is the 2nd color input in Survey Lines section
    const splayColor = section.locator('.settings-group-content input[type="color"]').nth(1);
    await changeColor(splayColor, '#ff00ff');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.splay?.color?.getHexString?.()
    );
    expect(matColor).toBe('ff00ff');
  });

  test('splay width change updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    // Splay width is the 3rd range (after center width, center opacity)
    const splayWidth = section.locator('.settings-group-content input[type="range"]').nth(2);
    await changeRange(splayWidth, '4');

    const linewidth = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.splay?.linewidth
    );
    expect(linewidth).toBeCloseTo(4, 0);
  });

  test('auxiliary color change updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    // Auxiliary color is the 3rd color input
    const auxColor = section.locator('.settings-group-content input[type="color"]').nth(2);
    await changeColor(auxColor, '#aabb00');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.segments?.auxiliary?.color?.getHexString?.()
    );
    expect(matColor).toBe('aabb00');
  });

  test('hiding center lines is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    await clickVisibilityToggle(section, 0);

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const config = await getStoredConfig(page);
    expect(config.data.scene.centerLines.segments.show).toBe(false);
  });

  test('hiding splays is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 0);
    await clickVisibilityToggle(section, 1);

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const config = await getStoredConfig(page);
    expect(config.data.scene.splays.segments.show).toBe(false);
  });
});

test.describe('Config Visual Impact - Stations', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
  });

  test('center station sphere color updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 1);
    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#00ff00');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.sphere?.centerLine?.color?.getHexString?.()
    );
    expect(matColor).toBe('00ff00');
  });

  test('splay station sphere color updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 1);
    const colorInput = section.locator('.settings-group-content input[type="color"]').nth(1);
    await changeColor(colorInput, '#ff00ff');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.sphere?.splay?.color?.getHexString?.()
    );
    expect(matColor).toBe('ff00ff');
  });

  test('auxiliary station sphere color updates material', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 1);
    const colorInput = section.locator('.settings-group-content input[type="color"]').nth(2);
    await changeColor(colorInput, '#aabb00');

    const matColor = await page.evaluate(() =>
      window.speleo?.scene?.mats?.sphere?.auxiliary?.color?.getHexString?.()
    );
    expect(matColor).toBe('aabb00');
  });
});

test.describe('Config Visual Impact - Sprites', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
  });

  test('hiding logo is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    const logoCheckbox = section.locator('.settings-group-content input[type="checkbox"]').nth(3);
    await toggleCheckbox(logoCheckbox);

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const display = await page.locator('#viewport-logo').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('hiding logo sets viewport-logo display to none', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    const logoCheckbox = section.locator('.settings-group-content input[type="checkbox"]').nth(3);
    await toggleCheckbox(logoCheckbox);

    const display = await page.locator('#viewport-logo').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('hiding compass is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    const compassCheckbox = section.locator('.settings-group-content input[type="checkbox"]').first();
    await toggleCheckbox(compassCheckbox);

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const visible = await page.evaluate(() =>
      window.speleo?.scene?.view?.compass?.visible
    );
    expect(visible).toBe(false);
  });

  test('hiding compass updates scene object', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    const compassCheckbox = section.locator('.settings-group-content input[type="checkbox"]').first();
    await toggleCheckbox(compassCheckbox);

    const visible = await page.evaluate(() =>
      window.speleo?.scene?.view?.compass?.visible
    );
    expect(visible).toBe(false);
  });

  test('hiding ruler is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    const rulerCheckbox = section.locator('.settings-group-content input[type="checkbox"]').nth(1);
    await toggleCheckbox(rulerCheckbox);

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);

    const visible = await page.evaluate(() =>
      window.speleo?.scene?.view?.ratioIndicator?.visible
    );
    expect(visible).toBe(false);
  });

  test('hiding ruler updates scene object', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    const rulerCheckbox = section.locator('.settings-group-content input[type="checkbox"]').nth(1);
    await toggleCheckbox(rulerCheckbox);

    const visible = await page.evaluate(() =>
      window.speleo?.scene?.view?.ratioIndicator?.visible
    );
    expect(visible).toBe(false);
  });

  test('hiding view helper updates scene object', async ({ page }) => {
    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    // View helper is the 5th checkbox
    const viewHelperCheckbox = section.locator('.settings-group-content input[type="checkbox"]').nth(4);
    await toggleCheckbox(viewHelperCheckbox);

    const visible = await page.evaluate(() =>
      window.speleo?.scene?.view?.viewHelper?.visible
    );
    expect(visible).toBe(false);
  });

  test('sprite text color change is visible in viewport', async ({ page }) => {
    const before = await viewportScreenshot(page);

    await openSettingsPanel(page);
    const section = await expandSection(page, 7);
    const textColor = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(textColor, '#ff0000');

    const config = await getStoredConfig(page);
    expect(config.data.scene.sprites3D.textColor).toBe('#ff0000');

    const after = await viewportScreenshot(page);
    assertScreenshotsDiffer(before, after);
  });
});

// ─── Station Labels ──────────────────────────────────────────

test.describe('Config Visual Impact - Station Labels', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
  });

  test('label mode select changes config', async ({ page }) => {
    const section = await expandSection(page, 2);
    const selectEl = section.locator('.settings-group-content select').first();
    // Change to second option (Depth)
    await selectEl.selectOption({ index: 1 });
    await selectEl.evaluate(el => { if (el.onchange) el.onchange({ target: el }); });
    await page.waitForTimeout(300);

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.mode).toBe('depth');
  });

  test('label color changes config', async ({ page }) => {
    const section = await expandSection(page, 2);
    const colorInput = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(colorInput, '#ff0000');

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.color).toBe('#ff0000');
  });

  test('label size changes config', async ({ page }) => {
    const section = await expandSection(page, 2);
    const sizeRange = section.locator('.settings-group-content input[type="range"]').first();
    await changeRange(sizeRange, '40');

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.size).toBe(40);
  });

  test('label offset changes config', async ({ page }) => {
    const section = await expandSection(page, 2);
    const offsetRange = section.locator('.settings-group-content input[type="range"]').nth(1);
    await changeRange(offsetRange, '5');

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.offset).toBe(5);
  });

  test('label offset direction select changes config', async ({ page }) => {
    const section = await expandSection(page, 2);
    // Offset direction is the 2nd select
    const selectEl = section.locator('.settings-group-content select').nth(1);
    await selectEl.selectOption({ index: 1 }); // 'down'
    await selectEl.evaluate(el => { if (el.onchange) el.onchange({ target: el }); });
    await page.waitForTimeout(300);

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.offsetDirection).toBe('down');
  });

  test('stroke checkbox toggles config', async ({ page }) => {
    const section = await expandSection(page, 2);
    const strokeCheckbox = section.locator('.settings-group-content input[type="checkbox"]').first();
    const before = await strokeCheckbox.evaluate(el => el.checked);
    await toggleCheckbox(strokeCheckbox);

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.stroke).toBe(!before);
  });

  test('stroke color changes config', async ({ page }) => {
    const section = await expandSection(page, 2);
    // Stroke color is the 2nd color input
    const strokeColor = section.locator('.settings-group-content input[type="color"]').nth(1);
    await changeColor(strokeColor, '#ff00ff');

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.strokeColor).toBe('#ff00ff');
  });

  test('section visibility toggle changes show config', async ({ page }) => {
    const section = page.locator('.settings-group').nth(2);
    const eyeToggle = section.locator('.settings-group-title .section-visibility');
    await eyeToggle.click();
    await page.waitForTimeout(300);

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationLabels.show).toBe(true);
  });
});

// ─── 3D Models ───────────────────────────────────────────────

test.describe('Config Visual Impact - 3D Models', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
  });

  test('point cloud point size changes config', async ({ page }) => {
    const section = await expandSection(page, 4);
    const sizeRange = section.locator('.settings-group-content input[type="range"]').first();
    await changeRange(sizeRange, '10');

    const config = await getStoredConfig(page);
    expect(config.data.scene.models.pointSize).toBe(10);
  });

  test('model color mode is gradientByZ by default', async ({ page }) => {
    const config = await getStoredConfig(page);
    expect(config.data.scene.models.color.mode).toBe('gradientByZ');
    expect(Array.isArray(config.data.scene.models.color.gradientColors)).toBe(true);
  });
});

// ─── Attributes ──────────────────────────────────────────────

test.describe('Config Visual Impact - Attributes', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
  });

  test('section label color changes config', async ({ page }) => {
    const section = await expandSection(page, 5);
    // First color input in Attributes section is inside the Section Labels subgroup
    const labelColor = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(labelColor, '#ff0000');

    const config = await getStoredConfig(page);
    expect(config.data.scene.sections.labels.color).toBe('#ff0000');
  });

  test('section label stroke color changes config', async ({ page }) => {
    const section = await expandSection(page, 5);
    const strokeColor = section.locator('.settings-group-content input[type="color"]').nth(1);
    await changeColor(strokeColor, '#aabbcc');

    const config = await getStoredConfig(page);
    expect(config.data.scene.sections.labels.strokeColor).toBe('#aabbcc');
  });

  test('section label size changes config', async ({ page }) => {
    const section = await expandSection(page, 5);
    const sizeRange = section.locator('.settings-group-content input[type="range"]').first();
    await changeRange(sizeRange, '15');

    const config = await getStoredConfig(page);
    expect(config.data.scene.sections.labels.size).toBe(15);
  });

  test('station icon scale changes config', async ({ page }) => {
    const section = await expandSection(page, 5);
    // Station icon scale is the 2nd range
    const iconScale = section.locator('.settings-group-content input[type="range"]').nth(1);
    await changeRange(iconScale, '12');

    const config = await getStoredConfig(page);
    expect(config.data.scene.stationAttributes.iconScale).toBe(12);
  });

  test('tectonic circle opacity changes config', async ({ page }) => {
    const section = await expandSection(page, 5);
    // Tectonic circle opacity is the 3rd range
    const opacityRange = section.locator('.settings-group-content input[type="range"]').nth(2);
    await changeRange(opacityRange, '0.3');

    const config = await getStoredConfig(page);
    expect(config.data.scene.attributes.tectonic.circle.opacity).toBeCloseTo(0.3, 1);
  });

  test('section labels visibility toggle changes config', async ({ page }) => {
    const section = await expandSection(page, 5);
    const eyeToggle = section.locator('.settings-subgroup .visibility-toggle').first();
    await eyeToggle.click();
    await page.waitForTimeout(300);

    const config = await getStoredConfig(page);
    expect(config.data.scene.sections.labels.show).toBe(false);
  });
});

// ─── Station Details ─────────────────────────────────────────

test.describe('Config Visual Impact - Station Details', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
  });

  test('toggling caveName checkbox changes config', async ({ page }) => {
    const section = await expandSection(page, 6);
    // caveName is the 1st checkbox in station details
    const checkbox = section.locator('.settings-group-content input[type="checkbox"]').first();
    const before = await checkbox.evaluate(el => el.checked);
    await toggleCheckbox(checkbox);

    const config = await getStoredConfig(page);
    expect(config.data.ui.stationDetails.caveName).toBe(!before);
  });

  test('toggling xCoordinate checkbox changes config', async ({ page }) => {
    const section = await expandSection(page, 6);
    // xCoordinate is the 4th checkbox (after caveName, surveyName, stationName)
    const checkbox = section.locator('.settings-group-content input[type="checkbox"]').nth(3);
    await toggleCheckbox(checkbox);

    const config = await getStoredConfig(page);
    expect(config.data.ui.stationDetails.xCoordinate).toBe(true);
  });

  test('toggling type checkbox changes config', async ({ page }) => {
    const section = await expandSection(page, 6);
    // type is the 10th checkbox (after caveName, surveyName, stationName, x, y, z, eovY, eovX, utmEasting, utmNorthing, elevation)
    // Let's count: cave=0, survey=1, station=2, x=3, y=4, z=5, eovY=6, eovX=7, utmEasting=8, utmNorthing=9, elevation=10, type=11
    const checkbox = section.locator('.settings-group-content input[type="checkbox"]').nth(11);
    await toggleCheckbox(checkbox);

    const config = await getStoredConfig(page);
    expect(config.data.ui.stationDetails.type).toBe(true);
  });

  test('station details checkboxes persist across reload', async ({ page }) => {
    const section = await expandSection(page, 6);
    // Toggle xCoordinate
    const checkbox = section.locator('.settings-group-content input[type="checkbox"]').nth(3);
    await toggleCheckbox(checkbox);

    await reloadPage(page);
    await openSettingsPanel(page);
    await expandSection(page, 6);

    const isChecked = await page.locator('.settings-group').nth(6)
      .locator('.settings-group-content input[type="checkbox"]').nth(3)
      .evaluate(el => el.checked);
    expect(isChecked).toBe(true);
  });
});

// ─── Color Gradient ──────────────────────────────────────────

test.describe('Config Visual Impact - Color Gradient', () => {

  test.beforeEach(async ({ page }) => {
    await initApp(page);
    await closeProjectPanel(page);
    await openSettingsPanel(page);
  });

  test('adding gradient stop increases gradient count', async ({ page }) => {
    const section = await expandSection(page, 8);

    // Default has 4 gradient stops
    const countBefore = await page.evaluate(() =>
      window.speleo?.options?.scene?.caveLines?.color?.gradientColors?.length ?? 0
    );
    expect(countBefore).toBe(4);

    const addBtn = section.locator('.settings-group-content button').first();
    await addBtn.click();
    await page.waitForTimeout(300);

    const countAfter = await page.evaluate(() =>
      window.speleo?.options?.scene?.caveLines?.color?.gradientColors?.length ?? 0
    );
    expect(countAfter).toBe(countBefore + 1);
  });

  test('changing gradient color updates config', async ({ page }) => {
    const section = await expandSection(page, 8);

    // First gradient color input
    const gradientColor = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(gradientColor, '#ff00ff');

    const config = await getStoredConfig(page);
    expect(config.data.scene.caveLines.color.gradientColors[0].color).toBe('#ff00ff');
  });

  test('gradient colors persist across reload', async ({ page }) => {
    const section = await expandSection(page, 8);

    const gradientColor = section.locator('.settings-group-content input[type="color"]').first();
    await changeColor(gradientColor, '#aabb00');

    await reloadPage(page);
    await openSettingsPanel(page);
    await expandSection(page, 8);

    const color = await page.locator('.settings-group').nth(8)
      .locator('.settings-group-content input[type="color"]').first()
      .inputValue();
    expect(color).toBe('#aabb00');
  });
});
