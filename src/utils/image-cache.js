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
 * Image cache utility using Cache Storage API
 * Stores images persistently in browser cache storage
 */
export class ImageCache {
  constructor() {
    this.cacheName = 'image-cache';
    this.maxCacheSize = 100; // Maximum number of cached images
    this.maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    this.loadingPromises = new Map();
    this.isInitialized = false;
    this.#initialize();

  }

  async #initialize() {
    try {
      // Check if Cache API is supported
      if (!('caches' in window)) {
        console.warn('Cache API not supported, falling back to memory-only cache');
        this.isInitialized = true;
        return;
      }

      this.isInitialized = true;
      console.log('🖼 Image cache initialized successfully');

      // Clean up expired entries
      await this.#cleanupExpiredEntries();

    } catch (error) {
      console.warn('Failed to initialize image cache:', error);
      this.isInitialized = true; // Still work with memory cache
    }
  }

  /**
   * Generate a cache key from URL
   * @param {string} url - The image URL
   * @returns {string} - The cache key
   */
  #generateCacheKey(url) {
    if (!url) return null;

    // Use a simple hash of the URL for the key
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `img_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Check if an image is already cached
   * @param {string} url - The image URL
   * @returns {Promise<boolean>} - True if cached
   */
  async isCached(url) {
    if (!this.isInitialized) return false;

    // Check Cache Storage API
    if ('caches' in window) {
      try {
        const cache = await caches.open(this.cacheName);
        const response = await cache.match(url);
        return response !== undefined;
      } catch (error) {
        console.warn('Error checking cache:', error);
        return false;
      }
    }

    return false;
  }

  /**
   * Get cached image as blob from Cache Storage API
   * @param {string} url - The image URL
   * @returns {Promise<Blob|null>} - The cached image blob or null if not found
   */
  async #getCachedBlob(url) {
    if (!this.isInitialized) return null;

    try {
      if ('caches' in window) {
        const cache = await caches.open(this.cacheName);
        const response = await cache.match(url);

        if (response) {
          return await response.blob();
        }
      }

      return null;
    } catch (error) {
      console.warn('Error getting cached blob:', error);
      return null;
    }
  }

  async loadImage(url) {
    const key = this.#generateCacheKey(url);

    // Return existing loading promise if already loading
    if (this.loadingPromises.has(key)) {
      return this.loadingPromises.get(key);
    }

    // Create new loading promise
    const loadingPromise = this.#loadImageInternal(url);
    this.loadingPromises.set(key, loadingPromise);

    try {
      const result = await loadingPromise;
      this.loadingPromises.delete(key);
      return result;
    } catch (error) {
      this.loadingPromises.delete(key);
      throw error;
    }
  }

  async #getImage(blob) {
    const objectURL = URL.createObjectURL(blob);
    const img = new Image();
    img.src = objectURL;
    return await new Promise((resolve, reject) => {
      img.onerror = reject;
      img.onload = () => {
        URL.revokeObjectURL(objectURL); // Clean up object URL
        resolve(img);
      };
    });
  }

  validateResponse(response, url) {
    if (!response.ok) {
      console.error(`🖼 HTTP error code ${response.status} for ${url}`);
      return false;
    }

    const contentType = response.headers.get('Content-Type');
    if (contentType && !contentType.startsWith('image/')) {
      console.error(`🖼 Content-Type ${contentType} is not an image for ${url}`);
      return false;
    }

    return true;

  }

  async #loadImageInternal(url) {
    if (!this.isInitialized) {
      return undefined;
    }

    try {
      // Check if image is already cached in Cache Storage API
      const cachedBlob = await this.#getCachedBlob(url);

      if (cachedBlob) {
        console.log('🖼 Image file cache hit for', url);
        return this.#getImage(cachedBlob);
      }

      // Image not cached, try to fetch and cache it
      let response;
      try {
        const corsProxyUrl = `https://speleo-studio.hu/cors-proxy.php?url=${url}`;

        response = await fetch(corsProxyUrl, {
          headers : new Headers({
            Accept            : 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'User-Agent'      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X x.y; rv:10.0) Gecko/20100101 Firefox/10.0',
            'Accept-Encoding' : 'gzip'
          })
        });
        if (!this.validateResponse(response, url)) {
          return undefined;
        }

      } catch (fetchError) {
        console.error(`🖼 Fetch error for ${url}`, fetchError);
        return undefined;
      }

      // Clone the response for caching
      const responseClone = response.clone();

      // Add custom timestamp header to track cache time
      const headers = new Headers(responseClone.headers);
      headers.set('X-Cached-At', Date.now().toString());

      // Create a new response with our custom header
      const responseWithTimestamp = new Response(responseClone.body, {
        status     : responseClone.status,
        statusText : responseClone.statusText,
        headers    : headers
      });

      // Cache the response in Cache Storage API
      if ('caches' in window) {
        try {
          const cache = await caches.open(this.cacheName);
          await cache.put(url, responseWithTimestamp);
        } catch (cacheError) {
          console.warn('Failed to cache response:', cacheError);
        }
      }

      const blob = await response.blob();
      return await this.#getImage(blob);
    } catch (error) {
      console.error(`Failed to load image from ${url}:`, error);
      return undefined;
    }
  }

  /**
   * Clean up expired entries from Cache Storage API
   * @private
   */
  async #cleanupExpiredEntries() {
    if (!('caches' in window) || !this.isInitialized) return;

    try {
      const cache = await caches.open(this.cacheName);
      const requests = await cache.keys();

      const now = Date.now();
      const expiredRequests = [];

      for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
          // Try multiple methods to get cache timestamp
          let cacheTime = null;

          // Method 1: Check our custom timestamp header
          const cachedAt = response.headers.get('X-Cached-At');
          if (cachedAt) {
            cacheTime = parseInt(cachedAt, 10);
          }

          if (now - cacheTime > this.maxCacheAge) {
            expiredRequests.push(request);
          }
        }
      }

      // Delete expired entries
      if (expiredRequests.length > 0) {
        console.log(`🗑️ Cleaning up ${expiredRequests.length} expired cache entries`);
        await Promise.all(expiredRequests.map((request) => cache.delete(request)));
      }
    } catch (error) {
      console.warn('Error cleaning up expired entries:', error);
    }
  }

  /**
   * Clear all cached images
   */
  async clearCache() {
    try {
      // Clear Cache Storage API
      if ('caches' in window) {
        const cache = await caches.open(this.cacheName);
        const keys = await cache.keys();
        await Promise.all(keys.map((key) => cache.delete(key)));
      }

      // Clear loading promises
      this.loadingPromises.clear();

      console.log('Cache cleared successfully');
    } catch (error) {
      console.warn('Error clearing cache:', error);
    }
  }

  static isSupported() {
    return 'caches' in window;
  }
}
