import * as THREE from 'three';

import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

class Materials {

  constructor(options) {
    this.config = options.scene;
    this.materials = {
      segments : {
        centerLine : new LineMaterial({
          color           : this.config.centerLines.segments.color.hex(),
          linewidth       : this.config.centerLines.segments.width,
          worldUnits      : false,
          vertexColors    : false,
          alphaToCoverage : false,
          transparent     : true,
          opacity         : this.config.centerLines.segments.opacity
        }),
        splay : new LineMaterial({
          color           : this.config.splays.segments.color.hex(),
          linewidth       : this.config.splays.segments.width,
          worldUnits      : false,
          vertexColors    : false,
          alphaToCoverage : false
        }),
        auxiliary : new LineMaterial({
          color           : this.config.auxiliaries.segments.color.hex(),
          linewidth       : this.config.auxiliaries.segments.width,
          worldUnits      : false,
          vertexColors    : false,
          alphaToCoverage : false
        })
      },
      text   : new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      sphere : {
        centerLine         : new THREE.MeshBasicMaterial({ color: this.config.centerLines.spheres.color.hex() }),
        splay              : new THREE.MeshBasicMaterial({ color: this.config.splays.spheres.color.hex() }),
        auxiliary          : new THREE.MeshBasicMaterial({ color: this.config.auxiliaries.spheres.color.hex() }),
        surface            : new THREE.MeshBasicMaterial({ color: 0xa0a0ff }),
        selected           : new THREE.MeshBasicMaterial({ color: 0xf00fff }),
        selectedForContext : new THREE.MeshBasicMaterial({ color: 0x20ff3d })
      },

      distanceLine : new THREE.LineDashedMaterial({ color: 0xffffff, linewidth: 2, scale: 2, dashSize: 1, gapSize: 1 }),
      planes       : new Map([
        ['bedding', new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide })],
        ['fault', new THREE.MeshBasicMaterial({ color: 0xfff0f, side: THREE.DoubleSide })]
      ]),
      whiteLine : new LineMaterial({
        color           : 0xffffff, // this is very important to be white for gradient materials, don't change this
        linewidth       : 0, // in world units with size attenuation, pixels otherwise
        worldUnits      : false,
        vertexColors    : true,
        alphaToCoverage : false,
        transparent     : true
      })
    };

  }
}

export { Materials };
