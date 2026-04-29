import { describe, it, expect, vi } from 'vitest';

// ─── Mocks (must come before dynamic imports) ────────────────────────────────

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key, _params) => key }
}));

vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel   : vi.fn(),
  showWarningPanel : vi.fn(),
  showInfoPanel    : vi.fn()
}));

vi.mock('../../src/ui/coordinate-system-dialog.js', () => ({
  CoordinateSystemDialog : class {
    async show() {
      return { coordinateSystem: undefined, coordinates: [] };
    }
  }
}));

vi.mock('../../src/ui/encoding-selection-dialog.js', () => ({
  EncodingSelectionDialog : class {
    async show() {
      return { encoding: 'utf8' };
    }
  }
}));

vi.mock('../../src/utils/global-coordinate-normalizer.js', () => ({
  globalNormalizer : {
    isInitialized          : () => false,
    initializeGlobalOrigin : vi.fn(),
    getNormalizedVector    : (c) => c
  }
}));

vi.mock('three', () => ({}));
vi.mock('three/addons/loaders/PLYLoader.js', () => ({ PLYLoader: class {} }));
vi.mock('three/addons/loaders/OBJLoader.js', () => ({ OBJLoader: class {} }));

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────

const { TopodroidImporter } = await import('../../src/io/import.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeImporter() {
  return new TopodroidImporter(null, null, null, null);
}

function buildCsv({ unitsLine } = {}) {
  const lines = [
    '# name: Imperial Survey',
    '# date: 2024-06-01',
    '# team: Joe',
    '# declination: 0'
  ];
  if (unitsLine) lines.push(unitsLine);
  lines.push('# from to tape compass clino extend flags');
  lines.push('A0@Imperial_Survey,A1@Imperial_Survey,5.2,45,-10,,,');
  lines.push('A1@Imperial_Survey,A2@Imperial_Survey,3.8,120,-5,,,');
  return lines.join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TopodroidImporter — # units line', () => {

  it('defaults to meters/degrees when no units line is present', () => {
    const importer = makeImporter();
    const { survey } = importer.getSurvey(buildCsv());
    expect(survey.units).toEqual({ length: 'meters', angle: 'degrees' });
  });

  it('parses "tape meter compass clino degree" as meters/degrees', () => {
    const importer = makeImporter();
    const { survey } = importer.getSurvey(buildCsv({ unitsLine: '# units: tape meter compass clino degree' }));
    expect(survey.units).toEqual({ length: 'meters', angle: 'degrees' });
  });

  it('parses "tape feet compass clino degree" as feet/degrees', () => {
    const importer = makeImporter();
    const { survey } = importer.getSurvey(buildCsv({ unitsLine: '# units: tape feet compass clino degree' }));
    expect(survey.units).toEqual({ length: 'feet', angle: 'degrees' });
  });

  it('parses "tape meter compass clino grad" as meters/grads', () => {
    const importer = makeImporter();
    const { survey } = importer.getSurvey(buildCsv({ unitsLine: '# units: tape meter compass clino grad' }));
    expect(survey.units).toEqual({ length: 'meters', angle: 'grads' });
  });

  it('parses both units imperial: feet + grads', () => {
    const importer = makeImporter();
    const { survey } = importer.getSurvey(buildCsv({ unitsLine: '# units: tape feet compass clino grad' }));
    expect(survey.units).toEqual({ length: 'feet', angle: 'grads' });
  });

  it('accepts plural / abbreviation tokens (meters, ft, gons)', () => {
    const importer = makeImporter();
    const { survey: s1 } = importer.getSurvey(buildCsv({ unitsLine: '# units: tape ft compass clino gons' }));
    expect(s1.units).toEqual({ length: 'feet', angle: 'grads' });
    const { survey: s2 } = importer.getSurvey(buildCsv({ unitsLine: '# units: tape meters compass clino degrees' }));
    expect(s2.units).toEqual({ length: 'meters', angle: 'degrees' });
  });

  it('keeps shot values verbatim (no conversion is applied during import)', () => {
    const importer = makeImporter();
    const { survey } = importer.getSurvey(buildCsv({ unitsLine: '# units: tape feet compass clino degree' }));
    // First shot in fixture is 5.2 / 45 / -10 — those values must be preserved as-is,
    // since the survey now declares its units to be feet/degrees.
    expect(survey.shots[0].length).toBe(5.2);
    expect(survey.shots[0].azimuth).toBe(45);
    expect(survey.shots[0].clino).toBe(-10);
  });

  it('falls back to defaults when units string is unrecognized', () => {
    const importer = makeImporter();
    const { survey } = importer.getSurvey(buildCsv({ unitsLine: '# units: weird stuff here' }));
    expect(survey.units).toEqual({ length: 'meters', angle: 'degrees' });
  });
});
