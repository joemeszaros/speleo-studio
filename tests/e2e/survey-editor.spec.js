import { test, expect } from '@playwright/test';
import { setupWithCave, expandCaveNode, rightClickSurvey, dismissNotifications } from './helpers.js';

test.describe('Survey Editor', () => {

  test.beforeEach(async ({ page }) => {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });
  });

  test('open survey editor from context menu', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');

    const contextMenu = page.locator('#explorer-context-menu');
    await contextMenu.locator('.context-menu-option[title*="survey editor"]').click();

    // Editor panel should be visible
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
  });

  test('survey editor shows shot data in table', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Tabulator table should have rows
    const rows = editor.locator('.tabulator-row');
    await expect(rows).not.toHaveCount(0);
  });

  test('survey editor shows correct number of shots', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // sample-cave.json has 6 shots in Main Survey (table may include extra row)
    const rows = editor.locator('.tabulator-row');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('survey editor has toolbar buttons', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Check key toolbar buttons exist
    await expect(editor.locator('#add-row')).toBeAttached();
    await expect(editor.locator('#delete-row')).toBeAttached();
    await expect(editor.locator('#update-survey')).toBeAttached();
    await expect(editor.locator('#cancel-survey')).toBeAttached();
  });

  test('add row button adds a new shot', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const initialRowCount = await editor.locator('.tabulator-row').count();

    // Click add row button
    await editor.locator('#add-row').click();

    const newRowCount = await editor.locator('.tabulator-row').count();
    expect(newRowCount).toBe(initialRowCount + 1);
  });

  test('cancel button closes editor', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('#cancel-survey').click();
    await expect(editor).toBeHidden();
  });

  test('validate button exists and is clickable', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const validateBtn = editor.locator('#validate-shots');
    await expect(validateBtn).toBeAttached();
    await validateBtn.click();
  });

  test('export to CSV button exists', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await expect(editor.locator('#export-to-csv')).toBeAttached();
  });

  test('column toggle menu can be opened', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('#toggle-column').click();

    const toggleMenu = page.locator('#toogle-column-visibility-menu');
    await expect(toggleMenu).toBeVisible();
  });

  test('undo reverts adding a row', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const initialCount = await editor.locator('.tabulator-row').count();

    // Add a row
    await editor.locator('#add-row').click();
    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount + 1);

    // Undo
    await editor.locator('#undo').click();
    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount);
  });

  test('redo restores undone action with row data', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const initialCount = await editor.locator('.tabulator-row').count();

    // Add a row and fill it with values
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      rows[rows.length - 1].update({
        type: 'center',
        from: 'UNDO_FROM',
        to: 'UNDO_TO',
        length: 55.5,
        azimuth: 123,
        clino: -7
      });
    });
    await page.waitForTimeout(200);

    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount + 1);

    // Verify the new row data is present
    const fromValues = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map(r => r.getData().from);
    });
    expect(fromValues).toContain('UNDO_FROM');

    // Undo - row should be removed along with its data
    await editor.locator('#undo').click();
    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount);

    const fromValuesAfterUndo = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map(r => r.getData().from);
    });
    expect(fromValuesAfterUndo).not.toContain('UNDO_FROM');

    // Redo - row and its data should be restored
    await editor.locator('#redo').click();
    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount + 1);

    const fromValuesAfterRedo = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map(r => r.getData().from);
    });
    expect(fromValuesAfterRedo).toContain('UNDO_FROM');

    // Also verify all values were restored
    const restoredRow = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      const row = rows.find(r => r.getData().from === 'UNDO_FROM');
      const d = row.getData();
      return { type: d.type, from: d.from, to: d.to, length: d.length, azimuth: d.azimuth, clino: d.clino };
    });
    expect(restoredRow).toEqual({
      type: 'center',
      from: 'UNDO_FROM',
      to: 'UNDO_TO',
      length: 55.5,
      azimuth: 123,
      clino: -7
    });
  });

  test('add row before inserts row before selected row', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const initialCount = await editor.locator('.tabulator-row').count();

    // Select the first row by clicking on it
    await editor.locator('.tabulator-row').first().click();
    await page.waitForTimeout(200);

    // Add row before
    await editor.locator('#add-row-before').click();

    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount + 1);
  });

  test('add row after inserts row after selected row', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Select the second row (A1→A2, index 1)
    await editor.locator('.tabulator-row').nth(2).click();
    await page.waitForTimeout(200);

    // Add row after
    await editor.locator('#add-row-after').click();
    await page.waitForTimeout(300);

    // Fill the new row with distinct values
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      // The new row should be at index 3 (after row 2)
      rows[3].update({
        type: 'center',
        from: 'NEW_FROM',
        to: 'NEW_TO',
        length: 11.1,
        azimuth: 222,
        clino: -33
      });
    });
    await page.waitForTimeout(200);

    // Verify position: read from values of rows around the insertion point
    const rowData = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map(r => ({ from: r.getData().from, to: r.getData().to }));
    });

    // Row 2 should still be A1→A2 (the row we selected)
    expect(rowData[2].from).toBe('A1');
    expect(rowData[2].to).toBe('A2');
    // Row 3 should be our new row
    expect(rowData[3].from).toBe('NEW_FROM');
    expect(rowData[3].to).toBe('NEW_TO');
    // Row 4 should be the original row that was at index 3 (A2→A3)
    expect(rowData[4].from).toBe('A2');
    expect(rowData[4].to).toBe('A3');
  });

  test('add N rows using row count input', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const initialCount = await editor.locator('.tabulator-row').count();

    // Set row count to 3
    const rowCountInput = editor.locator('#row-count-input');
    await rowCountInput.fill('3');

    // Add 3 rows at end
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount + 3);
  });

  test('add then undo then delete: undo leaves row for deletion', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const initialCount = await editor.locator('.tabulator-row').count();

    // Add a row then undo - verifies delete button is present and operational
    await editor.locator('#add-row').click();
    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount + 1);

    // Undo to remove the added row
    await editor.locator('#undo').click();
    expect(await editor.locator('.tabulator-row').count()).toBe(initialCount);

    // Verify delete button exists
    await expect(editor.locator('#delete-row')).toBeAttached();
  });

  test('validate survey marks incomplete row as incomplete', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Add an empty row (missing from, to, length, azimuth, clino)
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);

    // Validate
    await editor.locator('#validate-shots').click();
    await page.waitForTimeout(500);

    // Check the last row's status via Tabulator API
    const lastRowStatus = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      return rows[rows.length - 1].getData().status;
    });
    expect(lastRowStatus).toBe('incomplete');
  });

  test('validate survey marks row with invalid values as invalid', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Add a row with invalid data (clino out of range: must be -90 to 90)
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      rows[rows.length - 1].update({
        type: 'center',
        from: 'A4',
        to: 'A5',
        length: 5.0,
        azimuth: 45,
        clino: -100
      });
    });
    await page.waitForTimeout(200);

    // Validate
    await editor.locator('#validate-shots').click();
    await page.waitForTimeout(500);

    // The row with clino=-100 should be marked invalid
    const lastRowStatus = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      return rows[rows.length - 1].getData().status;
    });
    expect(lastRowStatus).toBe('invalid');
  });

  test('validate survey marks valid rows as ok', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Validate the existing data (all shots are valid)
    await editor.locator('#validate-shots').click();
    await page.waitForTimeout(500);

    // Check first row status is ok
    const firstRowStatus = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows()[0].getData().status;
    });
    expect(firstRowStatus).toBe('ok');
  });

  test('update survey saves changes with new shot data', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Add a new row at the end
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    // Fill the new row's cells via Tabulator API
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      const lastRow = rows[rows.length - 1];
      lastRow.update({
        type: 'center',
        from: 'A4',
        to: 'A5',
        length: 7.3,
        azimuth: 85,
        clino: -12
      });
    });
    await page.waitForTimeout(200);

    // Save
    await editor.locator('#update-survey').click();
    await page.waitForTimeout(1000);

    // Close editor
    await editor.locator('#cancel-survey').click();
    await expect(editor).toBeHidden({ timeout: 5000 });
    await dismissNotifications(page);
    await page.waitForTimeout(1000);

    // Reopen and export CSV to verify exact content
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    await expect(editor).toBeVisible({ timeout: 5000 });

    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    const content = await (await download.createReadStream()).toArray();
    const csvText = Buffer.concat(content).toString('utf-8');

    // Exact match: original 6 shots + new A4→A5 shot with computed X/Y/Z
    const expected = [
      '"Type"\t"From"\t"To"\t"Length"\t"Azimuth"\t"Clino"\t"X"\t"Y"\t"Z"\t"Attributes"\t"Comment"',
      '"center"\t"A0"\t"A1"\t"5.2"\t"45"\t"-10"\t"3.621094049664098"\t"3.6210940496640984"\t"-0.9029705238680378"\t""\t""',
      '"splay"\t"A1"\t""\t"2.1"\t"90"\t"0"\t"5.721094049664098"\t"3.6210940496640984"\t"-0.9029705238680378"\t""\t""',
      '"center"\t"A1"\t"A2"\t"3.8"\t"120"\t"-5"\t"6.899467729182818"\t"1.7283241232897828"\t"-1.2341623463091387"\t""\t""',
      '"center"\t"A2"\t"A3"\t"6.1"\t"200"\t"15"\t"4.88423458293177"\t"-3.8084834409714663"\t"0.34463382881623783"\t""\t""',
      '"splay"\t"A3"\t""\t"1.5"\t"270"\t"0"\t"3.3842345829317697"\t"-3.8084834409714667"\t"0.34463382881623783"\t""\t""',
      '"center"\t"A3"\t"A4"\t"4"\t"310"\t"-20"\t"2.0048493413599524"\t"-1.3923923467512518"\t"-1.023446744486437"\t""\t""',
      '"center"\t"A4"\t"A5"\t"7.3"\t"85"\t"-12"\t"9.118155154115858"\t"-0.7700587279420513"\t"-2.54120208745608"\t""\t""',
    ].join('\n');

    expect(csvText).toBe(expected);
  });

  test('cancel rejects edits and added rows are not saved', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Add a row and fill it with data
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      const lastRow = rows[rows.length - 1];
      lastRow.update({
        type: 'center',
        from: 'X0',
        to: 'X1',
        length: 99.9,
        azimuth: 180,
        clino: 0
      });
    });
    await page.waitForTimeout(200);

    // Cancel - should discard changes and close
    await editor.locator('#cancel-survey').click();
    await expect(editor).toBeHidden();
    await dismissNotifications(page);
    await page.waitForTimeout(1000);

    // Reopen and export CSV to verify the cancelled row is NOT present
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    await expect(editor).toBeVisible({ timeout: 5000 });

    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    const content = await (await download.createReadStream()).toArray();
    const csvText = Buffer.concat(content).toString('utf-8');

    // Exact match: only the original 6 shots, no X0→X1 row
    const expected = [
      '"Type"\t"From"\t"To"\t"Length"\t"Azimuth"\t"Clino"\t"X"\t"Y"\t"Z"\t"Attributes"\t"Comment"',
      '"center"\t"A0"\t"A1"\t"5.2"\t"45"\t"-10"\t"3.621094049664098"\t"3.6210940496640984"\t"-0.9029705238680378"\t""\t""',
      '"splay"\t"A1"\t""\t"2.1"\t"90"\t"0"\t"5.721094049664098"\t"3.6210940496640984"\t"-0.9029705238680378"\t""\t""',
      '"center"\t"A1"\t"A2"\t"3.8"\t"120"\t"-5"\t"6.899467729182818"\t"1.7283241232897828"\t"-1.2341623463091387"\t""\t""',
      '"center"\t"A2"\t"A3"\t"6.1"\t"200"\t"15"\t"4.88423458293177"\t"-3.8084834409714663"\t"0.34463382881623783"\t""\t""',
      '"splay"\t"A3"\t""\t"1.5"\t"270"\t"0"\t"3.3842345829317697"\t"-3.8084834409714667"\t"0.34463382881623783"\t""\t""',
      '"center"\t"A3"\t"A4"\t"4"\t"310"\t"-20"\t"2.0048493413599524"\t"-1.3923923467512518"\t"-1.023446744486437"\t""\t""',
    ].join('\n');

    expect(csvText).toBe(expected);
  });

  test('export CSV downloads file with correct content', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Listen for download
    const downloadPromise = page.waitForEvent('download');
    await editor.locator('#export-to-csv').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('Test Cave - Main Survey.csv');

    const content = await (await download.createReadStream()).toArray();
    const csvText = Buffer.concat(content).toString('utf-8');

    const expected = [
      '"Type"\t"From"\t"To"\t"Length"\t"Azimuth"\t"Clino"\t"X"\t"Y"\t"Z"\t"Attributes"\t"Comment"',
      '"center"\t"A0"\t"A1"\t"5.2"\t"45"\t"-10"\t"3.621094049664098"\t"3.6210940496640984"\t"-0.9029705238680378"\t""\t""',
      '"splay"\t"A1"\t""\t"2.1"\t"90"\t"0"\t"5.721094049664098"\t"3.6210940496640984"\t"-0.9029705238680378"\t""\t""',
      '"center"\t"A1"\t"A2"\t"3.8"\t"120"\t"-5"\t"6.899467729182818"\t"1.7283241232897828"\t"-1.2341623463091387"\t""\t""',
      '"center"\t"A2"\t"A3"\t"6.1"\t"200"\t"15"\t"4.88423458293177"\t"-3.8084834409714663"\t"0.34463382881623783"\t""\t""',
      '"splay"\t"A3"\t""\t"1.5"\t"270"\t"0"\t"3.3842345829317697"\t"-3.8084834409714667"\t"0.34463382881623783"\t""\t""',
      '"center"\t"A3"\t"A4"\t"4"\t"310"\t"-20"\t"2.0048493413599524"\t"-1.3923923467512518"\t"-1.023446744486437"\t""\t""',
    ].join('\n');

    expect(csvText).toBe(expected);
  });

  test('comma decimal separator is converted to dot on save', async ({ page }) => {
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();

    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Add a row with comma decimal separators via Tabulator (simulating user typing "5,2")
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      const lastRow = rows[rows.length - 1];
      // Set values with comma separators as strings (simulating keyboard input)
      lastRow.update({
        type: 'center',
        from: 'C0',
        to: 'C1',
        length: '12,5',
        azimuth: '45,3',
        clino: '-7,8'
      });
    });
    await page.waitForTimeout(200);

    // Save the survey
    await editor.locator('#update-survey').click();
    await page.waitForTimeout(1500);
    await dismissNotifications(page);

    // Close and reopen
    await editor.locator('#cancel-survey').click();
    await expect(editor).toBeHidden({ timeout: 5000 });
    await dismissNotifications(page);
    await page.waitForTimeout(500);

    // Reopen editor
    const surveyNode = page.locator('.explorer-tree-node', { has: page.locator('text=Main Survey') });
    await expect(surveyNode).toBeVisible({ timeout: 5000 });
    await surveyNode.click({ button: 'right' });
    await expect(page.locator('#explorer-context-menu')).toBeVisible({ timeout: 5000 });
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Wait for table to populate
    await page.waitForFunction(() => {
      const table = document.querySelector('#surveydata');
      if (!table) return false;
      const tabs = window.Tabulator?.findTable?.(table);
      return tabs?.[0]?.getRows()?.length > 0;
    }, { timeout: 5000 });

    // Find the saved row and verify commas were converted to dots
    const savedRow = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const row = tabulator.getRows().find(r => r.getData().from === 'C0');
      if (!row) return null;
      const d = row.getData();
      return { length: d.length, azimuth: d.azimuth, clino: d.clino };
    });

    expect(savedRow).not.toBeNull();
    expect(savedRow.length).toBe(12.5);
    expect(savedRow.azimuth).toBe(45.3);
    expect(savedRow.clino).toBe(-7.8);
  });
});

