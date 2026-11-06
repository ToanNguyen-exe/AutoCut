/**
 * IndexedDB storage helper for persisting uploaded video blobs across browser reloads (F5).
 * Works offline, requires zero npm dependencies, and handles Blob / File storage natively.
 */

const DB_NAME = "autocut_storage";
const DB_VERSION = 1;
const STORE_NAME = "video_blobs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB is not supported in this environment"));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

export async function saveVideoBlob(key: string, blob: Blob): Promise<void> {
  if (!key || !blob) return;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      try {
        store.put(blob, key);
        store.put(blob, "__latest_active_video__");
      } catch (err) {
        console.warn("Lưu video vào IndexedDB warning:", err);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn("IndexedDB transaction warning:", tx.error);
        resolve(); // Không làm đứt luồng chính
      };
    });
  } catch (err) {
    console.warn("IndexedDB saveVideoBlob warning:", err);
  }
}

export async function getVideoBlob(key: string): Promise<Blob | null> {
  if (!key) return null;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result as Blob);
        } else {
          // Thử lấy video mới nhất làm fallback
          const latestReq = store.get("__latest_active_video__");
          latestReq.onsuccess = () => resolve((latestReq.result as Blob) || null);
          latestReq.onerror = () => resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("IndexedDB getVideoBlob warning:", err);
    return null;
  }
}

export async function removeVideoBlob(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
