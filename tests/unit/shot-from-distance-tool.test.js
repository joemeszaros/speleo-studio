import { describe, it, expect } from 'vitest';
import { Cave } from '../../src/model/cave.js';
import { SurveyHelper } from '../../src/survey.js';
import { MeridianConvergence } from '../../src/utils/geo.js';
import { normalizeAzimuthDeg, toPolar, radsToDegrees } from '../../src/utils/utils.js';
import { Vector } from '../../src/model.js';

const ATTR_DEFS = { schemaVersion: 6 };
const GEO_DATA = {
  coordinateSystem : { type: 'utm', epsgId: 32634, name: 'UTM', zoneNum: 34, northern: true },
  coordinates      : [
    { name: 'A1', coordinate: { easting: 319076.067, northing: 4696334.035, elevation: 1341.41, type: 'utm' } }
  ]
};
const DECLINATION = 5.062;

const shot = (from, to, length, azimuth, clino) => ({ type: 'center', from, to, length, azimuth, clino, comment: '' });

const buildCave = (shots) =>
  Cave.fromPure(
    {
      name       : 'tool-cave',
      geoData    : structuredClone(GEO_DATA),
      attributes : {},
      surveys    : [{ name: 'S1', start: 'A1', metadata: { declination: DECLINATION }, shots }]
    },
    ATTR_DEFS
  );

// What the distance panel reads off the rendered positions: a GRID bearing.
const measure = (cave, fromName, toName) => {
  const st = cave.getAllStations();
  const a = st.get(fromName).position, b = st.get(toName).position;
  const polar = toPolar(new Vector(b.x - a.x, b.y - a.y, b.z - a.z));
  return { distance: polar.distance, azimuth: radsToDegrees(polar.azimuth), clino: radsToDegrees(polar.clino) };
};

// The back-calculation the panel now shows, mirroring SceneInteraction.#rawShotSection.
const asRawShot = (cave, survey, measured) => {
  const correction = (survey.metadata?.declination ?? 0) - (MeridianConvergence.fromGeoData(cave.geoData) ?? 0);
  return { ...measured, azimuth: normalizeAzimuthDeg(measured.azimuth - correction) };
};

describe('turning a distance measurement into a survey shot', () => {

  // A1 -> A2 -> A3, then measure A1 -> A3 and close the triangle with one new leg.
  const cave = () => buildCave([shot('A1', 'A2', 10, 30, 0), shot('A2', 'A3', 10, 120, 0)]);

  it('the panel azimuth is a grid bearing, not what the instrument read', () => {
    const c = cave();
    SurveyHelper.recalculateCave(c);
    const measured = measure(c, 'A1', 'A2');
    const convergence = MeridianConvergence.fromGeoData(c.geoData);
    // the shot was entered as 30; rendered it sits at 30 + declination - convergence
    expect(measured.azimuth).toBeCloseTo(normalizeAzimuthDeg(30 + DECLINATION - convergence), 9);
    expect(measured.azimuth).not.toBeCloseTo(30, 3);
  });

  it('the raw value it offers is what the instrument would have read', () => {
    const c = cave();
    SurveyHelper.recalculateCave(c);
    const raw = asRawShot(c, c.surveys[0], measure(c, 'A1', 'A2'));
    expect(raw.azimuth).toBeCloseTo(30, 9);
  });

  it('entering the raw value lands exactly on the measured station', () => {
    const c = cave();
    SurveyHelper.recalculateCave(c);
    const raw = asRawShot(c, c.surveys[0], measure(c, 'A1', 'A3'));

    const closed = buildCave([
      shot('A1', 'A2', 10, 30, 0),
      shot('A2', 'A3', 10, 120, 0),
      shot('A1', 'X1', raw.distance, raw.azimuth, raw.clino)
    ]);
    SurveyHelper.recalculateCave(closed);
    const st = closed.getAllStations();
    const a3 = st.get('A3').position, x1 = st.get('X1').position;
    expect(Math.hypot(x1.x - a3.x, x1.y - a3.y, x1.z - a3.z)).toBeLessThan(1e-9);
  });

  it('entering the grid value misses, by the correction angle', () => {
    const c = cave();
    SurveyHelper.recalculateCave(c);
    const measured = measure(c, 'A1', 'A3');

    const wrong = buildCave([
      shot('A1', 'A2', 10, 30, 0),
      shot('A2', 'A3', 10, 120, 0),
      shot('A1', 'X1', measured.distance, measured.azimuth, measured.clino) // typed as-is
    ]);
    SurveyHelper.recalculateCave(wrong);
    const st = wrong.getAllStations();
    const a3 = st.get('A3').position, x1 = st.get('X1').position;
    const miss = Math.hypot(x1.x - a3.x, x1.y - a3.y, x1.z - a3.z);

    // chord of the correction angle over the measured distance
    const correction = DECLINATION - MeridianConvergence.fromGeoData(c.geoData);
    const expected = 2 * measured.distance * Math.sin((correction * Math.PI) / 360);
    expect(miss).toBeCloseTo(expected, 9);
    expect(miss).toBeGreaterThan(1); // and it is a real, visible miss
  });

  it('wraps a correction that pushes the azimuth below zero', () => {
    const c = buildCave([shot('A1', 'A2', 10, 1, 0)]);
    SurveyHelper.recalculateCave(c);
    const raw = asRawShot(c, c.surveys[0], measure(c, 'A1', 'A2'));
    expect(raw.azimuth).toBeCloseTo(1, 9);
    expect(raw.azimuth).toBeGreaterThanOrEqual(0);
  });

  it('leaves length and clino alone — the correction is a rotation about the vertical', () => {
    const c = buildCave([shot('A1', 'A2', 10, 30, 25)]);
    SurveyHelper.recalculateCave(c);
    const measured = measure(c, 'A1', 'A2');
    const raw = asRawShot(c, c.surveys[0], measured);
    expect(raw.distance).toBeCloseTo(10, 9);
    expect(raw.clino).toBeCloseTo(25, 9);
    expect(raw.clino).toBe(measured.clino);
  });

});

describe('normalizeAzimuthDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeAzimuthDeg(-6.545)).toBeCloseTo(353.455, 9);
    expect(normalizeAzimuthDeg(370)).toBeCloseTo(10, 9);
    expect(normalizeAzimuthDeg(360)).toBe(0);
    expect(normalizeAzimuthDeg(0)).toBe(0);
    expect(normalizeAzimuthDeg(-720.5)).toBeCloseTo(359.5, 9);
  });
});
