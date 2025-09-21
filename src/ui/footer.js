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

import { node } from '../utils/utils.js';
import { i18n } from '../i18n/i18n.js';

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
    this.project = undefined;
    this.updateProjectInfo(this.project);

    // Listen for project changes
    document.addEventListener('currentProjectChanged', (e) => this.updateProjectInfo(e.detail.project));
    document.addEventListener('currentProjectDeleted', () => this.updateProjectInfo(null));
    document.addEventListener('languageChanged', () => this.updateProjectInfo(this.project));

  }

  updateProjectInfo(project) {
    this.project = project;
    if (project) {
      this.projectInfoContainer.innerHTML = `${i18n.t('ui.footer.project')}: <span class="project-name">${project.name}</span>`;
    } else {
      this.projectInfoContainer.innerHTML = i18n.t('ui.footer.noProjectLoaded');
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
