import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { i18n } from '../i18n/i18n.js';

export class Controls {
  constructor(options, element) {
    this.options = options;
    this.element = element;
    this.gui = this.#createGui();

    if (this.options.ui.panels.settings.show) {
      this.element.style.display = 'block';
    } else {
      this.element.style.display = 'none';
    }
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
      'show center lines' : s.centerLines.segments.show,
      'line color'        : s.centerLines.segments.color,
      width               : s.centerLines.segments.width,
      opacity             : s.centerLines.segments.opacity,
      'show station'      : s.centerLines.spheres.show,
      'station color'     : s.centerLines.spheres.color,
      'station size'      : s.centerLines.spheres.radius
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

    const stationAttributeParam = {
      [i18n.t('ui.controlPanel.labels.iconScale')] : s.stationAttributes.iconScale
    };

    const screenParam = {
      DPI : this.options.screen.DPI
    };

    // Multi-color gradient controls
    const gradientFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.colorGradient'));

    // Add gradient color controls
    const addGradientColor = () => {
      const maxDepth = Math.max(...s.caveLines.color.gradientColors.map((gc) => gc.depth));
      const newColor = { depth: Math.min(maxDepth + 25, 100), color: '#ffffff' };
      s.caveLines.color.gradientColors = [...s.caveLines.color.gradientColors, newColor]; // trigger a change event
      this.reload();
    };

    const removeGradientColor = (index) => {
      if (s.caveLines.color.gradientColors.length > 2) {
        s.caveLines.color.gradientColors.splice(index, 1);
        s.caveLines.color.gradientColors = [...s.caveLines.color.gradientColors]; // trigger a change event
        this.reload();
      }
    };

    gradientFolder.add({ 'Add Color Stop': addGradientColor }, 'Add Color Stop');

    // Create controls for each gradient color
    s.caveLines.color.gradientColors.forEach((gradientColor, index) => {
      const colorFolder = gradientFolder.addFolder(`Color Stop ${index + 1}`);

      colorFolder
        .add(gradientColor, 'depth', 0, 100)
        .step(1)
        .name('Relative depth')
        .onFinishChange(() => {
          // Sort gradient colors by depth
          s.caveLines.color.gradientColors.sort((a, b) => a.depth - b.depth);
          // Trigger scene update by changing the gradientColors array
          s.caveLines.color.gradientColors = [...s.caveLines.color.gradientColors];
          this.reload();
        });

      colorFolder.addColor(gradientColor, 'color').onFinishChange(() => {
        // Trigger scene update by changing the gradientColors array
        s.caveLines.color.gradientColors = [...s.caveLines.color.gradientColors];
      });

      if (s.caveLines.color.gradientColors.length > 2) {
        colorFolder.add({ Remove: () => removeGradientColor(index) }, 'Remove');
      }
    });

    const centerLineFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.centerLines'));

    centerLineFolder.add(centerLineParam, 'show center lines').onFinishChange(function (val) {
      s.centerLines.segments.show = val;
    });

    centerLineFolder.addColor(centerLineParam, 'line color').onFinishChange(function (val) {
      s.centerLines.segments.color = val;
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

    centerLineFolder.addColor(centerLineParam, 'station color').onFinishChange(function (val) {
      s.centerLines.spheres.color = val;
    });

    centerLineFolder
      .add(centerLineParam, 'station size', 0.1, 5)
      .step(0.1)
      .onFinishChange(function (val) {
        s.centerLines.spheres.radius = val;
      });

    const splaysFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.splays'));

    splaysFolder.add(splayParam, 'show splays').onFinishChange(function (val) {
      s.splays.segments.show = val;
    });

    splaysFolder.addColor(splayParam, 'line color').onFinishChange(function (val) {
      s.splays.segments.color = val;
    });

    splaysFolder.add(splayParam, 'width', 1, 5).onFinishChange(function (val) {
      s.splays.segments.width = val;
    });

    splaysFolder.add(splayParam, 'show station').onFinishChange(function (val) {
      s.splays.spheres.show = val;
    });

    splaysFolder.addColor(splayParam, 'station color').onFinishChange(function (val) {
      s.splays.spheres.color = val;
    });

    splaysFolder
      .add(splayParam, 'station size', 0.1, 5)
      .step(0.1)
      .onFinishChange(function (val) {
        s.splays.spheres.radius = val;
      });

    const auxiliaryFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.auxiliary'));

    auxiliaryFolder.add(auxiliaryParam, 'show auxiliary').onFinishChange(function (val) {
      s.auxiliaries.segments.show = val;
    });

    auxiliaryFolder.addColor(auxiliaryParam, 'line color').onFinishChange(function (val) {
      s.auxiliaries.segments.color = val;
    });

    auxiliaryFolder.add(auxiliaryParam, 'width', 1, 5).onFinishChange(function (val) {
      s.auxiliaries.segments.width = val;
    });

    auxiliaryFolder.add(auxiliaryParam, 'show station').onFinishChange(function (val) {
      s.auxiliaries.spheres.show = val;
    });

    auxiliaryFolder.addColor(auxiliaryParam, 'station color').onFinishChange(function (val) {
      s.auxiliaries.spheres.color = val;
    });

    auxiliaryFolder
      .add(auxiliaryParam, 'station size', 0.1, 5)
      .step(0.1)
      .onFinishChange(function (val) {
        s.auxiliaries.spheres.radius = val;
      });

    const startPointParam = {
      'show starting points' : s.startPoint.show,
      color                  : s.startPoint.color,
      radius                 : s.startPoint.radius
    };

    const startPointFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.startingPoints'));

    startPointFolder.add(startPointParam, 'show starting points').onFinishChange(function (val) {
      s.startPoint.show = val;
    });

    startPointFolder.addColor(startPointParam, 'color').onFinishChange(function (val) {
      s.startPoint.color = val;
    });

    startPointFolder
      .add(startPointParam, 'radius', 0.1, 10.0)
      .step(0.1)
      .onFinishChange(function (val) {
        s.startPoint.radius = val;
      });

    const labelsFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.textLabels'));

    labelsFolder.addColor(labelParam, 'font color').onFinishChange(function (val) {
      s.labels.color = val;
    });

    labelsFolder
      .add(labelParam, 'font size', 0.1, 20)
      .step(0.1)
      .onFinishChange(function (val) {
        s.labels.size = val;
      });

    const sceneFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.scene'));

    sceneFolder.addColor(sceneParam, 'background color').onFinishChange(function (val) {
      s.background.color = val;
    });

    const sectionAttrFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.sectionAttributes'));

    sectionAttrFolder.addColor(sectionAttributeParam, 'color').onFinishChange(function (val) {
      s.sectionAttributes.color = val;
    });

    const stationAttrFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.stationAttributes'));

    stationAttrFolder
      .add(stationAttributeParam, i18n.t('ui.controlPanel.labels.iconScale'), 0.1, 20.0)
      .step(0.1)
      .onFinishChange(function (val) {
        s.stationAttributes.iconScale = val;
      });

    const screenFolder = gui.addFolder(i18n.t('ui.controlPanel.folders.screen'));

    screenFolder
      .add(screenParam, 'DPI', 72, 300)
      .step(1)
      .onFinishChange((val) => {
        this.options.screen.DPI = val;
      });

    return gui;

  }
}
