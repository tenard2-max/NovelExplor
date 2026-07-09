/** IndexedDB 저장소 */

const DB_NAME = 'FantasyForeshadowDB';
const DB_VERSION = 2;

const STORES = [
  'projects',
  'stories',
  'episodes',
  'characters',
  'worlds',
  'foreshadows',
  'timeline',
  'files',
  'versions',
  'trash',
  'settings',
];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { keyPath: 'id' });
          if (store === 'episodes') os.createIndex('projectId', 'projectId');
          if (store === 'stories') os.createIndex('projectId', 'projectId');
          if (store === 'characters') os.createIndex('projectId', 'projectId');
          if (store === 'foreshadows') os.createIndex('projectId', 'projectId');
          if (store === 'timeline') os.createIndex('projectId', 'projectId');
          if (store === 'worlds') os.createIndex('projectId', 'projectId');
          if (store === 'files') os.createIndex('projectId', 'projectId');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = fn(store);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function put(storeName, record) {
  return tx(storeName, 'readwrite', (store) => store.put(record));
}

export async function get(storeName, id) {
  return tx(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getAll(storeName) {
  return tx(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getByProject(storeName, projectId) {
  const all = await getAll(storeName);
  return all.filter((r) => r.projectId === projectId);
}

export async function remove(storeName, id) {
  return tx(storeName, 'readwrite', (store) => store.delete(id));
}

export async function clearStore(storeName) {
  return tx(storeName, 'readwrite', (store) => store.clear());
}

export async function bulkPut(storeName, records) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const rec of records) store.put(rec);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
