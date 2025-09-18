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
        const colors = SurveyHelper.getColorGradientsForCaves(this.db.getCavesMap(), this.options.scene.caveLines);
        this.caveObjects.forEach((surveyEntrires, cName) => {
          surveyEntrires.forEach((e, sName) => {
            const sColor = this.db.getSurvey(cName, sName).color;
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

          const caveColor = this.db.getCave(cName).color;

          surveyEntrires.forEach((e, sName) => {

            e['centerLines'].geometry.setColors([]);
            e['splays'].geometry.setColors([]);
            e['auxiliaries'].geometry.setColors([]);

            const sColor = this.db.getSurvey(cName, sName).color;

            if (sColor !== undefined) {
              e['centerLines'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'center', clConfig);
              e['splays'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'splay', splayConfig);
              e['auxiliaries'].material = this.materias.getOrAddSurvey(cName, sName, sColor, 'auxiliary', auxConfig);
            } else {
              if (mode === 'global' || (mode === 'percave' && caveColor === undefined)) {
                e['centerLines'].material = this.mats.segments.centerLine;
                e['splays'].material = this.mats.segments.splay;
                e['auxiliaries'].material = this.mats.segments.auxiliary;
              } else if (mode === 'percave' && caveColor !== undefined) {
                e['centerLines'].material = this.materias.getOrAddCave(cName, caveColor, 'center', clConfig);
                e['splays'].material = this.materias.getOrAddCave(cName, caveColor, 'splay', splayConfig);
                e['auxiliaries'].material = this.materias.getOrAddCave(cName, caveColor, 'auxiliary', auxConfig);
              } else if (mode === 'persurvey') {
                // no survey color
                e['centerLines'].material = this.mats.segments.fallback;
                e['splays'].material = this.mats.segments.fallback;
                e['auxiliaries'].material = this.mats.segments.fallback;
              }
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
