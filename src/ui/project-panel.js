import { showErrorPanel, showSuccessPanel } from './popups.js';
import * as U from '../utils/utils.js';

export class ProjectPanel {
  constructor(projectSystem) {
    this.projectSystem = projectSystem;
    this.panel = null;
    this.isVisible = false;
  }

  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'project-panel';
    this.panel.className = 'project-panel';
    this.panel.style.display = 'none';

    this.panel.innerHTML = `
      <div class="project-panel-header">
        <h3>Project Manager</h3>
        <button id="new-project-btn" class="project-btn">New Project</button>
        <button class="project-panel-close" onclick="this.parentElement.parentElement.style.display='none'">×</button>
      </div>
      
      <div class="project-panel-content">
        <div class="current-project-section">
          <h4>Current Project</h4>
          <div id="current-project-info">
            <p>No project loaded</p>
          </div>
        </div>
        
        <div class="recent-projects-section">
          <h4>Recent Projects</h4>
          <div class="project-search-container">
            <input type="text" id="project-search" placeholder="Search projects..." class="project-search-input">
          </div>
          <div id="recent-projects-list">
            <p>No recent projects</p>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
    return this.panel;
  }

  setupEventListeners() {
    const newProjectBtn = this.panel.querySelector('#new-project-btn');
    const projectSearch = this.panel.querySelector('#project-search');

    newProjectBtn.addEventListener('click', () => this.showNewProjectDialog());
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
            <span class="current-project-meta">${caveCount} caves • ${lastModified}</span>
          </div>
          ${currentProject.description ? `<div class="current-project-description">${currentProject.description}</div>` : ''}
          <div class="current-project-actions">
            <button id="save-project-btn" class="project-btn">Save Project</button>
            <button id="export-project-btn" class="project-btn">Export Project</button>
            <button id="rename-project-btn" class="project-btn">Rename</button>
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
        exportProjectBtn.addEventListener('click', () => this.exportCurrentProject());
      }
      if (renameProjectBtn) {
        renameProjectBtn.addEventListener('click', () => {
          this.renameProject(currentProject.id);
          this.projectSystem.setCurrentProject(currentProject);
        });
      }
    } else {
      currentProjectInfo.innerHTML = '<p>No project loaded</p>';
    }
  }

  async updateRecentProjectsList() {
    const recentProjectsList = this.panel.querySelector('#recent-projects-list');

    try {
      const projects = await this.projectSystem.getAllProjects();

      if (projects.length === 0) {
        recentProjectsList.innerHTML = '<p>No projects found</p>';
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
                 <span class="project-meta-text">${caveCount} caves • ${lastModified}</span>
                 ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
               </div>
             </div>
             <div class="project-item-actions">
               <button id="open-project-btn" class="project-action-btn">Open</button>
               <button id="delete-project-btn" class="project-action-btn delete">Delete</button>
               <button id="rename-project-btn" class="project-action-btn rename">Rename</button>
             </div>
           </div>
         `;

          panel.querySelector('#open-project-btn').addEventListener('click', () => this.openProject(project.id));
          panel.querySelector('#delete-project-btn').addEventListener('click', () => this.deleteProject(project.id));
          panel.querySelector('#rename-project-btn').addEventListener('click', () => this.renameProject(project.id));
          return panel;
        })
      );

      recentProjectsList.innerHTML = '';
      projectListItems.forEach((item) => {
        recentProjectsList.appendChild(item);
      });

    } catch (error) {
      recentProjectsList.innerHTML = '<p>Error loading projects</p>';
      console.error('Error loading projects:', error);
    }
  }

  async showNewProjectDialog() {
    const name = prompt('Enter project name:');
    if (!name) return;

    const description = prompt('Enter project description (optional):');

    try {
      const project = await this.projectSystem.createProject(name, description);
      this.projectSystem.setCurrentProject(project);

      this.#emitCurrentProjectChanged(project);

      this.hide();
      showSuccessPanel(`Project "${name}" created successfully`);
    } catch (error) {
      showErrorPanel(`Failed to create project: ${error.message}`);
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
      showErrorPanel(`Failed to load project: ${error.message}`);
    }
  }

  async saveCurrentProject() {
    try {
      await this.projectSystem.saveCurrentProject();
      this.updateDisplay();
      showSuccessPanel('Project saved successfully');
    } catch (error) {
      showErrorPanel(`Failed to save project: ${error.message}`);
    }
  }

  async exportCurrentProject() {
    const currentProject = this.projectSystem.getCurrentProject();
    if (!currentProject) {
      showErrorPanel('No project to export');
      return;
    }

    try {
      const projectData = currentProject.toJSON();
      const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_project.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showSuccessPanel(`Project "${currentProject.name}" exported successfully`);
    } catch (error) {
      showErrorPanel(`Failed to export project: ${error.message}`);
    }
  }

  async renameProject(projectId) {
    const project = await this.projectSystem.loadProjectById(projectId);

    if (!project) {
      showErrorPanel('No project to rename');
      return;
    }

    const newName = prompt('Enter new project name:', project.name);
    if (!newName || newName.trim() === '') {
      return;
    }

    const trimmedName = newName.trim();
    if (trimmedName === project.name) {
      return; // No change
    }

    try {
      // Check if name already exists
      const nameExists = await this.projectSystem.checkProjectExists(trimmedName);

      if (nameExists) {
        showErrorPanel(`A project with the name "${trimmedName}" already exists`);
        return;
      }

      // Update project name
      project.name = trimmedName;
      project.updatedAt = new Date().toISOString();
      // Save the updated project
      await this.projectSystem.saveProject(project);

      // Update display
      this.updateDisplay();

      showSuccessPanel(`Project renamed to "${trimmedName}" successfully`);
    } catch (error) {
      showErrorPanel(`Failed to rename project: ${error.message}`);
    }
  }

  async deleteProject(projectId) {
    const confirmed = confirm(`Are you sure you want to delete this project? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      await this.projectSystem.deleteProject(projectId);

      // If we're deleting the current project, clear it
      if (this.projectSystem.getCurrentProject()?.id === projectId) {
        this.projectSystem.clearCurrentProject();
        this.#emitCurrentProjectDeleted(projectId);
      }

      this.updateDisplay();
      showSuccessPanel(`Project deleted successfully`);
    } catch (error) {
      console.error('Failed to delete project', error);
      showErrorPanel(`Failed to delete project: ${error.message}`);
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
