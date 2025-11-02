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

import { showErrorPanel, showSuccessPanel } from './popups.js';
import * as U from '../utils/utils.js';
import { i18n } from '../i18n/i18n.js';
import { DriveProject, FatProject, Project } from '../model/project.js';
import { Cave, DriveCaveMetadata } from '../model/cave.js';
import { RevisionInfo } from '../model/misc.js';

export class ProjectPanel {
  constructor(
    db,
    panel,
    projectSystem,
    caveSystem,
    googleDriveSync,
    revisionStore,
    attributeDefs,
    projectInput = 'projectInput'
  ) {
    this.db = db;
    this.panel = panel;
    this.projectSystem = projectSystem;
    this.caveSystem = caveSystem;
    this.googleDriveSync = googleDriveSync;
    this.revisionStore = revisionStore;
    this.attributeDefs = attributeDefs;
    this.isVisible = false;
    this.fileInputElement = document.getElementById(projectInput);
    this.driveProjects = new Map();
    this.clickHandlerActive = false;

    this.fileInputElement.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const text = event.target.result;
          await this.importFatProject(text, this.attributeDefs);
        } catch (error) {
          console.error(i18n.t('ui.panels.projectManager.errors.projectImportFailed'), error);
          showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectImportFailed', { error: error.message }));
        }
      };

      reader.onerror = (error) => {
        showErrorPanel(i18n.t('ui.panels.projectManager.errors.fileReadFailed', { error: error.message }));
      };

      reader.readAsText(file);
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
        <button id="new-project-btn" class="project-btn">${i18n.t('ui.panels.projectManager.new')}</button>
        <button id="import-project-btn" class="project-btn">${i18n.t('ui.panels.projectManager.import')}</button>
        <button id="refresh-panel-btn" class="project-btn">${i18n.t('common.refresh')}</button>

        <button class="project-panel-close" onclick="this.parentElement.parentElement.style.display='none'">×</button>
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
    const projectSearch = this.panel.querySelector('#project-search');
    const refreshPanelBtn = this.panel.querySelector('#refresh-panel-btn');

    newProjectBtn.addEventListener('click', () => this.showNewProjectDialog());
    importProjectBtn.addEventListener('click', () => this.fileInputElement.click());
    projectSearch.addEventListener('input', () => this.filterProjects());
    refreshPanelBtn.addEventListener('click', () => this.updateDisplay());
  }

  show() {
    this.isVisible = true;
    this.panel.style.display = 'block';
    this.updateDisplay();
  }

  hide() {
    this.isVisible = false;
    this.panel.style.display = 'none';
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
      const lastModified = new Date(currentProject.updatedAt).toLocaleString();

      currentProjectInfo.innerHTML = `
        <div class="project-info">
          <div class="current-project-header">
            <span class="current-project-name">${currentProject.name}</span>
            <span class="current-project-meta">${caveCount} ${i18n.t('ui.panels.projectManager.caves')} • ${lastModified}</span>
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

  getProjectItemNode(project, caveNames, lastModified, isCurrent, isLocal) {
    const buttons = [
      { label: i18n.t('common.rename'), click: () => this.renameProject(project.id) },
      { label: i18n.t('common.export'), click: () => this.exportProject(project.id) },
      {
        id    : 'delete-project-btn',
        label : i18n.t('common.delete'),
        click : async (event) => await this.createClickHandler(event, async () => await this.deleteProject(project))
      }
    ];

    return this.projectItemNode(project, caveNames, buttons, lastModified, isCurrent, isLocal);
  }

  async updateRecentProjectsList() {
    const recentProjectsList = this.panel.querySelector('#recent-projects-list');

    try {
      const projects = await this.projectSystem.getAllProjects();

      if (projects.length === 0) {
        recentProjectsList.innerHTML = `<p>${i18n.t('ui.panels.projectManager.noProjectsFound')}</p>`;
      }

      const cavesForLocalProjects = new Map();
      this.driveProjects.clear();
      const projectListItems = await Promise.all(
        projects.map(async (project) => {
          const caves = await this.caveSystem.getCaveFieldsByProjectId(project.id, ['name', 'id', 'revision']);
          cavesForLocalProjects.set(project.id, caves);
          const caveNames = caves.map((c) => c.name);
          const lastModified = new Date(project.updatedAt).toLocaleDateString();
          const isCurrent = this.projectSystem.getCurrentProject()?.id === project.id;
          return this.getProjectItemNode(project, caveNames, lastModified, isCurrent, true);
        })
      );

      recentProjectsList.innerHTML = '';
      projectListItems.forEach((item) => {
        recentProjectsList.appendChild(item);
      });

      let driveProjectFiles = [];
      if (this.googleDriveSync.config.isConfigured()) {
        try {
          if (this.googleDriveSync.config.hasTokens() && !this.googleDriveSync.config.hasValidTokens()) {
            console.log('Refresh access tokens');
            await this.googleDriveSync.refreshToken();
          }
          driveProjectFiles = await this.googleDriveSync.listProjects();
        } catch (error) {
          console.error('Failed to list Google Drive projects', error);
        }

        if (driveProjectFiles.length > 0) {

          // sequential needs a promise function and not a promise which is immediately executed
          const promises = driveProjectFiles.map((file) => async () => {
            const response = await this.googleDriveSync.fetchProjectByFile(file);
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

        // local projects without google drive pair
        const localProjects = projects.filter((p) => !this.driveProjects.has(p.id));
        localProjects.forEach((project) => {
          const button = U.node`<button class="project-action-btn">${i18n.t('common.upload')}</button>`;
          const buttonContainer = recentProjectsList.querySelector(`#project-item-actions-${project.id}`);
          buttonContainer.appendChild(button);
          // Use wrapper function for click handler
          button.addEventListener(
            'click',
            async (event) => await this.createClickHandler(event, async () => await this.uploadProject(project))
          );
        });
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

      const projectNameElmnt = projectItemNode.querySelector(`#project-name-${localProject.id}`);
      projectNameElmnt.textContent = projectSyncInfo.name;
      const projectCavesElmnt = projectItemNode.querySelector(`#project-caves-${localProject.id}`);
      projectCavesElmnt.innerHTML =
        ' • ' +
        caveList
          .map((c) => c.decoratedName)
          .join(', ');
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
        );
      if (syncEnabled) {
        const cloudButton = U.node`<button id="sync-project-btn" class="project-action-btn sync">${i18n.t('common.sync')}</button>`;
        cloudButton.addEventListener(
          'click',
          async (event) =>
            await this.createClickHandler(
              event,
              async () =>
                await this.syncProject(localProject, driveProject, caveList, projectSyncInfo, async (dProj) => {
                  const nCaves = await this.caveSystem.getCaveFieldsByProjectId(localProject.id, [
                    'name',
                    'id',
                    'revision'
                  ]);
                  const newNode = this.getProjectItemNode(
                    localProject,
                    nCaves.map((c) => c.name),
                    new Date(localProject.updatedAt).toLocaleDateString(),
                    this.projectSystem.getCurrentProject()?.id === localProject.id,
                    true
                  );
                  const decoratedNode = await this.decorateProjectItemWithDrive(dProj, projects, nCaves, newNode);
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
    return this.projectItemNode(
      driveProject.project,
      driveProject.caves.map((c) => c.name).map((n) => `🔵 ${n}`),
      buttons,
      new Date(driveProject.project.updatedAt).toLocaleDateString(),
      false,
      false
    );
  }

  async getProjectSyncInfo(driveProject, localProject) {

    const driveRevision = driveProject.project.revision;
    const localRevisionInfo = await this.revisionStore.loadRevision(localProject.id);

    let hasConflict =
      localRevisionInfo.originApp !== driveProject.app && localRevisionInfo.originRevision !== driveRevision;
    const diff = localRevisionInfo.revision - driveRevision;
    let prefix = hasConflict ? '⚠️' : '';
    let diffStr = '';
    let projectName = localProject.name;
    if (diff > 0) {
      projectName = localProject.name;
      diffStr = `(+${diff})`;
    } else if (diff < 0) {
      projectName = driveProject.project.name;
      diffStr = `(-${diff})`;
    } else {
      projectName = localProject.name;
    }
    return { diff, hasConflict, name: `${prefix} ${projectName} ${diffStr}` };

  }

  getConflictMessages(caveList, projectSyncInfo) {
    const conflictMessages = caveList
      .filter((c) => c.hasConflict)
      .map((c) => {
        if (c.diff === 0) {
          return i18n.t('ui.panels.projectManager.errors.conflictSameRevision', { name: c.name, app: c.drive.app });
        } else if (c.diff > 0) {
          return i18n.t('ui.panels.projectManager.errors.conflictLocalChanges', { name: c.name, app: c.drive.app });
        } else {
          return i18n.t('ui.panels.projectManager.errors.conflictRemoteChanges', { name: c.name, app: c.drive.app });
        }
      });

    if (projectSyncInfo.hasConflict) {
      if (projectSyncInfo.diff === 0) {
        conflictMessages.push(
          `${projectSyncInfo.name} has conflict with remote project. Sync will drop remote changes made by "${projectSyncInfo.driveApp}" since last revision.`
        );
      } else if (projectSyncInfo.diff > 0) {
        conflictMessages.push(
          i18n.t('ui.panels.projectManager.errors.conflictProjectLocalChanges', {
            name : projectSyncInfo.name,
            app  : projectSyncInfo.driveApp
          })
        );
      } else if (projectSyncInfo.diff < 0) {
        conflictMessages.push(
          i18n.t('ui.panels.projectManager.errors.conflictProjectRemoteChanges', {
            name : projectSyncInfo.name,
            app  : projectSyncInfo.driveApp
          })
        );
      } else {
        conflictMessages.push(
          i18n.t('ui.panels.projectManager.errors.conflictProjectSameRevision', {
            name : projectSyncInfo.name,
            app  : projectSyncInfo.driveApp
          })
        );
      }
    }
    return conflictMessages;
  }

  getTooltipText(caveList) {
    const getAppName = (app) => {
      const _pos = app.lastIndexOf('_');
      const p = app.substring(0, _pos);
      return p;
    };
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

Local : ${c.local.revision} (${getAppName(c.local.app)})
Origin : ${c.local.originRevision} (${getAppName(c.local.originApp)})
Drive : ${c.drive.revision} (${getAppName(c.drive.app)})`;
            }
            case 'remoteDeleted':
              return `${c.name}: deleted by an other app`;
            case 'localDeleted':
              return `${c.name}: deleted by local app. ${c.isOwner ? 'You are the owner' : 'You are not the owner, the drive file can be deleted by: ' + c.ownerEmail}. Sync will download the cave.`;
            case 'new':
              return `${c.name}: created by local app, not in Google Drive`;
            case 'remote':
              return `${c.name}: created by remote app '${getAppName(c.drive.app)}'`;
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

  projectItemNode(project, caveNames, buttons, lastModified, isCurrent, isLocal = true) {
    const panel = U.node`
    <div id="project-item-${project.id}" class="project-item ${isCurrent ? 'current' : ''}" data-project-id="${project.id}">
      <div class="project-item-header">
        <div class="project-item-info" id="project-item-info-${project.id}">
          ${!isLocal ? `<img src="icons/drive.svg" class="drive-icon"/>` : ''}
          <span id="project-name-${project.id}" class="project-name">${project.name}</span>
          ${project.description ? `<span class="project-description">• ${project.description}</span>` : ''}
          <span class="project-caves" id="project-caves-${project.id}">${caveNames ? `• ${caveNames.join(', ')}` : ''}</span>
        </div>
        <div class="project-item-meta">
          <span class="project-meta-text">${caveNames.length} ${i18n.t('ui.panels.projectManager.caves')} • ${lastModified}</span>
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

  async importFatProject(fatProjectText, attributeDefs) {
    const pure = JSON.parse(fatProjectText);
    const fatProject = FatProject.fromPure(pure, attributeDefs);
    //generate new ids to avoid conflicts with existing projects and caves
    fatProject.project.id = Project.generateId();
    fatProject.caves.forEach((cave) => {
      cave.id = Cave.generateId();
    });
    const success = await this.importProject(fatProject.project, fatProject.caves, attributeDefs);
    if (success) {
      this.updateDisplay();
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

  async syncProject(localProject, driveProject, caveList, projectSyncInfo, onSuccess) {
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
              const cave = await this.downloadCave(driveCave, c.id, localProject.id);
              caves.set(cave.id, cave);
              //this.#emitCaveSynced(caveWithProperties.cave, localProject);
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
            const cave = await this.downloadCave(driveCave, c.id, localProject.id);
            caves.set(cave.id, cave);
            //this.#emitCaveSynced(caveWithProperties.cave, localProject);
          } else if (c.state === 'remoteDeleted') {
            this.db.deleteCave(cave.name);
            // Wait until 'caveDestructed' event is emitted for this cave
            // we need the indexed db operation to complete before we can continue
            setTimeout(() => this.#emitCaveDeleted(cave, driveProject.project.id), 200);
            await U.waitForEvent('caveDestructed', (detail) => detail.id === cave.id);

          } else if (c.state === 'localDeleted' && c.isOwner) {
            await this.googleDriveSync.deleteCave({ id: caveId });
            await this.revisionStore.deleteRevision(caveId);
            const response = await this.googleDriveSync.fetchProject(localProject);
            const driveProject = response.project;
            driveProject.deletedCaveIds.push(caveId);
            driveProject.caves = driveProject.caves.filter((c) => c.id !== caveId);
            await this.googleDriveSync.uploadProject(driveProject);
          } else if (c.state === 'localDeleted' && !c.isOwner) {
            // we download the cave
            const cave = await this.downloadCave(driveCave, c.id, localProject.id);
            caves.set(cave.id, cave);

          }
        })
      );

      let updatedProject;

      const cavesMetadata = [...caves.values()].map((cave) => {
        const rev = localRevisions.get(cave.id);
        return new DriveCaveMetadata(cave.id, cave.name, cave.revision ?? 1, rev?.app ?? localApp);
      });

      if (caveHasUploaded || projectSyncInfo.diff > 0 || (projectSyncInfo.diff === 0 && projectSyncInfo.hasConflict)) {
        //TODO: upload revinfo here
        updatedProject = new DriveProject(localProject, cavesMetadata, this.googleDriveSync.config.getApp());
        await this.googleDriveSync.uploadProject(updatedProject);
      } else if (projectSyncInfo.diff < 0) {
        // we need to fetch the project
        const response = await this.googleDriveSync.fetchProject(localProject);
        const project = response.project;
        this.projectSystem.saveProject(project);
        const rev = project.revision;
        const app = project.app;
        //this.#emitProjectSynced(projectWithProperties.project, localProject);
        await this.revisionStore.saveRevision(new RevisionInfo(localProject.id, rev, app, true, app, rev));

        //due to local changes in caves we need to update the project
        if (caveHasUploaded) {
          updatedProject = new DriveProject(project, cavesMetadata, app);
          await this.googleDriveSync.uploadProject(updatedProject);
        } else {
          updatedProject = project;
        }

      } else {
        // we do not need to upload the project, but we need fresh drive project and properties
        const { _, project } = await this.googleDriveSync.fetchProject(localProject);
        updatedProject = project;
      }

      onSuccess(updatedProject);
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectSyncFailed', { error: error.message }));
    }
  }
  async downloadCave(driveCave, caveId, projectId) {
    const response = await this.googleDriveSync.fetchCave({ id: caveId });
    if (driveCave.app !== response.properties.app) {
      throw new Error(i18n.t('ui.panels.projectManager.errors.caveAppMismatch', { id: caveId }));
    }
    const cave = response.cave;
    await this.caveSystem.saveCave(cave, projectId);
    const newRevInfo = new RevisionInfo(cave.id, cave.revision, driveCave.app, true, driveCave.app, driveCave.revision);
    await this.revisionStore.saveRevision(newRevInfo);
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
        const projectItem = this.panel.querySelector(`#project-item-${driveProject.project.id}`);
        const isCurrent = this.projectSystem.getCurrentProject()?.id === driveProject.project.id;
        const itemNode = this.getProjectItemNode(
          driveProject.project,
          driveProject.caves.map((c) => c.name),
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

  // this is always a new project upload and not an update
  async uploadProject(localProject) {
    try {
      const app = this.googleDriveSync.config.getApp();
      const caves = await this.caveSystem.getCavesByProjectId(localProject.id);
      const revisionInfo = new RevisionInfo(
        localProject.id,
        localProject.revision,
        app,
        true,
        app,
        localProject.revision
      );
      const cavesMetadata = caves.map((cave) => new DriveCaveMetadata(cave.id, cave.name, cave.revision ?? 1, app));
      await this.googleDriveSync.uploadProject(new DriveProject(localProject, cavesMetadata, app), true);
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
        new Date(localProject.updatedAt).toLocaleDateString(),
        isCurrent,
        true
      );
      const driveProject = new DriveProject(localProject, cavesMetadata, app, []);
      const projects = await this.projectSystem.getAllProjects();
      const decoratedNode = await this.decorateProjectItemWithDrive(driveProject, projects, caves, newNode);
      projectItemNode.replaceWith(decoratedNode);

    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectUploadFailed', { error: error.message }));
    }
  }

  async exportProject(projectId) {
    const project = await this.projectSystem.loadProjectById(projectId);
    try {

      const caves = await this.caveSystem.getCavesByProjectId(projectId);
      const projectWithCaves = new FatProject(project, caves);
      const projectData = projectWithCaves.toExport();
      const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_project.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showSuccessPanel(i18n.t('ui.panels.projectManager.projectExported', { name: project.name }));
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectExportFailed', { error: error.message }));
    }
  }

  async renameProject(projectId) {
    const project = await this.projectSystem.loadProjectById(projectId);

    if (!project) {
      showErrorPanel(i18n.t('ui.panels.projectManager.noProjectToRename'));
      return;
    }

    const newName = prompt(i18n.t('ui.panels.projectManager.enterNewProjectName', { name: project.name }));
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
      project.updatedAt = new Date().toISOString();
      // Save the updated project
      await this.projectSystem.saveProject(project);

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
