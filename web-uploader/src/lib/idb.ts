export interface SharedFileRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  blob?: Blob;
  data?: Blob | ArrayBuffer;
  title?: string;
  text?: string;
  sharedAt: string;
}

const DB_NAME = 'family_share_target_db';
const DB_VERSION = 1;
const STORE_NAME = 'shared_files';

function openSharedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this environment'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve all pending shared files from IndexedDB.
 */
export async function getSharedFiles(): Promise<SharedFileRecord[]> {
  try {
    const db = await openSharedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        db.close();
        resolve(request.result || []);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('[idb] getSharedFiles failed:', err);
    return [];
  }
}

/**
 * Clear all shared files from IndexedDB.
 */
export async function clearSharedFiles(): Promise<void> {
  try {
    const db = await openSharedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn('[idb] clearSharedFiles failed:', err);
  }
}

/**
 * Atomically retrieves and flushes all shared files.
 */
export async function flushSharedFiles(): Promise<File[]> {
  const records = await getSharedFiles();
  if (records.length === 0) return [];

  await clearSharedFiles();

  return records.map((r) => {
    const blobPart = (r.blob || r.data || new Blob([], { type: r.type })) as BlobPart;
    return new File([blobPart], r.name, {
      type: r.type || 'application/octet-stream',
      lastModified: Date.now(),
    });
  });
}
