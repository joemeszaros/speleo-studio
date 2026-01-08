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

import { Vector } from '../model.js';
import { CoordinateSystemType } from '../model/geo.js';

/**
 * Global coordinate normalization system to handle large UTM coordinates
 * and maintain proper positioning between multiple caves. With large UTM
 * coordinates there is coordinate jitter, gap between center lines and
 * floating point precision issues.
 */
export class GlobalCoordinateNormalizer {
  constructor() {
    this.globalOrigin = null;
    this.initialized = false;
  }

  /**
   * Initialize the global origin from the first cave with coordinates
   * @param {Object} coordinate - The first coordinate to establish global origin
   */
  initializeGlobalOrigin(coordinate) {
    if (this.initialized) {
      return;
    }

    if (coordinate) {

      switch (coordinate.type) {
        case CoordinateSystemType.UTM:
          this.globalOrigin = {
            easting   : coordinate.easting,
            northing  : coordinate.northing,
            elevation : coordinate.elevation
          };
          break;
        case CoordinateSystemType.EOV:
          this.globalOrigin = {
            y         : coordinate.y,
            x         : coordinate.x,
            elevation : coordinate.elevation
          };
          break;
        default:
          throw new Error(`Unknown coordinate system type: ${coordinate.type}`);
      }

      this.initialized = true;
    }
  }

  /**
   * Get the normalized vector for a coordinate relative to the global origin
   * @param {Object} coordinate - The coordinate to normalize
   * @returns {Vector} Normalized vector
   */
  getNormalizedVector(coordinate) {
    if (!this.initialized || !this.globalOrigin) {
      // Fallback to original behavior if not initialized
      return coordinate.toVector();
    }

    switch (coordinate.type) {
      case CoordinateSystemType.UTM:
        return new Vector(
          coordinate.easting - this.globalOrigin.easting,
          coordinate.northing - this.globalOrigin.northing,
          coordinate.elevation - this.globalOrigin.elevation
        );
      case CoordinateSystemType.EOV:
        return new Vector(
          coordinate.y - this.globalOrigin.y,
          coordinate.x - this.globalOrigin.x,
          coordinate.elevation - this.globalOrigin.elevation
        );
      default:
        throw new Error(`Unknown coordinate system type: ${coordinate.type}`);
    }
  }

  reset() {
    this.globalOrigin = null;
    this.initialized = false;
  }

  isInitialized() {
    return this.initialized;
  }
}

// Global instance
export const globalNormalizer = new GlobalCoordinateNormalizer();
