import { Exporter } from '../io/export.js';

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
        name     : 'File',
        elements : [
          {
            name  : 'Open TopoDroid file(s)',
            click : () => {
              document.getElementById('topodroidInput').click();
            }
          },
          {
            name  : 'Open Polygon file(s)',
            click : function () {
              document.getElementById('polygonInput').click();
            }
          },
          {
            name  : 'Open JSON file(s)',
            click : function () {
              document.getElementById('jsonInput').click();
            }
          },
          { name: 'Export JSON', click: () => Exporter.exportCaves(this.db.caves) },
          { name: 'Export PNG', click: () => Exporter.exportPNG(this.scene) }
        ]
      },
      {
        name     : 'Surface',
        elements : [
          {
            name  : 'Open PLY file',
            click : function () {
              document.getElementById('plyInput').click();
            }
          }
        ]
      },
      {
        name     : 'View',
        elements : [
          {
            name  : 'Cave explorer',
            click : () => this.#toggleVisibility('#tree-panel')
          },
          {
            name  : 'Control panel',
            click : () => this.#toggleVisibility('#control-panel')
          },
          {
            name  : 'Footer',
            click : () => this.#toggleVisibility('#footer')
          },
          {
            name  : 'Welcome panel',
            click : () => this.#toggleVisibility('#welcome-panel')
          }
        ]
      }
    ];
  }

  #getIcons() {
    return [
      {
        tooltip : 'Print',
        icon    : './icons/print.svg',
        click   : () => window.print()
      },
      {
        tooltip : 'Zoom to fit',
        icon    : './icons/zoom_fit.svg',
        click   : () => this.scene.view.fitScreen(this.scene.computeBoundingBox())
      },
      {
        tooltip : 'Zoom in',
        icon    : './icons/zoom_in.svg',
        click   : () => this.scene.view.zoomIn(this.options.scene.zoomStep)
      },
      {
        tooltip : 'Zoom out',
        icon    : './icons/zoom_out.svg',
        click   : () => this.scene.view.zoomOut(this.options.scene.zoomStep)
      },
      {
        tooltip    : 'Plan',
        selectable : true,
        icon       : './icons/plan.svg',
        click      : () => this.scene.changeView('plan')
      },
      {
        tooltip    : 'Profile',
        selectable : true,
        icon       : './icons/profile.svg',
        click      : () => this.scene.changeView('profile')
      },
      {
        tooltip    : '3D',
        selectable : true,
        selected   : true,
        icon       : './icons/3d.svg',
        click      : () => this.scene.changeView('spatial')
      },
      {
        tooltip : 'Bounding box',
        icon    : './icons/bounding_box.svg',
        click   : () => this.scene.toogleBoundingBox()
      },
      {
        tooltip : 'Show beddings',
        icon    : './icons/bedding.svg',
        click   : () => this.scene.tooglePlaneFor('bedding')
      },
      {
        tooltip : 'Show faults',
        icon    : './icons/fault.svg',
        click   : () => this.scene.tooglePlaneFor('fault')
      },
      {
        tooltip : 'Line color mode',
        icon    : './icons/cl_color.svg',
        click   : () => this.scene.rollCenterLineColor()
      },
      {
        tooltip : 'Grid position/visibility',
        icon    : './icons/grid.svg',
        click   : () => this.scene.grid.roll()
      },
      {
        tooltip : 'Surface visibility',
        icon    : './icons/surface.svg',
        click   : () => this.scene.rollSurface()
      },
      {
        tooltip : 'Locate point',
        icon    : './icons/locate.svg',
        click   : (event) => this.interactive.showLocateStationPanel(event.clientX)
      },
      {
        tooltip : 'Distance between points',
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

    const createIcon = (tooltip, icon, selectable, selected, click, width = 20, height = 20) => {
      const a = document.createElement('a');
      a.onclick = (event) => {
        if (a.hasAttribute('selectable')) {
          a.parentNode.querySelectorAll('a[selectable="true"]').forEach((c) => c.classList.remove('selected'));
          a.classList.add('selected');
        }
        click(event);
      };

      if (icon !== undefined) {
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
      if (selectable) {
        a.setAttribute('selectable', 'true');
      }

      if (selected === true) {
        a.classList.add('selected');
      }
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
            i.selectable,
            i.selected,
            i.click,
            i.width === undefined ? 20 : i.width,
            i.height === undefined ? 20 : i.height
          )
        );
      });
  }

  #toggleVisibility(name) {
    let style = document.querySelector(name).style;
    if (style.display !== 'none') {
      style.display = 'none';
    } else {
      style.display = 'block';
    }
  }
}

export { NavigationBar };
