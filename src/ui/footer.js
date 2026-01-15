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
    this.messagesContainer = node`<div class="content"></div>`;

    // Create project info container
    this.projectInfoContainer = node`<div class="meta-info"></div>`;
    this.coordinateInfoContainer = node`<div class="meta-info">${i18n.t('ui.footer.noCoordinateSystemLoaded')}</div>`;

    // Create Google Drive sync indicator
    this.googleDriveSyncIndicator = node`<div class="google-drive-sync-indicator" style="display: none;">
      <img src="icons/drive.svg" class="google-drive-icon" alt="Google Drive Sync" title="Google Drive sync in progress">
    </div>`;
    this.driveSeparator = node`<div style="display:none" class="footer-separator">|</div>`;

    // Get existing legal links container from HTML (if present)
    this.legalLinksContainer = element.querySelector('.footer-legal-links');

    // Add elements to footer
    element.appendChild(this.projectInfoContainer);
    element.appendChild(node`<div class="footer-separator">|</div>`);
    element.appendChild(this.coordinateInfoContainer);
    element.appendChild(this.driveSeparator);
    element.appendChild(this.googleDriveSyncIndicator);
    element.appendChild(this.messagesContainer);

    this.message = undefined;
    this.project = undefined;
    this.updateProjectInfo(this.project);
    this.updateLegalLinksTitles();

    // Listen for project changes
    document.addEventListener('currentProjectChanged', (e) => this.updateProjectInfo(e.detail.project));
    document.addEventListener('currentProjectDeleted', () => this.updateProjectInfo(null));
    document.addEventListener('languageChanged', () => {
      this.updateProjectInfo(this.project);
      this.updateLegalLinksTitles();
    });
    document.addEventListener('coordinateSystemChanged', (e) => this.updateCoordinateInfo(e.detail.coordinateSystem));

    // Listen for Google Drive sync status changes
    document.addEventListener('googleDriveSyncStarted', () => this.showGoogleDriveSyncIndicator());
    document.addEventListener('googleDriveSyncCompleted', () => this.hideGoogleDriveSyncIndicator());

  }

  updateCoordinateInfo(coordinateSystem) {
    if (coordinateSystem) {
      this.coordinateInfoContainer.innerHTML = `${i18n.t('ui.footer.coordinateSystem')}: <span class="meta-value">${coordinateSystem.toString()}</span>`;
    } else {
      this.coordinateInfoContainer.innerHTML = i18n.t('ui.footer.noCoordinateSystemLoaded');
    }
  }

  updateProjectInfo(project) {
    this.project = project;
    if (project) {
      this.projectInfoContainer.innerHTML = `${i18n.t('ui.footer.project')}: <span class="meta-value">${project.name}</span>`;
    } else {
      this.projectInfoContainer.innerHTML = i18n.t('ui.footer.noProjectLoaded');
    }
  }

  showMessage(message) {
    // Wrap content in a span to ensure proper text truncation
    // Use inline-block so it can be centered by flexbox, with max-width for truncation
    this.messagesContainer.innerHTML = `<span style="display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${message}</span>`;
  }

  clearMessage() {
    this.messagesContainer.innerHTML = '';
  }

  showGoogleDriveSyncIndicator() {
    this.googleDriveSyncIndicator.style.display = 'inline-block';
    this.googleDriveSyncIndicator.classList.add('blinking');
    this.driveSeparator.style.display = 'inline-block';
  }

  hideGoogleDriveSyncIndicator() {
    this.googleDriveSyncIndicator.style.display = 'none';
    this.googleDriveSyncIndicator.classList.remove('blinking');
    this.driveSeparator.style.display = 'none';
  }

  updateLegalLinksTitles() {
    // Update tooltips for legal links when language changes
    if (this.legalLinksContainer) {
      const privacyLink = this.legalLinksContainer.querySelector('a[href="pages/privacy-policy.html"]');
      const termsLink = this.legalLinksContainer.querySelector('a[href="pages/terms-of-service.html"]');
      if (privacyLink) {
        privacyLink.title = i18n.t('ui.footer.privacyPolicy');
        const privacyImg = privacyLink.querySelector('img');
        if (privacyImg) {
          privacyImg.alt = i18n.t('ui.footer.privacyPolicy');
        }
      }
      if (termsLink) {
        termsLink.title = i18n.t('ui.footer.termsOfService');
        const termsImg = termsLink.querySelector('img');
        if (termsImg) {
          termsImg.alt = i18n.t('ui.footer.termsOfService');
        }
      }
    }
  }
}

export { Footer };
