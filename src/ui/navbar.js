import { ConfigManager } from '../config.js';
import { Exporter } from '../io/export.js';

class NavigationBar {

  /**
   *
   * @param {HTMLElement} domElement - The HTML DOM element of the navigation bar
   * @param {Map<String, Map>} options - Global project options, like global visibility of an object
   * @param {MyScene} scene - The 3D scene
   */
  constructor(db, domElement, options, scene, interactive, projectManager, projectPanel, controls) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.interactive = interactive;
    this.projectManager = projectManager;
    this.projectPanel = projectPanel;
    this.controls = controls;
    this.#buildNavbar(domElement);
    this.#addNavbarClickListener();
    document.addEventListener('currentProjectChanged', () => this.setFileMenuDisabled(false));
    document.addEventListener('currentProjectDeleted', () => this.setFileMenuDisabled(true));
  }

  setFileMenuDisabled(disabled) {
    const fileMenuButton = Array.from(document.querySelectorAll('.mydropdown .dropbtn'))
      .find((button) => button.textContent === 'File');
    if (fileMenuButton) {
      fileMenuButton.disabled = disabled;
    }
  }

  #getMenus() {
    return [
      {
        name     : 'File',
        disabled : true,
        elements : [
          {
            name  : 'New cave',
            click : () => {
              this.projectManager.addNewCave();
            }
          },
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
          { name: 'Export PNG', click: () => Exporter.exportPNG(this.scene) },
          { name: 'Export DXF', click: () => Exporter.exportDXF(this.db.caves) },
          { name: 'Export Polygon', click: () => Exporter.exportPolygon(this.db.caves) },
          { name: 'Download configuration', click: () => ConfigManager.downloadConfig(this.options) },
          { name: 'Load configuration', click: () => document.getElementById('configInput').click() },
          {
            name  : 'Reset configuration',
            click : () => {
              ConfigManager.clear();
              const loadedConfig = ConfigManager.loadOrDefaults();
              ConfigManager.deepMerge(this.options, loadedConfig);
              this.controls.reload();
            }
          }
        ]
      },
      {
        name     : 'Project',
        elements : [
          {
            name  : 'New Project',
            click : () => {
              this.projectPanel.showNewProjectDialog();
            }
          },
          {
            name  : 'Project Manager',
            click : () => {
              this.projectPanel.show();
            }
          },
          {
            name  : 'Save Project',
            click : () => {
              this.projectPanel.saveCurrentProject();
            }
          },
          {
            name  : 'Export Project',
            click : () => {
              this.projectPanel.exportCurrentProject();
            }
          }
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
          },
          {
            name  : 'Scene overwiew',
            click : () => this.#toggleVisibility('#overview')
          },
          {
            name  : 'Enter / exit fullscreen',
            click : () => this.#toggleFullscreen()
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
        click   : () => this.scene.view.zoomIn()
      },
      {
        tooltip : 'Zoom out',
        icon    : './icons/zoom_out.svg',
        click   : () => this.scene.view.zoomOut()
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
        tooltip  : 'Line color mode',
        icon     : './icons/cl_color.svg',
        elements : [
          { id: 'global', title: 'Global color' },
          { id: 'gradientByZ', title: 'Gradient by Z' },
          { id: 'gradientByDistance', title: 'Gradient by distance' },
          { id: 'percave', title: 'Per cave' },
          { id: 'persurvey', title: 'Per survey' }
        ].map((e) => ({
          name     : e.title,
          selected : this.options.scene.caveLines.color.mode === e.id,
          click    : () => {
            this.options.scene.caveLines.color.mode = e.id;
          }
        }))
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
        tooltip : 'Shortest path between points',
        icon    : './icons/shortest_path.svg',
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
    const createMenu = (name, elements, disabled = false) => {
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
      b.disabled = disabled;

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

    const createIcon = (tooltip, icon, selectable, selected, click, elements = [], width = 20, height = 20) => {
      const a = document.createElement('a');
      const c = document.createElement('div');
      c.setAttribute('class', 'mydropdown-content');
      c.setAttribute('id', 'myDropdown');
      c.style.left = '0px';
      c.style.top = '47px';

      if (elements.length > 0) {
        elements.forEach((e) => {
          const al = document.createElement('a');
          if (e.selected) {
            al.classList.add('selected');
          }
          al.appendChild(document.createTextNode(e.name));
          al.onclick = () => {
            al.parentNode.querySelectorAll('a').forEach((c) => c.classList.remove('selected'));
            al.classList.add('selected');
            e.click();
          };
          c.appendChild(al);
        });
      }
      a.classList.add('mytooltip');
      a.classList.add('dropbtn');

      a.onclick = (event) => {

        if (elements.length > 0) {
          c.classList.toggle('mydropdown-show');
          // Add/remove class to parent to control tooltip visibility
          if (c.classList.contains('mydropdown-show')) {
            a.classList.add('dropdown-open');
          } else {
            a.classList.remove('dropdown-open');
          }
          document.querySelectorAll('.mydropdown-content').forEach((element) => {
            if (element !== c) {
              element.classList.remove('mydropdown-show'); // hide other visible menu elements
              // Remove dropdown-open class from other elements
              element.parentElement.classList.remove('dropdown-open');
            }
          });

        } else {

          if (a.hasAttribute('selectable')) {
            a.parentNode.querySelectorAll('a[selectable="true"]').forEach((c) => c.classList.remove('selected'));
            a.classList.add('selected');
          }

          click(event);
        }

      };

      if (icon !== undefined) {
        const img = document.createElement('img');
        img.setAttribute('class', 'dropbtn');
        img.setAttribute('src', icon);
        img.setAttribute('width', width);
        img.setAttribute('height', height);
        a.appendChild(img);
      }

      a.appendChild(c);

      const t = document.createElement('span');
      t.setAttribute('class', 'mytooltiptext');
      t.appendChild(document.createTextNode(tooltip));

      a.appendChild(t);
      if (selectable) {
        a.setAttribute('selectable', 'true');
      }

      if (selected === true) {
        a.classList.add('selected');
      }
      return a;
    };

    navbarHtmlElement.innerHTML = '';
    this.#getMenus().forEach((m) => navbarHtmlElement.appendChild(createMenu(m.name, m.elements, m.disabled)));
    this.#getIcons()
      .forEach((i) => {
        navbarHtmlElement.appendChild(
          createIcon(
            i.tooltip,
            i.icon,
            i.selectable,
            i.selected,
            i.click,
            i.elements,
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

  #toggleFullscreen() {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      } else if (document.documentElement.msRequestFullscreen) {
        document.documentElement.msRequestFullscreen();
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }
}

export { NavigationBar };
