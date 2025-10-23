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
import { Cave } from '../model/cave.js';
import { RevisionInfo } from '../model/misc.js';

export class ProjectPanel {
  constructor(
    panel,
    projectSystem,
    caveSystem,
    googleDriveSync,
    revisionStore,
    attributeDefs,
    projectInput = 'projectInput'
  ) {
    this.panel = panel;
    this.projectSystem = projectSystem;
    this.caveSystem = caveSystem;
    this.googleDriveSync = googleDriveSync;
    this.revisionStore = revisionStore;
    this.attributeDefs = attributeDefs;
    this.isVisible = false;
    this.fileInputElement = document.getElementById(projectInput);
    this.driveProjects = new Map();
    this.driveProperties = new Map();
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
      this.driveProperties.clear();
      const projectListItems = await Promise.all(
        projects.map(async (project) => {
          const caves = await this.projectSystem.getCavesForProject(project.id);
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
      if (this.googleDriveSync.isReady()) {
        driveProjectFiles = await this.googleDriveSync.listProjects();

        if (driveProjectFiles.length > 0) {

          // sequential needs a promise function and not a promise which is immediately executed
          const promises = driveProjectFiles.map((file) => async () => {
            const response = await this.googleDriveSync.fetchProjectByFile(file);
            if (response) {
              const projectId = response.project.project.id;
              this.driveProjects.set(projectId, response.project);
              this.driveProperties.set(projectId, response.properties);
              const projectItemNode = recentProjectsList.querySelector(`#project-item-${projectId}`);

              if (projectItemNode !== null) {
                await this.decorateProjectItemWithDrive(
                  response.properties,
                  response.project,
                  projects,
                  cavesForLocalProjects.get(projectId),
                  projectItemNode
                );
              } else {
                const newNode = this.getProjectItemForDriveProject(response.project, response.properties);
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

  async decorateProjectItemWithDrive(driveProperties, driveProject, projects, caves, projectItemNode) {

    if (driveProperties.revision !== driveProject.project.revision.toString()) {
      // this should never happen
      throw new Error(
        i18n.t('ui.panels.projectManager.errors.projectRevisionMismatch', {
          projectName   : driveProject.project.name,
          revision      : driveProperties.revision,
          driveRevision : driveProject.project.revision.toString()
        })
      );
    }

    const localProject = projects.find((p) => p.id === driveProject.project.id);

    // we need an updated cave list and a sync button

    const caveList = await this.getCaveList(caves, driveProject, driveProperties);
    let projectDiff = '';
    const diff = localProject.revision - driveProject.project.revision;
    if (diff > 0) {
      projectDiff = `(+${diff})`;
    } else if (diff < 0) {
      projectDiff = `(-${diff})`;
    }

    const projectNameElmnt = projectItemNode.querySelector(`#project-name-${localProject.id}`);
    projectNameElmnt.textContent = `${localProject.name} ${projectDiff}`;
    const projectCavesElmnt = projectItemNode.querySelector(`#project-caves-${localProject.id}`);
    projectCavesElmnt.textContent =
      ' • ' +
      caveList
        .map((c) => c.name)
        .join(', ');
    const projectInfoElmnt = projectItemNode.querySelector(`#project-item-info-${localProject.id}`);
    projectInfoElmnt.insertBefore(U.node`<img src="icons/drive.svg" class="drive-icon"/>`, projectInfoElmnt.firstChild);

    const syncEnabled =
      projectDiff !== '' ||
      caveList.some((c) => c.state !== 'existing' || (c.diff ?? 0) !== 0 || (c.hasConflict && c.diff === 0));
    if (syncEnabled) {
      const cloudButton = U.node`<button id="sync-project-btn" class="project-action-btn sync">${i18n.t('common.sync')}</button>`;
      cloudButton.addEventListener(
        'click',
        async (event) =>
          await this.createClickHandler(
            event,
            async () =>
              await this.syncProject(localProject, caveList, async (dProp, dProj) => {
                const nCaves = await this.projectSystem.getCavesForProject(localProject.id);
                const newNode = this.getProjectItemNode(
                  localProject,
                  nCaves.map((c) => c.name),
                  new Date(localProject.updatedAt).toLocaleDateString(),
                  true,
                  true
                );
                const decoratedNode = await this.decorateProjectItemWithDrive(dProp, dProj, projects, nCaves, newNode);
                const projectItemNode = this.panel.querySelector(`#project-item-${localProject.id}`);
                projectItemNode.replaceWith(decoratedNode);
              })
          )

      );
      const buttonContainer = projectItemNode.querySelector(`#project-item-actions-${localProject.id}`);
      buttonContainer.appendChild(cloudButton);

    }

    return projectItemNode;
  }

  // this is a drive project, without local copy, we need an item with a download button
  getProjectItemForDriveProject(driveProject, driveProperties) {
    const buttons = [
      {
        label : i18n.t('common.download'),
        click : async (event) =>
          await this.createClickHandler(event, async () => await this.downloadProject(driveProject, driveProperties))
      }
    ];
    return this.projectItemNode(
      driveProject.project,
      driveProject.caves.map((c) => c.name).map((n) => `🟢 ${n}`),
      buttons,
      new Date(driveProject.project.updatedAt).toLocaleDateString(),
      false,
      false
    );
  }

  async getProjectSyncInfo(driveProject, driveProperties, localProject) {
    const driveRevisionInfo = new RevisionInfo(
      driveProject.project.id,
      parseInt(driveProperties.revision),
      driveProperties.app,
      driveProperties.reason
    );

    const localRevisionInfo = await this.revisionStore.loadRevision(localProject.id);

    let hasConflict = false;
    const diff = localRevisionInfo.revision - driveRevisionInfo.revision;
    const info = { diff };

    // if (diff > 0) {
    //   //
    // } else if (diff < 0) {

    //   //
    // } else {
    //   hasConflict = localRevisionInfo.app !== driveProperties.app;
    // }

  }

  async getCaveList(caves, driveProject, driveProperties) {

    const caveList = await Promise.all(
      caves.map(async (cave) => {
        const caveId = cave.id;
        if (driveProject.caves.find((c) => c.id === caveId)) {
          const localRevision = await this.revisionStore.loadRevision(caveId);
          const hasConflict = localRevision.app !== driveProperties.app;
          const driveCaveRevision = driveProject.caves.find((c) => c.id === caveId).revision;
          const diff = cave.revision - driveCaveRevision;
          let prefix = hasConflict ? '⚠️' : '';
          let diffStr = '';
          if (diff > 0) {
            diffStr = `(+${diff})`;
          } else if (diff < 0) {
            diffStr = `(-${diff})`;
          } else {
            prefix = !hasConflict ? '✅️' : '';
          }
          return {
            id          : caveId,
            name        : `${prefix} ${cave.name} ${diffStr}`,
            state       : 'existing',
            diff        : diff,
            hasConflict : hasConflict,
            driveApp    : driveProperties.app
          };
        } else if (driveProject.deletedCaveIds.includes(caveId)) {
          return { id: caveId, name: '🔴 ' + cave.name, state: 'deleted' };
        } else {
          return { id: caveId, name: '🟢 ' + cave.name, state: 'new' };
        }
      })
    );
    const remoteCaves = driveProject.caves.filter((c) => caves.find((c2) => c2.id === c.id) === undefined);
    remoteCaves.forEach((cave) => {
      caveList.push({ id: cave.id, name: '🔵 ' + cave.name, state: 'remote' });
    });
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
    await Promise.all(
      caves.map((cave) => {
        this.caveSystem.saveCave(cave, project.id);
      })
    );
    return true;
  }

  async syncProject(localProject, caveList, onSuccess) {
    try {
      const conflictMessages = caveList
        .filter((c) => c.hasConflict)
        .map((c) => {
          if (c.diff === 0) {
            `Cave ${c.name} with same revision has been modified by another app: "${c.driveApp}". Sync will drop local changes since last revision.`;
          } else if (c.diff > 0) {
            `Cave ${c.name} has local changes. Sync will drop remote changes made by "${c.driveApp}".`;
          } else {
            `Cave ${c.name} has remote changes made by "${c.driveApp}". Sync will drop local changes since last revision.`;
          }
        });

      if (conflictMessages.length > 0) {
        if (!confirm(conflictMessages.join('\n\n'))) {
          return false;
        }
      }

      await Promise.all(
        caveList.map(async (c) => {
          const cave = await this.caveSystem.loadCave(c.id);
          const localRevisionInfo = await this.revisionStore.loadRevision(c.id);

          if (c.state === 'existing') {
            if (c.diff > 0) {
              await this.googleDriveSync.uploadCave(cave, localProject, false, localRevisionInfo);
            } else if (c.diff < 0) {
              const caveWithProperties = await this.googleDriveSync.fetchCave({ id: c.id }, localProject);
              this.caveSystem.saveCave(caveWithProperties.cave, localProject.id);
              this.#emitCaveSynced(caveWithProperties.cave, localProject);
            } else {
              if (c.hasConflict) {
                await this.googleDriveSync.uploadCave(cave, localProject, false, localRevisionInfo);
              } // otherwise nothing to do
            }
          } else if (c.state === 'new') {
            await this.googleDriveSync.uploadCave(cave, localProject, true);
          } else if (c.state === 'deleted') {
            this.#emitCaveDeleted(cave);
            // Wait until 'caveDestructed' event is emitted for this cave
            // we need the indexed db operation to complete before we can continue
            await U.waitForEvent('caveDestructed', (detail) => detail.id === cave.id);
          }
        })
      );

      const response = await this.googleDriveSync.uploadProject(localProject);

      onSuccess(response.properties, response.project);

      return true;
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectSyncFailed', { error: error.message }));
    }
  }

  async downloadProject(driveProject, driveProperties) {
    try {
      const cavesWithProperties = await Promise.all(
        driveProject.caves.map((cave) => this.googleDriveSync.fetchCave(cave))
      );
      const caves = cavesWithProperties.map((c) => c.cave);
      const success = await this.importProject(driveProject.project, caves);
      await Promise.all(
        cavesWithProperties.map(async (cwp) => {
          const caveRevisionInfo = new RevisionInfo(
            cwp.cave.id,
            cwp.cave.revision,
            this.googleDriveSync.config.getApp(),
            'create'
          );
          await this.revisionStore.saveRevision(caveRevisionInfo);
        })
      );

      if (success) {

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

        const decoratedNode = await this.decorateProjectItemWithDrive(
          driveProperties,
          driveProject,
          projects,
          caves,
          itemNode
        );
        projectItem.replaceWith(decoratedNode);
        showSuccessPanel(i18n.t('ui.panels.projectManager.projectDownloaded', { name: driveProject.project.name }));
      }
    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectDownloadFailed', { error: error.message }));
    }
  }

  async uploadProject(localProject) {
    try {
      const app = this.googleDriveSync.config.getApp();
      const caves = await this.projectSystem.getCavesForProject(localProject.id);
      const revisionInfo = new RevisionInfo(localProject.id, localProject.revision, app, 'create');
      // do not pass revision info, because this is a new file
      await this.googleDriveSync.uploadProject(localProject);
      await this.revisionStore.saveRevision(revisionInfo);
      await Promise.all(
        caves.map((cave) =>
          // do not pass revision info, because this is a new file
          this.#uploadCaveAndSaveRevision(cave, localProject, true, 'create')
        )
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
      const driveProject = new DriveProject(localProject, caves, app, []);
      const driveProperties = { app: app, revision: localProject.revision.toString() };
      const projects = await this.projectSystem.getAllProjects();
      const decoratedNode = await this.decorateProjectItemWithDrive(
        driveProperties,
        driveProject,
        projects,
        caves,
        newNode
      );
      projectItemNode.replaceWith(decoratedNode);

    } catch (error) {
      console.error(error);
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectUploadFailed', { error: error.message }));
    }
  }

  async exportProject(projectId) {
    const project = await this.projectSystem.loadProjectById(projectId);
    try {

      const caves = await this.projectSystem.getCavesForProject(projectId);
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
      const driveProperties = this.driveProperties.get(project.id);
      if (driveProject && this.googleDriveSync.isReady()) {
        const deleteFromDrive = confirm(i18n.t('ui.panels.projectManager.deleteProjectFromDriveConfirmation'));
        if (deleteFromDrive) {
          await this.googleDriveSync.deleteProject(project);
          const cavesIds = await this.caveSystem.getCaveFieldsByProjectId(project.id, ['id']);
          await Promise.all(cavesIds.map((cave) => this.googleDriveSync.deleteCave(cave)));
          this.driveProjects.delete(project.id);
          this.driveProperties.delete(project.id);
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
              await this.createClickHandler(
                event,
                async () => await this.downloadProject(driveProject, driveProperties)
              )
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

  async #uploadCaveAndSaveRevision(cave, project, create = false, reason = 'unknown') {
    const revisionInfo = new RevisionInfo(cave.id, cave.revision, this.googleDriveSync.config.getApp(), reason);
    if (create) {
      await this.googleDriveSync.uploadCave(cave, project, true);
    } else {
      await this.googleDriveSync.uploadCave(cave, project, false, revisionInfo);
    }
    await this.revisionStore.saveRevision(revisionInfo);
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

  #emitCaveDeleted(cave) {
    const event = new CustomEvent('caveDeleted', {
      detail : {
        name : cave.name,
        id   : cave.id
      }
    });
    document.dispatchEvent(event);
  }
}
