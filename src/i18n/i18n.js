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

/**
 * Home-built Internationalization (i18n) System
 * Supports multiple languages, template interpolation, and automatic language detection
 */

import { node } from '../utils/utils.js';

class I18nManager {

  constructor(options = {}) {
    this.fallbackLanguage = 'en';
    this.translations = {};
    this.supportedLanguages = new Map([
      ['en', 'English'],
      ['hu', 'Magyar']
    ]);
    this.translationsPath = options.translationsPath || './src/i18n/translations';
  }

  async init(storage = localStorage) {
    this.storage = storage;
    await this.detectPreferredLanguage();
    await this.loadTranslations(this.currentLanguage);

    // we need english translation for attribute label visualization (format string)
    if (this.currentLanguage !== 'en') {
      await this.loadTranslations('en');
    }
    this.initialzed = true;
  }

  async detectPreferredLanguage() {
    // Get browser language
    const browserLang = navigator.language || navigator.userLanguage;
    const shortLang = browserLang.split('-')[0].toLowerCase();

    // Check if browser language is supported
    if (this.supportedLanguages.has(shortLang)) {
      this.currentLanguage = shortLang;
    } else {
      // Fallback to English
      this.currentLanguage = this.fallbackLanguage;
    }

    // Check storage for previously selected language
    const savedLang = this.storage.getItem('preferred-language');
    if (savedLang && this.supportedLanguages.has(savedLang)) {
      this.currentLanguage = savedLang;
    }
  }

  /**
   * Load translations for a specific language
   */
  async loadTranslations(language) {
    try {
      const response = await fetch(`${this.translationsPath}/${language}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load translations for ${language}`);
      }
      this.translations[language] = await response.json();
      console.log(`${this.#getFlagEmoji(language)} Translations loaded for ${language}`);
    } catch (error) {
      console.error(`Could not load translations for ${language}, falling back to ${this.fallbackLanguage}`, error);
      if (language !== this.fallbackLanguage) {
        this.currentLanguage = this.fallbackLanguage;
        await this.loadTranslations(this.fallbackLanguage);
      }
    }
  }

  /**
   * Get a translated message
   * @param {string} key - Translation key
   * @param {Object} params - Parameters for template interpolation
   * @returns {string} Translated message
   */
  t(key, params = {}, language = this.currentLanguage, showWarning = true) {
    if (!this.initialzed) {
      throw new Error('I18n not initialized');
    }

    const message = this.getNestedTranslation(key, language);

    if (!message) {
      if (showWarning) {
        console.warn(`Translation key not found: ${key}`);
      }
      return key;
    }

    return this.interpolateTemplate(message, params);
  }

  // find what is the key for attributes.params.típus -> type
  lookupKey(prefix, translatedValue, language) {
    const keys = prefix.split('.');
    let value = this.translations[language ?? this.currentLanguage];

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return null;
      }
    }

    // value must be an object
    for (const k of Object.keys(value)) {
      if (value[k] === translatedValue) {
        return k;
      }
    }

    return null;

  }

  /**
   * Get nested translation value
   * @param {string} key - Translation key (e.g., 'menu.file.new')
   * @returns {string} Translation value
   */
  getNestedTranslation(key, language) {
    const keys = key.split('.');
    let value = this.translations[language ?? this.currentLanguage];

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return null;
      }
    }

    return value;
  }

  /**
   * Interpolate template parameters
   * @param {string} template - Template string with {{param}} placeholders
   * @param {Object} params - Parameters object
   * @returns {string} Interpolated string
   */
  interpolateTemplate(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, param) => {
      return params[param] !== undefined ? params[param] : match;
    });
  }

  /**
   * Change the current language
   */
  async changeLanguage(language) {
    if (language === this.currentLanguage) {
      return true;
    }

    await this.loadTranslations(language);
    this.currentLanguage = language;
    console.log(`Language changed to ${language}`);

    this.storage.setItem('preferred-language', language);
    document.dispatchEvent(
      new CustomEvent('languageChanged', {
        detail : { language: language }
      })
    );

    return true;
  }

  /**
   * Get current language
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages() {
    return [...this.supportedLanguages.keys()];
  }

  /**
   * Setup language selector in the UI
   */
  getLanguageSelector() {
    const langSelector = node`<div id="language-selector" class="language-selector">
      <select id="language-select" class="language-select">
        ${this.getSupportedLanguages().map((lang) => {
          return `<option ${lang === this.currentLanguage ? 'selected' : ''} value="${lang}">${this.#getFlagEmoji(lang)} ${this.supportedLanguages.get(lang)}</option>`;
        })}
      </select>
    </div>`;

    langSelector.querySelector('#language-select').addEventListener('change', (e) => {
      this.changeLanguage(e.target.value);
    });
    return langSelector;
  }

  /**
   * Get flag emoji for language code
   */
  #getFlagEmoji(lang) {
    const flagMap = {
      en : '🇺🇸',
      hu : '🇭🇺'
    };
    return flagMap[lang] || '🌐';
  }

  /**
   * Update all translated elements on the page
   */
  updatePageTranslations() {
    // Update elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      const params = this.parseDataParams(element);
      element.textContent = this.t(key, params);
    });

    // Update elements with data-i18n-title attribute
    document.querySelectorAll('[data-i18n-title]').forEach((element) => {
      const key = element.getAttribute('data-i18n-title');
      const params = this.parseDataParams(element);
      element.title = this.t(key, params);
    });

    // Update elements with data-i18n-placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const key = element.getAttribute('data-i18n-placeholder');
      const params = this.parseDataParams(element);
      element.placeholder = this.t(key, params);
    });
  }

  /**
   * Parse data parameters from element attributes
   */
  parseDataParams(element) {
    const params = {};
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-i18n-param-')) {
        const paramName = attr.name.replace('data-i18n-param-', '');
        params[paramName] = attr.value;
      }
    }
    return params;
  }
}

// Create singleton instance
const i18n = new I18nManager();

export { i18n, I18nManager };
