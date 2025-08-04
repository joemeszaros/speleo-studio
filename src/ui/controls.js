import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { Color } from '../model.js';
import { ShotType } from '../model/survey.js';
import * as THREE from 'three';

export function addGui(options, scene, materials, element) {
  const s = options.scene;
  const gui = new GUI({ title: 'Control panel', container: element });
  const centerLineParam = {
    'show center lines'    : s.centerLines.segments.show,
    'line color'           : s.centerLines.segments.color.hex(),
    'gradient start color' : s.caveLines.color.start.hex(),
    'gradient end color'   : s.caveLines.color.end.hex(),
    width                  : s.centerLines.segments.width,
    opacity                : s.centerLines.segments.opacity,
    'show station'         : s.centerLines.spheres.show,
    'station color'        : s.centerLines.spheres.color.hex(),
    'station size'         : s.centerLines.spheres.radius
  };

  const splayParam = {
    'show splays'   : s.splays.segments.show,
    'line color'    : s.splays.segments.color.hex(),
    width           : s.splays.segments.width,
    'show station'  : s.splays.spheres.show,
    'station color' : s.splays.spheres.color.hex(),
    'station size'  : s.splays.spheres.radius
  };

  const auxiliaryParam = {
    'show auxiliary' : s.auxiliaries.segments.show,
    'line color'     : s.auxiliaries.segments.color.hex(),
    width            : s.auxiliaries.segments.width,
    'show station'   : s.auxiliaries.spheres.show,
    'station color'  : s.auxiliaries.spheres.color.hex(),
    'station size'   : s.auxiliaries.spheres.radius
  };

  const labelParam = {
    'font color' : s.labels.color.hex(),
    'font size'  : s.labels.size
  };
  const sceneParam = {
    'background color' : s.background.color.hex()
  };

  const sectionAttributeParam = {
    color : s.sectionAttributes.color.hex()
  };

  const screenParam = {
    DPI : options.screen.DPI
  };

  const centerLineFolder = gui.addFolder('Center lines');

  centerLineFolder.add(centerLineParam, 'show center lines').onChange(function (val) {
    s.centerLines.segments.show = val;
    scene.setObjectsVisibility('centerLines', val);
  });

  centerLineFolder.addColor(centerLineParam, 'line color').onChange(function (val) {
    s.centerLines.segments.color = new Color(val);
    materials.segments.centerLine.color = new THREE.Color(val);
    scene.view.renderView();
  });

  centerLineFolder.addColor(centerLineParam, 'gradient start color').onChange(function (val) {
    s.caveLines.color.start = new Color(val);
  });

  centerLineFolder.addColor(centerLineParam, 'gradient end color').onChange(function (val) {
    s.caveLines.color.end = new Color(val);
  });

  centerLineFolder
    .add(centerLineParam, 'width', 0.5, 8)
    .step(0.1)
    .onChange(function (val) {
      s.centerLines.segments.width = val;
      materials.segments.centerLine.linewidth = s.centerLines.segments.width;
      materials.whiteLine.linewidth = s.centerLines.segments.width;
      scene.updateSegmentsWidth(val);
      scene.view.renderView();
    });

  centerLineFolder
    .add(centerLineParam, 'opacity', 0.0, 1.0)
    .step(0.1)
    .onChange(function (val) {
      s.centerLines.segments.opacity = val;
      materials.segments.centerLine.opacity = val;
      materials.whiteLine.opacity = val;
      scene.setObjectsOpacity('centerLines', val);
      scene.view.renderView();
    });

  centerLineFolder.add(centerLineParam, 'show station').onChange(function (val) {
    s.centerLines.spheres.show = val;
    scene.setObjectsVisibility('centerLinesSpheres', val);
  });

  centerLineFolder.addColor(centerLineParam, 'station color').onChange(function (val) {
    s.centerLines.spheres.color = new Color(val);
    scene.view.renderView();
  });

  centerLineFolder
    .add(centerLineParam, 'station size', 0.1, 5)
    .step(0.1)
    .onChange(function (val) {
      s.centerLines.spheres.radius = val;
      scene.changeStationSpheresRadius('centerLine');
    });

  const splaysFolder = gui.addFolder('Splays');

  splaysFolder.add(splayParam, 'show splays').onChange(function (val) {
    s.splays.segments.show = val;
    scene.setObjectsVisibility('splays', val);
  });

  splaysFolder.addColor(splayParam, 'line color').onChange(function (val) {
    s.splays.segments.color = new Color(val);
    materials.segments.splay.color = new THREE.Color(val);
    scene.view.renderView();
  });

  splaysFolder.add(splayParam, 'width', 1, 5).onChange(function (val) {
    s.splays.segments.width = val;
    materials.segments.splay.linewidth = s.splays.segments.width;
    materials.whiteLine.linewidth = s.splays.segments.width;
    scene.view.renderView();
  });

  splaysFolder.add(splayParam, 'show station').onChange(function (val) {
    s.splays.spheres.show = val;
    scene.setObjectsVisibility('splaysSpheres', val);
  });

  splaysFolder.addColor(splayParam, 'station color').onChange(function (val) {
    s.splays.spheres.color = new Color(val);
    scene.view.renderView();
  });

  splaysFolder
    .add(splayParam, 'station size', 0.1, 5)
    .step(0.1)
    .onChange(function (val) {
      s.splays.spheres.radius = val;
      scene.changeStationSpheresRadius(ShotType.SPLAY);
    });

  const auxiliaryFolder = gui.addFolder('Auxiliary');

  auxiliaryFolder.add(auxiliaryParam, 'show auxiliary').onChange(function (val) {
    s.auxiliary.segments.show = val;
    scene.setObjectsVisibility('auxiliary', val);
  });

  auxiliaryFolder.addColor(auxiliaryParam, 'line color').onChange(function (val) {
    s.auxiliary.segments.color = new Color(val);
    materials.segments.auxiliary.color = new THREE.Color(val);
    scene.view.renderView();
  });

  auxiliaryFolder.add(auxiliaryParam, 'width', 1, 5).onChange(function (val) {
    s.auxiliary.segments.width = val;
    materials.segments.auxiliary.linewidth = s.auxiliary.segments.width;
    materials.whiteLine.linewidth = s.auxiliary.segments.width;
    scene.view.renderView();
  });

  auxiliaryFolder.add(auxiliaryParam, 'show station').onChange(function (val) {
    s.auxiliary.spheres.show = val;
    scene.setObjectsVisibility('auxiliarySpheres', val);
  });

  auxiliaryFolder.addColor(auxiliaryParam, 'station color').onChange(function (val) {
    s.auxiliary.spheres.color = new Color(val);
    scene.view.renderView();
  });

  auxiliaryFolder
    .add(auxiliaryParam, 'station size', 0.1, 5)
    .step(0.1)
    .onChange(function (val) {
      s.auxiliary.spheres.radius = val;
      scene.changeStationSpheresRadius(ShotType.AUXILIARY);
    });

  const labelsFolder = gui.addFolder('Text labels');

  labelsFolder.addColor(labelParam, 'font color').onChange(function (val) {
    s.labels.color = new Color(val);
    materials.text.color = new THREE.Color(val);
    scene.view.renderView();
  });

  labelsFolder
    .add(labelParam, 'font size', 0.1, 20)
    .step(0.1)
    .onChange(function (val) {
      s.labels.size = val;
      scene.updateLabelSize(val);
      scene.view.renderView();
    });

  const sceneFolder = gui.addFolder('Scene');

  sceneFolder.addColor(sceneParam, 'background color').onChange(function (val) {
    s.background.color = new Color(val);
    scene.setBackground(val);
  });

  const sectionAttrFolder = gui.addFolder('Section attrbiutes');

  sectionAttrFolder.addColor(sectionAttributeParam, 'color').onChange(function (val) {
    s.sectionAttributes.color = new Color(val);
  });

  const screenFolder = gui.addFolder('Screen');

  screenFolder
    .add(screenParam, 'DPI', 72, 300)
    .step(1)
    .onFinishChange(function (val) {
      options.screen.DPI = val; // this sets the DPI in the options object that is used in the View
      scene.views.spatial.onDPIChange(val);
      scene.views.plan.onDPIChange(val);
      scene.views.profile.onDPIChange(val);
      scene.view.renderView();
    });

  return gui;

}
