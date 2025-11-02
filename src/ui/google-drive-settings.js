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
import { i18n } from '../i18n/i18n.js';
import { detectBrowser, detectPlatform } from '../utils/utils.js';
import { showErrorPanel, showSuccessPanel } from './popups.js';

/**
 * Google Drive settings UI component
 * Provides interface for configuring and managing Google Drive sync
 */
export class GoogleDriveSettings {
  constructor(googleDriveSync) {
    this.sync = googleDriveSync;
    this.config = this.sync.config;
    this.isVisible = false;
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for OAuth callback
   */
  setupEventListeners() {
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data.type === 'google-drive-auth') {
        this.handleOAuthCallback(event.data.code);
      }
    });
  }

  /**
   * Handle OAuth callback
   * @param {string} code - Authorization code
   */
  async handleOAuthCallback(code) {
    try {
      await this.sync.completeAuthorization(code);
      this.updateUI();
      showSuccessPanel(i18n.t('messages.googleDrive.authorizationSuccessful'));
    } catch (error) {
      console.error('OAuth callback error:', error);
      showErrorPanel(i18n.t('errors.googleDrive.authorizationFailed', { error: error.message }));
    }
  }

  /**
   * Show the Google Drive settings panel
   */
  show() {
    if (this.isVisible) {
      return;
    }

    this.isVisible = true;
    this.createPanel();
    this.updateUI();
  }

  /**
   * Hide the Google Drive settings panel
   */
  hide() {
    if (!this.isVisible) {
      return;
    }

    const panel = document.getElementById('google-drive-settings-panel');
    if (panel) {
      panel.remove();
    }
    this.isVisible = false;
  }

  /**
   * Create the settings panel HTML
   */
  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'google-drive-settings-panel';
    panel.className = 'google-drive-settings-panel';
    panel.innerHTML = `
      <div class="google-drive-settings-header">
        <h3>${i18n.t('ui.panels.googleDriveSettings.title')}</h3>
        <button id="close-google-drive-settings" class="google-drive-close-button">×</button>
      </div>
      <div class="google-drive-settings-content">
        <div class="google-drive-settings-section">
          <h4>${i18n.t('ui.panels.googleDriveSettings.configuration')}</h4>
          <div class="google-drive-form-group">
            <label for="client-id">${i18n.t('ui.panels.googleDriveSettings.clientId')}</label>
            <input type="text" id="client-id" placeholder="${i18n.t('ui.panels.googleDriveSettings.clientIdPlaceholder')}">
          </div>
          <div class="google-drive-form-group">
            <label for="client-secret">${i18n.t('ui.panels.googleDriveSettings.clientSecret')}</label>
            <input type="password" id="client-secret" placeholder="${i18n.t('ui.panels.googleDriveSettings.clientSecretPlaceholder')}">
          </div>
          <div class="google-drive-form-group">
            <label for="instance-name">${i18n.t('ui.panels.googleDriveSettings.instanceName')}</label>
            <input type="text" id="instance-name" placeholder="${i18n.t('ui.panels.googleDriveSettings.instanceNamePlaceholder')}" value="">
          </div>

          <div class="google-drive-form-group">
            <label for="folder-name">${i18n.t('ui.panels.googleDriveSettings.folderName')}</label>
            <input type="text" id="folder-name" placeholder="${i18n.t('ui.panels.googleDriveSettings.folderNamePlaceholder')}" value="${i18n.t('ui.panels.googleDriveSettings.folderNamePlaceholder')}">
          </div>
          <div class="google-drive-form-group">
            <label for="caves-folder">${i18n.t('ui.panels.googleDriveSettings.cavesFolder')}</label>
            <input type="text" id="caves-folder" placeholder="${i18n.t('ui.panels.googleDriveSettings.cavesFolderPlaceholder')}" value="${i18n.t('ui.panels.googleDriveSettings.cavesFolderPlaceholder')}">
          </div>
          <div class="google-drive-form-group">
            <label for="projects-folder">${i18n.t('ui.panels.googleDriveSettings.projectsFolder')}</label>
            <input type="text" id="projects-folder" placeholder="${i18n.t('ui.panels.googleDriveSettings.projectsFolderPlaceholder')}" value="${i18n.t('ui.panels.googleDriveSettings.projectsFolderPlaceholder')}">
          </div>
          <div class="google-drive-form-group">
            <label>
              <input type="checkbox" id="auto-sync">
              ${i18n.t('ui.panels.googleDriveSettings.enableAutoSync')}
            </label>
           <label>
              <input type="checkbox" id="ignore-conflict">
              ${i18n.t('ui.panels.googleDriveSettings.ignoreConflict')}
            </label>
          </div>
        </div>

        <div class="google-drive-settings-section">
          <h4>${i18n.t('ui.panels.googleDriveSettings.authentication')}</h4>
          <div id="auth-status" class="google-drive-auth-status">
            
          </div>
          <div class="google-drive-auth-buttons">
            <button id="authorize-button" class="google-drive-auth-button" disabled>${i18n.t('ui.panels.googleDriveSettings.authorize')}</button>
            <button id="disconnect-button" class="google-drive-auth-button" disabled>${i18n.t('ui.panels.googleDriveSettings.disconnect')}</button>
          </div>
        </div>

        
      </div>
    `;

    document.body.appendChild(panel);
    this.setupPanelEventListeners();
  }

  /**
   * Setup event listeners for the panel
   */
  setupPanelEventListeners() {
    const panel = document.getElementById('google-drive-settings-panel');

    // Close button
    panel.querySelector('#close-google-drive-settings').addEventListener('click', () => {
      this.hide();
    });

    // Configuration inputs
    const inputs = ['client-id', 'client-secret', 'instance-name', 'folder-name', 'caves-folder', 'projects-folder'];
    inputs.forEach((id) => {
      const input = panel.querySelector(`#${id}`);
      input.addEventListener('input', () => {
        this.saveConfiguration();
      });
    });

    // Auto-sync checkbox
    panel.querySelector('#auto-sync').addEventListener('change', (e) => {
      this.config.set('autoSync', e.target.checked);
    });

    panel.querySelector('#ignore-conflict').addEventListener('change', (e) => {
      this.config.set('ignoreConflict', e.target.checked);
    });

    // Auth buttons
    panel.querySelector('#authorize-button').addEventListener('click', () => {
      this.startAuthorization();
    });

    panel.querySelector('#disconnect-button').addEventListener('click', () => {
      this.disconnect();
    });

  }

  /**
   * Save configuration from form inputs
   */
  saveConfiguration() {
    const panel = document.getElementById('google-drive-settings-panel');

    const clientId = panel.querySelector('#client-id').value;
    const clientSecret = panel.querySelector('#client-secret').value;
    const instanceName = panel.querySelector('#instance-name').value;

    this.config.updateConfig({
      clientId     : clientId,
      clientSecret : clientSecret,
      appName      : instanceName,
      folderName   :
        panel.querySelector('#folder-name').value || i18n.t('ui.panels.googleDriveSettings.folderNamePlaceholder'),
      cavesFolderName :
        panel.querySelector('#caves-folder').value || i18n.t('ui.panels.googleDriveSettings.cavesFolderPlaceholder'),
      projectsFolderName :
        panel.querySelector('#projects-folder').value ||
        i18n.t('ui.panels.googleDriveSettings.projectsFolderPlaceholder')
    });

    this.updateUI();
  }

  /**
   * Update the UI based on current configuration
   */
  updateUI() {
    if (!this.isVisible) {
      return;
    }

    const panel = document.getElementById('google-drive-settings-panel');
    if (!panel) {
      return;
    }

    // Update form inputs
    panel.querySelector('#client-id').value = this.config.get('clientId') || '';
    panel.querySelector('#client-secret').value = this.config.get('clientSecret') || '';
    panel.querySelector('#instance-name').value =
      this.config.get('appName') || `${detectBrowser()} (${detectPlatform()})`;
    panel.querySelector('#folder-name').value =
      this.config.get('folderName') || i18n.t('ui.panels.googleDriveSettings.folderNamePlaceholder');
    panel.querySelector('#caves-folder').value =
      this.config.get('cavesFolderName') || i18n.t('ui.panels.googleDriveSettings.cavesFolderPlaceholder');
    panel.querySelector('#projects-folder').value =
      this.config.get('projectsFolderName') || i18n.t('ui.panels.googleDriveSettings.projectsFolderPlaceholder');
    panel.querySelector('#auto-sync').checked = this.config.get('autoSync') || false;
    panel.querySelector('#ignore-conflict').checked = this.config.get('ignoreConflict') || false;

    // Update auth status
    const authStatus = panel.querySelector('#auth-status');
    const authorizeButton = panel.querySelector('#authorize-button');
    const disconnectButton = panel.querySelector('#disconnect-button');

    if (this.config.isConfigured() && this.config.hasValidTokens()) {
      authStatus.innerHTML = `<p class="success">${i18n.t('ui.panels.googleDriveSettings.connected')}</p>`;
      authorizeButton.disabled = true;
      disconnectButton.disabled = false;

    } else if (this.config.isConfigured()) {
      authStatus.innerHTML = `<p class="warning">⚠ ${i18n.t('ui.panels.googleDriveSettings.configurationComplete')}</p>`;
      authorizeButton.disabled = false;
      disconnectButton.disabled = true;
    } else {
      authStatus.innerHTML = `<p class="error">✗ ${i18n.t('ui.panels.googleDriveSettings.notConfigured')}</p>`;
      authorizeButton.disabled = true;
      disconnectButton.disabled = true;
    }

    // Update sync buttons
    const syncButtons = panel.querySelectorAll('.sync-button');
    const isReady = this.sync.isReady();
    syncButtons.forEach((button) => {
      button.disabled = !isReady || this.sync.isSyncing;
    });
  }
  /**
   * Start OAuth authorization flow
   */
  startAuthorization() {
    if (!this.config.isConfigured()) {
      showErrorPanel(i18n.t('errors.googleDrive.notConfigured'));
      return;
    }

    try {
      const authURL = this.sync.getAuthorizationURL();
      window.open(authURL, 'google-drive-auth', 'width=500,height=600');
    } catch (error) {
      console.error('Authorization error:', error);
      showErrorPanel(i18n.t('errors.googleDrive.authorizationFailed', { error: error.message }));
    }
  }

  /**
   * Disconnect from Google Drive
   */
  disconnect() {
    this.sync.disconnect();
    this.updateUI();
    showSuccessPanel(i18n.t('messages.googleDrive.disconnected'));
  }

}
