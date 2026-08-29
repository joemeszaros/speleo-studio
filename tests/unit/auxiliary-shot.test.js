import { describe, it, expect } from 'vitest';
import { Cave } from '../../src/model/cave.js';
import { SurveyHelper } from '../../src/survey.js';

// Builds a single-survey cave: a short centerline with splays hanging off the stations and
// one nameless auxiliary shot in the middle. Auxiliary shots may end in a named station (so
// further shots can start from it) but are also valid with an empty `to`.
const buildCave = (shots) => buildMultiSurveyCave([{ name: 'S1', start: 'A1', shots }]);

// `surveys` is [{ name, start, shots }]; only the first survey carries a start station, the
// rest are chained onto it by shared station names (legacy/bare keying, as in this project).
const buildMultiSurveyCave = (surveys) =>
  Cave.fromPure(
    {
      name    : 'aux-cave',
      surveys : surveys.map((s) => ({
        name     : s.name,
        start    : s.start,
        metadata : { declination: 0 },
        shots    : s.shots
      })),
      startPosition : { x: 0, y: 0, z: 0 },
      attributes    : {}
    },
    { schemaVersion: 1 }
  );

const splay = (from, azimuth) => ({ type: 'splay', from, length: 2, azimuth, clino: 0, comment: '' });
const center = (from, to, azimuth) => ({ type: 'center', from, to, length: 5, azimuth, clino: 0, comment: '' });

describe('auxiliary shot without a to-station', () => {

  const shots = [
    center('A1', 'A2', 0),
    splay('A2', 10),
    splay('A2', 20),
    { type: 'auxiliary', from: 'A2', length: 3, azimuth: 90, clino: 0, comment: 'dip measurement' },
    splay('A2', 30),
    splay('A2', 40),
    center('A2', 'A3', 0),
    splay('A3', 50),
    splay('A3', 60)
  ];

  it('does not poison the station map with an empty key', () => {
    const cave = buildCave(shots);
    SurveyHelper.recalculateCave(cave);
    expect(cave.stations.has(undefined)).toBe(false);
    expect(cave.stations.has('')).toBe(false);
  });

  it('does not mark the splays that follow it as duplicates', () => {
    const cave = buildCave(shots);
    SurveyHelper.recalculateCave(cave);
    const survey = cave.surveys[0];
    expect([...survey.duplicateShotIds]).toEqual([]);
    expect([...survey.orphanShotIds]).toEqual([]);
  });

  it('places every splay so all of them are rendered', () => {
    const cave = buildCave(shots);
    SurveyHelper.recalculateCave(cave);
    const survey = cave.surveys[0];
    const [centerSegments, splaySegments, auxSegments] = SurveyHelper.getSegments(survey, cave.stations);
    expect(centerSegments.length / 6).toBe(2);
    expect(splaySegments.length / 6).toBe(6);
    expect(auxSegments.length / 6).toBe(1);
  });

  it('gives the nameless auxiliary endpoint a generated unique name', () => {
    const cave = buildCave(shots);
    SurveyHelper.recalculateCave(cave);
    const survey = cave.surveys[0];
    const aux = survey.shots.find((s) => s.type === 'auxiliary');
    const name = survey.getToStationName(aux);
    expect(name).toBe(survey.getAuxiliaryStationName(aux.id));
    expect(cave.stations.has(survey.qualify(name))).toBe(true);
  });

  it('keeps a named auxiliary endpoint under its own name', () => {
    const cave = buildCave([
      center('A1', 'A2', 0),
      { type: 'auxiliary', from: 'A2', to: 'X1', length: 3, azimuth: 90, clino: 0, comment: '' }
    ]);
    SurveyHelper.recalculateCave(cave);
    const survey = cave.surveys[0];
    const aux = survey.shots.find((s) => s.type === 'auxiliary');
    expect(survey.getToStationName(aux)).toBe('X1');
    expect(cave.stations.has(survey.qualify('X1'))).toBe(true);
  });

});

