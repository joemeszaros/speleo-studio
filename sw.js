// Copyright 2024 Joe Meszaros
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/*
 * Speleo Studio service worker — makes the app load and run offline.
 *
 * Strategy:
 *   - install : precache the generated asset list (precache-manifest.js).
 *   - fetch   : cache-first for same-origin GETs, with a runtime cache that
 *               picks up anything not precached (e.g. the on-demand CJK font,
 *               or assets requested via an absolute path). Cross-origin
 *               requests (Google Drive, NOAA, the CORS proxy, …) are left to
 *               the network and simply fail when offline — by design.
 *   - navigate: fall back to the cached app shell (index.html) so reloads and
 *               deep links work offline.
 */

importScripts('./precache-manifest.js');

const { version, urls: PRECACHE_URLS } = self.__PRECACHE_MANIFEST;
const CACHE_NAME = `speleo-studio-${version}`;
const APP_SHELL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Resilient precache: a single missing/failed asset must not abort the
      // whole install, otherwise the app would never gain offline support.
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          await cache.put(url, response);
        })
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        console.warn(`[sw] ${failed.length} asset(s) failed to precache:`, failed.map((f) => String(f.reason)));
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('speleo-studio-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isCacheableResponse(response) {
  // Only cache complete, same-origin (basic) 200 responses. Skipping opaque
  // and 206 (range) responses avoids poisoning the cache with partial bodies.
  return response && response.status === 200 && response.type === 'basic';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin → network only

  // Navigations (page loads, reloads, deep links): serve the cached shell when
  // the network is unavailable so the single-page app always boots.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(APP_SHELL)) || (await cache.match('./')) || Response.error();
        }
      })()
    );
    return;
  }

  // Everything else: cache-first, then network (and populate the cache so
  // non-precached same-origin assets become available offline after first use).
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (isCacheableResponse(response)) cache.put(request, response.clone());
        return response;
      } catch (err) {
        // Last resort: maybe it matches with search params ignored already
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        throw err;
      }
    })()
  );
});
