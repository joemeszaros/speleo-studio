import { describe, it, expect } from 'vitest';
import { Cave } from '../../src/model/cave.js';
import { SurveyHelper } from '../../src/survey.js';
import { MeridianConvergence } from '../../src/utils/geo.js';

const ATTR_DEFS = { schemaVersion: 6 };

// UTM 34N fix point in Hungary; its convergence is roughly -1.48 degrees.
const GEO_DATA = {
  coordinateSystem : { type: 'utm', epsgId: 32634, name: 'UTM', zoneNum: 34, northern: true },
  coordinates      : [
    { name: 'A1', coordinate: { easting: 319076.067, northing: 4696334.035, elevation: 1341.41, type: 'utm' } }
  ]
};
// A fix point one UTM zone over, to prove the value follows the coordinates.
const OTHER_GEO_DATA = {
  coordinateSystem : { type: 'utm', epsgId: 32633, name: 'UTM', zoneNum: 33, northern: true },
  coordinates      : [
    { name: 'A1', coordinate: { easting: 500000, northing: 4696334.035, elevation: 100, type: 'utm' } }
  ]
};
const derive = (gd) =>
  MeridianConvergence.fromGeoData({
    coordinateSystem : gd.coordinateSystem,
    coordinates      : [{ coordinate: gd.coordinates[0].coordinate }]
  });
const EXPECTED = derive(GEO_DATA);

const leg = (from, to, azimuth) => ({ type: 'center', from, to, length: 10, azimuth, clino: 0, comment: '' });

// `geoData: null` means "not georeferenced" (passing undefined would select the default).
// The fixtures are deep-cloned because Cave.fromPure mutates the object it is handed.
const pureCave = ({ surveys, geoData = GEO_DATA, readOnly = false } = {}) => ({
  name       : 'test-cave',
  geoData    : geoData === null ? undefined : structuredClone(geoData),
  surveys    : structuredClone(surveys),
  attributes : {},
  readOnly
});

const survey = (name, convergence, shots = [leg('A1', 'A2', 0)]) => ({
  name,
  start    : 'A1',
  metadata : { declination: 5, convergence },
  shots
});

const load = (opts) => Cave.fromPure(pureCave(opts), ATTR_DEFS);

