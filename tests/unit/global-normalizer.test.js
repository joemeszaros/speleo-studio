import { describe, it, expect, beforeEach } from 'vitest';
import {
  GlobalCoordinateNormalizer,
  globalNormalizer
} from '../../src/utils/global-coordinate-normalizer.js';
import { Cave } from '../../src/model/cave.js';
import { SurveyHelper } from '../../src/survey.js';

const utm = (easting, northing, elevation) => ({ type: 'utm', easting, northing, elevation });
const eov = (y, x, elevation) => ({ type: 'eov', y, x, elevation });

describe('GlobalCoordinateNormalizer', () => {

  let n;
  beforeEach(() => {
    n = new GlobalCoordinateNormalizer();
  });

  describe('accepting an origin', () => {

    it('takes a usable UTM coordinate', () => {
      n.initializeGlobalOrigin(utm(319076.067, 4696334.035, 1341.41));
      expect(n.isInitialized()).toBe(true);
      expect(n.globalOrigin).toEqual({ easting: 319076.067, northing: 4696334.035, elevation: 1341.41 });
    });

    it('takes a usable EOV coordinate', () => {
      n.initializeGlobalOrigin(eov(650000, 240000, 300));
      expect(n.globalOrigin).toEqual({ y: 650000, x: 240000, elevation: 300 });
    });

    it('keeps the first origin it accepted', () => {
      n.initializeGlobalOrigin(utm(100, 200, 10));
      n.initializeGlobalOrigin(utm(999, 999, 99));
      expect(n.globalOrigin.easting).toBe(100);
    });

    it('ignores a missing coordinate', () => {
      n.initializeGlobalOrigin(undefined);
      n.initializeGlobalOrigin(null);
      expect(n.isInitialized()).toBe(false);
    });

    it('still rejects an unknown coordinate system', () => {
      expect(() => n.initializeGlobalOrigin({ type: 'nonsense', easting: 1, northing: 2 })).toThrow();
    });

  });

  // The origin is set once and never revised, so one unusable coordinate used to break every
  // cave for the rest of the session — a half-typed value in the cave sheet was enough.
  describe('refusing an unusable origin', () => {

    it.each([
      ['NaN easting', utm(NaN, 4696334.035, 1341.41)],
      ['NaN northing', utm(319076.067, NaN, 1341.41)],
      ['undefined easting', utm(undefined, 4696334.035, 1341.41)],
      ['Infinity northing', utm(319076.067, Infinity, 1341.41)],
      ['NaN EOV y', eov(NaN, 240000, 300)],
      ['NaN EOV x', eov(650000, NaN, 300)]
    ])('stays uninitialized for %s', (_label, coordinate) => {
      n.initializeGlobalOrigin(coordinate);
      expect(n.isInitialized()).toBe(false);
      expect(n.globalOrigin).toBeNull();
    });

    it('lets the next usable coordinate seed the origin', () => {
      n.initializeGlobalOrigin(utm(NaN, NaN, NaN));
      n.initializeGlobalOrigin(utm(319076.067, 4696334.035, 1341.41));
      expect(n.isInitialized()).toBe(true);
      expect(n.globalOrigin.easting).toBe(319076.067);
    });

    it('does not turn every later position into NaN', () => {
      n.initializeGlobalOrigin(utm(NaN, 4696334.035, 1341.41));
      n.initializeGlobalOrigin(utm(319076.067, 4696334.035, 1341.41));
      const v = n.getNormalizedVector(utm(319086.067, 4696344.035, 1351.41));
      expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
      expect([v.x, v.y, v.z]).toEqual([10, 10, 10]);
    });

  });

  // Elevation only shifts z; rejecting the coordinate over it would put raw UTM eastings back
  // into the scene, which is the precision problem this class exists to remove.
  describe('elevation', () => {

    it.each([
      ['NaN', NaN],
      ['undefined', undefined],
      ['Infinity', Infinity]
    ])('anchors z at 0 when elevation is %s', (_label, elevation) => {
      n.initializeGlobalOrigin(utm(319076.067, 4696334.035, elevation));
      expect(n.isInitialized()).toBe(true);
      expect(n.globalOrigin.elevation).toBe(0);
    });

    it('keeps z finite when the origin had no elevation', () => {
      n.initializeGlobalOrigin(utm(319076.067, 4696334.035, undefined));
      const v = n.getNormalizedVector(utm(319076.067, 4696334.035, 1341.41));
      expect(v.z).toBe(1341.41);
      expect(Number.isFinite(v.z)).toBe(true);
    });

  });

  // The point of refusing an unusable origin: one bad cave used to take the whole session with
  // it, because every other cave is placed relative to that same origin.
  describe('a cave with an unusable coordinate', () => {

    const buildCave = (name, easting) =>
      Cave.fromPure(
        {
          name,
          attributes : {},
          geoData    : {
            coordinateSystem : { type: 'utm', epsgId: 32634, name: 'UTM', zoneNum: 34, northern: true },
            coordinates      : [
              { name: 'A1', coordinate: { easting, northing: 4696334.035, elevation: 1341.41, type: 'utm' } }
            ]
          },
          surveys : [
            {
              name     : 'S1',
              start    : 'A1',
              metadata : { declination: 0 },
              shots    : [{ type: 'center', from: 'A1', to: 'A2', length: 10, azimuth: 0, clino: 0, comment: '' }]
            }
          ]
        },
        { schemaVersion: 6 }
      );

    const allFinite = (cave) =>
      [...cave.getAllStations().values()].every((s) => [s.position.x, s.position.y, s.position.z].every(Number.isFinite));

    it('does not drag the caves loaded after it into NaN', () => {
      globalNormalizer.reset();
      const broken = buildCave('half-typed', NaN);
      SurveyHelper.recalculateCave(broken);
      const good = buildCave('usable', 319076.067);
      SurveyHelper.recalculateCave(good);

      expect(globalNormalizer.isInitialized()).toBe(true);
      expect(globalNormalizer.globalOrigin.easting).toBe(319076.067);
      expect(allFinite(good)).toBe(true);
    });

    it('does not drag the caves loaded before it into NaN either', () => {
      globalNormalizer.reset();
      const good = buildCave('usable', 319076.067);
      SurveyHelper.recalculateCave(good);
      SurveyHelper.recalculateCave(buildCave('half-typed', NaN));

      expect(globalNormalizer.globalOrigin.easting).toBe(319076.067);
      expect(allFinite(good)).toBe(true);
    });

  });

  describe('getNormalizedVector', () => {

    it('subtracts the origin', () => {
      n.initializeGlobalOrigin(utm(1000, 2000, 30));
      const v = n.getNormalizedVector(utm(1005, 1995, 35));
      expect([v.x, v.y, v.z]).toEqual([5, -5, 5]);
    });

    it('subtracts the origin for EOV too', () => {
      n.initializeGlobalOrigin(eov(1000, 2000, 30));
      const v = n.getNormalizedVector(eov(1005, 1995, 35));
      expect([v.x, v.y, v.z]).toEqual([5, -5, 5]);
    });

    it('reset lets a new origin be established', () => {
      n.initializeGlobalOrigin(utm(1000, 2000, 30));
      n.reset();
      expect(n.isInitialized()).toBe(false);
      n.initializeGlobalOrigin(utm(5000, 6000, 70));
      expect(n.globalOrigin.easting).toBe(5000);
    });

  });

});