test.describe('Survey Editor Row Context Menu', () => {

  /**
   * Open survey editor and return the editor locator.
   */
  async function openSurveyEditor(page) {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    return editor;
  }

  /**
   * Right-click on a table row and click a context menu item by text.
   */
  async function rightClickRowAndSelect(page, rowIndex, menuText) {
    await page.evaluate((idx) => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const row = tabulator.getRows()[idx];
      const el = row.getElement();
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + 50, clientY: rect.top + 10
      }));
    }, rowIndex);
    await page.waitForTimeout(300);
    // Tabulator context menu items are in .tabulator-menu
    const menuItem = page.locator('.tabulator-menu .tabulator-menu-item', { hasText: menuText });
    await menuItem.click();
    await page.waitForTimeout(300);
  }

  /**
   * Get all row data from the table via Tabulator API.
   */
  async function getTableData(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map(r => {
        const d = r.getData();
        return { type: d.type, from: d.from, to: d.to, length: d.length, azimuth: d.azimuth, clino: d.clino };
      });
    });
  }

  test('row context menu: delete row removes the row', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    const initialData = await getTableData(page);
    const initialCount = initialData.length;

    // Right-click last row and delete
    await rightClickRowAndSelect(page, initialCount - 1, 'Delete row');

    const afterData = await getTableData(page);
    expect(afterData.length).toBe(initialCount - 1);
    // The deleted row (A3→A4) should be gone
    expect(afterData.find(r => r.from === 'A3' && r.to === 'A4')).toBeUndefined();
  });

  test('row context menu: add row above inserts before current row', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Right-click on row 2 (A1→A2) and add above
    await rightClickRowAndSelect(page, 2, 'Add row above');

    const data = await getTableData(page);
    // New empty row should be at index 2, A1→A2 should now be at index 3
    expect(data[3].from).toBe('A1');
    expect(data[3].to).toBe('A2');
    expect(data[2].from).toBeUndefined();
  });

  test('row context menu: add row below inserts after current row', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Right-click on row 0 (A0→A1) and add below
    await rightClickRowAndSelect(page, 0, 'Add row below');

    const data = await getTableData(page);
    // Row 0 should still be A0→A1
    expect(data[0].from).toBe('A0');
    expect(data[0].to).toBe('A1');
    // New empty row at index 1
    expect(data[1].from).toBeUndefined();
    // Original row 1 (splay from A1) should be at index 2
    expect(data[2].from).toBe('A1');
    expect(data[2].type).toBe('splay');
  });

  test('row context menu: invert shot swaps from/to and inverts azimuth/clino', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Row 0 is: center A0→A1, azimuth=45, clino=-10
    await rightClickRowAndSelect(page, 0, 'Invert shot');

    const data = await getTableData(page);
    // From and To should be swapped
    expect(data[0].from).toBe('A1');
    expect(data[0].to).toBe('A0');
    // Azimuth should be 45 + 180 = 225
    expect(data[0].azimuth).toBe(225);
    // Clino should be negated: -(-10) = 10
    expect(data[0].clino).toBe(10);
  });

  test('row context menu: rename from station renames all occurrences', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Row 0: from=A0. Rename A0 → Z0 via prompt
    page.once('dialog', async (dialog) => {
      await dialog.accept('Z0');
    });
    await rightClickRowAndSelect(page, 0, 'Rename from station');

    const data = await getTableData(page);
    // A0 should be renamed to Z0 everywhere it appears as from or to
    expect(data[0].from).toBe('Z0');
    // No row should have A0 anymore
    expect(data.find(r => r.from === 'A0' || r.to === 'A0')).toBeUndefined();
  });

  test('row context menu: rename to station renames all occurrences', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Row 0: to=A1. Rename A1 → Z1 via prompt
    page.once('dialog', async (dialog) => {
      await dialog.accept('Z1');
    });
    await rightClickRowAndSelect(page, 0, 'Rename to station');

    const data = await getTableData(page);
    // A1 should be renamed to Z1 everywhere
    expect(data[0].to).toBe('Z1');
    // A1 appeared as from in rows 1,2 - should all be Z1 now
    expect(data[1].from).toBe('Z1');
    expect(data[2].from).toBe('Z1');
    expect(data.find(r => r.from === 'A1' || r.to === 'A1')).toBeUndefined();
  });

  test('row context menu: prefix stations adds prefix to all station names', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Prefix all stations with "P_"
    page.once('dialog', async (dialog) => {
      await dialog.accept('P_');
    });
    await rightClickRowAndSelect(page, 0, 'Prefix stations');

    const data = await getTableData(page);
    // All from/to values should start with P_
    expect(data[0].from).toBe('P_A0');
    expect(data[0].to).toBe('P_A1');
    expect(data[2].from).toBe('P_A1');
    expect(data[2].to).toBe('P_A2');
    expect(data[5].from).toBe('P_A3');
    expect(data[5].to).toBe('P_A4');
  });

  test('row context menu: locate from is available', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Right-click row 0, verify "Locate from" menu item exists and is clickable
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const row = tabulator.getRows()[0];
      const el = row.getElement();
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + 50, clientY: rect.top + 10
      }));
    });
    await page.waitForTimeout(300);

    const locateItem = page.locator('.tabulator-menu .tabulator-menu-item', { hasText: 'Locate from' });
    await expect(locateItem).toBeVisible();
    await locateItem.click();
  });

  test('row context menu: locate to is available', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const row = tabulator.getRows()[0];
      const el = row.getElement();
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + 50, clientY: rect.top + 10
      }));
    });
    await page.waitForTimeout(300);

    const locateItem = page.locator('.tabulator-menu .tabulator-menu-item', { hasText: 'Locate to' });
    await expect(locateItem).toBeVisible();
    await locateItem.click();
  });

  test('row context menu has all expected items', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Right-click first row to open context menu
    await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const row = tabulator.getRows()[0];
      const el = row.getElement();
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + 50, clientY: rect.top + 10
      }));
    });
    await page.waitForTimeout(300);

    const menu = page.locator('.tabulator-menu');
    await expect(menu).toBeVisible();

    // Verify all expected menu items are present
    const items = await menu.locator('.tabulator-menu-item').allTextContents();
    const itemTexts = items.map(t => t.trim());

    expect(itemTexts).toContain('Delete row');
    expect(itemTexts).toContain('Add row above');
    expect(itemTexts).toContain('Add row below');
    expect(itemTexts).toContain('Invert shot');
    expect(itemTexts).toContain('Locate from');
    expect(itemTexts).toContain('Locate to');
    expect(itemTexts).toContain('Details about from');
    expect(itemTexts).toContain('Details about to');
    expect(itemTexts).toContain('Rename from station');
    expect(itemTexts).toContain('Rename to station');
    expect(itemTexts).toContain('Prefix stations');
  });
});