describe('duplicate leg detection', () => {

  it('still flags a genuinely repeated centerline leg', () => {
    const cave = buildCave([
      center('A1', 'A2', 0),
      center('A2', 'A3', 90),
      center('A2', 'A3', 90)
    ]);
    SurveyHelper.recalculateCave(cave);
    expect([...cave.surveys[0].duplicateShotIds].length).toBe(1);
  });

  it('flags a leg repeated in the reverse direction', () => {
    const cave = buildCave([
      center('A1', 'A2', 0),
      center('A2', 'A3', 90),
      center('A3', 'A2', 270)
    ]);
    SurveyHelper.recalculateCave(cave);
    expect([...cave.surveys[0].duplicateShotIds].length).toBe(1);
  });

  it('never flags splays leaving the same station', () => {
    const cave = buildCave([center('A1', 'A2', 0), splay('A2', 10), splay('A2', 10)]);
    SurveyHelper.recalculateCave(cave);
    expect([...cave.surveys[0].duplicateShotIds]).toEqual([]);
  });

  // findDuplicateShots is only reached for shots whose both endpoints are already placed, so
  // exercise it directly: it must never pair up two shots that simply have no to-station.
  it('findDuplicateShots ignores shots without a to-station', () => {
    const cave = buildCave([
      center('A1', 'A2', 0),
      splay('A2', 10),
      splay('A2', 20),
      { type: 'auxiliary', from: 'A2', length: 3, azimuth: 90, clino: 0, comment: '' }
    ]);
    SurveyHelper.recalculateCave(cave);
    const survey = cave.surveys[0];
    survey.shots
      .filter((sh) => sh.type !== 'center')
      .forEach((sh) => {
        expect(SurveyHelper.findDuplicateShots(sh, survey, cave.surveys)).toEqual([]);
      });
  });

  it('findDuplicateShots finds the repeated leg it is meant to find', () => {
    const cave = buildCave([center('A1', 'A2', 0), center('A2', 'A3', 90), center('A2', 'A3', 90)]);
    SurveyHelper.recalculateCave(cave);
    const survey = cave.surveys[0];
    const repeated = survey.shots[2];
    const found = SurveyHelper.findDuplicateShots(repeated, survey, cave.surveys);
    expect(found.length).toBe(1);
    expect(found[0].id).toBe(survey.shots[1].id);
  });

});

describe('empty to-station on a center shot', () => {

  it('is reported as an orphan instead of poisoning the station map', () => {
    const cave = buildCave([
      center('A1', 'A2', 0),
      { type: 'center', from: 'A2', to: '', length: 5, azimuth: 90, clino: 0, comment: '' },
      splay('A2', 10),
      splay('A2', 20)
    ]);
    SurveyHelper.recalculateCave(cave);
    const survey = cave.surveys[0];
    const broken = survey.shots.find((s) => s.to === '');
    expect(cave.stations.has(undefined)).toBe(false);
    expect(cave.stations.has('')).toBe(false);
    expect([...survey.orphanShotIds]).toEqual([broken.id]);
    // the splays after it are untouched
    expect([...survey.duplicateShotIds]).toEqual([]);
    const [, splaySegments] = SurveyHelper.getSegments(survey, cave.stations);
    expect(splaySegments.length / 6).toBe(2);
  });

});

describe('auxiliary shot in an earlier survey', () => {

  // The station map is shared by every survey of a cave, so a nameless auxiliary endpoint in
  // one survey used to break the splays of all the surveys solved after it, not just its own.
  const cave = () =>
    buildMultiSurveyCave([
      {
        name  : 'S1',
        start : 'A1',
        shots : [
          center('A1', 'A2', 0),
          { type: 'auxiliary', from: 'A2', length: 3, azimuth: 90, clino: 0, comment: '' }
        ]
      },
      {
        name  : 'S2',
        shots : [center('A2', 'B1', 45), splay('B1', 10), splay('B1', 20), splay('B1', 30)]
      }
    ]);

  it('leaves the next survey\'s splays alone', () => {
    const c = cave();
    SurveyHelper.recalculateCave(c);
    const second = c.surveys[1];
    expect([...second.duplicateShotIds]).toEqual([]);
    expect([...second.orphanShotIds]).toEqual([]);
  });

  it('renders every splay of the next survey', () => {
    const c = cave();
    SurveyHelper.recalculateCave(c);
    const [, splaySegments] = SurveyHelper.getSegments(c.surveys[1], c.stations);
    expect(splaySegments.length / 6).toBe(3);
  });

  it('keeps the two auxiliary endpoints of two surveys distinct', () => {
    const c = buildMultiSurveyCave([
      {
        name  : 'S1',
        start : 'A1',
        shots : [
          center('A1', 'A2', 0),
          { type: 'auxiliary', from: 'A2', length: 3, azimuth: 90, clino: 0, comment: '' }
        ]
      },
      {
        name  : 'S2',
        shots : [
          center('A2', 'B1', 45),
          { type: 'auxiliary', from: 'B1', length: 3, azimuth: 90, clino: 0, comment: '' }
        ]
      }
    ]);
    SurveyHelper.recalculateCave(c);
    const names = c.surveys.map((s) => {
      const aux = s.shots.find((x) => x.type === 'auxiliary');
      return s.qualify(s.getToStationName(aux));
    });
    expect(new Set(names).size).toBe(2);
    names.forEach((n) => expect(c.stations.has(n)).toBe(true));
  });

});
