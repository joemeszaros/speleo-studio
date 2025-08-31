/**
 * Declination cache system that integrates with the existing DatabaseManager
 * Caches NOAA declination values by coordinate and date to avoid repeated API calls
 */
export class DeclinationCache {

  constructor(databaseManager) {
    this.storeName = 'declinationCache';
    this.dbManager = databaseManager;
  }

  /**
   * Generate a cache key for the given parameters
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {Date} date - Date
   * @returns {string} Cache key
   */
  generateKey(lat, lon, date) {
    // Round coordinates to 2 decimal places (~1km precision) to group nearby locations
    // This provides better cache efficiency while maintaining reasonable accuracy
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLon = Math.round(lon * 100) / 100;

    // Use year and month for date to group by month (declination changes slowly)
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    return `${roundedLat},${roundedLon},${year}-${month}`;
  }

  /**
   * Get declination value from cache
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {Date} date - Date
   * @returns {Promise<number|null>} Cached declination value or null if not found
   */
  async get(lat, lon, date) {
    const key = this.generateKey(lat, lon, date);

    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).get(key);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`Declination cache hit for ${key}: ${result.declination}`);
          resolve(result.declination);
        } else {
          console.log(`Declination cache miss for ${key}`);
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('Error reading from declination cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Store declination value in cache
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {Date} date - Date
   * @param {number} declination - Declination value
   * @returns {Promise<void>}
   */
  async set(lat, lon, date, declination) {
    const key = this.generateKey(lat, lon, date);
    const cacheEntry = {
      key         : key,
      lat         : lat,
      lon         : lon,
      date        : date.toISOString(),
      declination : declination,
      cachedAt    : new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadWriteStore(this.storeName).put(cacheEntry);

      request.onsuccess = () => {
        console.log(`Declination cached for ${key}: ${declination}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Error writing to declination cache:', request.error);
        reject(request.error);
      };
    });
  }

}
