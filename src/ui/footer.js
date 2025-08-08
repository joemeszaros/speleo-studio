import { node } from '../utils/utils.js';

class Footer {

  constructor(element) {
    this.element = element;
    this.messagesContainer = node`<div class="content"><div/>`;

    // Create project info container
    this.projectInfoContainer = node`<div class="project-info"></div>`;

    // Add elements to footer
    element.appendChild(document.createTextNode('Speleo Studio 1.0.0'));
    element.appendChild(node`<div class="project-info-separator">|</div>`);
    element.appendChild(this.projectInfoContainer);
    element.appendChild(this.messagesContainer);

    this.message = undefined;

    // Listen for project changes
    document.addEventListener('currentProjectChanged', (e) => this.updateProjectInfo(e.detail.project));
    document.addEventListener('currentProjectDeleted', () => this.updateProjectInfo(null));

  }

  updateProjectInfo(project) {
    if (project) {
      this.projectInfoContainer.innerHTML = `Project: <span class="project-name">${project.name}</span>`;
    } else {
      this.projectInfoContainer.innerHTML = 'No project loaded';
    }
  }

  showMessage(message) {
    this.messagesContainer.innerHTML = message;
  }

  clearMessage() {
    this.messagesContainer.innerHTML = '';
  }
}

export { Footer };