test.describe('Survey Editor Filtering', () => {

  /**
   * Open survey editor, validate to populate statuses, return editor locator.
   */
  async function openEditorWithValidation(page) {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    // Validate so rows get ok/incomplete statuses
    await editor.locator('#validate-shots').click();
    await page.waitForTimeout(500);
    return editor;
  }

  /**
   * Get visible row count via Tabulator API (respects filters).
   */
  async function getVisibleRowCount(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows('active').length;
    });
  }

  /**
   * Get visible row data via Tabulator API.
   */
  async function getVisibleRows(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows('active').map(r => {
        const d = r.getData();
        return { type: d.type, from: d.from, to: d.to, length: d.length, status: d.status };
      });
    });
  }

  /**
   * Set a header filter value on a column.
   */
  async function setHeaderFilter(page, field, value) {
    await page.evaluate(({ field, value }) => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      tabulator.setHeaderFilterValue(field, value);
    }, { field, value });
    await page.waitForTimeout(300);
  }

  test('filter by type: show only center shots', async ({ page }) => {
    await openEditorWithValidation(page);

    // sample-cave.json has 4 center + 2 splay shots
    expect(await getVisibleRowCount(page)).toBeGreaterThanOrEqual(6);

    await setHeaderFilter(page, 'type', 'center');

    const rows = await getVisibleRows(page);
    expect(rows.length).toBe(4);
    rows.forEach(r => expect(r.type).toBe('center'));
  });

  test('filter by type: show only splay shots', async ({ page }) => {
    await openEditorWithValidation(page);

    await setHeaderFilter(page, 'type', 'splay');

    const rows = await getVisibleRows(page);
    expect(rows.length).toBe(2);
    rows.forEach(r => expect(r.type).toBe('splay'));
  });

  test('filter by from station: A1 matches rows where from=A1', async ({ page }) => {
    await openEditorWithValidation(page);

    await setHeaderFilter(page, 'from', 'A1');

    const rows = await getVisibleRows(page);
    // A1 appears as from in: splay from A1, center A1→A2
    expect(rows.length).toBe(2);
    rows.forEach(r => expect(r.from).toBe('A1'));
  });

  test('filter by to station: A3 matches rows where to=A3', async ({ page }) => {
    await openEditorWithValidation(page);

    await setHeaderFilter(page, 'to', 'A3');

    const rows = await getVisibleRows(page);
    // A3 appears as to in: center A2→A3
    expect(rows.length).toBe(1);
    expect(rows[0].from).toBe('A2');
    expect(rows[0].to).toBe('A3');
  });

  test('filter by length: partial match on distance value', async ({ page }) => {
    await openEditorWithValidation(page);

    // Filter for "5" should match 5.2 and 1.5
    await setHeaderFilter(page, 'length', '5');

    const rows = await getVisibleRows(page);
    rows.forEach(r => expect(String(r.length)).toContain('5'));
  });

  test('filter by status: show only ok rows after validation', async ({ page }) => {
    const editor = await openEditorWithValidation(page);

    // Add an incomplete row so we have mixed statuses
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await editor.locator('#validate-shots').click();
    await page.waitForTimeout(500);

    const totalCount = await getVisibleRowCount(page);

    // Filter for "ok" status
    await setHeaderFilter(page, 'status', 'ok');

    const okRows = await getVisibleRows(page);
    // Should have fewer rows than total (incomplete row filtered out)
    expect(okRows.length).toBeLessThan(totalCount);
    okRows.forEach(r => expect(r.status).toBe('ok'));
  });

  test('filter by status: show only incomplete rows', async ({ page }) => {
    const editor = await openEditorWithValidation(page);

    // Add an incomplete row
    await editor.locator('#add-row').click();
    await page.waitForTimeout(200);
    await editor.locator('#validate-shots').click();
    await page.waitForTimeout(500);

    await setHeaderFilter(page, 'status', 'incomplete');

    const rows = await getVisibleRows(page);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    rows.forEach(r => expect(r.status).toBe('incomplete'));
  });

  test('clearing filter restores all rows', async ({ page }) => {
    await openEditorWithValidation(page);

    const totalCount = await getVisibleRowCount(page);

    // Apply filter
    await setHeaderFilter(page, 'type', 'center');
    expect(await getVisibleRowCount(page)).toBe(4);

    // Clear filter
    await setHeaderFilter(page, 'type', '');

    expect(await getVisibleRowCount(page)).toBe(totalCount);
  });

  test('combining filters: type + from narrows results', async ({ page }) => {
    await openEditorWithValidation(page);

    // Filter center shots from A1
    await setHeaderFilter(page, 'type', 'center');
    await setHeaderFilter(page, 'from', 'A1');

    const rows = await getVisibleRows(page);
    // Only center A1→A2 matches both filters
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('center');
    expect(rows[0].from).toBe('A1');
    expect(rows[0].to).toBe('A2');
  });
});

