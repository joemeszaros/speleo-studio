import * as THREE from 'three';

export const DEFAULT_OPTIONS = {
  scene : {

    zoomStep : 0.1,

    centerLines : {
      segments : {
        show    : true,
        color   : '#ff0000',
        width   : 1.5,
        opacity : 1.0
      },
      spheres : {
        show   : true,
        color  : '#ffff00',
        radius : 0.3
      }
    },
    splays : {
      segments : {
        show  : true,
        color : '#00ffff',
        width : 1.5
      },
      spheres : {
        show   : true,
        color  : '#0000ff',
        radius : 0.3
      }
    },
    auxiliaries : {
      segments : {
        show  : true,
        color : '#f0abff',
        width : 1.5
      },
      spheres : {
        show   : true,
        color  : '#f0abff',
        radius : 0.3
      }
    },
    boundingBox : {
      show : false
    },
    grid : {
      mode : {
        value   : 'top',
        choices : ['top', 'bottom', 'hidden']
      }
    },
    surface : {
      color : {
        start : '#39b14d',
        end   : '#9f2d2d',
        mode  : {
          value   : 'gradientByZ',
          choices : ['gradientByZ', 'hidden']
        }

      }
    },
    caveLines : {
      color : {
        start : '#00ff2a',
        end   : '#0000ff',
        mode  : 'gradientByZ'
      }
    },
    sectionAttributes : {
      color : '#00ff2a'
    },
    labels : {
      color : '#ffffff',
      size  : 3
    },
    background : {
      color : '#000000'
    },
    startPoint : {
      show   : true,
      color  : '#ffff00',
      radius : 0.3
    }
  },

  tabulator : {
    paginationSize : 7
  },

  screen : {
    DPI : 96
  },
  ui : {
    editor : {
      survey : {
        height  : 300,
        width   : 700,
        columns : ['type', 'from', 'to', 'length', 'azimuth', 'clino', 'x', 'y', 'z', 'attributes', 'comment']
      }
    }
  },
  import : {
    cavesMaxDistance : 2000
  }
};

export class Options {

  static rotateOptionChoice(config) {
    const index = config.choices.indexOf(config.value);

    if (index >= 0 && index < config.choices.length - 1) {
      config.value = config.choices[index + 1];
    } else {
      config.value = config.choices[0];
    }

  }
}

/**
 * Watching changes of nested objects
 */
export class ObjectObserver {

  constructor() {
    this.watchedObjects = new WeakMap();
  }

  /**
   * Create a deeply watched version of an object
   * @param {Object} obj - Object to watch
   * @param {string} path - Current path in the object tree
   * @returns {Proxy} - Watched object
   */
  watchObject(obj, path = '') {
    // Return if already watched or not an object
    if (this.watchedObjects.has(obj) || typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return obj;
    }

    const watched = new Proxy(obj, {
      set : (target, property, value) => {
        const oldValue = target[property];
        const currentPath = path ? `${path}.${property}` : property;

        // Handle nested objects
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Watch the new nested object
          const watchedValue = this.watchObject(value, currentPath);
          target[property] = watchedValue;
        } else {
          // Set primitive value
          target[property] = value;
        }

        // Trigger change callback
        if (oldValue !== value) {
          this.onChange(currentPath, oldValue, value, target);
        }

        return true;
      }

    });

    // Mark as watched
    this.watchedObjects.set(obj, watched);

    // Watch existing nested objects
    for (const key in obj) {
      if (
        Object.prototype.hasOwnProperty.call(obj, key) &&
        typeof obj[key] === 'object' &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        const currentPath = path ? `${path}.${key}` : key;
        obj[key] = this.watchObject(obj[key], currentPath);
      }
    }

    return watched;
  }

  watchChanges(onChange) {
    this.onChange = onChange;
  }

}

/**
 * ConfigManager handles persistence of user configurations using localStorage
 */
export class ConfigManager {
  static STORAGE_KEY = 'speleo-studio-config';
  static VERSION = '1.0';

