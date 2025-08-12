/**
 * Home-built Internationalization (i18n) System
 * Supports multiple languages, template interpolation, and automatic language detection
 */

import { node } from '../utils/utils.js';

class I18nManager {

  constructor() {
    this.fallbackLanguage = 'en';
    this.translations = {};
    this.supportedLanguages = new Map([
      ['en', 'English'],
      ['hu', 'Magyar']
    ]);
  }

  async init() {
    await this.detectPreferredLanguage();
    await this.loadTranslations(this.currentLanguage);
    // Dispatch event that i18n is ready
    document.dispatchEvent(new CustomEvent('i18nReady'));
    this.initialzed = true;
    console.log('I18n initialized');
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

    // Check localStorage for previously selected language
    const savedLang = localStorage.getItem('preferred-language');
    if (savedLang && this.supportedLanguages.has(savedLang)) {
      this.currentLanguage = savedLang;
    }
  }

  /**
   * Load translations for a specific language
   */
  async loadTranslations(language) {
    try {
      const response = await fetch(`./src/i18n/translations/${language}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load translations for ${language}`);
      }
      this.translations[language] = await response.json();
      console.log(`${this.#getFlagEmoji(language)} Translations loaded for ${language}`);
    } catch {
      console.warn(`Could not load translations for ${language}, falling back to ${this.fallbackLanguage}`);
      if (language !== this.fallbackLanguage) {
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
  t(key, params = {}) {
    if (!this.initialzed) {
      throw new Error('I18n not initialized');
    }

    const message = this.getNestedTranslation(key);

    if (!message) {
      console.warn(`Translation key not found: ${key}`);
      return key;
    }

    return this.interpolateTemplate(message, params);
  }

  /**
   * Get nested translation value
   * @param {string} key - Translation key (e.g., 'menu.file.new')
   * @returns {string} Translation value
   */
  getNestedTranslation(key) {
    const keys = key.split('.');
    let value = this.translations[this.currentLanguage];

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
    return template.replace(/\{\{(\w+)\}\}/g, (match, param) => {
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
    localStorage.setItem('preferred-language', language);

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