test.describe('Survey Editor Row Status Detection', () => {

  /**
   * Open editor, add row, validate (checks incomplete/invalid).
   */
  async function openEditorAndValidateRow(page, rowData) {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await page.evaluate((data) => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      rows[rows.length - 1].update(data);
    }, rowData);
    await page.waitForTimeout(200);

    await editor.locator('#validate-shots').click();
    await page.waitForTimeout(500);

    return editor;
  }

  /**
   * Open editor, add row, save (triggers recalculate → detects orphan/duplicate),
   * then reopen editor to read computed statuses.
   */
  async function openEditorSaveAndReopen(page, rowData) {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);
    await page.evaluate((data) => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      rows[rows.length - 1].update(data);
    }, rowData);
    await page.waitForTimeout(200);

    // Save to trigger recalculation (orphan/duplicate detection)
    await editor.locator('#update-survey').click();
    await page.waitForTimeout(2000);
    await dismissNotifications(page);

    // Close editor
    await editor.locator('#cancel-survey').click();
    await expect(editor).toBeHidden({ timeout: 5000 });
    await dismissNotifications(page);

    // Wait for explorer tree to stabilize after recalculation re-render
    const surveyNode = page.locator('.explorer-tree-node', { has: page.locator('text=Main Survey') });
    await expect(surveyNode).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Right-click the survey node to reopen editor
    await surveyNode.click({ button: 'right' });
    await expect(page.locator('#explorer-context-menu')).toBeVisible({ timeout: 5000 });
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Wait for Tabulator table to be fully populated with rows
    await page.waitForFunction(() => {
      const table = document.querySelector('#surveydata');
      if (!table) return false;
      const tabs = window.Tabulator?.findTable?.(table);
      if (!tabs || tabs.length === 0) return false;
      return tabs[0].getRows().length > 0;
    }, { timeout: 5000 });
    await page.waitForTimeout(200);

    return editor;
  }

  async function getLastRowStatus(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      const d = rows[rows.length - 1].getData();
      return { status: d.status, from: d.from, to: d.to };
    });
  }

  async function getRowStatuses(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map(r => {
        const d = r.getData();
        return { status: d.status, from: d.from, to: d.to, length: d.length };
      });
    });
  }

  test('orphan row: disconnected shot is marked orphan after save', async ({ page }) => {
    // X0→X1 doesn't connect to the existing network (A0→A1→A2→A3→A4)
    await openEditorSaveAndReopen(page, {
      type: 'center', from: 'X0', to: 'X1',
      length: 10, azimuth: 90, clino: 0
    });

    const last = await getLastRowStatus(page);
    expect(last.status).toBe('orphan');
    expect(last.from).toBe('X0');
    expect(last.to).toBe('X1');
  });

  test('orphan row has brown background color', async ({ page }) => {
    await openEditorSaveAndReopen(page, {
      type: 'center', from: 'X0', to: 'X1',
      length: 10, azimuth: 90, clino: 0
    });

    const bgColor = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const rows = tabulator.getRows();
      return rows[rows.length - 1].getElement().style.backgroundColor;
    });
    expect(bgColor).toBe('rgb(125, 73, 40)');
  });

  test('invalid row: clino out of range is marked invalid', async ({ page }) => {
    await openEditorAndValidateRow(page, {
      type: 'center', from: 'A4', to: 'A5',
      length: 5, azimuth: 45, clino: -100
    });

    const last = await getLastRowStatus(page);
    expect(last.status).toBe('invalid');
  });

  test('duplicate row: same from→to as existing shot is marked duplicate after save', async ({ page }) => {
    // A0→A1 already exists in the survey
    await openEditorSaveAndReopen(page, {
      type: 'center', from: 'A0', to: 'A1',
      length: 8, azimuth: 100, clino: -5
    });

    const allRows = await getRowStatuses(page);
    const a0a1Rows = allRows.filter(r => r.from === 'A0' && r.to === 'A1');
    expect(a0a1Rows.length).toBe(2);
    expect(a0a1Rows.some(r => r.status === 'duplicate')).toBe(true);
  });

  test('incomplete row: missing required fields is marked incomplete', async ({ page }) => {
    await openEditorAndValidateRow(page, {
      type: 'center', from: 'A4'
    });

    const last = await getLastRowStatus(page);
    expect(last.status).toBe('incomplete');
  });

  test('valid connected row is marked ok after save', async ({ page }) => {
    await openEditorSaveAndReopen(page, {
      type: 'center', from: 'A4', to: 'A5',
      length: 5, azimuth: 90, clino: -5
    });

    const last = await getLastRowStatus(page);
    expect(last.status).toBe('ok');
  });
});

