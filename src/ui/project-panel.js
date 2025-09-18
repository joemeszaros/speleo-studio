import { showErrorPanel, showSuccessPanel } from './popups.js';
import * as U from '../utils/utils.js';
import { i18n } from '../i18n/i18n.js';
import { FatProject } from '../model/project.js';

export class ProjectPanel {
  constructor(panel, projectSystem, attributeDefs, projectInput = 'projectInput') {
    this.panel = panel;
    this.projectSystem = projectSystem;
    this.attributeDefs = attributeDefs;
    this.isVisible = false;
    this.fileInputElement = document.getElementById(projectInput);

    this.fileInputElement.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const text = event.target.result;
          await this.importProject(text, this.attributeDefs);
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

  setupPanel() {
    this.panel.innerHTML = `
      <div class="project-panel-header">
        <h3>${i18n.t('ui.panels.projectManager.title')}</h3>
        <button id="new-project-btn" class="project-btn">${i18n.t('ui.panels.projectManager.new')}</button>
        <button id="import-project-btn" class="project-btn">${i18n.t('ui.panels.projectManager.import')}</button>
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

    newProjectBtn.addEventListener('click', () => this.showNewProjectDialog());
    importProjectBtn.addEventListener('click', () => this.fileInputElement.click());
    projectSearch.addEventListener('input', () => this.filterProjects());
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

  async updateRecentProjectsList() {
    const recentProjectsList = this.panel.querySelector('#recent-projects-list');

    try {
      const projects = await this.projectSystem.getAllProjects();

      if (projects.length === 0) {
        recentProjectsList.innerHTML = `<p>${i18n.t('ui.panels.projectManager.noProjectsFound')}</p>`;
        return;
      }

      const projectListItems = await Promise.all(
        projects.map(async (project) => {
          const caves = await this.projectSystem.getCavesForProject(project.id);
          const caveCount = caves.length;
          const lastModified = new Date(project.updatedAt).toLocaleDateString();
          const isCurrent = this.projectSystem.getCurrentProject()?.id === project.id;
          const caveNames = caves.map((cave) => cave.name).join(', ');

          const panel = U.node`
           <div class="project-item ${isCurrent ? 'current' : ''}" data-project-id="${project.id}">
             <div class="project-item-header">
               <div class="project-item-info">
                 <span class="project-name">${project.name}</span>
                 ${project.description ? `<span class="project-description">• ${project.description}</span>` : ''}
                 ${caveNames ? `<span class="project-caves">• ${caveNames}</span>` : ''}
               </div>
               <div class="project-item-meta">
                 <span class="project-meta-text">${caveCount} ${i18n.t('ui.panels.projectManager.caves')} • ${lastModified}</span>
                 ${isCurrent ? `<span class="current-badge">${i18n.t('common.current')}</span>` : ''}
               </div>
             </div>
             <div class="project-item-actions">
               ${!isCurrent ? `<button id="open-project-btn" class="project-action-btn">${i18n.t('common.open')}</button>` : ''}
               <button id="delete-project-btn" class="project-action-btn delete">${i18n.t('common.delete')}</button>
               <button id="rename-project-btn" class="project-action-btn rename">${i18n.t('common.rename')}</button>
               <button id="export-project-btn" class="project-action-btn export">${i18n.t('common.export')}</button>
             </div>
           </div>
         `;

          panel.querySelector('#open-project-btn')?.addEventListener('click', () => this.openProject(project.id));
          panel.querySelector('#delete-project-btn').addEventListener('click', () => this.deleteProject(project.id));
          panel.querySelector('#rename-project-btn').addEventListener('click', () => this.renameProject(project.id));
          panel.querySelector('#export-project-btn').addEventListener('click', () => this.exportProject(project.id));
          return panel;
        })
      );

      recentProjectsList.innerHTML = '';
      projectListItems.forEach((item) => {
        recentProjectsList.appendChild(item);
      });

    } catch (error) {
      const errorMessage = i18n.t('ui.panels.projectManager.errorLoadingProjects');
      recentProjectsList.innerHTML = `<p>${errorMessage}</p>`;
      console.error(errorMessage, error);
    }
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
      showErrorPanel(i18n.t('ui.panels.projectManager.projectCreationFailed', { error: error.message }));
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
      showErrorPanel(i18n.t('ui.panels.projectManager.projectOpenFailed', { error: error.message }));
    }
  }

  async saveCurrentProject() {
    try {
      await this.projectSystem.saveCurrentProject();
      this.updateDisplay();
      showSuccessPanel(i18n.t('ui.panels.projectManager.projectSaved'));
    } catch (error) {
      showErrorPanel(i18n.t('ui.panels.projectManager.projectSaveFailed', { error: error.message }));
    }
  }

  async importProject(projectText, attributeDefs) {
    const pure = JSON.parse(projectText);
    const project = FatProject.fromPure(pure, attributeDefs);
    const nameExists = await this.projectSystem.checkProjectExistsByName(project.project.name);

    if (nameExists) {
      showErrorPanel(
        i18n.t('ui.panels.projectManager.errors.projectNameAlreadyExists', { name: project.project.name })
      );
      return;
    }
    const projectExists = await this.projectSystem.checkProjectExistsById(project.project.id);
    if (projectExists) {
      showErrorPanel(i18n.t('ui.panels.projectManager.errors.projectIdAlreadyExists', { id: project.project.id }));
      return;
    }

    for (const cave of project.caves) {
      const caveExists = await this.projectSystem.caveSystem.checkCaveExistsById(cave.id);
      if (caveExists) {
        showErrorPanel(i18n.t('ui.panels.projectManager.errors.caveIdAlreadyExists', { id: cave.id }));
        return;
      }
    }

    await this.projectSystem.saveProject(project.project);
    project.caves.forEach(async (cave) => {
      await this.projectSystem.caveSystem.saveCave(cave, project.project.id);
    });
    this.updateDisplay();
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
      showErrorPanel(i18n.t('ui.panels.projectManager.projectExportFailed', { error: error.message }));
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
      showErrorPanel(i18n.t('ui.panels.projectManager.projectRenameFailed', { error: error.message }));
    }
  }

  async deleteProject(projectId) {
    const confirmed = confirm(i18n.t('ui.panels.projectManager.deleteProjectConfirmation'));
    if (!confirmed) return;

    try {
      await this.projectSystem.deleteProject(projectId);

      // If we're deleting the current project, clear it
      if (this.projectSystem.getCurrentProject()?.id === projectId) {
        this.projectSystem.clearCurrentProject();
        this.#emitCurrentProjectDeleted(projectId);
      }

      this.updateDisplay();
      showSuccessPanel(i18n.t('ui.panels.projectManager.projectDeleted'));
    } catch (error) {
      showErrorPanel(i18n.t('ui.panels.projectManager.projectDeletionFailed', { error: error.message }));
    }
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
}
