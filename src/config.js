import { Color } from './model.js';

export const OPTIONS = {
  scene : {

    zoomStep : 0.1,

    centerLines : {
      segments : {
        show    : true,
        color   : new Color(0xff0000),
        width   : 1.5,
        opacity : 1.0
      },
      spheres : {
        show   : true,
        color  : new Color(0xffff00),
        radius : 0.3
      }
    },
    splays : {
      segments : {
        show  : true,
        color : new Color(0x00ffff),
        width : 1.5
      },
      spheres : {
        show   : true,
        color  : new Color(0x0000ff),
        radius : 0.3
      }
    },
    boundingBox : {
      show : false
    },
    grid : {
      mode : {
        value   : 'top',
        choices : ['top', 'bottom', 'hidden']
      }
    },
    surface : {
      color : {
        start : new Color(0x39b14d),
        end   : new Color(0x9f2d2d),
        mode  : {
          value   : 'gradientByZ',
          choices : ['gradientByZ', 'hidden']
        }

      }
    },
    caveLines : {
      color : {
        start : new Color(0x00ff2a),
        end   : new Color(0x0000ff),
        mode  : {
          value   : 'gradientByZ',
          choices : ['global', 'gradientByZ', 'gradientByDistance', 'percave', 'persurvey']
        }
      }
    },
    sectionAttributes : {
      color : new Color(0x00ff2a)
    },
    labels : {
      color : new Color(0xffffff),
      size  : 3
    },
    background : {
      color : new Color(0x000000)
    },
    startPoint : {
      show   : true,
      color  : new Color(0xffff00),
      radius : 0.3
    }
  },

  tabulator : {
    paginationSize : 7
  },

  screen : {
    DPI : 96
  }
};

export class Options {

  static rotateOptionChoice(config) {
    const index = config.choices.indexOf(config.value);

    if (index >= 0 && index < config.choices.length - 1) {
      config.value = config.choices[index + 1];
    } else {
      config.value = config.choices[0];
    }

  }
}