  /**
   * Serialize a configuration object for storage
   * @param {Object} config - The configuration object to serialize
   * @param {number} revision - Optional revision number (auto-incremented if not provided)
   * @returns {Object} - Serialized configuration
   */
  static serialize(config, revision = null) {
    // Get the current revision from storage if not provided
    if (revision === null) {
      revision = this.getCurrentRevision() + 1;
    }

    const serialized = {
      version   : this.VERSION,
      timestamp : Date.now(),
      revision  : revision,
      data      : this.#serializeObject(config)
    };
    return serialized;
  }

  /**
   * Get the current revision number from storage
   * @returns {number} - Current revision number (0 if no config exists)
   */
  static getCurrentRevision() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        return 0;
      }

      const serialized = JSON.parse(stored);
      return serialized.revision || 0;
    } catch (error) {
      console.warn('Failed to get current revision:', error);
      return 0;
    }
  }

  /**
   * Deserialize a configuration object from storage
   * @param {Object} serialized - The serialized configuration
   * @returns {Object} - Deserialized configuration
   */
  static deserialize(serialized) {
    if (!serialized || !serialized.data) {
      return null;
    }
    return this.#deserializeObject(serialized.data);
  }

  /**
   * Save configuration to localStorage
   * @param {Object} config - The configuration object to save
   */
  static save(config) {
    try {
      if (!config) {
        console.warn('Attempted to save null or undefined configuration');
        return;
      }

      const serialized = this.serialize(config);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(serialized));
      console.log(`💾 Configuration saved successfully (revision ${serialized.revision})`);

      // Show what changed if this is not the first save
      if (serialized.revision > 1) {
        console.log(`📈 Configuration updated from revision ${serialized.revision - 1} to ${serialized.revision}`);
      }
    } catch (error) {
      console.warn('Failed to save configuration to localStorage:', error);
    }
  }

  /**
   * Load configuration from localStorage
   * @returns {Object|null} - The loaded configuration or null if not found/invalid
   */
  static load() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        console.log('No saved configuration found');
        return null;
      }

      const serialized = JSON.parse(stored);
      const config = this.deserialize(serialized);
      console.log(
        `Configuration loaded successfully (revision ${serialized.revision || 0}) - ${new Date(serialized.timestamp)})`
      );
      return config;
    } catch (error) {
      console.warn('Failed to load configuration from localStorage:', error);
      return null;
    }
  }

  /**
   * Merge saved configuration with default configuration
   * @param {Object} defaultConfig - The default configuration
   * @returns {Object} - Merged configuration
   */
  static loadOrDefaults(defaultConfig = DEFAULT_OPTIONS) {
    const savedConfig = this.load();
    if (!savedConfig) {
      console.log('No saved configuration found, using defaults');
      return defaultConfig;
    }

    return savedConfig;
  }

  /**
   * Clear saved configuration
   */
  static clear() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('Configuration cleared successfully');
    } catch (error) {
      console.warn('Failed to clear configuration from localStorage:', error);
    }
  }

  /**
   * Export configuration as a JSON string for backup/sharing
   * @param {Object} config - Configuration to export
   * @returns {string} - JSON string representation
   */
  static getJsonString(config) {
    try {
      const serialized = this.serialize(config);
      return JSON.stringify(serialized, null, 2);
    } catch (error) {
      console.error('Failed to export configuration:', error);
      throw error;
    }
  }

  /**
   * Import configuration from a JSON string
   * @param {string} jsonString - JSON string representation of configuration
   * @returns {Object|null} - Imported configuration or null if failed
   */
  static getConfigObject(jsonString) {
    try {
      const serialized = JSON.parse(jsonString);
      return this.deserialize(serialized);
    } catch (error) {
      console.error('Failed to import configuration:', error);
      return null;
    }
  }

  /**
   * Download configuration as a file
   * @param {Object} config - Configuration to download
   * @param {string} filename - Optional filename (default: speleo-studio-config.json)
   */
  static downloadConfig(config, filename = 'speleo-studio-config.json') {
    try {
      const jsonString = this.getJsonString(config);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download configuration:', error);
      throw error;
    }
  }
  /**
   * Recursively serialize an object, handling Color instances
   * @param {*} obj - Object to serialize
   * @returns {*} - Serialized object
   */
  static #serializeObject(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.#serializeObject(item));
    }

    if (typeof obj === 'object') {
      const serialized = {};
      for (const [key, value] of Object.entries(obj)) {
        serialized[key] = this.#serializeObject(value);
      }
      return serialized;
    }

    return obj;
  }

  /**
   * Recursively deserialize an object, handling Color instances
   * @param {*} obj - Object to deserialize
   * @returns {*} - Deserialized object
   */
  static #deserializeObject(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.#deserializeObject(item));
    }

    if (typeof obj === 'object') {
      const deserialized = {};
      for (const [key, value] of Object.entries(obj)) {
        deserialized[key] = this.#deserializeObject(value);
      }
      return deserialized;
    }

    return obj;
  }

  /**
   * Deep merge two objects, preserving structure
   * @param {Object} target - Target object
   * @param {Object} source - Source object
   * @returns {Object} - Merged object
   */
  static deepMerge(source, target) {

    for (const [key, value] of Object.entries(target)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          this.deepMerge(source[key], value);
        } else {
          source[key] = value;
        }
      } else {
        source[key] = value;
      }
    }

  }
}

