import { test, expect } from '@playwright/test';
import { setupWithCave } from './helpers.js';

/**
 * Helper to read download content as text.
 */
async function downloadText(download) {
  const content = await (await download.createReadStream()).toArray();
  return Buffer.concat(content).toString('utf-8');
}

/**
 * Helper to open export dialog and select a format.
 */
async function openExportAndSelect(page, format) {
  const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
  await fileMenu.locator('.dropbtn').click();
  await page.locator('.mydropdown-content a', { hasText: 'Export cave' }).click();

  const exportPanel = page.locator('#export-panel');
  await expect(exportPanel).toBeVisible({ timeout: 5000 });

  await exportPanel.locator('#export-format').selectOption(format);
  return exportPanel;
}

/**
 * Helper to export and get downloaded text content.
 */
async function exportAndDownload(page, format) {
  const exportPanel = await openExportAndSelect(page, format);

  const downloadPromise = page.waitForEvent('download');
  await exportPanel.locator('button[type="submit"]').click();
  const download = await downloadPromise;
  const text = await downloadText(download);
  return { download, text };
}

test.describe('Export Formats', () => {

  test.beforeEach(async ({ page }) => {
    await setupWithCave(page);
  });

  test('export dialog opens from File menu', async ({ page }) => {
    const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
    await fileMenu.locator('.dropbtn').click();
    await page.locator('.mydropdown-content a', { hasText: 'Export cave' }).click();

    const exportPanel = page.locator('#export-panel');
    await expect(exportPanel).toBeVisible({ timeout: 5000 });
  });

  test('export dialog has format selection with all formats', async ({ page }) => {
    const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
    await fileMenu.locator('.dropbtn').click();
    await page.locator('.mydropdown-content a', { hasText: 'Export cave' }).click();

    const exportPanel = page.locator('#export-panel');
    await expect(exportPanel).toBeVisible({ timeout: 5000 });

    const options = await exportPanel.locator('#export-format option').evaluateAll(
      (els) => els.map((el) => el.value)
    );
    expect(options).toContain('json');
    expect(options).toContain('png');
    expect(options).toContain('svg');
    expect(options).toContain('dxf');
    expect(options).toContain('kml');
    expect(options).toContain('polygon');
  });

  test('export dialog has project name input with default value', async ({ page }) => {
    const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
    await fileMenu.locator('.dropbtn').click();
    await page.locator('.mydropdown-content a', { hasText: 'Export cave' }).click();

    const exportPanel = page.locator('#export-panel');
    await expect(exportPanel).toBeVisible({ timeout: 5000 });

    const nameInput = exportPanel.locator('#export-project-name');
    await expect(nameInput).toBeVisible();
    const value = await nameInput.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('export as JSON has correct structure', async ({ page }) => {
    const { download, text } = await exportAndDownload(page, 'json');

    expect(download.suggestedFilename()).toContain('.json');

    const parsed = JSON.parse(text);
    expect(parsed.name).toBe('Test Cave');
    expect(parsed.metadata.region).toBe('Bukk');
    expect(parsed.metadata.country).toBe('Hungary');
    expect(parsed.metadata.settlement).toBe('Lillafured');
    expect(parsed.metadata.catasterCode).toBe('TC001');
    expect(parsed.metadata.creator).toBe('Test');
    expect(parsed.surveys).toHaveLength(1);
    expect(parsed.surveys[0].name).toBe('Main Survey');
    expect(parsed.surveys[0].start).toBe('A0');
    expect(parsed.surveys[0].shots).toHaveLength(6);

    // Verify shot data
    const centerShots = parsed.surveys[0].shots.filter(s => s.type === 'center');
    expect(centerShots).toHaveLength(4);
    expect(centerShots[0]).toMatchObject({ from: 'A0', to: 'A1', length: 5.2, azimuth: 45, clino: -10 });
    expect(centerShots[1]).toMatchObject({ from: 'A1', to: 'A2', length: 3.8, azimuth: 120, clino: -5 });
    expect(centerShots[2]).toMatchObject({ from: 'A2', to: 'A3', length: 6.1, azimuth: 200, clino: 15 });
    expect(centerShots[3]).toMatchObject({ from: 'A3', to: 'A4', length: 4.0, azimuth: 310, clino: -20 });

    const splayShots = parsed.surveys[0].shots.filter(s => s.type === 'splay');
    expect(splayShots).toHaveLength(2);
  });

  test('export as SVG has valid SVG structure', async ({ page }) => {
    const { download, text } = await exportAndDownload(page, 'svg');

    expect(download.suggestedFilename()).toContain('.svg');

    // Valid SVG structure
    expect(text).toContain('<svg');
    expect(text).toContain('</svg>');
    expect(text).toContain('viewBox');

    // Should contain line elements for shots
    expect(text).toContain('<line');

    // Should contain station labels or circles
    const hasStationElements = text.includes('<circle') || text.includes('<text');
    expect(hasStationElements).toBe(true);
  });

  test('export as DXF has valid structure markers', async ({ page }) => {
    const exportPanel = await openExportAndSelect(page, 'dxf');

    const options = await exportPanel.locator('#export-format option').evaluateAll(
      (els) => els.map((el) => el.value)
    );
    expect(options).toContain('dxf');
  });

  test('export as Polygon .cave has valid structure', async ({ page }) => {
    const { download, text } = await exportAndDownload(page, 'polygon');

    expect(download.suggestedFilename()).toContain('.cave');

    // Polygon header
    expect(text).toContain('POLYGON Cave Surveying Software');
    expect(text).toContain('Polygon Program Version');

    // Project section
    expect(text).toContain('*** Project ***');
    expect(text).toContain('Project name: Test Cave');
    expect(text).toContain('Project place: Lillafured');
    expect(text).toContain('Project code: TC001');
    expect(text).toContain('Made by: Test');

    // Survey section
    expect(text).toContain('*** Surveys ***');
    expect(text).toContain('Survey name: Main Survey');

    // Survey data header
    expect(text).toContain('Survey data');
    expect(text).toContain('From\tTo\tLength\tAzimuth\tVertical');

    // Shot data - only center shots in Polygon format (values use JS number toString)
    expect(text).toContain('A0\tA1\t5.2\t45\t-10');
    expect(text).toContain('A1\tA2\t3.8\t120\t-5');
    expect(text).toContain('A2\tA3\t6.1\t200\t15');
    expect(text).toContain('A3\tA4\t4\t310\t-20');

    // Footer
    expect(text).toContain('End of survey data.');
    expect(text).toContain('EOF.');
  });

  test('export as PNG triggers download', async ({ page }) => {
    const fileMenu = page.locator('.mydropdown').filter({ hasText: 'File' });
    await fileMenu.locator('.dropbtn').click();
    await page.locator('.mydropdown-content a', { hasText: 'Export cave' }).click();

    const exportPanel = page.locator('#export-panel');
    await expect(exportPanel).toBeVisible({ timeout: 5000 });

    await exportPanel.locator('#export-format').selectOption('png');

    const downloadPromise = page.waitForEvent('download');
    await exportPanel.locator('button[type="submit"]').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('.png');
  });
});
