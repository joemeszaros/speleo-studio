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

import { showErrorPanel, showSuccessPanel, showInfoPanel } from './popups.js';
import * as U from '../utils/utils.js';
import { i18n } from '../i18n/i18n.js';
import { DriveProject, DriveModelMetadata, FatProject, Project, FatProjects } from '../model/project.js';
import { Cave, DriveCaveMetadata } from '../model/cave.js';
import { CoordinateSystem } from '../model/geo.js';
import { RevisionInfo } from '../model/misc.js';
import { LoadingOverlay } from './loading-overlay.js';

export class ProjectPanel {
  constructor(
    db,
    panel,
    projectSystem,
    caveSystem,
    googleDriveSync,
    revisionStore,
    attributeDefs,
    projectInput = 'projectInput',
    modelSystem = null
  ) {
    this.db = db;
    this.panel = panel;
    this.projectSystem = projectSystem;
    this.caveSystem = caveSystem;
    this.googleDriveSync = googleDriveSync;
    this.revisionStore = revisionStore;
    this.attributeDefs = attributeDefs;
    this.modelSystem = modelSystem;
    this.isVisible = false;
    this.fileInputElement = document.getElementById(projectInput);
    this.driveProjects = new Map();
    this.clickHandlerActive = false;
    this.driveOperationsController = null;
    this.loadingOverlay = new LoadingOverlay();

    document.addEventListener('languageChanged', () => {
      this.setupPanel();
      if (this.isVisible) {
        this.updateDisplay();
      }
    });

    this.fileInputElement.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      await this.loadingOverlay.guard(i18n.t('ui.panels.projectManager.importing'), async () => {
        try {
          const result = await FatProject.deserialize(file, this.attributeDefs);
          if (result instanceof FatProjects) {
            await U.sequential(
              result.projects.map((fatProject) => async () => {
                await this.importFatProject(fatProject, this.attributeDefs);
              })
            );
          } else {
            await this.importFatProject(result, this.attributeDefs);
          }
        } catch (error) {
          console.error(i18n.t('ui.panels.projectManager.errors.projectImportFailed'), error);
          showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectImportFailed', { error: error.message }));
        }
      });

      this.fileInputElement.value = '';
    });
  }

  async createClickHandler(event, uploadFunction) {

    if (this.clickHandlerActive) {
      event.preventDefault();
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.syncInProgress'));
      return;
    }

    // Check if Google Drive sync is in progress
    if (this.googleDriveSync.isSyncing) {
      event.preventDefault();
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.syncInProgress'));
      return;
    }

    this.clickHandlerActive = true;
    // Disable the button and show syncing state
    const button = event.target;
    button.disabled = true;
    button.classList.add('disabled');

    try {
      await uploadFunction();
    } finally {
      // Re-enable the button
      button.disabled = false;
      button.classList.remove('disabled');
      this.clickHandlerActive = false;
    }
  }

  setupPanel() {
    this.panel.innerHTML = `
      <div class="project-panel-header">
        <h3>${i18n.t('ui.panels.projectManager.title')}</h3>
        <button id="new-project-btn" class="project-btn">${i18n.t('common.new')}</button>
        <button id="import-project-btn" class="project-btn">${i18n.t('common.import')}</button>
        <button id="export-project-btn" class="project-btn">${i18n.t('common.export')}</button>
        <button id="refresh-panel-btn" class="project-btn"><img src="icons/drive.svg" class="drive-icon"/>${i18n.t('common.refresh')}</button>

        <button class="project-panel-close" id="close-panel-btn">×</button>
      </div>
      
      <div class="project-panel-content">
        <div class="current-project-section">
          <h4>${i18n.t('ui.panels.projectManager.current')}</h4>
          <div id="current-project-info">
            <p>${i18n.t('ui.panels.projectManager.noProject')}</p>
          </div>
        </div>
        
        <div class="recent-projects-section">
          <h4>${i18n.t('ui.panels.projectManager.recentProjects')}</h4>
          <div class="project-search-container">
            <input type="text" id="project-search" placeholder="${i18n.t('ui.panels.projectManager.searchProjects')}" class="project-search-input">
          </div>
          <div id="recent-projects-list">
            <p>${i18n.t('ui.panels.projectManager.noRecentProjects')}</p>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  setupEventListeners() {
    const newProjectBtn = this.panel.querySelector('#new-project-btn');
    const importProjectBtn = this.panel.querySelector('#import-project-btn');
    const exportProjectBtn = this.panel.querySelector('#export-project-btn');
    const projectSearch = this.panel.querySelector('#project-search');
    const refreshPanelBtn = this.panel.querySelector('#refresh-panel-btn');
    const closePanelBtn = this.panel.querySelector('#close-panel-btn');

    newProjectBtn.addEventListener('click', () => this.showNewProjectDialog());
    importProjectBtn.addEventListener('click', () => this.fileInputElement.click());
    exportProjectBtn.addEventListener('click', async () => await this.exportAllProjects());
    projectSearch.addEventListener('input', () => this.filterProjects());
    refreshPanelBtn.addEventListener('click', () => this.updateDisplay());
    closePanelBtn.addEventListener('click', () => this.hide());
  }

  show() {
    this.isVisible = true;
    this.panel.style.display = 'block';
    // Create a new AbortController for Google Drive operations
    this.driveOperationsController = new AbortController();
    this.updateDisplay();
  }

  hide() {
    this.isVisible = false;
    this.panel.style.display = 'none';
    // Cancel any pending Google Drive operations
    if (this.driveOperationsController) {
      this.driveOperationsController.abort();
      this.driveOperationsController = null;
    }
  }

  async updateDisplay() {
    await this.updateCurrentProjectInfo();
    await this.updateRecentProjectsList();
  }

  async updateCurrentProjectInfo() {
    const currentProjectInfo = this.panel.querySelector('#current-project-info');
    const currentProject = this.projectSystem.getCurrentProject();

    if (currentProject) {
      const caveNames = await this.projectSystem.getCaveNamesForProject(currentProject.id);
      const caveCount = caveNames.length;
      const modelCount = this.modelSystem
        ? (await this.modelSystem.getModelFilesByProject(currentProject.id)).length
        : 0;
      const lastModified = new Date(currentProject.updatedAt).toLocaleString();

      const metaParts = [];
      if (caveCount > 0) metaParts.push(`${caveCount} ${i18n.t('ui.panels.projectManager.caves')}`);
      if (modelCount > 0) metaParts.push(`${modelCount} ${i18n.t('ui.panels.projectManager.models')}`);
      metaParts.push(lastModified);
      const metaText = metaParts.join(' • ');

      currentProjectInfo.innerHTML = `
        <div class="project-info">
          <div class="current-project-header">
            <span class="current-project-name">${currentProject.name}</span>
            <span class="current-project-meta">${metaText}</span>
          </div>
          ${currentProject.description ? `<div class="current-project-description">${currentProject.description}</div>` : ''}
          <div class="current-project-actions">
            <button id="save-project-btn" class="project-btn">${i18n.t('common.save')}</button>
            <button id="export-project-btn" class="project-btn">${i18n.t('common.export')}</button>
            <button id="rename-project-btn" class="project-btn">${i18n.t('common.rename')}</button>
          </div>
        </div>
      `;

      // Add event listeners for the dynamically created buttons
      const saveProjectBtn = currentProjectInfo.querySelector('#save-project-btn');
      const exportProjectBtn = currentProjectInfo.querySelector('#export-project-btn');
      const renameProjectBtn = currentProjectInfo.querySelector('#rename-project-btn');
      if (saveProjectBtn) {
        saveProjectBtn.addEventListener('click', () => this.saveCurrentProject());
      }
      if (exportProjectBtn) {
        exportProjectBtn.addEventListener('click', () => {
          if (!currentProject) {
            showErrorPanel(i18n.t('ui.panels.projectManager.noProjectToExport'));
            return;
          }
          this.exportProject(currentProject.id);
        });
      }
      if (renameProjectBtn) {
        renameProjectBtn.addEventListener('click', () => {
          this.renameProject(currentProject.id);

        });
      }
    } else {
      currentProjectInfo.innerHTML = `<p>${i18n.t('ui.panels.projectManager.noProject')}</p>`;
    }
  }

  getProjectItemNode(project, caveNames, modelNames, lastModified, isCurrent, isLocal, coordinateSystems = []) {
    const buttons = [
      { label: i18n.t('common.rename'), click: () => this.renameProject(project.id) },
      { label: i18n.t('common.export'), click: () => this.exportProject(project.id) },
      {
        id    : 'delete-project-btn',
        label : i18n.t('common.delete'),
        click : async (event) => await this.createClickHandler(event, async () => await this.deleteProject(project))
      }
    ];

    return this.projectItemNode(
      project,
      caveNames,
      modelNames,
      buttons,
      lastModified,
      isCurrent,
      isLocal,
      coordinateSystems
    );
  }

  async updateRecentProjectsList() {
    const recentProjectsList = this.panel.querySelector('#recent-projects-list');

    try {
      const projects = await this.projectSystem.getAllProjects();

      if (projects.length === 0) {
        recentProjectsList.innerHTML = `<p>${i18n.t('ui.panels.projectManager.noProjectsFound')}</p>`;
      }
      // Sort by updatedAt (most recent first)
      projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      const cavesForLocalProjects = new Map();
      this.driveProjects.clear();
      const projectListItems = await Promise.all(
        projects.map(async (project) => {
          const caves = await this.caveSystem.getCaveFieldsByProjectId(project.id, [
            'name',
            'id',
            'revision',
            'geoData'
          ]);
          cavesForLocalProjects.set(project.id, caves);
          const caveNames = caves.map((c) => c.name);
          const coordinateSystems = [
            ...new Set(
              caves
                .map((c) => c.geoData?.coordinateSystem)
                .filter(Boolean)
                .map((cs) => CoordinateSystem.fromPure(cs).toString())
            )
          ];
          const modelMetadata = this.modelSystem ? await this.modelSystem.getModelMetadataByProject(project.id) : [];
          const modelNames = modelMetadata.map((m) => m.name);
          const lastModified = new Date(project.updatedAt).toLocaleDateString();
          const isCurrent = this.projectSystem.getCurrentProject()?.id === project.id;
          return this.getProjectItemNode(
            project,
            caveNames,
            modelNames,
            lastModified,
            isCurrent,
            true,
            coordinateSystems
          );
        })
      );

      recentProjectsList.innerHTML = '';
      projectListItems.forEach((item) => {
        recentProjectsList.appendChild(item);
      });

      let driveProjectFiles = [];
      let driveAuthenticated = false;
      const signal = this.driveOperationsController?.signal;

      if (this.googleDriveSync.config.isConfigured()) {
        try {
          if (this.googleDriveSync.config.hasTokens() && !this.googleDriveSync.config.hasValidTokens()) {
            console.log('Refresh access tokens');
            await this.googleDriveSync.refreshToken();
          }

          if (signal?.aborted) return;

          if (this.googleDriveSync.config.hasValidTokens()) {
            driveProjectFiles = await this.googleDriveSync.listProjects();
            driveAuthenticated = true;
          }
        } catch (error) {
          console.error('Failed to list Google Drive projects', error);
        }

        if (driveProjectFiles.length > 0 && !signal?.aborted) {

          // sequential needs a promise function and not a promise which is immediately executed
          const promises = driveProjectFiles.map((file) => async () => {
            if (signal?.aborted) return;

            const response = await this.googleDriveSync.fetchProjectByFile(file);
            if (signal?.aborted) return;

            if (response) {
              const projectId = response.project.project.id;
              this.driveProjects.set(projectId, response.project);
              const projectItemNode = recentProjectsList.querySelector(`#project-item-${projectId}`);

              if (projectItemNode !== null) {

                await this.decorateProjectItemWithDrive(
                  response.project,
                  projects,
                  cavesForLocalProjects.get(projectId),
                  projectItemNode
                );

              } else {
                const newNode = this.getProjectItemForDriveProject(response.project);
                recentProjectsList.appendChild(newNode);
              }
            }
          });

          await U.sequential(promises);
        }

        if (signal?.aborted) return;

        // Only show upload buttons when Drive is authenticated
        if (driveAuthenticated) {
          const localProjects = projects.filter((p) => !this.driveProjects.has(p.id));
          localProjects.forEach((project) => {
            const button = U.node`<button class="project-action-btn">${i18n.t('common.upload')}</button>`;
            const buttonContainer = recentProjectsList.querySelector(`#project-item-actions-${project.id}`);
            const crsSpan = buttonContainer.querySelector('.project-crs');
            crsSpan ? buttonContainer.insertBefore(button, crsSpan) : buttonContainer.appendChild(button);
            button.addEventListener(
              'click',
              async (event) => await this.createClickHandler(event, async () => await this.uploadProject(project))
            );
          });
        }
      }

    } catch (error) {
      const errorMessage = i18n.t('ui.panels.projectManager.errorLoadingProjects');
      recentProjectsList.innerHTML = `<p>${errorMessage}</p>`;
      console.error(errorMessage, error);
    }
  }

  async decorateProjectItemWithDrive(driveProject, projects, caves, projectItemNode) {

    const localProject = projects.find((p) => p.id === driveProject.project.id);
    try {
      // we need an updated cave list and a sync button
      const caveList = await this.getCaveList(caves, driveProject);
      const projectSyncInfo = await this.getProjectSyncInfo(driveProject, localProject);

      const embeddedModels = this.modelSystem
        ? await this.modelSystem.getModelsForExport(localProject.id)
        : [];
      const modelSyncInfo = await this.getModelSyncInfo(embeddedModels, driveProject);

      const projectNameElmnt = projectItemNode.querySelector(`#project-name-${localProject.id}`);
      projectNameElmnt.innerHTML = projectSyncInfo.decoratedName;
      projectNameElmnt.title = i18n.t('ui.panels.projectManager.projectId') + ': ' + driveProject?.project?.id;
      const projectCavesElmnt = projectItemNode.querySelector(`#project-caves-${localProject.id}`);
      const allDecorated = [
        ...caveList.map((c) => c.decoratedName),
        ...modelSyncInfo.map((m) => m.decoratedName)
      ];
      projectCavesElmnt.innerHTML = ' • ' + allDecorated.join(', ');
      projectCavesElmnt.title = this.getTooltipText(caveList);
      const projectInfoElmnt = projectItemNode.querySelector(`#project-item-info-${localProject.id}`);
      projectInfoElmnt.insertBefore(
        U.node`<img src="icons/drive.svg" class="drive-icon"/>`,
        projectInfoElmnt.firstChild
      );

      const syncEnabled =
        (projectSyncInfo.diff ?? 0) !== 0 ||
        (projectSyncInfo.hasConflict && projectSyncInfo.diff === 0) ||
        caveList.some(
          (c) =>
            ['new', 'remote', 'remoteDeleted', 'localDeleted'].includes(c.state) ||
            (c.diff ?? 0) !== 0 ||
            (c.hasConflict && c.diff === 0)
        ) ||
        modelSyncInfo.some(
          (m) => m.state === 'new' || (m.metaDiff ?? 0) !== 0 || (m.settingsDiff ?? 0) !== 0 || m.hasConflict
        );
      if (syncEnabled) {
        const cloudButton = U.node`<button id="sync-project-btn" class="project-action-btn sync">${i18n.t('common.sync')}</button>`;
        cloudButton.addEventListener(
          'click',
          async (event) =>
            await this.createClickHandler(
              event,
              async () =>
                await this.syncProject(localProject, driveProject, caveList, projectSyncInfo, modelSyncInfo, async (dProj) => {
                  const nCaves = await this.caveSystem.getCaveFieldsByProjectId(localProject.id, [
                    'name',
                    'id',
                    'revision'
                  ]);
                  const newNode = this.getProjectItemNode(
                    dProj.project,
                    nCaves.map((c) => c.name),
                    [],
                    new Date(localProject.updatedAt).toLocaleDateString(),
                    this.projectSystem.getCurrentProject()?.id === localProject.id,
                    true
                  );
                  const nProjects = await this.projectSystem.getAllProjects();
                  const decoratedNode = await this.decorateProjectItemWithDrive(dProj, nProjects, nCaves, newNode);
                  const projectItemNode = this.panel.querySelector(`#project-item-${localProject.id}`);
                  projectItemNode.replaceWith(decoratedNode);
                })
            )

        );
        const buttonContainer = projectItemNode.querySelector(`#project-item-actions-${localProject.id}`);
        buttonContainer.appendChild(cloudButton);

      }
    } catch (error) {
      console.error(error);
      const projectCavesElmnt = projectItemNode.querySelector(`#project-caves-${localProject.id}`);
      projectCavesElmnt.innerHTML += ` ⚠️ ${i18n.t('ui.panels.projectManager.errors.failedToDecorateProjectItemShort')}`;

      projectCavesElmnt.title = i18n.t('ui.panels.projectManager.errors.failedToDecorateProjectItem');
    }
    return projectItemNode;
  }

  // this is a drive project, without local copy, we need an item with a download button
  getProjectItemForDriveProject(driveProject) {
    const buttons = [
      {
        label : i18n.t('common.download'),
        click : async (event) =>
          await this.createClickHandler(event, async () => await this.downloadProject(driveProject))
      }
    ];
    const coordinateSystems = [
      ...new Set(
        driveProject.caves
          .map((c) => c.geoData?.coordinateSystem)
          .filter(Boolean)
          .map((cs) => CoordinateSystem.fromPure(cs).toString())
      )
    ];
    return this.projectItemNode(
      driveProject.project,
      driveProject.caves.map((c) => c.name).map((n) => `🔵 ${n}`),
      [],
      buttons,
      new Date(driveProject.project.updatedAt).toLocaleDateString(),
      false,
      false,
      coordinateSystems
    );
  }

  async getProjectSyncInfo(driveProject, localProject) {

    const driveRevision = driveProject.project.revision;
    const localRevisionInfo = await this.revisionStore.loadRevision(localProject.id);

    const hasLocalChanges = !localRevisionInfo.synced;

    let hasConflict;
    const diff = localRevisionInfo.revision - driveRevision;

    if (diff > 0) {
      hasConflict = !(
        localRevisionInfo.originRevision === driveRevision && localRevisionInfo.originApp === driveProject.app
      );
    } else if (diff < 0) {
      hasConflict = hasLocalChanges;
    } else {
      hasConflict = hasLocalChanges;
    }

    let prefix = hasConflict ? '⚠️' : '';
    let diffStr = '';
    let projectName = localProject.name;

    if (diff > 0) {
      diffStr = `(<span style="color: green"><strong>Δ ${diff}</strong></span>)`;
    } else if (diff < 0) {
      diffStr = `(<span style="color: red"><strong>∇ ${Math.abs(diff)}</strong></span>)`;
    }
    return {
      diff,
      hasConflict,
      name          : projectName,
      decoratedName : `${prefix} ${projectName} ${diffStr}`,
      drive         : { app: driveProject.app }
    };

  }

  getConflictMessages(caveList, projectSyncInfo) {
    const conflictMessages = caveList
      .filter((c) => c.hasConflict)
      .map((c) => {
        if (c.diff === 0) {
          return i18n.t('ui.panels.projectManager.errors.conflictSameRevision', {
            name : c.name,
            app  : this.#getAppName(c.drive.app)
          });
        } else if (c.diff > 0) {
          return i18n.t('ui.panels.projectManager.errors.conflictLocalChanges', {
            name : c.name,
            app  : this.#getAppName(c.drive.app)
          });
        } else {
          return i18n.t('ui.panels.projectManager.errors.conflictRemoteChanges', {
            name : c.name,
            app  : this.#getAppName(c.drive.app)
          });
        }
      });

    if (projectSyncInfo.hasConflict) {
      if (projectSyncInfo.diff > 0) {
        conflictMessages.push(
          i18n.t('ui.panels.projectManager.errors.conflictProjectLocalChanges', {
            name : projectSyncInfo.name,
            app  : this.#getAppName(projectSyncInfo.drive.app)
          })
        );
      } else if (projectSyncInfo.diff < 0) {
        conflictMessages.push(
          i18n.t('ui.panels.projectManager.errors.conflictProjectRemoteChanges', {
            name : projectSyncInfo.name,
            app  : this.#getAppName(projectSyncInfo.drive.app)
          })
        );
      } else {
        conflictMessages.push(
          i18n.t('ui.panels.projectManager.errors.conflictProjectSameRevision', {
            name : projectSyncInfo.name,
            app  : this.#getAppName(projectSyncInfo.drive.app)
          })
        );
      }
    }
    return conflictMessages;
  }

  #getAppName(app) {
    const _pos = app.lastIndexOf('_');
    const p = app.substring(0, _pos);
    return p;
  }

  getTooltipText(caveList) {

    return (
      caveList
        //.filter((c) => !(c.state === 'existing' && c.diff === 0 && !c.hasConflict))
        .map((c) => {
          switch (c.state) {
            case 'existing': {
              let prefix;
              if (c.hasConflict) {
                prefix = `⚠️ ${c.name}: conflict with drive`;
              } else {
                prefix = `${c.name}: `;
              }
              return `${prefix}

Local : ${c.local.revision} (${this.#getAppName(c.local.app)})
Origin : ${c.local.originRevision} (${this.#getAppName(c.local.originApp)})
Drive : ${c.drive.revision} (${this.#getAppName(c.drive.app)})`;
            }
            case 'remoteDeleted':
              return `${c.name}: deleted by an other app`;
            case 'localDeleted':
              return `${c.name}: deleted by local app. ${c.isOwner ? 'You are the owner' : 'You are not the owner, the drive file can be deleted by: ' + c.ownerEmail}. Sync will download the cave.`;
            case 'new':
              return `${c.name}: created by local app, not in Google Drive`;
            case 'remote':
              return `${c.name}: created by remote app '${this.#getAppName(c.drive.app)}'`;
          }
        })
        .join('\n\n')
    );
  }

  async getCaveList(caves, driveProject) {

    const caveList = await Promise.all(
      caves.map(async (cave) => {
        const caveId = cave.id;
        const driveCave = driveProject.caves.find((c) => c.id === caveId);
        if (driveCave) {
          const localRevision = await this.revisionStore.loadRevision(caveId);
          const hasLocalChanges = !localRevision.synced;
          //cave.reivision might not exist
          const diff = localRevision.revision - driveCave.revision;
          let hasConflict;

          if (diff > 0) {
            hasConflict = !(
              localRevision.originRevision === driveCave.revision && localRevision.originApp === driveCave.app
            );
          } else if (diff < 0) {
            hasConflict = hasLocalChanges;
          } else {
            hasConflict = hasLocalChanges;
          }

          let prefix = hasConflict ? '⚠️' : '';
          let diffStr = '';

          if (diff > 0) {
            diffStr = `(<span style="color: green"><strong>Δ ${diff}</strong></span>)`;
          } else if (diff < 0) {
            diffStr = `(<span style="color: red"><strong>∇ ${Math.abs(diff)}</strong></span>)`;
          } else {
            prefix = !hasConflict ? '✅️' : prefix;
          }
          return {
            id            : caveId,
            name          : cave.name,
            decoratedName : `${prefix} ${cave.name} ${diffStr}`,
            state         : 'existing',
            diff          : diff,
            hasConflict   : hasConflict,
            local         : {
              revision       : localRevision.revision,
              app            : localRevision.app,
              originApp      : localRevision.originApp,
              originRevision : localRevision.originRevision
            },
            drive : {
              revision : driveCave.revision,
              app      : driveCave.app
            }

          };
        } else if (driveProject.deletedCaveIds.includes(caveId)) {
          return { id: caveId, name: cave.name, decoratedName: '🔴 ' + cave.name, state: 'remoteDeleted' };
        } else {
          return { id: caveId, name: cave.name, decoratedName: '🟢 ' + cave.name, state: 'new' };
        }
      })
    );

    const remoteOrDeletedCaves = driveProject.caves.filter((c) => caves.find((c2) => c2.id === c.id) === undefined);
    const toAdd = await Promise.all(
      remoteOrDeletedCaves.map(async (cave) => {
        const revInfo = await this.revisionStore.loadRevision(cave.id);
        if (revInfo?.deleted === true) {
          const ownerEmail = await this.googleDriveSync.getCaveOwner(cave);
          // the file cannot be found, someone deleted it
          if (ownerEmail === null) {
            return null;
          }
          const userEmail = await this.googleDriveSync.config.get('email');
          const isOwner = ownerEmail === userEmail;
          const prefix = isOwner ? '⭕' : '🚫';
          return {
            id            : cave.id,
            name          : cave.name,
            decoratedName : `${prefix} ${cave.name}`,
            state         : 'localDeleted',
            isOwner       : isOwner,
            ownerEmail    : ownerEmail
          };
        } else {
          return {
            id            : cave.id,
            name          : cave.name,
            decoratedName : '🔵 ' + cave.name,
            state         : 'remote',
            drive         : {
              revision : cave.revision,
              app      : cave.app
            }
          };
        }
      })
    );
    caveList.push(...toAdd.filter((c) => c !== null));
    return caveList;

  }

  async getModelSyncInfo(embeddedModels, driveProject) {
    const driveModels = driveProject.models || [];
    return await Promise.all(
      embeddedModels.map(async (model) => {
        const modelFileId = model.modelFile.id;
        const name = model.metadata.name;
        const driveModel = driveModels.find((m) => m.id === modelFileId);

        if (!driveModel) {
          return { id: modelFileId, name, decoratedName: `🟢 ${name}`, state: 'new', hasConflict: false };
        }

        const [localMeta, localSettings] = await Promise.all([
          this.revisionStore.loadRevision(`${modelFileId}_meta`),
          this.revisionStore.loadRevision(`${modelFileId}_settings`)
        ]);

        const metaDiff = (localMeta?.revision ?? 1) - driveModel.metadataRevision;
        const settingsDiff = (localSettings?.revision ?? 1) - driveModel.settingsRevision;

        const calcConflict = (localRev, diff, driveRev, driveApp) => {
          if (!localRev) return false;
          if (diff > 0) return !(localRev.originRevision === driveRev && localRev.originApp === driveApp);
          return !localRev.synced;
        };

        const metaConflict = calcConflict(localMeta, metaDiff, driveModel.metadataRevision, driveModel.metadataApp);
        const settingsConflict = calcConflict(localSettings, settingsDiff, driveModel.settingsRevision, driveModel.settingsApp);
        const hasConflict = metaConflict || settingsConflict;

        const maxDiff = Math.max(metaDiff, settingsDiff);
        let prefix = hasConflict ? '⚠️' : '';
        let diffStr = '';

        if (maxDiff > 0) {
          diffStr = `(<span style="color: green"><strong>Δ ${maxDiff}</strong></span>)`;
        } else if (maxDiff < 0) {
          diffStr = `(<span style="color: red"><strong>∇ ${Math.abs(maxDiff)}</strong></span>)`;
        } else if (!hasConflict) {
          prefix = '✅️';
        }

        return {
          id           : modelFileId,
          name,
          decoratedName : `${prefix} ${name} ${diffStr}`,
          state        : 'existing',
          metaDiff,
          settingsDiff,
          hasConflict,
          model
        };
      })
    );
  }

  projectItemNode(
    project,
    caveNames,
    modelNames,
    buttons,
    lastModified,
    isCurrent,
    isLocal = true,
    coordinateSystems = []
  ) {
    const metaParts = [];
    if (caveNames.length > 0) metaParts.push(`${caveNames.length} ${i18n.t('ui.panels.projectManager.caves')}`);
    if (modelNames.length > 0) metaParts.push(`${modelNames.length} ${i18n.t('ui.panels.projectManager.models')}`);
    metaParts.push(lastModified);
    const metaText = metaParts.join(' • ');
    const crsText = coordinateSystems.length > 0 ? coordinateSystems.join(', ') : '';

    const allNames = [...caveNames, ...modelNames];
    const namesText = allNames.length > 0 ? `• ${allNames.join(', ')}` : '';

    const panel = U.node`
    <div id="project-item-${project.id}" class="project-item ${isCurrent ? 'current' : ''}" data-project-id="${project.id}">
      <div class="project-item-header">
        <div class="project-item-info" id="project-item-info-${project.id}">
          ${!isLocal ? `<img src="icons/drive.svg" class="drive-icon"/>` : ''}
          <span id="project-name-${project.id}" class="project-name">${project.name}</span>
          ${project.description ? `<span class="project-description">• ${project.description}</span>` : ''}
          <span class="project-caves" id="project-caves-${project.id}">${namesText}</span>
        </div>
        <div class="project-item-meta">
          <span class="project-meta-text">${metaText}</span>
          ${isCurrent ? `<span class="current-badge">${i18n.t('common.current')}</span>` : ''}
        </div>
      </div>
      <div class="project-item-actions" id="project-item-actions-${project.id}">
      </div>
    </div>
  `;
    const buttonContainer = panel.querySelector(`#project-item-actions-${project.id}`);

    if (!isCurrent && isLocal) {
      const openButton = U.node`<button class="project-action-btn">${i18n.t('common.open')}</button>`;
      buttonContainer.appendChild(openButton);
      openButton.addEventListener('click', () => this.openProject(project.id));
    }

    buttons.forEach((button) => {
      const b = U.node`<button ${button.id ? `id="${button.id}"` : ''} class="project-action-btn">${button.label}</button>`;
      b.addEventListener('click', button.click);
      buttonContainer.appendChild(b);
    });

    if (crsText) {
      buttonContainer.appendChild(U.node`<span class="project-crs">${crsText}</span>`);
    }

    return panel;
  }

  async showNewProjectDialog() {
    const name = prompt(i18n.t('ui.panels.projectManager.enterProjectName'));
    if (!name) return;

    const description = prompt(i18n.t('ui.panels.projectManager.enterProjectDescription'));

    if (!name || name.trim() === '') {
      return;
    }

    const trimmedName = name.trim();

    try {
      const nameExists = await this.projectSystem.checkProjectExistsByName(trimmedName);
      if (nameExists) {
        showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectNameAlreadyExists', { name: trimmedName }));
        return;
      }
      const project = await this.projectSystem.createProject(trimmedName, description);
      this.projectSystem.setCurrentProject(project);

      this.#emitCurrentProjectChanged(project);

      this.hide();
      showSuccessPanel(i18n.t('ui.panels.projectManager.projectCreated', { name: trimmedName }));
    } catch (error) {
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectCreationFailed', { error: error.message }));
    }
  }

  filterProjects() {
    const searchTerm = this.panel.querySelector('#project-search').value.toLowerCase();
    const projectItems = this.panel.querySelectorAll('.project-item');

    projectItems.forEach((item) => {
      const projectName = item.querySelector('.project-name').textContent.toLowerCase().substring(0, 50);
      const projectDescription = item.querySelector('.project-description')?.textContent.toLowerCase() || '';
      const projectCaves = item.querySelector('.project-caves')?.textContent.toLowerCase() || '';
      const projectMeta = item.querySelector('.project-meta-text')?.textContent.toLowerCase() || '';

      if (
        projectName.includes(searchTerm) ||
        projectDescription.includes(searchTerm) ||
        projectCaves.includes(searchTerm) ||
        projectMeta.includes(searchTerm)
      ) {
        item.style.display = 'block';
      } else {
        item.style.display = 'none';
      }
    });
  }

  async openProject(projectId) {
    try {
      const project = await this.projectSystem.loadProjectById(projectId);
      this.projectSystem.setCurrentProject(project);
      this.#emitCurrentProjectChanged(project);
      // Close the panel after successful project opening
      this.hide();
    } catch (error) {
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectOpenFailed', { error: error.message }));
    }
  }

  async saveCurrentProject() {
    try {
      await this.projectSystem.saveCurrentProject();
      this.updateDisplay();
      showSuccessPanel(i18n.t('ui.panels.projectManager.projectSaved'));
    } catch (error) {
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectSaveFailed', { error: error.message }));
    }
  }

  async importFatProject(fatProject, attributeDefs) {
    //generate new ids to avoid conflicts with existing projects and caves
    fatProject.project.id = Project.generateId();
    fatProject.caves.forEach((cave) => {
      cave.id = Cave.generateId();
    });
    const success = await this.importProject(fatProject.project, fatProject.caves, attributeDefs);
    if (success) {
      // Import embedded models if present
      if (fatProject.models.length > 0 && this.modelSystem) {
        await this.importModels(fatProject.project.id, fatProject.models);
      }
      this.updateDisplay();
    }
  }

  /**
   * Import embedded models from an exported project JSON
   * @param {string} projectId - The project ID to associate models with
   * @param {Array<Model>} models - Array of Model instances
   */
  async importModels(projectId, models) {
    for (const model of models) {
      try {
        await this.modelSystem.saveModelFile(projectId, model.modelFile);
        for (const tex of model.textures) {
          await this.modelSystem.saveTextureFile(projectId, tex);
        }
        await this.modelSystem.saveModelMetadata(projectId, model.metadata);
        if (model.settings) {
          await this.modelSystem.saveModelFileSettings(model.modelFile.id, projectId, model.settings);
        }

        console.log(`🌐 Imported embedded model: ${model.metadata.name}`);
      } catch (err) {
        console.error(`Failed to import embedded model ${model.metadata?.name}:`, err);
      }
    }
  }

  async importProject(project, caves) {

    const nameExists = await this.projectSystem.checkProjectExistsByName(project.name);

    if (nameExists) {
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectNameAlreadyExists', { name: project.name }));
      return false;
    }
    const projectExists = await this.projectSystem.checkProjectExistsById(project.id);
    if (projectExists) {
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectIdAlreadyExists', { id: project.id }));
      return false;
    }

    for (const cave of caves) {
      //due to indexed db and google drive cave id must be globally unique
      const caveExists = await this.caveSystem.checkCaveExistsById(cave.id);
      if (caveExists) {
        showErrorPanel(i18n.t('ui.panels.projectManager.errors.caveIdAlreadyExists', { id: cave.id }));
        return false;
      }
    }

    await this.projectSystem.saveProject(project);
    await Promise.all(caves.map((cave) => this.caveSystem.saveCave(cave, project.id)));
    return true;
  }

  async syncProject(localProject, driveProject, caveList, projectSyncInfo, modelSyncInfo, onSuccess) {
    try {

      const conflictMessages = this.getConflictMessages(caveList, projectSyncInfo);
      if (conflictMessages.length > 0) {
        if (!confirm(conflictMessages.join('\n\n'))) {
          return false;
        }
      }

      const cavesArr = await Promise.all(
        caveList
          .filter((c) => c.state !== 'localDeleted' && c.state !== 'remote')
          .map((c) => this.caveSystem.loadCave(c.id))
      );
      const caves = new Map(cavesArr.map((c) => [c.id, c]));
      const localRevisions = new Map();
      const localApp = this.googleDriveSync.config.getApp();

      var caveHasUploaded = false;

      await Promise.all(
        caveList.map(async (c) => {
          const cave = caves.get(c.id);
          const caveId = c.id;
          const driveCave = driveProject.caves.find((dc) => dc.id === caveId);
          if (c.state === 'existing') {
            const localRevisionInfo = await this.revisionStore.loadRevision(c.id);
            localRevisions.set(c.id, localRevisionInfo);
            if (c.diff > 0) {
              // local revision is higher, it means a local change
              await this.googleDriveSync.uploadCave(cave, localProject);
              caveHasUploaded = true;
              //we need to flip the synced flag to true
              localRevisionInfo.synced = true;
              localRevisionInfo.originApp = localApp;
              localRevisionInfo.originRevision = cave.revision;
              await this.revisionStore.saveRevision(localRevisionInfo);
            } else if (c.diff < 0) {
              const cave = await this.downloadCave(driveCave, c, localProject.id, true);
              caves.set(cave.id, cave);
            } else {
              if (c.hasConflict) {
                await this.googleDriveSync.uploadCave(cave, localProject);
                caveHasUploaded = true;
                localRevisionInfo.synced = true;
                localRevisionInfo.originApp = localApp;
                localRevisionInfo.originRevision = cave.revision;
                await this.revisionStore.saveRevision(localRevisionInfo);
              } // otherwise nothing to do
            }
          } else if (c.state === 'new') {
            await this.googleDriveSync.uploadCave(cave, localProject, true);
            caveHasUploaded = true;
            const localRevisionInfo = new RevisionInfo(cave.id, cave.revision, localApp, true, localApp, cave.revision);
            await this.revisionStore.saveRevision(localRevisionInfo);
          } else if (c.state === 'remote') {
            const cave = await this.downloadCave(driveCave, c, localProject.id, false);
            caves.set(cave.id, cave);
          } else if (c.state === 'remoteDeleted') {
            this.db.deleteCave(cave.name);
            // Wait until 'caveDestructed' event is emitted for this cave
            setTimeout(() => this.#emitCaveDeleted(cave, driveProject.project.id), 200);
            // we need the indexed db operation to complete before we can continue
            await U.waitForEvent('caveDestructed', (detail) => detail.id === cave.id);

          } else if (c.state === 'localDeleted' && c.isOwner) {
            await this.googleDriveSync.deleteCave({ id: caveId });
            await this.revisionStore.deleteRevision(caveId);
            const response = await this.googleDriveSync.fetchProject(localProject);
            const driveProject = response.project;
            driveProject.project.updatedAt = new Date().toISOString();
            driveProject.deletedCaveIds.push(caveId);
            driveProject.caves = driveProject.caves.filter((c) => c.id !== caveId);
            await this.googleDriveSync.uploadProject(driveProject);
          } else if (c.state === 'localDeleted' && !c.isOwner) {
            // we download the cave since we are not the owners and this would block further
            // google drive operations
            const cave = await this.downloadCave(driveCave, c, localProject.id, false);
            caves.set(cave.id, cave);

          }
        })
      );

      let updatedProject;

      const cavesMetadata = [...caves.values()].map((cave) => {
        const rev = localRevisions.get(cave.id);
        return new DriveCaveMetadata(cave.id, cave.name, cave.revision ?? 1, rev?.app ?? localApp);
      });

      // Sync embedded models
      const updatedModelsMetadata = await this.#syncModels(modelSyncInfo, localProject, localApp);

      const localRevisionInfo = await this.revisionStore.loadRevision(localProject?.id ?? driveProject.project.id);

      if (caveHasUploaded || projectSyncInfo.diff > 0 || (projectSyncInfo.diff === 0 && projectSyncInfo.hasConflict)) {
        localProject.updatedAt = new Date().toISOString();
        updatedProject = new DriveProject(localProject, cavesMetadata, this.googleDriveSync.config.getApp(), [], updatedModelsMetadata);
        await this.googleDriveSync.uploadProject(updatedProject);
        localRevisionInfo.synced = true;
        localRevisionInfo.originApp = localApp;
        localRevisionInfo.originRevision = localProject.revision;
        await this.revisionStore.saveRevision(localRevisionInfo);

      } else if (projectSyncInfo.diff < 0) {
        // we need to fetch the project
        const response = await this.googleDriveSync.fetchProject(localProject);
        const driveProject = response.project;
        const project = driveProject.project;
        await this.projectSystem.saveProject(project);
        const rev = project.revision;
        const app = driveProject.app;
        await this.revisionStore.saveRevision(new RevisionInfo(localProject.id, rev, app, true, app, rev));

        //due to local changes in caves we need to update the project
        if (caveHasUploaded || updatedModelsMetadata.length > 0) {
          project.updatedAt = new Date().toISOString();
          updatedProject = new DriveProject(project, cavesMetadata, app, [], updatedModelsMetadata);
          await this.googleDriveSync.uploadProject(updatedProject);
        } else {
          updatedProject = driveProject;
        }

      } else {
        // we do not need to upload the project, but we need fresh drive project and properties
        const { _, project } = await this.googleDriveSync.fetchProject(localProject);
        updatedProject = project;
        if (updatedModelsMetadata.length > 0) {
          updatedProject.models = updatedModelsMetadata;
          await this.googleDriveSync.uploadProject(updatedProject);
        }
      }

      onSuccess(updatedProject);
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectSyncFailed', { error: error.message }));
    }
  }
  async #syncModels(modelSyncInfo, localProject, localApp) {
    if (!this.modelSystem || !modelSyncInfo || modelSyncInfo.length === 0) return [];
    const updatedModelsMetadata = [];

    for (const m of modelSyncInfo) {
      try {
        const model = m.model;
        const modelFileId = m.id;
        const needsMetaUpload = m.state === 'new' || m.metaDiff > 0 || (m.metaDiff === 0 && m.hasConflict);
        const needsSettingsUpload = m.state === 'new' || m.settingsDiff > 0 || (m.settingsDiff === 0 && m.hasConflict);

        // Upload immutable binary files if not yet on Drive
        if (model) {
          await this.googleDriveSync.uploadModelFile(model.modelFile, localProject);
          for (const texture of model.textures) {
            await this.googleDriveSync.uploadTextureFile(texture, localProject);
          }
        }

        let metaRev = await this.revisionStore.loadRevision(`${modelFileId}_meta`);
        let settingsRev = await this.revisionStore.loadRevision(`${modelFileId}_settings`);

        if (needsMetaUpload && model) {
          if (!metaRev) metaRev = new RevisionInfo(`${modelFileId}_meta`, 1, localApp, false, localApp, 0);
          await this.googleDriveSync.uploadModelMetadata(model.metadata, metaRev, localProject, m.state === 'new');
          metaRev.synced = true;
          metaRev.originApp = localApp;
          metaRev.originRevision = metaRev.revision;
          await this.revisionStore.saveRevision(metaRev);
        } else if (m.metaDiff < 0) {
          const result = await this.googleDriveSync.fetchModelMetadata(modelFileId);
          if (result && model) {
            await this.modelSystem.saveModelMetadata(localProject.id, result.metadata);
            const driveRev = parseInt(result.properties?.revision ?? '1');
            metaRev = new RevisionInfo(`${modelFileId}_meta`, driveRev, result.properties?.app ?? localApp, true, result.properties?.app ?? localApp, driveRev);
            await this.revisionStore.saveRevision(metaRev);
          }
        }

        if (needsSettingsUpload && model?.settings) {
          if (!settingsRev) settingsRev = new RevisionInfo(`${modelFileId}_settings`, 1, localApp, false, localApp, 0);
          await this.googleDriveSync.uploadModelSettings(model.settings, modelFileId, settingsRev, localProject, m.state === 'new');
          settingsRev.synced = true;
          settingsRev.originApp = localApp;
          settingsRev.originRevision = settingsRev.revision;
          await this.revisionStore.saveRevision(settingsRev);
        } else if (m.settingsDiff < 0) {
          const result = await this.googleDriveSync.fetchModelSettings(modelFileId);
          if (result && model) {
            await this.modelSystem.saveModelFileSettings(modelFileId, localProject.id, result.settings);
            const driveRev = parseInt(result.properties?.revision ?? '1');
            settingsRev = new RevisionInfo(`${modelFileId}_settings`, driveRev, result.properties?.app ?? localApp, true, result.properties?.app ?? localApp, driveRev);
            await this.revisionStore.saveRevision(settingsRev);
          }
        }

        updatedModelsMetadata.push(new DriveModelMetadata(
          modelFileId,
          m.name,
          metaRev?.revision ?? 1,
          metaRev?.app ?? localApp,
          settingsRev?.revision ?? 1,
          settingsRev?.app ?? localApp
        ));
      } catch (err) {
        console.error(`Failed to sync model ${m.name}:`, err);
      }
    }

    return updatedModelsMetadata;
  }

  async downloadCave(driveCave, caveEntry, projectId, hasLocalCopy) {
    const caveId = caveEntry.id;
    const response = await this.googleDriveSync.fetchCave({ id: caveId });
    if (driveCave.app !== response.properties.app) {
      throw new Error(i18n.t('ui.panels.projectManager.errors.caveAppMismatch', { id: caveId }));
    }
    const cave = response.cave;
    await this.caveSystem.saveCave(cave, projectId);
    const newRevInfo = new RevisionInfo(cave.id, cave.revision, driveCave.app, true, driveCave.app, driveCave.revision);
    await this.revisionStore.saveRevision(newRevInfo);
    const currentProject = this.projectSystem.getCurrentProject();
    if (currentProject && currentProject.id === projectId) {
      if (hasLocalCopy) {
        const oldName = caveEntry.name;
        if (cave.name !== oldName) {
          // someone renamed the cave
          setTimeout(() => {
            this.db.renameCave(oldName, cave.name);
            this.#emitCaveRenamed(cave, oldName, projectId);
          }, 200);
          // Wait until 'caveRenamedCompleted' event is emitted for this cave
          await U.waitForEvent('caveRenamedCompleted', (detail) => detail.cave.id === cave.id);

        }
        this.#emitCaveChanged(cave);
      } else {
        this.#emitCaveAdded(cave, projectId);
      }

    }

    return cave;
  }

  async downloadProject(driveProject) {
    try {
      const cavesWithProperties = await Promise.all(
        driveProject.caves.map((cave) => this.googleDriveSync.fetchCave(cave))
      );
      const project = driveProject.project;
      const caves = cavesWithProperties.map((c) => c.cave);
      const success = await this.importProject(project, caves);

      if (success) {
        await Promise.all(
          cavesWithProperties.map(async (cwp) => {
            const caveRevisionInfo = new RevisionInfo(
              cwp.cave.id,
              cwp.cave.revision,
              cwp.properties.app,
              true,
              cwp.properties.app,
              cwp.cave.revision
            );
            await this.revisionStore.saveRevision(caveRevisionInfo);
          })
        );
        await this.revisionStore.saveRevision(
          new RevisionInfo(project.id, project.revision, driveProject.app, true, driveProject.app, project.revision)
        );

        // Download embedded models
        if (this.modelSystem && driveProject.models?.length > 0) {
          await this.#downloadModels(driveProject.models, project.id, driveProject.app);
        }

        const projectItem = this.panel.querySelector(`#project-item-${driveProject.project.id}`);
        const isCurrent = this.projectSystem.getCurrentProject()?.id === driveProject.project.id;
        const itemNode = this.getProjectItemNode(
          driveProject.project,
          driveProject.caves.map((c) => c.name),
          [],
          new Date(driveProject.project.updatedAt).toLocaleDateString(),
          isCurrent,
          true
        );

        const projects = await this.projectSystem.getAllProjects();
        const decoratedNode = await this.decorateProjectItemWithDrive(driveProject, projects, caves, itemNode);
        projectItem.replaceWith(decoratedNode);
        showSuccessPanel(i18n.t('ui.panels.projectManager.projectDownloaded', { name: driveProject.project.name }));
      }
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectDownloadFailed', { error: error.message }));
    }
  }

  async #downloadModels(driveModels, projectId, driveApp) {
    for (const driveModel of driveModels) {
      try {
        const modelFileId = driveModel.id;
        const [modelFileResult, metadataResult, settingsResult] = await Promise.all([
          this.googleDriveSync.fetchModelFile(modelFileId),
          this.googleDriveSync.fetchModelMetadata(modelFileId),
          this.googleDriveSync.fetchModelSettings(modelFileId)
        ]);

        if (!modelFileResult || !metadataResult) continue;

        modelFileResult.id = modelFileId;
        const metadata = metadataResult.metadata;
        metadata.modelFileId = modelFileId;

        await this.modelSystem.saveModelFile(projectId, modelFileResult);
        await this.modelSystem.saveModelMetadata(projectId, metadata);

        if (settingsResult?.settings) {
          await this.modelSystem.saveModelFileSettings(modelFileId, projectId, settingsResult.settings);
        }

        // Save revision info
        await this.revisionStore.saveRevision(
          new RevisionInfo(`${modelFileId}_meta`, driveModel.metadataRevision, driveModel.metadataApp, true, driveModel.metadataApp, driveModel.metadataRevision)
        );
        await this.revisionStore.saveRevision(
          new RevisionInfo(`${modelFileId}_settings`, driveModel.settingsRevision, driveModel.settingsApp, true, driveModel.settingsApp, driveModel.settingsRevision)
        );
      } catch (err) {
        console.error(`Failed to download model ${driveModel.name}:`, err);
      }
    }
  }

  // this is always a new project upload and not an update
  async uploadProject(localProject) {
    try {
      const app = this.googleDriveSync.config.getApp();
      const caves = await this.caveSystem.getCavesByProjectId(localProject.id);
      const embeddedModels = this.modelSystem ? await this.modelSystem.getModelsForExport(localProject.id) : [];
      const revisionInfo = new RevisionInfo(
        localProject.id,
        localProject.revision,
        app,
        true,
        app,
        localProject.revision
      );
      const cavesMetadata = caves.map((cave) => new DriveCaveMetadata(cave.id, cave.name, cave.revision ?? 1, app));

      // Upload models first (sequentially to avoid creating duplicate Drive folders)
      const modelsMetadata = [];
      await U.sequential(
        embeddedModels.map((model) => async () => {
          await this.googleDriveSync.uploadModelFile(model.modelFile, localProject);
          for (const texture of model.textures) {
            await this.googleDriveSync.uploadTextureFile(texture, localProject);
          }
          const metaRevKey = `${model.modelFile.id}_meta`;
          const settingsRevKey = `${model.modelFile.id}_settings`;
          const metaRev = new RevisionInfo(metaRevKey, 1, app, true, app, 1);
          const settingsRev = new RevisionInfo(settingsRevKey, 1, app, true, app, 1);
          await this.googleDriveSync.uploadModelMetadata(model.metadata, metaRev, localProject, true);
          if (model.settings) {
            await this.googleDriveSync.uploadModelSettings(model.settings, model.modelFile.id, settingsRev, localProject, true);
          }
          await this.revisionStore.saveRevision(metaRev);
          await this.revisionStore.saveRevision(settingsRev);
          modelsMetadata.push(new DriveModelMetadata(model.modelFile.id, model.metadata.name, 1, app, 1, app));
        })
      );

      await this.googleDriveSync.uploadProject(new DriveProject(localProject, cavesMetadata, app, [], modelsMetadata), true);
      await this.revisionStore.saveRevision(revisionInfo);
      // we need to upload caves sequentially to avoid parallel executions and multiple 'Caves' folders in google drive
      await U.sequential(
        caves.map((cave) => async () => {
          const revisionInfo = new RevisionInfo(cave.id, cave.revision, app, true, app, cave.revision);
          await this.googleDriveSync.uploadCave(cave, localProject, true);
          await this.revisionStore.saveRevision(revisionInfo);
        })
      );
      const projectItemNode = this.panel.querySelector(`#project-item-${localProject.id}`);
      const isCurrent = this.projectSystem.getCurrentProject()?.id === localProject.id;
      const newNode = this.getProjectItemNode(
        localProject,
        caves.map((c) => c.name),
        embeddedModels.map((m) => m.metadata.name),
        new Date(localProject.updatedAt).toLocaleDateString(),
        isCurrent,
        true
      );
      const driveProject = new DriveProject(localProject, cavesMetadata, app, [], modelsMetadata);
      const projects = await this.projectSystem.getAllProjects();
      const decoratedNode = await this.decorateProjectItemWithDrive(driveProject, projects, caves, newNode);
      projectItemNode.replaceWith(decoratedNode);

    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectUploadFailed', { error: error.message }));
    }
  }

  async exportAllProjects() {
    await this.loadingOverlay.guard(i18n.t('ui.panels.projectManager.exporting'), async () => {
      try {
        const projects = await this.projectSystem.getAllProjects();
        if (projects.length === 0) {
          showErrorPanel(i18n.t('ui.panels.projectManager.errors.noProjectsToExport'));
          return;
        }

        const fatProjectList = await Promise.all(
          projects.map(async (project) => {
            const caves = await this.caveSystem.getCavesByProjectId(project.id);
            const models = this.modelSystem ? await this.modelSystem.getModelsForExport(project.id) : [];
            return new FatProject(project, caves, models);
          })
        );

        const fatProjects = new FatProjects(fatProjectList);
        const { blob, compressed } = await fatProjects.serialize();
        const ext = compressed ? '.json.gz' : '.json';

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `speleo-studio-projects${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showSuccessPanel(i18n.t('ui.panels.projectManager.allProjectsExported'));
        for (const project of projects) {
          await this.#warnNonEmbeddedModels(project.id, project.name);
        }
      } catch (error) {
        console.error(error);
        showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectExportFailed', { error: error.message }));
      }
    });
  }

  async exportProject(projectId) {
    await this.loadingOverlay.guard(i18n.t('ui.panels.projectManager.exporting'), async () => {
      const project = await this.projectSystem.loadProjectById(projectId);
      try {
        const caves = await this.caveSystem.getCavesByProjectId(projectId);
        const models = this.modelSystem ? await this.modelSystem.getModelsForExport(projectId) : [];
        const fatProject = new FatProject(project, caves, models);
        const { blob, compressed } = await fatProject.serialize();
        const baseName = project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const ext = compressed ? '.json.gz' : '.json';

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_project${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showSuccessPanel(i18n.t('ui.panels.projectManager.projectExported', { name: project.name }));
        await this.#warnNonEmbeddedModels(projectId, project.name);
      } catch (error) {
        console.error(error);
        showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectExportFailed', { error: error.message }));
      }
    });
  }

  async #warnNonEmbeddedModels(projectId, projectName) {
    if (!this.modelSystem) return;
    const allMetadata = await this.modelSystem.getModelMetadataByProject(projectId);
    const nonEmbedded = allMetadata.filter((m) => !m.embedded);
    if (nonEmbedded.length > 0) {
      const names = nonEmbedded.map((m) => m.name).join(', ');
      showInfoPanel(i18n.t('ui.panels.projectManager.nonEmbeddedModelsWarning', { project: projectName, names }));
    }
  }

  async renameProject(projectId) {
    const project = await this.projectSystem.loadProjectById(projectId);

    if (!project) {
      showErrorPanel(i18n.t('ui.panels.projectManager.noProjectToRename'));
      return;
    }

    const newName = prompt(
      i18n.t('ui.panels.projectManager.enterNewProjectName', { name: project.name }),
      project.name
    );
    if (!newName || newName.trim() === '') {
      return;
    }

    const trimmedName = newName.trim();
    if (trimmedName === project.name) {
      return; // No change
    }

    try {
      // Check if name already exists
      const nameExists = await this.projectSystem.checkProjectExistsByName(trimmedName);

      if (nameExists) {
        showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectNameAlreadyExists', { name: trimmedName }));
        return;
      }
      if (this.projectSystem.getCurrentProject()?.id === project.id) {
        document.title = `Speleo Studio - ${trimmedName}`;
      }
      // Update project name
      project.name = trimmedName;
      project.revision++;
      project.updatedAt = new Date().toISOString();
      // Save the updated project
      await this.projectSystem.saveProject(project);

      const revInfo = await this.revisionStore.loadRevision(project.id);
      const localApp = this.googleDriveSync.config.getApp();

      if (revInfo !== null) {
        const autoSync = this.googleDriveSync.config.get('autoSync');
        const newRevInfo = new RevisionInfo(project.id, project.revision, localApp, false, revInfo.originApp, revInfo.originRevision);
        if (autoSync) {
          const response = await this.googleDriveSync.fetchProject(project);
          const driveProject = response.project;
          driveProject.project.updatedAt = new Date().toISOString();
          driveProject.project.revision = project.revision;
          driveProject.project.name = project.name;
          driveProject.app = localApp;
          await this.googleDriveSync.uploadProject(driveProject);
          newRevInfo.synced = true;
          newRevInfo.originApp = localApp;
          newRevInfo.originRevision = project.revision;
        }

        await this.revisionStore.saveRevision(newRevInfo);
      }

      // Update display
      this.updateDisplay();

      showSuccessPanel(i18n.t('ui.panels.projectManager.projectRenamed', { name: trimmedName }));
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectRenameFailed', { error: error.message }));
    }
  }

  async deleteProject(project) {
    const confirmed = confirm(i18n.t('ui.panels.projectManager.deleteProjectConfirmation'));
    if (!confirmed) return;

    let driveDeleted = false;
    try {

      const driveProject = this.driveProjects.get(project.id);
      if (driveProject && this.googleDriveSync.isReady()) {
        const deleteFromDrive = confirm(i18n.t('ui.panels.projectManager.deleteProjectFromDriveConfirmation'));
        if (deleteFromDrive) {
          await this.googleDriveSync.deleteProject(project);
          const cavesIds = await this.caveSystem.getCaveFieldsByProjectId(project.id, ['id']);
          await Promise.all(cavesIds.map((cave) => this.googleDriveSync.deleteCave(cave)));
          this.driveProjects.delete(project.id);
          this.revisionStore.deleteRevision(project.id);
          await Promise.all(cavesIds.map((cave) => this.revisionStore.deleteRevision(cave.id)));
          driveDeleted = true;
        }
      }

      await this.projectSystem.deleteProject(project.id);

      // If we're deleting the current project, clear it
      if (this.projectSystem.getCurrentProject()?.id === project.id) {
        this.projectSystem.clearCurrentProject();
        this.#emitCurrentProjectDeleted(project.id);
      }

      const projectItem = this.panel.querySelector(`#project-item-${project.id}`);

      if (driveProject && !driveDeleted) {
        const buttons = [
          {
            label : i18n.t('common.download'),
            click : async (event) =>
              await this.createClickHandler(event, async () => await this.downloadProject(driveProject))
          }
        ];
        const panel = this.projectItemNode(
          driveProject.project,
          driveProject.caves.map((c) => c.name).map((n) => `🟢 ${n}`),
          [],
          buttons,
          new Date(driveProject.project.updatedAt).toLocaleDateString(),
          false,
          false
        );
        projectItem.replaceWith(panel);
      } else {
        projectItem.remove();
      }

      showSuccessPanel(i18n.t('ui.panels.projectManager.projectDeleted'));
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectDeletionFailed', { error: error.message }));
    }
  }

  #emitCaveSynced(cave, project) {
    const event = new CustomEvent('caveSynced', {
      detail : {
        cave    : cave,
        project : project
      }
    });
    document.dispatchEvent(event);
  }

  #emitCurrentProjectChanged(project) {
    const event = new CustomEvent('currentProjectChanged', {
      detail : {
        project : project
      }
    });
    document.dispatchEvent(event);
  }

  #emitCurrentProjectDeleted(projectId) {
    const event = new CustomEvent('currentProjectDeleted', {
      detail : {
        projectId : projectId
      }
    });
    document.dispatchEvent(event);
  }

  #emitCaveRenamed(cave, oldName, projectId) {
    const event = new CustomEvent('caveRenamed', {
      detail : {
        oldName   : oldName,
        cave      : cave,
        projectId : projectId,
        source    : 'project-panel'
      }
    });
    document.dispatchEvent(event);
  }

  #emitCaveChanged(cave) {
    const event = new CustomEvent('caveChanged', {
      detail : {
        cave    : cave,
        source  : 'project-panel',
        reasons : ['drive']
      }
    });
    document.dispatchEvent(event);
  }

  #emitCaveAdded(cave, projectId) {
    const event = new CustomEvent('caveAdded', {
      detail : {
        cave      : cave,
        projectId : projectId,
        source    : 'project-panel'
      }
    });
    document.dispatchEvent(event);
  }

  #emitCaveDeleted(cave, projectId) {
    const event = new CustomEvent('caveDeleted', {
      detail : {
        name      : cave.name,
        id        : cave.id,
        source    : 'project-panel',
        projectId : projectId
      }
    });
    document.dispatchEvent(event);
  }
}
