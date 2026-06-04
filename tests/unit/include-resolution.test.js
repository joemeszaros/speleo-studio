import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/i18n/i18n.js', () => ({ i18n: { t: (k) => k } }));
vi.mock('../../src/ui/popups.js', () => ({ showErrorPanel: vi.fn(), showWarningPanel: vi.fn(), showInfoPanel: vi.fn() }));

const { normalizeRelativePath, findRootFile, flattenFile } = await import('../../src/io/cave-survey-helpers.js');

// Therion-flavoured options (matches THERION_OPTS in therion-importer.js).
const TH = {
  commentChar    : '#',
  stripStarPrefix: false,
  includeKeyword : 'input',
  countPattern   : /^\s*input\b/gim,
  skipExtensions : ['.th2', '.thm'],
  defaultExt     : '.th'
};

describe('normalizeRelativePath', () => {
  it('resolves a path against the including file directory', () => {
    expect(normalizeRelativePath('a/b', 'c/d.th')).toBe('a/b/c/d.th');
  });
  it('collapses "." and ".." segments', () => {
    expect(normalizeRelativePath('a/b', './c.th')).toBe('a/b/c.th');
    expect(normalizeRelativePath('a/b', '../c.th')).toBe('a/c.th');
    expect(normalizeRelativePath('a/b/c', '../../d.th')).toBe('a/d.th');
  });
  it('handles an empty base directory (root-level file)', () => {
    expect(normalizeRelativePath('', 'sub/x.th')).toBe('sub/x.th');
  });
  it('normalizes backslashes', () => {
    expect(normalizeRelativePath('a\\b', 'c\\d.th')).toBe('a/b/c/d.th');
  });
});

describe('findRootFile', () => {
  it('returns the only file when the map has one entry', () => {
    const tm = new Map([['only.th', 'survey only\nendsurvey']]);
    expect(findRootFile(tm, TH)).toBe('only.th');
  });

  it('picks the file that is not referenced by any input directive', () => {
    const tm = new Map([
      ['root.th', 'survey r\n  input "a.th"\n  input "b.th"\nendsurvey'],
      ['a.th', 'survey a\nendsurvey'],
      ['b.th', 'survey b\nendsurvey']
    ]);
    expect(findRootFile(tm, TH)).toBe('root.th');
  });

  it('does NOT exclude a root that shares a basename with a deeper included file', () => {
    // Regression: ubend/ubend.th inputs 2000/ubend/ubend.th — both basename ubend.th.
    // Basename-only exclusion wrongly dropped the real root; full-path resolution keeps it.
    const tm = new Map([
      ['ubend/ubend.th', 'survey ubend\n  input "2000/ubend/ubend.th"\nendsurvey'],
      ['ubend/2000/ubend/ubend.th', 'survey inner\nendsurvey']
    ]);
    expect(findRootFile(tm, TH)).toBe('ubend/ubend.th');
  });

  it('falls back to basename exclusion when includes cannot be resolved to a key', () => {
    // Flat multi-file selection: keys are basenames, includes reference basenames.
    const tm = new Map([
      ['root.th', 'survey r\n  input "child.th"\nendsurvey'],
      ['child.th', 'survey c\nendsurvey']
    ]);
    expect(findRootFile(tm, TH)).toBe('root.th');
  });
});

describe('flattenFile (directory-aware include expansion)', () => {
  it('expands cross-folder relative includes (./ and bare, with default extension)', () => {
    const tm = new Map([
      ['proj/sys.th', 'survey sys\n  input "./caves/a.th"\n  input "caves/b"\nendsurvey'],
      ['proj/caves/a.th', 'survey a\n  centreline\n    1 2 5 0 0\n  endcentreline\nendsurvey'],
      ['proj/caves/b.th', 'survey b\n  centreline\n    1 2 5 90 0\n  endcentreline\nendsurvey']
    ]);
    const unresolved = [];
    const lines = flattenFile('proj/sys.th', tm, new Set(), unresolved, TH);
    const surveyNames = lines.filter((t) => t[0] === 'survey').map((t) => t[1]);
    expect(surveyNames).toEqual(['sys', 'a', 'b']);
    expect(unresolved).toEqual([]);
  });

  it('records unresolved includes (and skips drawing-file extensions silently)', () => {
    const tm = new Map([
      ['root.th', 'survey r\n  input "missing.th"\n  input "drawing.th2"\nendsurvey']
    ]);
    const unresolved = [];
    flattenFile('root.th', tm, new Set(), unresolved, TH);
    expect(unresolved).toContain('missing.th');
    expect(unresolved.some((u) => u.includes('.th2'))).toBe(false);
  });

  it('does not loop on cyclic includes', () => {
    const tm = new Map([
      ['a.th', 'survey a\n  input "b.th"\nendsurvey'],
      ['b.th', 'survey b\n  input "a.th"\nendsurvey']
    ]);
    const lines = flattenFile('a.th', tm, new Set(), [], TH);
    // each file expanded once
    expect(lines.filter((t) => t[0] === 'survey').map((t) => t[1])).toEqual(['a', 'b']);
  });
});