/**
 * ConfigChanges class handles all configuration change actions
 * Centralizes all the onChange logic from GUI controls
 */
export class ConfigChanges {
  constructor(watchedConfig, scene, materials, options) {
    this.watchedConfig = watchedConfig;
    this.scene = scene;
    this.materials = materials;
    this.options = options;
  }

  /**
   * Handle center line configuration changes
   */
  handleCenterLineChanges(path, oldValue, newValue) {
    switch (path) {
      case 'scene.centerLines.segments.show':
        this.scene.setObjectsVisibility('centerLines', newValue);
        break;

      case 'scene.centerLines.segments.color':
        this.materials.segments.centerLine.color = new THREE.Color(newValue);
        this.scene.view.renderView();
        break;

      case 'scene.centerLines.segments.width':
        this.materials.segments.centerLine.linewidth = newValue;
        this.materials.whiteLine.linewidth = newValue;
        this.scene.updateSegmentsWidth(newValue);
        this.scene.view.renderView();
        break;

      case 'scene.centerLines.segments.opacity':
        this.materials.segments.centerLine.opacity = newValue;
        this.materials.whiteLine.opacity = newValue;
        this.scene.setObjectsOpacity('centerLines', newValue);
        this.scene.view.renderView();
        break;

      case 'scene.centerLines.spheres.show':
        this.scene.setObjectsVisibility('centerLinesSpheres', newValue);
        break;

      case 'scene.centerLines.spheres.color':
        this.scene.view.renderView();
        break;

      case 'scene.centerLines.spheres.radius':
        this.scene.changeStationSpheresRadius('centerLine');
        break;
    }
  }

  /**
   * Handle splay configuration changes
   */
  handleSplayChanges(path, oldValue, newValue) {
    switch (path) {
      case 'scene.splays.segments.show':
        this.scene.setObjectsVisibility('splays', newValue);
        break;

      case 'scene.splays.segments.color':
        this.materials.segments.splay.color = new THREE.Color(newValue);
        this.scene.view.renderView();
        break;

      case 'scene.splays.segments.width':
        this.materials.segments.splay.linewidth = newValue;
        this.materials.whiteLine.linewidth = newValue;
        this.scene.view.renderView();
        break;

      case 'scene.splays.spheres.show':
        this.scene.setObjectsVisibility('splaysSpheres', newValue);
        break;

      case 'scene.splays.spheres.color':
        this.scene.view.renderView();
        break;

      case 'scene.splays.spheres.radius':
        this.scene.changeStationSpheresRadius('SPLAY');
        break;
    }
  }

