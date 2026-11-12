/**
 * Service Worker: Android TV Family File Library
 * Handles:
 * 1. Web Share Target POST /share-target interception -> IndexedDB persistence -> 303 redirect.
 * 2. App Shell precaching & cache-first/stale-while-revalidate for static assets.
 * 3. Network pass-through for Supabase API and storage requests.
 * 4. Immediate activation via skipWaiting() and clients.claim().
 */

const CACHE_NAME = 'family-files-shell-v1';
const DB_NAME = 'family_share_target_db';
const DB_VERSION = 1;
const STORE_NAME = 'shared_files';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/favicon.ico',
];

// Open IndexedDB connection
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Persist shared files to IndexedDB
async function persistSharedFiles(files, metadata) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const f of files) {
      const record = {
        id: 'shared-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
        name: f.name || 'shared_file',
        type: f.type || 'application/octet-stream',
        size: f.size || 0,
        blob: f,
        data: f, // Compatibility alias
        title: metadata.title || '',
        text: metadata.text || '',
        sharedAt: new Date().toISOString(),
      };
      store.put(record);
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// Share Target fetch handler
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();

    // Defensively check 'file' first (spec), then 'files' (plural)
    let files = formData.getAll('file');
    if (!files || files.length === 0) {
      files = formData.getAll('files');
    }
    if (!files || files.length === 0) {
      files = [];
      for (const [key, value] of formData.entries()) {
        if (value && typeof value === 'object' && value.name) {
          files.push(value);
        }
      }
    }

    const title = formData.get('title') || formData.get('name') || '';
    const text = formData.get('text') || formData.get('description') || '';

    if (files.length > 0) {
      await persistSharedFiles(files, { title, text });
    }

    // Notify any currently active window clients
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({
        type: 'FILES_SHARED',
        count: files.length,
        timestamp: Date.now(),
      });
    }

    // Return HTTP 303 See Other redirect to /?shared=true
    return Response.redirect('/?shared=true', 303);
  } catch (err) {
    console.error('[SW] Share target error:', err);
    return Response.redirect('/?shared_error=true', 303);
  }
}

// Lifecycle: Install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[SW] Precache incomplete, continuing:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Lifecycle: Activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Lifecycle: Fetch
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Intercept POST /share-target
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // 2. Bypass Supabase and API requests (always network)
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/storage/v1')
  ) {
    return;
  }

  // 3. SPA Navigation fallback to /index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 4. Cache-first for static assets
  if (
    event.request.method === 'GET' &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg'))
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
