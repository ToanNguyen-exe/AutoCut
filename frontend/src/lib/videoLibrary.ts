import { VideoLibraryItem } from "@/types";
import defaultVideos from "@/mock-data/videos_library.json";

const STORAGE_KEY = "autocut_video_library";

/**
 * Đảm bảo đường dẫn video luôn hợp lệ, ưu tiên video nội bộ có sẵn trong public/videos
 * hoặc qua Next.js stream API để người dùng có thể xem và nghe mượt mà không lỗi CORS.
 */
export function resolvePlayableVideoUrl(url: string | undefined, name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("bai08") || n.includes("ep_kieu") || n.includes("ytsave")) {
    return "/videos/Bai08_Ep_kieu_du_lieu.mp4";
  }
  if (n.includes("bai07") || n.includes("bien")) {
    return "/videos/Bai07_Bien_va_hang.mp4";
  }
  if (n.includes("bai09") || n.includes("chuoi")) {
    return "/videos/Bai09_Chuoi_ky_tu.mp4";
  }
  if (url && !url.startsWith("blob:") && !url.includes("commondatastorage.googleapis.com")) {
    return url;
  }
  return `/api/stream?file=${encodeURIComponent(name)}`;
}

/**
 * Lấy danh sách video trong thư viện:
 * - Ưu tiên đọc từ localStorage để giữ lại toàn bộ video người dùng đã thêm/upload sau khi F5.
 * - Tự động hợp nhất với danh sách mặc định để luôn có sẵn các bài học chuẩn.
 */
export function getLibraryVideos(): VideoLibraryItem[] {
  const sanitize = (list: VideoLibraryItem[]): VideoLibraryItem[] =>
    list.map((v) => ({
      ...v,
      url: resolvePlayableVideoUrl(v.url, v.name),
    }));

  if (typeof window === "undefined") {
    return sanitize(defaultVideos as VideoLibraryItem[]);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const init = sanitize(defaultVideos as VideoLibraryItem[]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(init));
      return init;
    }
    const parsed = JSON.parse(raw) as VideoLibraryItem[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Hợp nhất các video mặc định nếu chưa có trong localStorage (đảm bảo không bị thiếu Bài 08, 07, 09 hay R2)
      const existingIds = new Set(parsed.map((v) => v.id || v.name));
      let hasNewDefaults = false;
      const merged = [...parsed];

      for (const def of defaultVideos as VideoLibraryItem[]) {
        if (!existingIds.has(def.id) && !existingIds.has(def.name)) {
          merged.push(def);
          existingIds.add(def.id);
          hasNewDefaults = true;
        }
      }

      const cleanList = sanitize(merged);
      if (hasNewDefaults || cleanList.some((v, i) => v.url !== merged[i]?.url)) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanList));
        } catch {
          // ignore storage limit
        }
      }

      return cleanList;
    }
    const fallbackList = sanitize(defaultVideos as VideoLibraryItem[]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fallbackList));
    return fallbackList;
  } catch {
    return sanitize(defaultVideos as VideoLibraryItem[]);
  }
}

/**
 * Lưu hoặc cập nhật một video vào thư viện (được lưu vĩnh viễn vào localStorage, F5 không bị mất)
 */
export function saveVideoToLibrary(video: VideoLibraryItem): VideoLibraryItem[] {
  const current = getLibraryVideos();
  const existingIndex = current.findIndex(
    (v) => (v.id && v.id === video.id) || (v.name && v.name === video.name)
  );

  let updated: VideoLibraryItem[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = {
      ...updated[existingIndex],
      ...video,
      updatedAt: new Date().toLocaleTimeString("vi-VN"),
    };
  } else {
    // Đưa video mới lên đầu danh sách thư viện
    updated = [
      {
        ...video,
        updatedAt: new Date().toLocaleTimeString("vi-VN"),
      },
      ...current,
    ];
  }

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("Không thể lưu video vào localStorage:", e);
    }
  }

  return updated;
}

/**
 * Cập nhật danh sách phân đoạn của một video trong thư viện
 */
export function updateVideoSegmentsInLibrary(
  videoName: string,
  segments: VideoLibraryItem["segments"]
): void {
  const current = getLibraryVideos();
  const target = current.find((v) => v.name === videoName);
  if (target) {
    target.segments = segments;
    target.segmentsCount = segments.length;
    target.status = "edited";
    target.statusLabel = "Đã chỉnh sửa";
    target.updatedAt = new Date().toLocaleTimeString("vi-VN");
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Xóa một video khỏi thư viện
 */
export function removeVideoFromLibrary(videoId: string): VideoLibraryItem[] {
  const current = getLibraryVideos();
  const updated = current.filter((v) => v.id !== videoId && v.name !== videoId);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  }
  return updated;
}
