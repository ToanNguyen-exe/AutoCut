import { VideoLibraryItem } from "@/types";
import defaultVideos from "@/mock-data/videos_library.json";

const STORAGE_KEY = "autocut_video_library";

export function getLibraryVideos(): VideoLibraryItem[] {
  if (typeof window === "undefined") {
    return defaultVideos as VideoLibraryItem[];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultVideos));
      return defaultVideos as VideoLibraryItem[];
    }
    return JSON.parse(raw) as VideoLibraryItem[];
  } catch {
    return defaultVideos as VideoLibraryItem[];
  }
}

export function saveVideoToLibrary(video: VideoLibraryItem): VideoLibraryItem[] {
  const current = getLibraryVideos();
  const existingIndex = current.findIndex((v) => v.id === video.id || v.name === video.name);

  let updated: VideoLibraryItem[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = { ...updated[existingIndex], ...video, updatedAt: new Date().toLocaleTimeString("vi-VN") };
  } else {
    updated = [video, ...current];
  }

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // storage limit handle
    }
  }

  return updated;
}

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
