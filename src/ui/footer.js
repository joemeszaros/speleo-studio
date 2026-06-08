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

import { node, formatFloat } from '../utils/utils.js';
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

    // PWA install button — discreetly shown only when the browser offers installation
    this.installButton = node`<a href="#" class="footer-icon-link footer-install-link" style="display: none;" title="${i18n.t('ui.footer.installApp')}">
      <img src="icons/install.svg" class="footer-icon" alt="${i18n.t('ui.footer.installApp')}">
    </a>`;
    this.installButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.promptInstall();
    });
    if (this.legalLinksContainer) {
      this.legalLinksContainer.insertBefore(this.installButton, this.legalLinksContainer.firstChild);
    }
    this.initInstallPrompt();

    // Create zoom level container
    this.zoomSeparator = node`<div class="footer-separator">|</div>`;
    this.zoomInfoContainer = node`<div class="meta-info"></div>`;

    // Add elements to footer
    element.appendChild(this.projectInfoContainer);
    element.appendChild(node`<div class="footer-separator">|</div>`);
    element.appendChild(this.coordinateInfoContainer);
    element.appendChild(this.zoomSeparator);
    element.appendChild(this.zoomInfoContainer);
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
    document.addEventListener('zoomLevelChanged', (e) => this.updateZoomLevel(e.detail.level));

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

  updateZoomLevel(level) {
    this.zoomInfoContainer.innerHTML = `🔍&nbsp;<span class="meta-value">${formatFloat(level, 1)}</span>`;
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

  initInstallPrompt() {
    // The beforeinstallprompt event is captured early in index.html and stashed
    // on window.__deferredInstallPrompt; reveal the button when it is available.
    if (window.__deferredInstallPrompt) this.showInstallButton();
    window.addEventListener('pwaInstallAvailable', () => this.showInstallButton());
    window.addEventListener('pwaInstalled', () => this.hideInstallButton());
  }

  isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  showInstallButton() {
    // Already running as an installed app → nothing to offer.
    if (!this.isStandalone()) this.installButton.style.display = 'inline-flex';
  }

  hideInstallButton() {
    this.installButton.style.display = 'none';
  }

  async promptInstall() {
    const deferred = window.__deferredInstallPrompt;
    if (!deferred) return;
    this.hideInstallButton();
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      // user dismissed or the prompt failed – nothing to do
    }
    // A captured prompt can only be used once.
    window.__deferredInstallPrompt = null;
  }

  updateLegalLinksTitles() {
    // Update tooltips for legal links when language changes
    if (this.installButton) {
      this.installButton.title = i18n.t('ui.footer.installApp');
      const installImg = this.installButton.querySelector('img');
      if (installImg) {
        installImg.alt = i18n.t('ui.footer.installApp');
      }
    }
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
