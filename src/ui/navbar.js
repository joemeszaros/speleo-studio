/*
 * Copyright 2024 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';
import { ExportWindow } from '../io/export.js';
import { PDFPrintDialog } from './generate-pdf.js';
import { i18n } from '../i18n/i18n.js';
import { showErrorPanel } from './popups.js';
import { RotationTool } from './tool/rotation.js';
import { ShortestPathTool } from './tool/shortestpath.js';
import { DipStrikeCalculatorTool } from './tool/dipstrike.js';
import { RoseDiagramTool } from './tool/rosediagram.js';

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
    googleDriveSettings,
    projectPanel,
    exportPanel,
    printPanel
  ) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.printUtils = printUtils;
    this.interactive = interactive;
    this.projectManager = projectManager;
    this.projectSystem = projectSystem;
    this.googleDriveSettings = googleDriveSettings;
    this.projectPanel = projectPanel;
    this.exportPanel = exportPanel;
    this.printPanel = printPanel;
    this.listeners = [];
    // Icons with a dynamic `disabled` function are registered here so
    // we can re-evaluate their state when relevant data changes.
    this.dynamicIcons = [];
    this.#addNavbarClickListener();
    document.addEventListener('currentProjectChanged', () => {
      this.setFileMenuDisabled(false);
      this.#refreshDynamicIcons();
    });
    document.addEventListener('currentProjectDeleted', () => {
      this.setFileMenuDisabled(true);
      this.#refreshDynamicIcons();
    });
    document.addEventListener('modelsChanged', () => this.#refreshDynamicIcons());
    document.addEventListener('modelDeleted', () => this.#refreshDynamicIcons());
    document.addEventListener('spatialProjectionChanged', (e) => this.#updateProjectionIcon(e.detail.projection));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Listen for language changes and refresh navbar
    document.addEventListener('languageChanged', () => {
      this.#buildNavbar(domElement);
    });
    this.#buildNavbar(domElement);
  }

  #updateProjectionIcon(projection) {
    const img = document.querySelector('#projection-toggle img.dropbtn');
    if (!img) return;
    img.setAttribute('src', projection === 'perspective'
      ? 'icons/camera_perspective.svg'
      : 'icons/camera_ortho.svg');
  }

  #refreshDynamicIcons() {
    this.dynamicIcons.forEach(({ element, disabledFn }) => {
      const isDisabled = typeof disabledFn === 'function' ? disabledFn() : disabledFn;
      if (isDisabled) {
        element.setAttribute('disabled', '');
        element.classList.add('disabled');
      } else {
        element.removeAttribute('disabled');
        element.classList.remove('disabled');
      }
    });
  }

  onKeyDown(e) {

    const isEditable =
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target.isContentEditable;
    if (isEditable) return; // ignore normal typing

    this.listeners.forEach((l) => {
      if (
        e.key.toUpperCase() === l.key &&
        ((e.ctrlKey && l.crtl) || !l.crtl) &&
        ((e.shiftKey && l.shift) || (!l.shift && !e.shiftKey))
      ) {
        e.preventDefault();
        l.action(e);
      }
    });
  }

  setFileMenuDisabled(disabled) {
    const fileMenuButton = Array.from(document.querySelectorAll('.mydropdown .dropbtn'))
      .find((button) => button.textContent === i18n.t('ui.navbar.menu.file.name'));
    if (fileMenuButton) {
      fileMenuButton.disabled = disabled;
    }
  }

  #getMenus() {
    return [
      {
        name     : i18n.t('ui.navbar.menu.file.name'),
        disabled : this.projectSystem.getCurrentProject() === null,
        elements : [
          {
            name  : i18n.t('ui.navbar.menu.file.new'),
            click : () => {
              this.projectManager.addNewCave();
            },
            shortkeys : ['crtl⊕n']
          },
          {
            name  : i18n.t('ui.navbar.menu.file.open'),
            click : function () {
              document.getElementById('caveInput').click();
            },
            shortkeys : ['crtl⊕o']
          },
          {
            name  : i18n.t('ui.navbar.menu.file.export'),
            click : () => {
              new ExportWindow(
                this.db.getAllCaves(),
                this.projectSystem.getCurrentProject(),
                this.scene,
                this.exportPanel
              ).show();
            },
            shortkeys : ['crtl⊕h']
          },
          {
            name  : i18n.t('ui.navbar.menu.file.openModel'),
            click : function () {
              document.getElementById('modelInput').click();
            }
          },
          {
            name  : i18n.t('ui.navbar.menu.file.print'),
            click : () => {
              window.print();
            },
            shortkeys : ['crtl⊕p']
          },
          {
            name  : i18n.t('ui.navbar.menu.file.printPDF'),
            click : () => {

              if (this.scene.view.name !== 'planView') {
                showErrorPanel(i18n.t('ui.panels.pdfPrint.planViewRequired'));
                return;
              }

              new PDFPrintDialog(
                this.db.getAllCaves(),
                this.scene,
                this.projectSystem.getCurrentProject(),
                this.printPanel,
                this.options
              ).show();
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
            },
            shortkeys : ['crtl⊕shift⊕n']
          },
          {
            name  : i18n.t('ui.navbar.menu.project.manager'),
            click : () => {
              this.projectPanel.show();
            },
            shortkeys : ['crtl⊕shift⊕p']
          },
          {
            name     : i18n.t('ui.navbar.menu.project.export'),
            disabled : () => this.projectSystem.getCurrentProject() === null,
            click    : () => {
              const currentProject = this.projectSystem.getCurrentProject();
              if (currentProject) {
                this.projectPanel.exportProject(currentProject.id);
              }
            },
            shortkeys : ['crtl⊕shift⊕s']
          }
        ]
      },
      {
        name     : i18n.t('ui.navbar.menu.tools.name'),
        elements : [
          {
            name  : i18n.t('ui.navbar.menu.tools.dipStrike'),
            icon  : 'icons/strike.svg',
            click : () => {
              new DipStrikeCalculatorTool().show();
            }
          },
          {
            name     : i18n.t('ui.navbar.menu.tools.shortestPath'),
            icon     : 'icons/shortest_path.svg',
            disabled : () => this.db.getAllCaveNames().length === 0,
            click    : () => new ShortestPathTool(this.db, this.options, this.scene).show()
          },
          {
            name     : i18n.t('ui.navbar.menu.tools.roseDiagram'),
            icon     : 'icons/rose_diagram.svg',
            disabled : () => this.db.getAllCaveNames().length === 0,
            click    : () => new RoseDiagramTool(this.db).show()
          },
          {
            name  : i18n.t('ui.navbar.menu.tools.drive'),
            icon  : 'icons/drive.svg',
            click : () => this.googleDriveSettings.show()
          }
        ]
      },
      {
        name     : i18n.t('ui.navbar.menu.help.name'),
        elements : [
          {
            name  : i18n.t('ui.navbar.menu.help.manual'),
            click : () => window.open('manual/hu/index.html', '_blank')
          },
          {
            name  : i18n.t('ui.navbar.menu.help.attributeReference'),
            click : () => window.open('attributes.html', '_blank')
          },
          {
            name  : i18n.t('ui.navbar.menu.help.privacyPolicy'),
            click : () => window.open('pages/privacy-policy.html', '_blank')
          },
          {
            name  : i18n.t('ui.navbar.menu.help.termsOfService'),
            click : () => window.open('pages/terms-of-service.html', '_blank')
          },
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
        tooltip : i18n.t('ui.navbar.tooltips.zoomFit'),
        icon    : 'icons/zoom_fit.svg',
        click   : () => {
          const scenebb = this.scene.computeBoundingBox();
          const gridbb = new THREE.Box3().setFromObject(this.scene.grid.grid);
          const boundingBox = scenebb ?? gridbb;
          const center = boundingBox.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0);
          this.scene.view.panCameraTo(center);
          this.scene.view.fitScreen(boundingBox);
          this.scene.view.renderView();
        }

      },
      {
        tooltip   : i18n.t('ui.navbar.tooltips.zoomIn'),
        icon      : 'icons/zoom_in.svg',
        click     : () => this.scene.view.zoomIn(),
        shortkeys : ['crtl⊕+', 'crtl⊕=']
      },
      {
        tooltip   : i18n.t('ui.navbar.tooltips.zoomOut'),
        icon      : 'icons/zoom_out.svg',
        click     : () => this.scene.view.zoomOut(),
        shortkeys : ['crtl⊕-', 'crtl⊕_']
      },
      {
        tooltip     : i18n.t('ui.navbar.tooltips.plan'),
        selectable  : true,
        selectGroup : 'view',
        icon        : 'icons/plan.svg',
        click       : () => this.scene.changeView('plan'),
        shortkeys   : ['crtl⊕shift⊕1', 'crtl⊕shift⊕!']
      },
      {
        tooltip     : i18n.t('ui.navbar.tooltips.profile'),
        selectable  : true,
        selectGroup : 'view',
        icon        : 'icons/profile.svg',
        click       : () => this.scene.changeView('profile'),
        shortkeys   : ['crtl⊕shift⊕2', 'crtl⊕shift⊕@']
      },
      {
        tooltip     : i18n.t('ui.navbar.tooltips.3d'),
        selectable  : true,
        selectGroup : 'view',
        selected    : true,
        icon        : 'icons/3d.svg',
        click       : () => this.scene.changeView('spatial'),
        shortkeys   : ['crtl⊕shift⊕3', 'crtl⊕shift⊕#']
      },
      {
        // Projection-mode toggle. No "selected" state — the current mode is
        // conveyed entirely by which icon is shown (ortho cube vs perspective
        // cube), swapped via the spatialProjectionChanged event.
        tooltip  : i18n.t('ui.navbar.tooltips.projectionToggle'),
        id       : 'projection-toggle',
        icon     : this.options.scene.spatialView?.projection === 'perspective'
          ? 'icons/camera_perspective.svg'
          : 'icons/camera_ortho.svg',
        // Perspective is only useful when there is a 3D model to dolly into —
        // for cave-only projects keep the button disabled.
        disabled : () => this.db.getAllModelNames().length === 0,
        click    : () => {
          const current = this.options.scene.spatialView?.projection ?? 'ortho';
          this.options.scene.spatialView.projection = current === 'perspective' ? 'ortho' : 'perspective';
        }
      },
      {
        id       : 'bounding-box-toggle',
        tooltip  : i18n.t('ui.navbar.tooltips.boundingBox'),
        icon     : 'icons/bounding_box.svg',
        elements : [
          { id: 'off', icon: 'icons/bounding_box_off.svg', title: i18n.t('ui.navbar.boundingBoxModes.off') },
          { id: 'box', icon: 'icons/bounding_box.svg', title: i18n.t('ui.navbar.boundingBoxModes.box') },
          { id: 'boxWithProjections', icon: 'icons/bounding_box_projections.svg', title: i18n.t('ui.navbar.boundingBoxModes.boxWithProjections') }
        ].map((e) => ({
          name     : e.title,
          icon     : e.icon,
          selected : this.options.scene.boundingBox.mode === e.id,
          click    : () => {
            this.options.scene.boundingBox.mode = e.id;
          }
        }))
      },
      {
        tooltip  : i18n.t('ui.navbar.tooltips.lineColor'),
        icon     : 'icons/cl_color.svg',
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
        tooltip  : i18n.t('ui.navbar.tooltips.modelColor'),
        icon     : 'icons/model_color.svg',
        elements : [
          { id: 'gradientByZ', title: i18n.t('ui.navbar.modelColorModes.gradientByZ') },
          { id: 'perModel',    title: i18n.t('ui.navbar.modelColorModes.perModel') },
          { id: 'ownColor',    title: i18n.t('ui.navbar.modelColorModes.ownColor') }
        ].map((e) => ({
          name     : e.title,
          selected : this.options.scene.models.color.mode === e.id,
          click    : () => {
            this.options.scene.models.color.mode = e.id;
          }
        }))
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.grid'),
        icon    : 'icons/grid.svg',
        click   : () => this.scene.grid.roll()
      },
      {
        tooltip   : i18n.t('ui.navbar.tooltips.locate'),
        icon      : 'icons/locate.svg',
        click     : (event) => this.interactive.showLocateStationPanel(event.clientX),
        shortkeys : ['crtl⊕L']
      },
      {
        tooltip     : i18n.t('ui.navbar.tooltips.raycasting'),
        icon        : 'icons/raycasting.svg',
        selectable  : true,
        selectGroup : 'raycasting',
        selected    : this.interactive.raycastingEnabled,
        click       : () => this.interactive.toggleRaycasting(),
        shortkeys   : ['crtl⊕shift⊕R']
      },
      {
        tooltip   : i18n.t('ui.navbar.tooltips.rotation'),
        icon      : 'icons/rotate.svg',
        click     : () => new RotationTool(this.scene).show(),
        shortkeys : ['crtl⊕R']
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.fullscreen'),
        icon    : 'icons/fullscreen.svg',
        click   : () => this.#toggleFullscreen()
      },
      {
        tooltip : i18n.t('ui.navbar.tooltips.donate'),
        icon    : 'icons/donate.svg',
        click   : () => window.open('manual/hu/14-tamogatas.html', '_blank')
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

    // Re-initialize shortkey + dynamic-icon registries so language-change
    // rebuilds don't leak stale references into the old DOM.
    this.listeners = [];
    this.dynamicIcons = [];

    const addShortkeys = (shortkeys, clickEvent) => {
      shortkeys.forEach((shortkey) => {
        const parts = shortkey.split('⊕');
        const key = parts[parts.length - 1].toUpperCase();
        const hasCtrl = parts.length > 1 && parts[0] === 'crtl';
        const hasShift = parts.length > 1 && parts[1] === 'shift';
        this.listeners.push({
          key,
          crtl   : hasCtrl,
          shift  : hasShift,
          action : clickEvent
        });
      });
    };

    const shortKeyText = (shortkeys, label) => {
      if (shortkeys) {
        const firstShortKeyParts = shortkeys[0].split('⊕');
        const key = firstShortKeyParts.at(-1);
        const hasShift = firstShortKeyParts.length > 1 && firstShortKeyParts[1] === 'shift';
        const hasCtrl = firstShortKeyParts.length > 1 && firstShortKeyParts[0] === 'crtl';
        return `${label} (${hasCtrl ? 'Ctrl + ' : ''}${hasShift ? 'Shift + ' : ''}${key.toUpperCase()})`;
      } else {
        return label;
      }
    };

    const createMenu = (name, elements, disabled = false, iconSize = 20) => {
      const c = document.createElement('div');
      c.setAttribute('class', 'mydropdown-content');
      c.setAttribute('id', 'myDropdown');

      const dynamicItems = [];

      elements.forEach((e) => {
        const a = document.createElement('a');
        if (e.icon !== undefined) {
          const img = document.createElement('img');
          img.setAttribute('src', e.icon);
          img.setAttribute('width', iconSize);
          img.setAttribute('height', iconSize);
          a.appendChild(img);
        }
        a.appendChild(document.createTextNode(shortKeyText(e.shortkeys, e.name)));
        if (e.disabled) {
          dynamicItems.push({ element: a, disabledFn: e.disabled, clickFn: e.click });
          a.onclick = () => {
            if (!a.hasAttribute('disabled')) e.click();
          };
        } else {
          a.onclick = e.click;
        }
        if (e.shortkeys) {
          addShortkeys(e.shortkeys, e.click);
        }
        c.appendChild(a);
      });

      const updateDynamicItems = () => {
        dynamicItems.forEach(({ element, disabledFn }) => {
          const isDisabled = typeof disabledFn === 'function' ? disabledFn() : disabledFn;
          if (isDisabled) {
            element.setAttribute('disabled', '');
            element.classList.add('disabled');
          } else {
            element.removeAttribute('disabled');
            element.classList.remove('disabled');
          }
        });
      };
      updateDynamicItems();

      const d = document.createElement('div');
      d.setAttribute('class', 'mydropdown');
      const b = document.createElement('button');
      b.setAttribute('class', 'dropbtn');
      b.disabled = disabled;

      b.onclick = function () {
        updateDynamicItems();
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

    const createIcon = (
      tooltip,
      icon,
      selectable,
      selected,
      selectGroup,
      click,
      elements = [],
      shortkeys,
      width = 20,
      height = 20,
      disabled = false,
      id = null
    ) => {
      const a = document.createElement('a');
      const c = document.createElement('div');
      c.setAttribute('class', 'mydropdown-content');
      c.setAttribute('id', 'myDropdown');
      if (selectGroup) {
        a.setAttribute('selectGroup', selectGroup);
      }
      if (id) {
        a.setAttribute('id', id);
      }

      c.style.left = '0px';
      c.style.top = '47px';

      if (elements.length > 0) {
        elements.forEach((e) => {
          const al = document.createElement('a');
          if (e.selected) {
            al.classList.add('selected');
          }
          if (e.icon) {
            const iconImg = document.createElement('img');
            iconImg.setAttribute('src', e.icon);
            iconImg.setAttribute('alt', '');
            al.appendChild(iconImg);
          }
          al.appendChild(document.createTextNode(shortKeyText(e.shortkeys, e.name)));
          al.onclick = () => {
            al.parentNode.querySelectorAll('a').forEach((c) => c.classList.remove('selected'));
            al.classList.add('selected');
            e.click();
          };

          if (e.shortkeys) {
            addShortkeys(e.shortkeys, e.click);
          }

          c.appendChild(al);
        });
      }
      a.classList.add('mytooltip');
      a.classList.add('dropbtn');

      const clickEvent = (event) => {

        // Guard against clicks (and shortkeys) when the icon is disabled.
        if (a.hasAttribute('disabled')) return;

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
            const group = a.getAttribute('selectGroup');
            const groupItems = a.parentNode
              .querySelectorAll('a[selectable="true"][selectGroup="' + group + '"]');
            if (groupItems.length === 1) {
              groupItems[0].classList.toggle('selected');
            } else {
              groupItems.forEach((c) => c.classList.remove('selected'));
              a.classList.add('selected');
            }

          }

          click(event);
        }

      };

      if (shortkeys) {
        addShortkeys(shortkeys, clickEvent);
      }
      a.onclick = clickEvent;

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
      const tooltipText = shortKeyText(shortkeys, tooltip);
      t.appendChild(document.createTextNode(tooltipText));

      a.appendChild(t);
      if (selectable) {
        a.setAttribute('selectable', 'true');
      }

      if (selected === true) {
        a.classList.add('selected');
      }

      // Apply disabled state and, when `disabled` is a function, register for
      // re-evaluation on relevant data changes (currentProjectChanged,
      // modelsChanged, etc.).
      if (disabled !== undefined && disabled !== false) {
        const isDisabled = typeof disabled === 'function' ? disabled() : disabled;
        if (isDisabled) {
          a.setAttribute('disabled', '');
          a.classList.add('disabled');
        }
        if (typeof disabled === 'function') {
          this.dynamicIcons.push({ element: a, disabledFn: disabled });
        }
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
            i.selectGroup,
            i.click,
            i.elements,
            i.shortkeys,
            i.width === undefined ? 20 : i.width,
            i.height === undefined ? 20 : i.height,
            i.disabled,
            i.id
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

  async #showAboutDialog() {
    let aboutDialog = document.getElementById('about-dialog');
    if (!aboutDialog) {
      aboutDialog = document.createElement('div');
      document.body.appendChild(aboutDialog);
    }

    const response = await fetch('.version');
    let version;
    if (!response.ok) {
      version = 'unavailable';
    } else {
      version = await response.text();
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
              <a href="manual/hu/index.html" target="_blank" class="about-link">
                <span class="about-link-icon">📖</span>
                ${i18n.t('ui.about.links.manual')}
              </a>
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
          ${version !== 'unavailable' ? `<div class="about-version">${version}</div>` : ''}
        </div>
      `;

    // Show the dialog
    aboutDialog.style.display = 'block';
  }
}

export { NavigationBar };
