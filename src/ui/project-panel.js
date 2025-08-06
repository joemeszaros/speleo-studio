import { showErrorPanel, showSuccessPanel } from './popups.js';

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
        <button class="project-panel-close" onclick="this.parentElement.parentElement.style.display='none'">×</button>
      </div>
      
      <div class="project-panel-content">
        <div class="current-project-section">
          <h4>Current Project</h4>
          <div id="current-project-info">
            <p>No project loaded</p>
          </div>
        </div>
        
        <div class="project-actions-section">
          <h4>Project Actions</h4>
          <button id="new-project-btn" class="project-btn">New Project</button>
          <button id="save-project-btn" class="project-btn" disabled>Save Project</button>
          <button id="export-project-btn" class="project-btn" disabled>Export Project</button>
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
    const saveProjectBtn = this.panel.querySelector('#save-project-btn');
    const exportProjectBtn = this.panel.querySelector('#export-project-btn');
    const projectSearch = this.panel.querySelector('#project-search');

    newProjectBtn.addEventListener('click', () => this.showNewProjectDialog());
    saveProjectBtn.addEventListener('click', () => this.saveCurrentProject());
    exportProjectBtn.addEventListener('click', () => this.exportCurrentProject());
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
    this.updateButtonStates();
  }

  async updateCurrentProjectInfo() {
    const currentProjectInfo = this.panel.querySelector('#current-project-info');
    const currentProject = this.projectSystem.getCurrentProject();

    if (currentProject) {
      const caveCount = currentProject.getAllCaves().length;
      const lastModified = new Date(currentProject.updatedAt).toLocaleString();

      currentProjectInfo.innerHTML = `
        <div class="project-info">
          <h5>${currentProject.name}</h5>
          <p><strong>Caves:</strong> ${caveCount}</p>
          <p><strong>Created:</strong> ${new Date(currentProject.createdAt).toLocaleDateString()}</p>
          <p><strong>Modified:</strong> ${lastModified}</p>
          ${currentProject.description ? `<p><strong>Description:</strong> ${currentProject.description}</p>` : ''}
        </div>
      `;
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

      const projectsHtml = projects
        .map((project) => {
          const caves = project.getAllCaves();
          const caveCount = caves.length;
          const lastModified = new Date(project.updatedAt).toLocaleDateString();
          const isCurrent = this.projectSystem.getCurrentProject()?.id === project.id;
          const caveNames = caves.map((cave) => cave.name).join(', ');

          return `
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
                 <button class="project-action-btn" onclick="window.projectPanel.openProject('${project.id}')">Open</button>
                 <button class="project-action-btn delete" onclick="window.projectPanel.deleteProject('${project.id}')">Delete</button>
               </div>
             </div>
           `;
        })
        .join('');

      recentProjectsList.innerHTML = projectsHtml;
    } catch (error) {
      recentProjectsList.innerHTML = '<p>Error loading projects</p>';
      console.error('Error loading projects:', error);
    }
  }

  updateButtonStates() {
    const currentProject = this.projectSystem.getCurrentProject();
    const saveProjectBtn = this.panel.querySelector('#save-project-btn');
    const exportProjectBtn = this.panel.querySelector('#export-project-btn');

    saveProjectBtn.disabled = !currentProject;
    exportProjectBtn.disabled = !currentProject;
  }

  async showNewProjectDialog() {
    const name = prompt('Enter project name:');
    if (!name) return;

    const description = prompt('Enter project description (optional):');

    try {
      const project = await this.projectSystem.createProject(name, description);
      this.projectSystem.setCurrentProject(project);

      this.#emitCurrentProjectChanged(project);

      this.updateDisplay();
      showSuccessPanel(`Project "${name}" created successfully`);
    } catch (error) {
      showErrorPanel(`Failed to create project: ${error.message}`);
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

      this.updateDisplay();
      showSuccessPanel(`Project "${project.name}" loaded successfully`);

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

  async deleteProject(projectId) {
    const project = await this.projectSystem.loadProjectById(projectId);
    const confirmed = confirm(
      `Are you sure you want to delete project "${project.name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await this.projectSystem.deleteProject(projectId);

      // If we're deleting the current project, clear it
      if (this.projectSystem.getCurrentProject()?.id === projectId) {
        this.projectSystem.setCurrentProject(null);
        this.#emitCurrentProjectChanged(null);
      }

      this.updateDisplay();
      showSuccessPanel(`Project "${project.name}" deleted successfully`);
    } catch (error) {
      showErrorPanel(`Failed to delete project: ${error.message}`);
    }
  }
}