  /**
   * Handle auxiliary configuration changes
   */
  handleAuxiliaryChanges(path, oldValue, newValue) {
    switch (path) {
      case 'scene.auxiliaries.segments.show':
        this.scene.setObjectsVisibility('auxiliary', newValue);
        break;

      case 'scene.auxiliaries.segments.color':
        this.materials.segments.auxiliary.color = new THREE.Color(newValue);
        this.scene.view.renderView();
        break;

      case 'scene.auxiliaries.segments.width':
        this.materials.segments.auxiliary.linewidth = newValue;
        this.materials.whiteLine.linewidth = newValue;
        this.scene.view.renderView();
        break;

      case 'scene.auxiliaries.spheres.show':
        this.scene.setObjectsVisibility('auxiliarySpheres', newValue);
        break;

      case 'scene.auxiliaries.spheres.color':
        this.scene.view.renderView();
        break;

      case 'scene.auxiliaries.spheres.radius':
        this.scene.changeStationSpheresRadius('AUXILIARY');
        break;
    }
  }

  /**
   * Handle label configuration changes
   */
  handleLabelChanges(path, oldValue, newValue) {
    switch (path) {
      case 'scene.labels.color':
        this.materials.text.color = new THREE.Color(newValue);
        this.scene.view.renderView();
        break;

      case 'scene.labels.size':
        this.scene.updateLabelSize(newValue);
        this.scene.view.renderView();
        break;
    }
  }

  /**
   * Handle scene configuration changes
   */
  handleSceneChanges(path, oldValue, newValue) {
    switch (path) {
      case 'scene.background.color':
        this.scene.setBackground(newValue);
        break;

      case 'scene.sectionAttributes.color':
        // Section attributes color changed - no immediate visual update needed
        break;
    }
  }

  /**
   * Handle screen configuration changes
   */
  handleScreenChanges(path, oldValue, newValue) {
    switch (path) {
      case 'screen.DPI':
        this.scene.views.spatial.onDPIChange(newValue);
        this.scene.views.plan.onDPIChange(newValue);
        this.scene.views.profile.onDPIChange(newValue);
        this.scene.view.renderView();
        break;
    }
  }

  handleCaveLineColorChanges(path, oldValue, newValue) {
    switch (path) {
      case 'scene.caveLines.color.mode':
        this.scene.changeCenterLineColorMode(newValue);
        break;
    }
  }

  /**
   * Main onChange handler that routes to specific handlers
   */
  onChange(path, oldValue, newValue) {
    console.log(`🔧 Config change: ${path} = ${newValue} (${oldValue})`);

    // Route to appropriate handler based on path
    if (path.startsWith('scene.centerLines')) {
      this.handleCenterLineChanges(path, oldValue, newValue);
    } else if (path.startsWith('scene.splays')) {
      this.handleSplayChanges(path, oldValue, newValue);
    } else if (path.startsWith('scene.auxiliaries')) {
      this.handleAuxiliaryChanges(path, oldValue, newValue);
    } else if (path.startsWith('scene.caveLines.color')) {
      this.handleCaveLineColorChanges(path, oldValue, newValue);
    } else if (path.startsWith('scene.labels')) {
      this.handleLabelChanges(path, oldValue, newValue);
    } else if (path.startsWith('scene.background') || path.startsWith('scene.sectionAttributes')) {
      this.handleSceneChanges(path, oldValue, newValue);
    } else if (path.startsWith('screen.')) {
      this.handleScreenChanges(path, oldValue, newValue);
    } else if (path.startsWith('ui.editor.survey.')) {
      // do nothing, no action on survey editor changes
    } else {
      console.log(`⚠️ No handler for path: ${path}`);
    }

    ConfigManager.save(this.watchedConfig);
  }

  /**
   * Get the onChange handler bound to this instance
   */
  getOnChangeHandler() {
    return this.onChange.bind(this);
  }
}