describe('meridian convergence is derived from the cave, never stored', () => {

  describe('getConvergence', () => {

    it('derives the value from the cave geoData', () => {
      expect(load({ surveys: [survey('S1', undefined)] }).getConvergence()).toBeCloseTo(EXPECTED, 12);
    });

    it('ignores whatever a survey happens to carry', () => {
      expect(load({ surveys: [survey('S1', 42), survey('S2', -99)] }).getConvergence()).toBeCloseTo(EXPECTED, 12);
    });

    it('is undefined for a cave that is not georeferenced', () => {
      expect(load({ surveys: [survey('S1', -2.5)], geoData: null }).getConvergence()).toBeUndefined();
    });

    it('is undefined for a read-only .3d cave, whose bearings are already grid bearings', () => {
      expect(load({ surveys: [survey('S1', null)], readOnly: true }).getConvergence()).toBeUndefined();
    });

    // The cave sheet previews the value while the coordinates are still being typed.
    it('is undefined for a half-typed coordinate, rather than NaN', () => {
      const halfTyped = structuredClone(GEO_DATA);
      halfTyped.coordinates[0].coordinate.northing = NaN;
      expect(load({ surveys: [survey('S1', undefined)], geoData: halfTyped }).getConvergence()).toBeUndefined();
    });

    // The whole point of deriving: there is no second copy that can drift from the fix point.
    it('follows the coordinates when they change, with nothing to refresh', () => {
      const cave = load({ surveys: [survey('S1', undefined)] });
      const before = cave.getConvergence();
      cave.geoData.coordinateSystem.zoneNum = OTHER_GEO_DATA.coordinateSystem.zoneNum;
      cave.geoData.coordinates[0].coordinate.easting = OTHER_GEO_DATA.coordinates[0].coordinate.easting;
      expect(cave.getConvergence()).not.toBeCloseTo(before, 6);
      expect(cave.getConvergence()).toBeCloseTo(derive(OTHER_GEO_DATA), 12);
    });

  });

  describe('serialization', () => {

    it('does not persist the derived value on the cave', () => {
      const exported = load({ surveys: [survey('S1', undefined)] }).toExport();
      expect('convergence' in exported).toBe(false);
    });

    it('leaves the cave format version untouched', () => {
      expect(load({ surveys: [survey('S1', undefined)] }).toExport().version).toBe(1);
    });

    it('mirrors the value onto every survey so an older build reads the same geometry', () => {
      const cave = load({ surveys: [survey('S1', undefined), survey('S2', 42)] });
      const exported = cave.toExport();
      expect(exported.surveys.map((s) => s.metadata.convergence)).toEqual([cave.getConvergence(), cave.getConvergence()]);
    });

    it('mirrors null for a cave with no convergence, so an older build applies none either', () => {
      const cave = load({ surveys: [survey('S1', 42)], geoData: null });
      expect(cave.toExport().surveys[0].metadata.convergence).toBeNull();
    });

  });

  // The count lives on the cave it describes — like Survey.orphanShotIds — so nothing has to be
  // drained from shared state and loading one cave cannot affect what another reports.
  describe('correctedConvergenceSurveys', () => {

    it('counts the surveys whose stored value differed', () => {
      const cave = load({ surveys: [survey('S1', EXPECTED), survey('S2', undefined), survey('S3', undefined)] });
      expect(cave.correctedConvergenceSurveys).toBe(2);
    });

    it('counts the whole cave when no survey had a value at all', () => {
      expect(load({ surveys: [survey('S1', undefined), survey('S2', undefined)] }).correctedConvergenceSurveys).toBe(2);
    });

    it('is zero when every survey already agreed', () => {
      expect(load({ surveys: [survey('S1', EXPECTED), survey('S2', EXPECTED)] }).correctedConvergenceSurveys).toBe(0);
    });

    it('tolerates a last-bit difference from a value an earlier build computed', () => {
      const cave = load({ surveys: [survey('S1', EXPECTED + 1e-11), survey('S2', EXPECTED - 1e-11)] });
      expect(cave.correctedConvergenceSurveys).toBe(0);
    });

    it('is zero for a cave that is not georeferenced and had no value', () => {
      expect(load({ surveys: [survey('S1', undefined)], geoData: null }).correctedConvergenceSurveys).toBe(0);
    });

    it('is zero for a read-only cave', () => {
      expect(load({ surveys: [survey('S1', null)], readOnly: true }).correctedConvergenceSurveys).toBe(0);
    });

    it('is never serialized', () => {
      const cave = load({ surveys: [survey('S1', undefined)] });
      expect(cave.correctedConvergenceSurveys).toBe(1);
      expect('correctedConvergenceSurveys' in cave.toExport()).toBe(false);
    });

    // No stored flag marks the cave as corrected: saving rewrites the mirrors, and reloading
    // that project then finds nothing that differs. This is what keeps the warning from nagging.
    it('goes back to zero once the project has been saved', () => {
      const exported = load({ surveys: [survey('S1', undefined), survey('S2', undefined)] }).toExport();
      expect(Cave.fromPure({ ...exported, attributes: {} }, ATTR_DEFS).correctedConvergenceSurveys).toBe(0);
    });

    it('is independent per cave', () => {
      const dirty = load({ surveys: [survey('S1', undefined)] });
      const clean = load({ surveys: [survey('S1', EXPECTED)] });
      expect([dirty.correctedConvergenceSurveys, clean.correctedConvergenceSurveys]).toEqual([1, 0]);
    });

  });

  describe('the solver', () => {

    // Both surveys shoot due north from the same station, so with one convergence for the cave
    // they must run parallel; the old per-survey fallback rotated them apart.
    const twoSurveyCave = (c1, c2, geoData = GEO_DATA) =>
      Cave.fromPure(
        pureCave({
          geoData,
          surveys : [
            { name: 'S1', start: 'A1', metadata: { declination: 5, convergence: c1 }, shots: [leg('A1', 'A2', 0)] },
            { name: 'S2', start: 'A1', metadata: { declination: 5, convergence: c2 }, shots: [leg('A2', 'B2', 0)] }
          ]
        }),
        ATTR_DEFS
      );

    const bearing = (cave, a, b) => {
      const st = cave.getAllStations();
      const p = st.get(a).position, q = st.get(b).position;
      return Math.atan2(q.x - p.x, q.y - p.y);
    };

    it('places surveys identically even when their stored copies disagreed', () => {
      const cave = twoSurveyCave(EXPECTED, undefined);
      SurveyHelper.recalculateCave(cave);
      expect(bearing(cave, 'A1', 'A2')).toBeCloseTo(bearing(cave, 'A2', 'B2'), 12);
    });

    it('ignores a survey copy that was poisoned after load', () => {
      const clean = twoSurveyCave(undefined, undefined);
      SurveyHelper.recalculateCave(clean);
      const expected = bearing(clean, 'A1', 'A2');

      const poisoned = twoSurveyCave(undefined, undefined);
      poisoned.surveys.forEach((s) => (s.metadata.convergence = 90)); // nonsense, must not be read
      SurveyHelper.recalculateCave(poisoned);
      expect(bearing(poisoned, 'A1', 'A2')).toBeCloseTo(expected, 12);
    });

    it('applies the derived value: the legs are rotated by declination minus convergence', () => {
      const cave = twoSurveyCave(undefined, undefined);
      SurveyHelper.recalculateCave(cave);
      const expectedDeg = 5 - EXPECTED; // declination - convergence, for a due-north shot
      expect((bearing(cave, 'A1', 'A2') * 180) / Math.PI).toBeCloseTo(expectedDeg, 9);
    });

    it('applies no convergence to a cave that is not georeferenced', () => {
      const cave = twoSurveyCave(-1.48, -1.48, null);
      SurveyHelper.recalculateCave(cave);
      expect((bearing(cave, 'A1', 'A2') * 180) / Math.PI).toBeCloseTo(5, 9); // declination only
    });

  });

});
