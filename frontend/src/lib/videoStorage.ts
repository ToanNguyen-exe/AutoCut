/**
 * IndexedDB storage helper for persisting uploaded video blobs across browser reloads (F5).
 * Works offline, requires zero npm dependencies, and handles Blob / File storage natively.
 */

const DB_NAME = "autocut_storage";
const DB_VERSION = 2;
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

export function normalizeStorageKey(str: string): string {
  return (str || "")
    .toLowerCase()
    .trim()
    .replace(/\.[^/.]+$/, "")
    .replace(/[\s_\(\)\-\.]+/g, "");
}

/**
 * Lưu video Blob vào IndexedDB dưới nhiều khóa alias (tên đầy đủ, tên stem, normalized)
 * để đảm bảo mỗi video được lưu trữ độc lập tuyệt đối.
 */
export async function saveVideoBlob(key: string, blob: Blob): Promise<void> {
  if (!key || !blob) return;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      try {
        const rawKey = key.trim();
        const stemKey = rawKey.replace(/\.[^/.]+$/, "");
        const normKey = normalizeStorageKey(rawKey);

        store.put(blob, rawKey);
        if (stemKey && stemKey !== rawKey) {
          store.put(blob, stemKey);
        }
        if (normKey) {
          store.put(blob, `norm_${normKey}`);
        }
      } catch (err) {
        console.warn("Lưu video vào IndexedDB warning:", err);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn("IndexedDB transaction warning:", tx.error);
        resolve();
      };
    });
  } catch (err) {
    console.warn("IndexedDB saveVideoBlob warning:", err);
  }
}

/**
 * Lấy video Blob chính xác theo key.
 * TUYỆT ĐỐI KHÔNG fallback sang video khác (tránh trường hợp Download 1, 2, 3 bị gán nhầm thành Download 4).
 */
export async function getVideoBlob(key: string): Promise<Blob | null> {
  if (!key) return null;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);

      const rawKey = key.trim();
      const stemKey = rawKey.replace(/\.[^/.]+$/, "");
      const mp4Key = rawKey.endsWith(".mp4") ? rawKey : `${rawKey}.mp4`;
      const normKey = `norm_${normalizeStorageKey(rawKey)}`;

      // 1. Thử khóa chính xác
      const req1 = store.get(rawKey);
      req1.onsuccess = () => {
        if (req1.result) {
          resolve(req1.result as Blob);
          return;
        }

        // 2. Thử khóa stem (không đuôi mở rộng)
        const req2 = store.get(stemKey);
        req2.onsuccess = () => {
          if (req2.result) {
            resolve(req2.result as Blob);
            return;
          }

          // 3. Thử khóa có đuôi .mp4
          const req3 = store.get(mp4Key);
          req3.onsuccess = () => {
            if (req3.result) {
              resolve(req3.result as Blob);
              return;
            }

            // 4. Thử khóa normalized
            const req4 = store.get(normKey);
            req4.onsuccess = () => {
              if (req4.result) {
                resolve(req4.result as Blob);
                return;
              }

              // 5. Quét danh sách khóa để tìm video có stem khớp chính xác
              const targetStem = normalizeStorageKey(rawKey);
              if (!targetStem) {
                resolve(null);
                return;
              }

              const allKeysReq = store.getAllKeys();
              allKeysReq.onsuccess = () => {
                const keys = (allKeysReq.result || []) as string[];
                const matchedKey = keys.find(
                  (k) => !k.startsWith("__") && normalizeStorageKey(k) === targetStem
                );

                if (matchedKey) {
                  const matchReq = store.get(matchedKey);
                  matchReq.onsuccess = () => resolve((matchReq.result as Blob) || null);
                  matchReq.onerror = () => resolve(null);
                } else {
                  // KHÔNG TÌM THẤY: Trả về null để gọi luồng stream từ server hoặc link gốc.
                  // Tuyệt đối không trả về video khác!
                  resolve(null);
                }
              };
              allKeysReq.onerror = () => resolve(null);
            };
            req4.onerror = () => resolve(null);
          };
          req3.onerror = () => resolve(null);
        };
        req2.onerror = () => resolve(null);
      };
      req1.onerror = () => resolve(null);
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
      const rawKey = key.trim();
      const stemKey = rawKey.replace(/\.[^/.]+$/, "");
      const normKey = `norm_${normalizeStorageKey(rawKey)}`;
      store.delete(rawKey);
      store.delete(stemKey);
      store.delete(normKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
