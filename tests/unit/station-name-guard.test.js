import { describe, it, expect } from 'vitest';
import { bareStationName } from '../../src/utils/utils.js';
import { Survey, Shot, ShotType } from '../../src/model/survey.js';

describe('bareStationName', () => {
  it('strips the @surveyPath qualifier', () => {
    expect(bareStationName('5@a.b.c')).toBe('5');
  });
  it('leaves bare names unchanged', () => {
    expect(bareStationName('5')).toBe('5');
    expect(bareStationName('1019/1')).toBe('1019/1'); // slashes are fine
    expect(bareStationName('1.5')).toBe('1.5');       // dots in the bare name are fine
  });
  it('splits on the first @ only', () => {
    expect(bareStationName('a@b@c')).toBe('a');
  });
  it('passes through non-strings', () => {
    expect(bareStationName(undefined)).toBe(undefined);
  });
});

describe('Survey.updateShots reserves @ in station names', () => {
  it('strips a user-typed @ from shot from/to (keeping the part before it)', () => {
    const survey = new Survey('s');
    const shot = new Shot(1, ShotType.CENTER, '5@foo', '6@bar.baz', 10, 90, 0);
    survey.updateShots([shot]);
    expect(survey.shots[0].from).toBe('5');
    expect(survey.shots[0].to).toBe('6');
  });

  it('leaves clean names (including dots/slashes) untouched', () => {
    const survey = new Survey('s');
    const shot = new Shot(1, ShotType.CENTER, '1.5', '1019/2', 10, 90, 0);
    survey.updateShots([shot]);
    expect(survey.shots[0].from).toBe('1.5');
    expect(survey.shots[0].to).toBe('1019/2');
  });
});
