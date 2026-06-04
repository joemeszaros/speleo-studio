/*
 * Copyright 2024 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';
import { SurveyHelper } from '../survey.js';
import { i18n } from '../i18n/i18n.js';

export class ColorModeHelper {

  constructor(db, options, caveObjects, materials) {
    this.db = db;
    this.options = options;
    this.caveObjects = caveObjects;
    this.mats = materials.materials;
    this.materias = materials;
    // User-chosen start station for 'gradientByDistance' mode: { cave, station } (survey-qualified
    // station key). Transient (not persisted) — reset implicitly whenever the user picks a new one.
    this.distanceStartStation = undefined;
  }

  setColorMode(mode, trigger) {
    const clConfig = this.options.scene.centerLines;
    const splayConfig = this.options.scene.splays;
    const auxConfig = this.options.scene.auxiliaries;

    // we just need to change the color if we already have survey materials
    if (trigger?.reason === 'surveyColor') {
      if (trigger.color === undefined) {
        this.materias.clearSurvey(trigger.cave, trigger.survey);
      } else {
        const surveyMats = this.materias.getSurvey(trigger.cave, trigger.survey);
        if (surveyMats !== undefined) {
          const newColor = new THREE.Color(trigger.color);
          surveyMats.get('center').color = newColor;
          surveyMats.get('splay').color = newColor;
          surveyMats.get('auxiliary').color = newColor;
          return;
        }
      }
    }

    if (trigger?.reason === 'caveColor') {
      if (trigger.color === undefined) {
        this.materias.clearCave(trigger.cave);
      } else {
        // we just need to change the color if we already have cave materials
        const caveMats = this.materias.getCave(trigger.cave);
        if (caveMats !== undefined) {
          const newColor = new THREE.Color(trigger.color);
          caveMats.get('center').color = newColor;
          caveMats.get('splay').color = newColor;
          caveMats.get('auxiliary').color = newColor;
          return;
        }
      }
    }

    switch (mode) {
      case 'gradientByZ':
      case 'gradientByDistance': {
        const colors = SurveyHelper.getColorGradientsForCaves(
          this.db.getCavesMap(),
          this.options.scene.caveLines,
          this.distanceStartStation
        );
        this.caveObjects.forEach((surveyEntrires, cName) => {
          surveyEntrires.forEach((e, sName) => {
            const sColor = this.db.getSurveyById(cName, sName)?.color;
            if (sColor !== undefined) {
              e['centerLines'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'center', clConfig);
              e['splays'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'splay', splayConfig);
              e['auxiliaries'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'auxiliary', auxConfig);
            } else {
              e['centerLines'].material = this.mats.whiteLine.get('center');
              e['splays'].material = this.mats.whiteLine.get('splay');
              e['auxiliaries'].material = this.mats.whiteLine.get('auxiliary');
              const surveyColors = colors.get(cName).get(sName);
              e['centerLines'].geometry.setColors(surveyColors.center);
              e['splays'].geometry.setColors(surveyColors.splays);
              e['auxiliaries'].geometry.setColors(surveyColors.auxiliary);
            }
          });
        });
        break;
      }
      case 'global':
      case 'percave':
      case 'persurvey': {

        this.caveObjects.forEach((surveyEntrires, cName) => {

          const cave = this.db.getCave(cName);

          surveyEntrires.forEach((e, sName) => {

            e['centerLines'].geometry.setColors([]);
            e['splays'].geometry.setColors([]);
            e['auxiliaries'].geometry.setColors([]);

            const survey = this.db.getSurveyById(cName, sName);
            const sColor = survey?.color;

            // For per-cave coloring the color comes from the (sub-)cave that owns this survey, not
            // just the top-level cave — a multi-level system (e.g. Migovec) has sub-cave colors set
            // on the nested Cave nodes. Pick the nearest colored ancestor in the survey's cave
            // chain so a sub-cave color applies (and overrides the top cave); previously only the
            // top cave's color was read, so sub-cave colors were ignored and lines fell back to the
            // default (red) material. Keyed by the owning cave's name to match the explorer's
            // per-cave color trigger.
            const colorCave =
              mode === 'percave' && survey
                ? [...cave.getCaveChain(survey)].reverse().find((c) => c.color !== undefined)
                : undefined;

            if (sColor !== undefined) {
              e['centerLines'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'center', clConfig);
              e['splays'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'splay', splayConfig);
              e['auxiliaries'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'auxiliary', auxConfig);
            } else if (mode === 'percave' && colorCave !== undefined) {
              e['centerLines'].material = this.materias.getOrAddCave(colorCave.name, colorCave.color, 'center', clConfig);
              e['splays'].material = this.materias.getOrAddCave(colorCave.name, colorCave.color, 'splay', splayConfig);
              e['auxiliaries'].material = this.materias.getOrAddCave(colorCave.name, colorCave.color, 'auxiliary', auxConfig);
            } else if (mode === 'persurvey') {
              // no survey color
              e['centerLines'].material = this.mats.segments.fallback;
              e['splays'].material = this.mats.segments.fallback;
              e['auxiliaries'].material = this.mats.segments.fallback;
            } else {
              // 'global', or 'percave' with no color anywhere in the chain → default materials
              e['centerLines'].material = this.mats.segments.centerLine;
              e['splays'].material = this.mats.segments.splay;
              e['auxiliaries'].material = this.mats.segments.auxiliary;
            }

          });
        });
        break;
      }
      default:
        throw new Error(i18n.t('errors.colormode.unknownCaveLineColorConfiguration', { mode }));
    }

  }
}
