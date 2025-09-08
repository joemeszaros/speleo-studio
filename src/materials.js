import * as THREE from 'three';

import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

class Materials {

  constructor(options) {
    this.config = options.scene;
    this.materials = {
      segments : {
        centerLine : new LineMaterial({
          color           : this.config.centerLines.segments.color,
          linewidth       : this.config.centerLines.segments.width,
          worldUnits      : false,
          vertexColors    : false,
          alphaToCoverage : false,
          transparent     : true,
          opacity         : this.config.centerLines.segments.opacity
        }),
        splay : new LineMaterial({
          color           : this.config.splays.segments.color,
          linewidth       : this.config.splays.segments.width,
          worldUnits      : false,
          vertexColors    : false,
          alphaToCoverage : false
        }),
        auxiliary : new LineMaterial({
          color           : this.config.auxiliaries.segments.color,
          linewidth       : this.config.auxiliaries.segments.width,
          worldUnits      : false,
          vertexColors    : false,
          alphaToCoverage : false
        }),
        fallback : new LineMaterial({
          color           : '#ffffff',
          linewidth       : this.config.centerLines.segments.width,
          worldUnits      : false,
          vertexColors    : false,
          alphaToCoverage : false
        })
      },
      text   : new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      sphere : {
        centerLine          : new THREE.MeshBasicMaterial({ color: this.config.centerLines.spheres.color }),
        splay               : new THREE.MeshBasicMaterial({ color: this.config.splays.spheres.color }),
        auxiliary           : new THREE.MeshBasicMaterial({ color: this.config.auxiliaries.spheres.color }),
        surface             : new THREE.MeshBasicMaterial({ color: 0xa0a0ff }),
        selected            : new THREE.MeshBasicMaterial({ color: 0xf00fff }),
        hover               : new THREE.MeshBasicMaterial({ color: 0x00ffff }),
        distanceMeasurement : new THREE.MeshBasicMaterial({ color: 0xff8800 }), // Orange color for distance measurement
        startPoint          : new THREE.MeshBasicMaterial({ color: this.config.startPoint.color })
      },

      distanceLine : new THREE.LineDashedMaterial({ color: 0xffffff, linewidth: 2, scale: 2, dashSize: 1, gapSize: 1 }),
      planes       : new Map([
        ['bedding', new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide })],
        ['fault', new THREE.MeshBasicMaterial({ color: 0xfff0f, side: THREE.DoubleSide })]
      ]),
      whiteLine : new Map([
        // used for gradient materials
        [
          'center',
          new LineMaterial({
            color           : 0xffffff, // this is very important to be white for gradient materials, don't change this
            linewidth       : this.config.centerLines.segments.width, // in world units with size attenuation, pixels otherwise
            worldUnits      : false,
            vertexColors    : true,
            alphaToCoverage : false,
            transparent     : true
          })
        ],
        [
          'splay',
          new LineMaterial({
            color           : 0xffffff, // this is very important to be white for gradient materials, don't change this
            linewidth       : this.config.splays.segments.width, // in world units with size attenuation, pixels otherwise
            worldUnits      : false,
            vertexColors    : true,
            alphaToCoverage : false,
            transparent     : true
          })
        ],
        [
          'auxiliary',
          new LineMaterial({
            color           : 0xffffff, // this is very important to be white for gradient materials, don't change this
            linewidth       : this.config.auxiliaries.segments.width, // in world units with size attenuation, pixels otherwise
            worldUnits      : false,
            vertexColors    : true,
            alphaToCoverage : false,
            transparent     : true
          })
        ]
      ]),
      temporary : {
        // used in percave and persurvey modes
        caves  : new Map(),
        suveys : new Map()

      }
    };

  }

  getCave(caveName) {
    if (this.materials.temporary.caves.has(caveName)) {
      return this.materials.temporary.caves.get(caveName);
    } else {
      return undefined;
    }
  }

  getSurvey(caveName, surveyName) {
    if (this.materials.temporary.suveys.has(caveName)) {
      return this.materials.temporary.suveys.get(caveName).get(surveyName);
    } else {
      return undefined;
    }
  }

  getOrAddSurvey(caveName, surveyName, color, type, config) {
    let caveObj;
    if (this.materials.temporary.suveys.has(caveName)) {
      caveObj = this.materials.temporary.suveys.get(caveName);
    } else {
      caveObj = new Map();
      this.materials.temporary.suveys.set(caveName, caveObj);
    }

    let surveyMats;
    if (caveObj.has(surveyName)) {
      surveyMats = caveObj.get(surveyName);
    } else {
      surveyMats = new Map();
      caveObj.set(surveyName, surveyMats);
    }

    if (surveyMats.has(type)) {
      const mat = surveyMats.get(type);
      mat.color = new THREE.Color(color);
      return mat;
    } else {
      const mat = new LineMaterial({
        color        : color,
        linewidth    : config.segments.width,
        vertexColors : false,
        transparent  : true,
        opacity      : config.segments.opacity
      });
      surveyMats.set(type, mat);
      return mat;
    }
  }

  getOrAddCave(caveName, color, type, config) {
    let caveMats;

    if (this.materials.temporary.caves.has(caveName)) {
      caveMats = this.materials.temporary.caves.get(caveName);
    } else {
      caveMats = new Map();
      this.materials.temporary.caves.set(caveName, caveMats);
    }

    if (caveMats.has(type)) {
      const mat = caveMats.get(type);
      mat.color = new THREE.Color(color);
      return mat;
    } else {
      const mat = new LineMaterial({
        color        : color,
        linewidth    : config.segments.width,
        vertexColors : false,
        transparent  : true,
        opacity      : config.segments.opacity
      });

      caveMats.set(type, mat);
      return mat;
    }
  }

  clearCave(caveName) {
    this.materials.temporary.caves.forEach((caveMats) => {
      caveMats.get('center').dispose();
      caveMats.get('splay').dispose();
      caveMats.get('auxiliary').dispose();
      caveMats.delete('center');
      caveMats.delete('splay');
      caveMats.delete('auxiliary');
    });
    this.materials.temporary.caves.delete(caveName);
  }

  clearSurvey(caveName, surveyName) {
    const surveyMats = this.materials.temporary.suveys.get(caveName).get(surveyName);
    surveyMats.get('center').dispose();
    surveyMats.get('splay').dispose();
    surveyMats.get('auxiliary').dispose();
    surveyMats.delete('center');
    surveyMats.delete('splay');
    surveyMats.delete('auxiliary');
    this.materials.temporary.suveys.get(caveName).delete(surveyName);
    if (this.materials.temporary.suveys.get(caveName).size === 0) {
      this.materials.temporary.suveys.delete(caveName);
    }
  }

  setSurveyOrCaveMaterial(type, attribute, value) {
    this.materials.temporary.caves.forEach((caveMats) => {
      caveMats.get(type)[attribute] = value;
    });
    this.materials.temporary.suveys.forEach((caveObj) => {
      caveObj.forEach((surveyMats) => {
        surveyMats.get(type)[attribute] = value;
      });
    });
  }

  renameCave(oldName, newName) {
    if (!this.materials.temporary.caves.has(oldName)) {
      return;
    }
    const mat = this.materials.temporary.caves.get(oldName);
    this.materials.temporary.caves.delete(oldName);
    this.materials.temporary.caves.set(newName, mat);
  }

  renameSurvey(oldName, newName, caveName) {
    if (!this.materials.temporary.suveys.has(caveName)) {
      return;
    }
    if (!this.materials.temporary.suveys.get(caveName).has(oldName)) {
      return;
    }
    const mat = this.materials.temporary.suveys.get(caveName).get(oldName);
    this.materials.temporary.suveys.get(caveName).delete(oldName);
    this.materials.temporary.suveys.get(caveName).set(newName, mat);
  }
}

export { Materials };
