import { Exporter } from '../io/export.js';
import '../localization/local-setup.js';

class NavigationBar {

  /**
   *
   * @param {HTMLElement} domElement - The HTML DOM element of the navigation bar
   * @param {Map<String, Map>} options - Global project options, like global visibility of an object
   * @param {MyScene} scene - The 3D scene
   */
  constructor(db, domElement, options, scene, interactive) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.interactive = interactive;
    this.#buildNavbar(domElement);
    this.#addNavbarClickListener();
  }

  #getMenus() {
    return [
      {
        name     : i18next.t('File'),
        elements : [
          {
            name  : i18next.t('Open TopoDroid file'),
            click : () => {
              document.getElementById('topodroidInput').click();
            }
          },
          {
            name  : i18next.t('Open Polygon file'),
            click : function () {
              document.getElementById('polygonInput').click();
            }
          },
          {
            name  : i18next.t('Open JSON file'),
            click : function () {
              document.getElementById('jsonInput').click();
            }
          },
          { name: i18next.t('Export JSON'), click: () => Exporter.exportCaves(this.db.caves) },
          { name: i18next.t('Export PNG'), click: () => Exporter.exportPNG(this.scene) }
        ]
      },
      {
        name     : i18next.t('Surface'),
        elements : [
          {
            name  : i18next.t('Open PLY file'),
            click : function () {
              document.getElementById('plyInput').click();
            }
          }
        ]
      }
    ];
  }

  #getIcons() {
    return [
      {
        tooltip : i18next.t('Print'),
        icon    : './icons/print.svg',
        click   : () => window.print()
      },
      {
        tooltip : i18next.t('Zoom to fit'),
        icon    : './icons/zoom_fit.svg',
        click   : () => this.scene.fitScene(this.scene.computeBoundingBox())
      },
      {
        tooltip : i18next.t('Zoom in'),
        icon    : './icons/zoom_in.svg',
        click   : () => this.scene.zoomWithStep(this.options.scene.zoomStep)
      },
      {
        tooltip : i18next.t('Zoom out'),
        icon    : './icons/zoom_out.svg',
        click   : () => this.scene.zoomWithStep(-1 * this.options.scene.zoomStep)
      },
      {
        tooltip : i18next.t('Plan'),
        icon    : './icons/plan.svg',
        click   : () => this.scene.lookAtPlan()
      },
      {
        tooltip : i18next.t('Profile'),
        icon    : './icons/profile.svg',
        click   : () => this.scene.lookAtProfile()
      },
      {
        tooltip : i18next.t('3D'),
        icon    : './icons/3d.svg',
        click   : () => this.scene.lookAt3D()
      },
      {
        tooltip : i18next.t('Bounding box'),
        icon    : './icons/bounding_box.svg',
        click   : () => this.scene.toogleBoundingBox()
      },
      {
        tooltip : i18next.t('Show beddings'),
        icon    : './icons/bedding.svg',
        click   : () => this.scene.tooglePlaneFor('bedding')
      },
      {
        tooltip : i18next.t('Show faults'),
        icon    : './icons/fault.svg',
        click   : () => this.scene.tooglePlaneFor('fault')
      },
      {
        tooltip : i18next.t('Line color mode'),
        icon    : './icons/cl_color.svg',
        click   : () => this.scene.rollCenterLineColor()
      },
      {
        tooltip : i18next.t('Grid position/visibility'),
        icon    : './icons/grid.svg',
        click   : () => this.scene.grid.roll()
      },
      {
        tooltip : i18next.t('Surface visibility'),
        icon    : './icons/surface.svg',
        click   : () => this.scene.rollSurface()
      },
      {
        tooltip : i18next.t('Locate point'),
        icon    : './icons/locate.svg',
        click   : (event) => this.interactive.showLocatePanel(event.clientX)
      },
      {
        tooltip : i18next.t('Distance between points'),
        icon    : './icons/distance.svg',
        click   : (event) => this.interactive.showShortestPathPanel(event.clientX)
      }
    ];
  }

  #addNavbarClickListener() {
    //Close the dropdown if the user clicks outside of it
    window.onclick = function (e) {
      if (!e.target.matches('.dropbtn')) {
        document.querySelectorAll('.mydropdown-content').forEach((c) => {
          if (c.classList.contains('mydropdown-show')) {
            c.classList.remove('mydropdown-show');
          }
        });
      }
    };
  }

  #buildNavbar(navbarHtmlElement) {
    const createMenu = (name, elements) => {
      const c = document.createElement('div');
      c.setAttribute('class', 'mydropdown-content');
      c.setAttribute('id', 'myDropdown');

      elements.forEach((e) => {
        const a = document.createElement('a');
        a.appendChild(document.createTextNode(e.name));
        a.onclick = e.click;
        c.appendChild(a);
      });

      const d = document.createElement('div');
      d.setAttribute('class', 'mydropdown');
      const b = document.createElement('button');
      b.setAttribute('class', 'dropbtn');
      b.onclick = function () {
        c.classList.toggle('mydropdown-show');
        document.querySelectorAll('.mydropdown-content').forEach((element) => {
          if (element !== c) {
            element.classList.remove('mydropdown-show'); // hide other visible menu elements
          }
        });
      };
      b.appendChild(document.createTextNode(name));
      d.appendChild(b);
      d.appendChild(c);
      return d;
    };

    const createIcon = (tooltip, icon, glyphName, click, width = 20, height = 20) => {
      const a = document.createElement('a');
      a.onclick = click;

      if (glyphName !== undefined) {
        const i = document.createElement('i');
        i.setAttribute('class', `glyphicon glyphicon-${glyphName}`);
        a.appendChild(i);
      } else if (icon !== undefined) {
        const img = document.createElement('img');
        img.setAttribute('src', icon);
        img.setAttribute('width', width);
        img.setAttribute('height', height);
        a.appendChild(img);
      }

      const t = document.createElement('span');
      t.setAttribute('class', 'mytooltiptext');
      t.appendChild(document.createTextNode(tooltip));

      a.appendChild(t);
      a.setAttribute('class', 'mytooltip');
      return a;
    };

    navbarHtmlElement.innerHTML = '';
    this.#getMenus().forEach((m) => navbarHtmlElement.appendChild(createMenu(m.name, m.elements)));
    this.#getIcons()
      .forEach((i) => {
        navbarHtmlElement.appendChild(
          createIcon(
            i.tooltip,
            i.icon,
            i.glyphName,
            i.click,
            i.width === undefined ? 20 : i.width,
            i.height === undefined ? 20 : i.height
          )
        );
      });
  }
}

export { NavigationBar };