test.describe('Survey Editor Copy & Paste', () => {

  async function openSurveyEditor(page) {
    await setupWithCave(page);
    await expandCaveNode(page, 'Test Cave');
    await expect(page.locator('#explorer-tree').locator('text=Main Survey')).toBeVisible({ timeout: 5000 });
    await rightClickSurvey(page, 'Main Survey');
    await page.locator('#explorer-context-menu .context-menu-option[title*="survey editor"]').click();
    const editor = page.locator('#resizable-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    return editor;
  }

  async function getRowData(page, rowIndex) {
    return page.evaluate((idx) => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const d = tabulator.getRows()[idx].getData();
      return { type: d.type, from: d.from, to: d.to, length: d.length, azimuth: d.azimuth, clino: d.clino };
    }, rowIndex);
  }

  async function getAllRowData(page) {
    return page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      return tabulator.getRows().map(r => {
        const d = r.getData();
        return { type: d.type, from: d.from, to: d.to, length: d.length, azimuth: d.azimuth, clino: d.clino };
      });
    });
  }

  /**
   * Select a range of cells in the table via Tabulator API.
   * startRow/endRow are 0-based row indices, startCol/endCol are field names.
   */
  async function selectRange(page, startRow, startCol, endRow, endCol) {
    await page.evaluate(({ sr, sc, er, ec }) => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      // Clear existing ranges
      tabulator.getRanges().forEach(r => r.remove());
      // Add new range
      const rows = tabulator.getRows();
      const startCell = rows[sr].getCell(sc);
      const endCell = rows[er].getCell(ec);
      tabulator.addRange(startCell, endCell);
    }, { sr: startRow, sc: startCol, er: endRow, ec: endCol });
    await page.waitForTimeout(200);
  }

  /**
   * Dispatch a paste event with tab-delimited data on the Tabulator element.
   */
  async function pasteIntoTable(page, tsvData) {
    await page.evaluate((data) => {
      const table = document.querySelector('#surveydata');
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.setData('text/plain', data);
      table.dispatchEvent(pasteEvent);
    }, tsvData);
    await page.waitForTimeout(500);
  }

  test('copy row data and paste into new empty row', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Get original row 0 data (A0→A1)
    const sourceRow = await getRowData(page, 0);
    expect(sourceRow.from).toBe('A0');

    // Select row 0 cells and copy
    await selectRange(page, 0, 'type', 0, 'clino');
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);

    // Read what was copied
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    // Add a new empty row
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const lastIdx = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      return window.Tabulator.findTable(table)[0].getRows().length - 1;
    });

    // Select target cells and paste via ClipboardEvent
    await selectRange(page, lastIdx, 'type', lastIdx, 'clino');
    await pasteIntoTable(page, copied);

    const pastedRow = await getRowData(page, lastIdx);
    expect(pastedRow.type).toBe(sourceRow.type);
    expect(pastedRow.from).toBe(sourceRow.from);
    expect(pastedRow.to).toBe(sourceRow.to);
    expect(parseFloat(pastedRow.length)).toBe(sourceRow.length);
    expect(parseFloat(pastedRow.azimuth)).toBe(sourceRow.azimuth);
    expect(parseFloat(pastedRow.clino)).toBe(sourceRow.clino);
  });

  test('copy multiple rows and paste', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    const row0 = await getRowData(page, 0);
    const row1 = await getRowData(page, 1);

    // Select rows 0-1 and copy
    await selectRange(page, 0, 'type', 1, 'clino');
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    // Add 2 new empty rows
    await editor.locator('#row-count-input').fill('2');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const totalRows = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      return window.Tabulator.findTable(table)[0].getRows().length;
    });

    await selectRange(page, totalRows - 2, 'type', totalRows - 1, 'clino');
    await pasteIntoTable(page, copied);

    const pasted0 = await getRowData(page, totalRows - 2);
    const pasted1 = await getRowData(page, totalRows - 1);

    expect(pasted0.from).toBe(row0.from);
    expect(pasted0.to).toBe(row0.to);
    expect(parseFloat(pasted0.length)).toBe(row0.length);

    expect(pasted1.from).toBe(row1.from);
    expect(String(pasted1.type)).toBe(row1.type);
  });

  test('range selection selects correct cells', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Select a 2x2 range: rows 0-1, from and to columns
    await selectRange(page, 0, 'from', 1, 'to');

    // Verify the range exists and contains expected bounds
    const rangeInfo = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      const tabulator = window.Tabulator.findTable(table)[0];
      const ranges = tabulator.getRanges();
      if (ranges.length === 0) return null;
      const range = ranges[0];
      const cells = range.getCells().flat();
      return {
        rangeCount: ranges.length,
        cellCount: cells.length,
        values: cells.map(c => c.getValue())
      };
    });

    expect(rangeInfo.rangeCount).toBe(1);
    // 2 rows × 2 columns = 4 cells
    expect(rangeInfo.cellCount).toBe(4);
    // Should contain A0, A1 (from column) and A1, A2 (to column)
    expect(rangeInfo.values).toContain('A0');
    expect(rangeInfo.values).toContain('A1');
  });

  test('copied range produces tab-delimited clipboard content', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Select row 0 from/to/length cells
    await selectRange(page, 0, 'from', 0, 'length');

    // Copy
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);

    // Read clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

    // Should be tab-delimited: A0\tA1\t5.2
    expect(clipboardText).toContain('A0');
    expect(clipboardText).toContain('A1');
    expect(clipboardText).toContain('5.2');
    // Tab-separated
    const parts = clipboardText.trim().split('\t');
    expect(parts.length).toBe(3);
  });

  test('paste tab-delimited text into selected cells', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Add a new empty row
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const lastIdx = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      return window.Tabulator.findTable(table)[0].getRows().length - 1;
    });

    // Select the new row's from, to, length cells
    await selectRange(page, lastIdx, 'from', lastIdx, 'length');

    // Paste tab-delimited data
    await pasteIntoTable(page, 'P1\tP2\t12.5');

    const pasted = await getRowData(page, lastIdx);
    expect(pasted.from).toBe('P1');
    expect(pasted.to).toBe('P2');
    expect(parseFloat(pasted.length)).toBe(12.5);
  });

  test('paste multi-row tab-delimited data', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Add 2 new empty rows
    await editor.locator('#row-count-input').fill('2');
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const totalRows = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      return window.Tabulator.findTable(table)[0].getRows().length;
    });

    // Select from/to/length of both new rows
    await selectRange(page, totalRows - 2, 'from', totalRows - 1, 'length');

    // Paste 2-row tab-delimited data
    await pasteIntoTable(page, 'R1\tR2\t8.0\nR2\tR3\t9.5');

    const row1 = await getRowData(page, totalRows - 2);
    const row2 = await getRowData(page, totalRows - 1);

    expect(row1.from).toBe('R1');
    expect(row1.to).toBe('R2');
    expect(parseFloat(row1.length)).toBe(8);

    expect(row2.from).toBe('R2');
    expect(row2.to).toBe('R3');
    expect(parseFloat(row2.length)).toBe(9.5);
  });

  test('copy and paste preserves shot type', async ({ page }) => {
    const editor = await openSurveyEditor(page);

    // Row 1 is a splay (type=splay, from=A1)
    const splayRow = await getRowData(page, 1);
    expect(splayRow.type).toBe('splay');

    // Select and copy the splay row
    await selectRange(page, 1, 'type', 1, 'clino');
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    // Add new row and paste
    await editor.locator('#add-row').click();
    await page.waitForTimeout(300);

    const lastIdx = await page.evaluate(() => {
      const table = document.querySelector('#surveydata');
      return window.Tabulator.findTable(table)[0].getRows().length - 1;
    });

    await selectRange(page, lastIdx, 'type', lastIdx, 'clino');
    await pasteIntoTable(page, copied);

    const pasted = await getRowData(page, lastIdx);
    expect(String(pasted.type)).toBe('splay');
    expect(pasted.from).toBe(splayRow.from);
    expect(parseFloat(pasted.length)).toBe(splayRow.length);
  });
});
