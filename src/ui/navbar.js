import { Exporter } from '../io/export.js';
import { i18n } from '../i18n/i18n.js';

class NavigationBar {

  /**
   *
   * @param {HTMLElement} domElement - The HTML DOM element of the navigation bar
   * @param {Map<String, Map>} options - Global project options, like global visibility of an object
   * @param {MyScene} scene - The 3D scene
   */
  constructor(
    db,
    domElement,
    options,
    scene,
    printUtils,
    interactive,
    projectManager,
    projectSystem,
    projectPanel,
    exportPanel
  ) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.printUtils = printUtils;
    this.interactive = interactive;
    this.projectManager = projectManager;
    this.projectSystem = projectSystem;
    this.projectPanel = projectPanel;
    this.exportPanel = exportPanel;
    this.#addNavbarClickListener();
    document.addEventListener('currentProjectChanged', () => this.setFileMenuDisabled(false));
    document.addEventListener('currentProjectDeleted', () => this.setFileMenuDisabled(true));

    // Listen for language changes and refresh navbar
    document.addEventListener('languageChanged', () => {
      this.#buildNavbar(domElement);
    });
    this.#buildNavbar(domElement);
  }

  setFileMenuDisabled(disabled) {
    const fileMenuButton = Array.from(document.querySelectorAll('.mydropdown .dropbtn'))
      .find((button) => button.textContent === i18n.t('ui.navbar.menu.file.name'));
    if (fileMenuButton) {
      fileMenuButton.disabled = disabled;
    }
  }

  showDipStrikeCalculator() {
    this.interactive.showDipStrikeCalculatorPanel();
  }

  #getMenus() {
    return [
      {
        name     : i18n.t('ui.navbar.menu.file.name'),
        disabled : this.projectSystem.getCurrentProject() === undefined,
        elements : [
          {
            name  : i18n.t('ui.navbar.menu.file.new'),
            click : () => {
              this.projectManager.addNewCave();
            }
          },
          {
            name  : i18n.t('ui.navbar.menu.file.open'),
            click : function () {
              document.getElementById('caveInput').click();
            }
          },
          {
            name  : i18n.t('ui.navbar.menu.file.export'),
            click : () =>
              Exporter.showExportDialog(
                this.db.getAllCaves(),
                this.projectSystem.getCurrentProject(),
                this.scene,
                this.exportPanel
              )
          },
          {
            name  : i18n.t('ui.navbar.menu.file.openModel'),
            click : function () {
              document.getElementById('modelInput').click();
            }
          }
        ]
      },
      {
        name     : i18n.t('ui.navbar.menu.project.name'),
        elements : [
          {
            name  : i18n.t('ui.navbar.menu.project.new'),
            click : () => {
              this.projectPanel.showNewProjectDialog();
            }
          },
          {
            name  : i18n.t('ui.navbar.menu.project.manager'),
            click : () => {
              this.projectPanel.show();
            }
          },
          {
            name  : i18n.t('ui.navbar.menu.project.export'),
            click : () => {
              this.projectPanel.exportCurrentProject();
            }
          }
        ]
      },
      {
        name     : i18n.t('ui.navbar.menu.tools.name'),
        elements : [
          {
            name  : i18n.t('ui.navbar.menu.tools.dipStrike'),
            click : () => {
              this.showDipStrikeCalculator();
            }
          }
        ]
      },
      {
        name     : i18n.t('ui.navbar.menu.help.name'),
        elements : [
          {
            name  : i18n.t('ui.navbar.menu.help.about'),
            click : () => this.#showAboutDialog()
          }
        ]
      }
    ];
  }

  #getIcons() {
    return [
      {
        tooltip : i18n.t('ui.navbar.tooltips.print'),
        icon    : './icons/print.svg',
        click   : () => {
          this.printUtils.printScene();
        }
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.zoomFit'),
        icon    : './icons/zoom_fit.svg',
        click   : () => this.scene.view.fitScreen(this.scene.computeBoundingBox())
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.zoomIn'),
        icon    : './icons/zoom_in.svg',
        click   : () => this.scene.view.zoomIn()
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.zoomOut'),
        icon    : './icons/zoom_out.svg',
        click   : () => this.scene.view.zoomOut()
      },
      {
        tooltip    : i18n.t('ui.navbar.tooltips.plan'),
        selectable : true,
        icon       : './icons/plan.svg',
        click      : () => this.scene.changeView('plan')
      },
      {
        tooltip    : i18n.t('ui.navbar.tooltips.profile'),
        selectable : true,
        icon       : './icons/profile.svg',
        click      : () => this.scene.changeView('profile')
      },
      {
        tooltip    : i18n.t('ui.navbar.tooltips.3d'),
        selectable : true,
        selected   : true,
        icon       : './icons/3d.svg',
        click      : () => this.scene.changeView('spatial')
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.boundingBox'),
        icon    : './icons/bounding_box.svg',
        click   : () => this.scene.toogleBoundingBox()
      },
      {
        tooltip  : i18n.t('ui.navbar.tooltips.lineColor'),
        icon     : './icons/cl_color.svg',
        elements : [
          { id: 'global', title: i18n.t('ui.navbar.lineColorModes.global') },
          { id: 'gradientByZ', title: i18n.t('ui.navbar.lineColorModes.gradientByZ') },
          { id: 'gradientByDistance', title: i18n.t('ui.navbar.lineColorModes.gradientByDistance') },
          { id: 'percave', title: i18n.t('ui.navbar.lineColorModes.percave') },
          { id: 'persurvey', title: i18n.t('ui.navbar.lineColorModes.persurvey') }
        ].map((e) => ({
          name     : e.title,
          selected : this.options.scene.caveLines.color.mode === e.id,
          click    : () => {
            this.options.scene.caveLines.color.mode = e.id;
          }
        }))
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.grid'),
        icon    : './icons/grid.svg',
        click   : () => this.scene.grid.roll()
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.locate'),
        icon    : './icons/locate.svg',
        click   : (event) => this.interactive.showLocateStationPanel(event.clientX)
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.shortestPath'),
        icon    : './icons/shortest_path.svg',
        click   : (event) => this.interactive.showShortestPathPanel(event.clientX)
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.fullscreen'),
        icon    : './icons/fullscreen.svg',
        click   : () => this.#toggleFullscreen()
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
    navbarHtmlElement.appendChild(i18n.getLanguageSelector());
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

  #showAboutDialog() {
    let aboutDialog = document.getElementById('about-dialog');
    if (!aboutDialog) {
      aboutDialog = document.createElement('div');
      document.body.appendChild(aboutDialog);
    }
    aboutDialog.id = 'about-dialog';
    aboutDialog.className = 'about-dialog';
    aboutDialog.innerHTML = `
        <div class="about-container">
          <div class="about-header">
            <img src="images/logo.png" alt="Speleo Studio Logo" class="about-logo" />
            <h2 class="about-title">${i18n.t('ui.about.title')}</h2>
            <button class="about-close-btn" onclick="this.closest('.about-dialog').style.display='none'">×</button>
          </div>
          <div class="about-content">
            <p class="about-description">
              ${i18n.t('ui.about.description')}
            </p>
            <div class="about-features">
              <h3>${i18n.t('ui.about.keyFeatures')}</h3>
              <ul>
                <li>${i18n.t('ui.about.features.3d')}</li>
                <li>${i18n.t('ui.about.features.survey')}</li>
                <li>${i18n.t('ui.about.features.navigation')}</li>
                <li>${i18n.t('ui.about.features.editing')}</li>
                <li>${i18n.t('ui.about.features.export')}</li>
                <li>${i18n.t('ui.about.features.management')}</li>
                <li>${i18n.t('ui.about.features.surface')}</li>
              </ul>
            </div>
            <div class="about-links">
              <a href="https://github.com/joemeszaros/speleo-studio/" target="_blank" class="about-link">
                <span class="about-link-icon">📂</span>
                ${i18n.t('ui.about.links.github')}
              </a>
              <a href="https://joemeszaros.github.io/speleo-studio/" target="_blank" class="about-link">
                <span class="about-link-icon">🌐</span>
                ${i18n.t('ui.about.links.live')}
              </a>
            </div>
          </div>
        </div>
      `;

    // Show the dialog
    aboutDialog.style.display = 'block';
  }
}

export { NavigationBar };
