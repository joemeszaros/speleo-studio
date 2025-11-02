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
import { detectBrowser, detectPlatform, randomAlphaNumbericString } from '../utils/utils.js';
/**
 * Google Drive configuration manager
 * Handles authentication details and folder configuration for Google Drive sync
 */
export class GoogleDriveConfig {
  static STORAGE_KEY = 'speleo-studio-google-drive-config';
  static VERSION = '1.0';

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from localStorage
   * @returns {Object} Configuration object
   */
  loadConfig() {
    try {
      const stored = localStorage.getItem(GoogleDriveConfig.STORAGE_KEY);
      if (!stored) {
        return this.getDefaultConfig();
      }

      const config = JSON.parse(stored);
      return this.validateAndMergeConfig(config);
    } catch (error) {
      console.warn('Failed to load Google Drive configuration:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Get default configuration
   * @returns {Object} Default configuration
   */
  getDefaultConfig() {
    return {
      version            : GoogleDriveConfig.VERSION,
      clientId           : '',
      clientSecret       : '',
      appName            : `${detectBrowser()} (${detectPlatform()})`,
      appId              : randomAlphaNumbericString(8),
      folderName         : 'Speleo Studio',
      cavesFolderName    : 'Caves',
      projectsFolderName : 'Projects',
      autoSync           : false,
      ignoreConflict     : false,
      lastSync           : null,
      accessToken        : null,
      refreshToken       : null,
      tokenExpiry        : null,
      email              : null
    };
  }

  /**
   * Validate and merge configuration with defaults
   * @param {Object} config - Configuration to validate
   * @returns {Object} Validated configuration
   */
  validateAndMergeConfig(config) {
    const defaultConfig = this.getDefaultConfig();

    // Ensure all required fields exist
    const validatedConfig = { ...defaultConfig, ...config };

    // Validate version compatibility
    if (validatedConfig.version !== GoogleDriveConfig.VERSION) {
      console.warn('Google Drive config version mismatch, using defaults');
      return defaultConfig;
    }

    return validatedConfig;
  }

  /**
   * Save configuration to localStorage
   */
  saveConfig() {
    try {
      this.config.version = GoogleDriveConfig.VERSION;
      localStorage.setItem(GoogleDriveConfig.STORAGE_KEY, JSON.stringify(this.config));
      console.log('Google Drive configuration saved successfully');
    } catch (error) {
      console.error('Failed to save Google Drive configuration:', error);
      throw new Error(i18n.t('errors.googleDrive.failedToSaveConfig'));
    }
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration updates
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  isConfigured() {
    return this.config.clientId && this.config.clientSecret && this.config.folderName;
  }

  hasTokens() {
    return this.config.accessToken !== null && this.config.refreshToken !== null;
  }

  /**
   * Check if authentication tokens are valid
   * @returns {boolean} True if tokens are valid
   */
  hasValidTokens() {
    if (!this.hasTokens()) {
      return false;
    }

    if (this.config.tokenExpiry) {
      const now = new Date();
      const expiry = new Date(this.config.tokenExpiry);
      return now < expiry;
    }

    return true;
  }

  /**
   * Clear authentication tokens
   */
  clearTokens() {
    this.config.accessToken = null;
    this.config.refreshToken = null;
    this.config.tokenExpiry = null;
    this.saveConfig();
  }

  /**
   * Set authentication tokens
   * @param {string} accessToken - Access token
   * @param {string} refreshToken - Refresh token
   * @param {number} expiresIn - Token expiry in seconds
   */
  setTokens(accessToken, refreshToken, expiresIn) {
    this.config.accessToken = accessToken;
    this.config.refreshToken = refreshToken;

    if (expiresIn) {
      const expiry = new Date();
      expiry.setSeconds(expiry.getSeconds() + expiresIn);
      this.config.tokenExpiry = expiry.toISOString();
    }

    this.saveConfig();
  }

  getApp() {
    return `${this.config.appName}_${this.config.appId}`;
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   * @returns {*} Configuration value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Set configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Configuration value
   */
  set(key, value) {
    this.config[key] = value;
    this.saveConfig();
  }

  /**
   * Export configuration for backup
   * @returns {string} JSON string of configuration
   */
  exportConfig() {
    const exportConfig = { ...this.config };
    // Remove sensitive tokens for export
    delete exportConfig.accessToken;
    delete exportConfig.refreshToken;
    delete exportConfig.tokenExpiry;

    return JSON.stringify(exportConfig, null, 2);
  }

  /**
   * Import configuration from JSON string
   * @param {string} jsonString - JSON configuration string
   * @returns {boolean} True if import successful
   */
  importConfig(jsonString) {
    try {
      const importedConfig = JSON.parse(jsonString);
      this.config = this.validateAndMergeConfig(importedConfig);
      this.saveConfig();
      return true;
    } catch (error) {
      console.error('Failed to import Google Drive configuration:', error);
      return false;
    }
  }

  /**
   * Reset configuration to defaults
   */
  reset() {
    this.config = this.getDefaultConfig();
    this.saveConfig();
  }
}
