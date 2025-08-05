import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

export class Controls {
  constructor(options, element) {
    this.options = options;
    this.element = element;
    this.gui = this.#createGui();
  }

  close() {
    this.gui.close();
  }

  reload() {
    this.gui.destroy();
    this.gui = this.#createGui();
  }

  #createGui() {
    const s = this.options.scene;
    const gui = new GUI({ title: 'Control panel', container: this.element });

    const centerLineParam = {
      'show center lines'    : s.centerLines.segments.show,
      'line color'           : s.centerLines.segments.color,
      'gradient start color' : s.caveLines.color.start,
      'gradient end color'   : s.caveLines.color.end,
      width                  : s.centerLines.segments.width,
      opacity                : s.centerLines.segments.opacity,
      'show station'         : s.centerLines.spheres.show,
      'station color'        : s.centerLines.spheres.color,
      'station size'         : s.centerLines.spheres.radius
    };

    const splayParam = {
      'show splays'   : s.splays.segments.show,
      'line color'    : s.splays.segments.color,
      width           : s.splays.segments.width,
      'show station'  : s.splays.spheres.show,
      'station color' : s.splays.spheres.color,
      'station size'  : s.splays.spheres.radius
    };

    const auxiliaryParam = {
      'show auxiliary' : s.auxiliaries.segments.show,
      'line color'     : s.auxiliaries.segments.color,
      width            : s.auxiliaries.segments.width,
      'show station'   : s.auxiliaries.spheres.show,
      'station color'  : s.auxiliaries.spheres.color,
      'station size'   : s.auxiliaries.spheres.radius
    };

    const labelParam = {
      'font color' : s.labels.color,
      'font size'  : s.labels.size
    };
    const sceneParam = {
      'background color' : s.background.color
    };

    const sectionAttributeParam = {
      color : s.sectionAttributes.color
    };

    const screenParam = {
      DPI : this.options.screen.DPI
    };

    const centerLineFolder = gui.addFolder('Center lines');

    centerLineFolder.add(centerLineParam, 'show center lines').onFinishChange(function (val) {
      s.centerLines.segments.show = val;
    });

    centerLineFolder.addColor(centerLineParam, 'line color').onChange(function (val) {
      s.centerLines.segments.color = val;
    });

    centerLineFolder.addColor(centerLineParam, 'gradient start color').onChange(function (val) {
      s.caveLines.color.start = val;
    });

    centerLineFolder.addColor(centerLineParam, 'gradient end color').onChange(function (val) {
      s.caveLines.color.end = val;
    });

    centerLineFolder
      .add(centerLineParam, 'width', 0.5, 8)
      .step(0.1)
      .onFinishChange(function (val) {
        s.centerLines.segments.width = val;
      });

    centerLineFolder
      .add(centerLineParam, 'opacity', 0.0, 1.0)
      .step(0.1)
      .onFinishChange(function (val) {
        s.centerLines.segments.opacity = val;
      });

    centerLineFolder.add(centerLineParam, 'show station').onFinishChange(function (val) {
      s.centerLines.spheres.show = val;
    });

    centerLineFolder.addColor(centerLineParam, 'station color').onChange(function (val) {
      s.centerLines.spheres.color = val;
    });

    centerLineFolder
      .add(centerLineParam, 'station size', 0.1, 5)
      .step(0.1)
      .onFinishChange(function (val) {
        s.centerLines.spheres.radius = val;
      });

    const splaysFolder = gui.addFolder('Splays');

    splaysFolder.add(splayParam, 'show splays').onFinishChange(function (val) {
      s.splays.segments.show = val;
    });

    splaysFolder.addColor(splayParam, 'line color').onChange(function (val) {
      s.splays.segments.color = val;
    });

    splaysFolder.add(splayParam, 'width', 1, 5).onFinishChange(function (val) {
      s.splays.segments.width = val;
    });

    splaysFolder.add(splayParam, 'show station').onFinishChange(function (val) {
      s.splays.spheres.show = val;
    });

    splaysFolder.addColor(splayParam, 'station color').onChange(function (val) {
      s.splays.spheres.color = val;
    });

    splaysFolder
      .add(splayParam, 'station size', 0.1, 5)
      .step(0.1)
      .onFinishChange(function (val) {
        s.splays.spheres.radius = val;
      });

    const auxiliaryFolder = gui.addFolder('Auxiliary');

    auxiliaryFolder.add(auxiliaryParam, 'show auxiliary').onFinishChange(function (val) {
      s.auxiliaries.segments.show = val;
    });

    auxiliaryFolder.addColor(auxiliaryParam, 'line color').onChange(function (val) {
      s.auxiliaries.segments.color = val;
    });

    auxiliaryFolder.add(auxiliaryParam, 'width', 1, 5).onFinishChange(function (val) {
      s.auxiliaries.segments.width = val;
    });

    auxiliaryFolder.add(auxiliaryParam, 'show station').onFinishChange(function (val) {
      s.auxiliaries.spheres.show = val;
    });

    auxiliaryFolder.addColor(auxiliaryParam, 'station color').onChange(function (val) {
      s.auxiliaries.spheres.color = val;
    });

    auxiliaryFolder
      .add(auxiliaryParam, 'station size', 0.1, 5)
      .step(0.1)
      .onFinishChange(function (val) {
        s.auxiliaries.spheres.radius = val;
      });

    const labelsFolder = gui.addFolder('Text labels');

    labelsFolder.addColor(labelParam, 'font color').onChange(function (val) {
      s.labels.color = val;
    });

    labelsFolder
      .add(labelParam, 'font size', 0.1, 20)
      .step(0.1)
      .onFinishChange(function (val) {
        s.labels.size = val;
      });

    const sceneFolder = gui.addFolder('Scene');

    sceneFolder.addColor(sceneParam, 'background color').onChange(function (val) {
      s.background.color = val;
    });

    const sectionAttrFolder = gui.addFolder('Section attrbiutes');

    sectionAttrFolder.addColor(sectionAttributeParam, 'color').onChange(function (val) {
      s.sectionAttributes.color = val;
    });

    const screenFolder = gui.addFolder('Screen');

    screenFolder
      .add(screenParam, 'DPI', 72, 300)
      .step(1)
      .onFinishChange((val) => {
        this.options.screen.DPI = val;
      });

    return gui;

  }
}
