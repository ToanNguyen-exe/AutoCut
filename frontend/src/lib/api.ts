import type { SegmentsData, Segment, TranscriptData } from "@/types";
import { API_BASE, apiFetch, requestAuthTicket } from "./http.ts";

export { API_BASE };

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  source: "api" | "fallback";
  status?: number;
}

// Dữ liệu fallback nếu backend chưa khởi động
export const FALLBACK_SEGMENTS: SegmentsData = {
  video: "Bai05_VongLap.mp4",
  lesson: "Bai05_VongLap",
  mode: "demo",
  reviewed: false,
  segments: [
    {
      id: "seg01",
      section_no: 1,
      section: "Lý thuyết",
      topic_no: 1,
      topic: "Vòng lặp for",
      slug: "for",
      start_id: "S0001",
      end_id: "S0040",
      start: 0.0,
      end: 350.2,
      parts: [
        {
          part: 1,
          start: 0.0,
          end: 350.2,
          file: "01_LyThuyet/01_for.mp4",
        },
      ],
    },
    {
      id: "seg02",
      section_no: 1,
      section: "Lý thuyết",
      topic_no: 2,
      topic: "Vòng lặp while",
      slug: "while",
      start_id: "S0041",
      end_id: "S0095",
      start: 350.2,
      end: 710.0,
      parts: [
        {
          part: 1,
          start: 350.2,
          end: 710.0,
          file: "01_LyThuyet/02_while.mp4",
        },
      ],
    },
    {
      id: "seg03",
      section_no: 1,
      section: "Lý thuyết",
      topic_no: 3,
      topic: "Vòng lặp do...while",
      slug: "do-while",
      start_id: "S0096",
      end_id: "S0210",
      start: 710.0,
      end: 1450.5,
      parts: [
        {
          part: 1,
          start: 710.0,
          end: 1080.0,
          file: "01_LyThuyet/03_do-while_Phan1.mp4",
        },
        {
          part: 2,
          start: 1080.0,
          end: 1450.5,
          file: "01_LyThuyet/03_do-while_Phan2.mp4",
        },
      ],
    },
    {
      id: "seg04",
      section_no: 2,
      section: "Thực hành ví dụ",
      topic_no: 1,
      topic: "Tính tổng 1 đến N",
      slug: "tinh-tong-1-den-n",
      start_id: "S0211",
      end_id: "S0280",
      start: 1450.5,
      end: 1820.0,
      parts: [
        {
          part: 1,
          start: 1450.5,
          end: 1820.0,
          file: "02_ThucHanhViDu/01_tinh-tong-1-den-n.mp4",
        },
      ],
    },
  ],
};

/**
 * Lấy dữ liệu segments mẫu từ Backend Spring Boot (GET /api/video/mock-segments)
 */
export async function fetchMockSegments(): Promise<ApiResponse<SegmentsData>> {
  try {
    const res = await apiFetch(`${API_BASE}/mock-segments`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    const data: SegmentsData = await res.json();
    return { data, source: "api" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không kết nối được Backend";
    return { data: FALLBACK_SEGMENTS, error: message, source: "fallback" };
  }
}

/**
 * Lấy transcript mẫu từ Backend (GET /api/video/mock-transcript)
 */
export async function fetchMockTranscript(): Promise<ApiResponse<TranscriptData>> {
  try {
    const res = await apiFetch(`${API_BASE}/mock-transcript`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    const data: TranscriptData = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Lỗi nạp transcript",
      source: "fallback",
    };
  }
}

export interface CacheResponse {
  cached: boolean;
  transcript?: TranscriptData;
}

/**
 * Kiểm tra trạng thái cache cho mã băm video (GET /api/video/cache/{hash} - P04)
 */
export async function checkCache(hash: string): Promise<ApiResponse<CacheResponse>> {
  try {
    const res = await apiFetch(`${API_BASE}/cache/${encodeURIComponent(hash)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    const data: CacheResponse = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      data: { cached: false },
      error: err instanceof Error ? err.message : "Lỗi kiểm tra cache",
      source: "fallback",
    };
  }
}

/**
 * Lấy cấu hình runtime từ config.yaml của Backend (GET /api/video/config)
 */
export async function fetchConfig(): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    const res = await apiFetch(`${API_BASE}/config`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    const data: Record<string, unknown> = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Backend chưa chạy",
      source: "fallback",
    };
  }
}

export interface RenderedClipItem {
  file: string;
  sizeBytes: number;
  executionMs: number;
  path: string;
}

export interface RenderResponse {
  success: boolean;
  status?: string;
  message: string;
  savedPlan?: string;
  totalRendered?: number;
  renderedFiles?: RenderedClipItem[];
  outputDirectory?: string;
  lesson?: string;
  engine?: string;
}

export function normalizeClipPath(filePath: string, lesson?: string): string {
  if (!filePath) return "";
  // Chuẩn hóa đường dẫn: đổi tất cả \ thành /
  let clean = filePath.replace(/\\/g, "/");

  // Nếu là đường dẫn tuyệt đối chứa output/, chỉ lấy phần sau output/
  const outputIdx = clean.toLowerCase().indexOf("/output/");
  if (outputIdx !== -1) {
    clean = clean.substring(outputIdx + "/output/".length);
  } else if (clean.toLowerCase().startsWith("output/")) {
    clean = clean.substring("output/".length);
  } else if (lesson && !clean.includes("/") && !clean.startsWith(lesson)) {
    // Nếu chỉ có tên file đơn thuần (e.g. 01_intro.mp4), ghép thêm lesson
    clean = `${lesson}/${clean}`;
  }

  return clean;
}

/**
 * Lấy URL tải về 1 clip MP4 cụ thể từ Backend
 */
export function getDownloadClipUrl(filePath: string, lesson?: string, ticket?: string): string {
  const clean = normalizeClipPath(filePath, lesson);
  if (!clean) return "";
  const ticketParam = ticket ? `&ticket=${encodeURIComponent(ticket)}` : "";
  return `${API_BASE}/download-clip?path=${encodeURIComponent(clean)}${ticketParam}`;
}

/**
 * Lấy URL tải về toàn bộ các clip đã cắt dưới dạng file nén ZIP
 */
export function getDownloadZipUrl(lesson: string, user?: string, ticket?: string): string {
  const cleanLesson = (lesson || "clips").trim();
  const userParam = user ? `&user=${encodeURIComponent(user)}` : "";
  const ticketParam = ticket ? `&ticket=${encodeURIComponent(ticket)}` : "";
  return `${API_BASE}/download-zip?lesson=${encodeURIComponent(cleanLesson)}${userParam}${ticketParam}`;
}

export function buildVideoSegmentsUrl(videoId: number | string): string {
  return `${API_BASE}/${videoId}/segments`;
}

export async function resolveProtectedDownloadClipUrl(
  filePath: string,
  lesson?: string
): Promise<string> {
  const clean = normalizeClipPath(filePath, lesson);
  if (!clean) return "";
  const ticket = await requestAuthTicket("DOWNLOAD", clean);
  return getDownloadClipUrl(filePath, lesson, ticket || undefined);
}

export async function resolveProtectedDownloadZipUrl(
  lesson: string,
  user?: string
): Promise<string> {
  const cleanLesson = (lesson || "clips").trim();
  const ticket = await requestAuthTicket("DOWNLOAD", cleanLesson);
  return getDownloadZipUrl(cleanLesson, user, ticket || undefined);
}

export async function resolveProtectedStreamUrl(url: string): Promise<string> {
  if (!url || !url.includes("/api/video/stream/") || url.includes("ticket=")) {
    return url;
  }
  const match = url.match(/\/api\/video\/stream\/([a-fA-F0-9]{64})/);
  if (!match) return url;
  const hash = match[1];
  const ticket = await requestAuthTicket("STREAM", hash);
  if (!ticket) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Kích hoạt tải tệp trực tiếp an toàn trên trình duyệt chuẩn HTML5 (tránh bị popup blocker chặn)
 */
export function triggerBrowserDownload(url: string, filename?: string): void {
  if (typeof window === "undefined" || !url) return;
  const link = document.createElement("a");
  link.href = url;
  if (filename) {
    link.download = filename;
  }
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
  }, 300);
}

/**
 * Gửi kế hoạch phân đoạn đã duyệt lên Backend để thực hiện cắt video (POST /api/video/render - B10)
 */
export async function submitRenderSegments(
  segmentsData: SegmentsData
): Promise<RenderResponse> {
  try {
    const res = await apiFetch(`${API_BASE}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(segmentsData),
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = (await res.json()) as { error?: string };
        if (errJson && typeof errJson.error === "string") {
          errorMsg = errJson.error;
        }
      } catch {
        const errText = await res.text().catch(() => "");
        if (errText) errorMsg = errText;
      }
      throw new Error(errorMsg);
    }

    const json = (await res.json()) as {
      status?: string;
      message?: string;
      savedPlan?: string;
      totalRendered?: number;
      renderedFiles?: RenderedClipItem[];
      outputDirectory?: string;
      lesson?: string;
      engine?: string;
    };

    return {
      success: true,
      status: json.status,
      message: json.message || "Đã hoàn thành cắt phân đoạn video.",
      savedPlan: json.savedPlan,
      totalRendered: json.totalRendered,
      renderedFiles: json.renderedFiles,
      outputDirectory: json.outputDirectory,
      lesson: json.lesson,
      engine: json.engine,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Lỗi khi gửi yêu cầu render",
    };
  }
}

export interface UploadVideoResponse {
  status: string;
  videoId?: number;
  video_id?: number;
  file_name: string;
  file_size: number;
  sha256: string;
  cloud_url: string;
  transcript_file?: string;
  transcript?: TranscriptData;
  segmentsData?: SegmentsData;
  message?: string;
}

/**
 * Tải file video lên Backend Spring Boot (POST /api/video/upload-sample)
 * Tự động tính SHA-256, đẩy lên Cloudflare R2 (hoặc lưu local fallback),
 * và lưu bản ghi vào Database.
 */
export async function uploadVideoFile(
  file: File
): Promise<ApiResponse<UploadVideoResponse>> {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await apiFetch(`${API_BASE}/upload-sample`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = (await res.json()) as { error?: string };
        if (errJson && typeof errJson.error === "string") {
          errorMsg = errJson.error;
        }
      } catch {
        const errText = await res.text().catch(() => "");
        if (errText) errorMsg = errText;
      }
      throw new Error(errorMsg);
    }

    const data: UploadVideoResponse = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Lỗi upload video lên server",
      source: "fallback",
    };
  }
}

export interface BackendVideoItem {
  id?: number;
  fileName: string;
  sha256Hash: string;
  status?: string;
  fileSize?: number;
  duration?: number;
  r2Key?: string;
  cloudUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Lấy danh sách video đã lưu trữ từ Database qua Backend (GET /api/video/list)
 */
export async function fetchBackendVideos(): Promise<ApiResponse<BackendVideoItem[]>> {
  try {
    const res = await apiFetch(`${API_BASE}/list`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    const data: BackendVideoItem[] = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không thể lấy danh sách video từ server",
      source: "fallback",
    };
  }
}

export interface AnalyzeResponse {
  status: string;
  mode: string;
  segmentsData: SegmentsData;
  transcript: TranscriptData;
}

/**
 * Gọi AI Phân tích Video & Semantic Segmentation từ Backend (POST /api/video/analyze)
 */
export async function analyzeVideoBackend(payload: {
  videoName: string;
  lesson: string;
  hash?: string;
  duration: number;
  force?: boolean;
  url?: string;
}): Promise<ApiResponse<AnalyzeResponse>> {
  try {
    const requestBody: {
      videoName: string;
      lesson: string;
      duration: number;
      force: boolean;
      hash?: string;
      url?: string;
    } = {
      videoName: payload.videoName,
      lesson: payload.lesson,
      duration: payload.duration,
      force: payload.force === true,
    };
    if (payload.hash) {
      requestBody.hash = payload.hash;
    }
    if (payload.url) {
      requestBody.url = payload.url;
    }

    const res = await apiFetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = (await res.json()) as { error?: string };
        if (errJson && typeof errJson.error === "string") {
          errorMsg = errJson.error;
        }
      } catch {
        const errText = await res.text().catch(() => "");
        if (errText) errorMsg = errText;
      }
      return {
        error: errorMsg,
        source: "fallback",
        status: res.status,
      };
    }

    const data: AnalyzeResponse = await res.json();
    return { data, source: "api", status: res.status };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Lỗi khi gọi AI phân tích trên backend",
      source: "fallback",
    };
  }
}

export interface AnalyzeWithAutoSyncOptions {
  videoName: string;
  lesson: string;
  duration: number;
  hash?: string;
  force?: boolean;
  url?: string;
  getLocalBlob?: () => Promise<Blob | null>;
  analyzeFn?: typeof analyzeVideoBackend;
  uploadFn?: typeof uploadVideoFile;
}

export interface AnalyzeWithAutoSyncResult {
  response: ApiResponse<AnalyzeResponse>;
  syncedHash?: string;
  syncedUrl?: string;
}

function isMissingBackendMediaError(res: ApiResponse<AnalyzeResponse>): boolean {
  if (res.source === "api") return false;
  const err = (res.error || "").toLowerCase();
  return (
    res.status === 502 ||
    err.includes("empty_transcript") ||
    err.includes("uploads/")
  );
}

/**
 * Gọi /api/video/analyze; nếu Backend thiếu tệp vật lý trong uploads/ nhưng trình duyệt
 * còn giữ video trong IndexedDB, tự động đồng bộ qua /api/video/upload-sample rồi thử lại 1 lần.
 */
export async function analyzeVideoWithAutoSync(
  options: AnalyzeWithAutoSyncOptions
): Promise<AnalyzeWithAutoSyncResult> {
  const analyzeFn = options.analyzeFn ?? analyzeVideoBackend;
  const uploadFn = options.uploadFn ?? uploadVideoFile;
  const serverUrl =
    options.url && !options.url.startsWith("blob:") ? options.url : undefined;

  const firstRes = await analyzeFn({
    videoName: options.videoName,
    lesson: options.lesson,
    duration: options.duration,
    hash: options.hash,
    force: options.force,
    url: serverUrl,
  });

  if (
    firstRes.source === "api" &&
    firstRes.data?.status === "SUCCESS" &&
    (firstRes.data.segmentsData?.segments?.length ?? 0) > 0
  ) {
    return {
      response: firstRes,
      syncedHash: options.hash,
      syncedUrl: options.url,
    };
  }

  if (isMissingBackendMediaError(firstRes) && options.getLocalBlob) {
    const localBlob = await options.getLocalBlob().catch(() => null);
    if (localBlob && localBlob.size > 0) {
      const uploadTarget =
        typeof File !== "undefined" && localBlob instanceof File
          ? localBlob
          : new File([localBlob], options.videoName, {
              type: localBlob.type || "video/mp4",
            });
      const uploadRes = await uploadFn(uploadTarget);
      if (uploadRes.source === "api" && uploadRes.data?.sha256) {
        const syncedHash = uploadRes.data.sha256;
        const syncedUrl = uploadRes.data.cloud_url || serverUrl;
        const retryRes = await analyzeFn({
          videoName: options.videoName,
          lesson: options.lesson,
          duration: options.duration,
          hash: syncedHash,
          force: options.force,
          url: syncedUrl,
        });
        return {
          response: retryRes,
          syncedHash,
          syncedUrl,
        };
      }
    }
  }

  return {
    response: firstRes,
    syncedHash: options.hash,
    syncedUrl: options.url,
  };
}

export interface SaveProjectPayload {
  user?: string;
  lesson: string;
  video: string;
  videoUrl?: string;
  duration?: number;
  segments: unknown[];
  [key: string]: unknown;
}

export interface SaveProjectResponse {
  status: string;
  message: string;
  user?: string;
  lesson?: string;
  localDirectory?: string;
  cloudUrl?: string;
  r2Url?: string;
  files?: string[];
  savedAt?: number;
}

export async function saveProjectToBackend(
  payload: SaveProjectPayload
): Promise<ApiResponse<SaveProjectResponse>> {
  try {
    const res = await apiFetch(`${API_BASE}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data: SaveProjectResponse = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không thể kết nối API lưu dự án",
      source: "fallback",
    };
  }
}

export interface ConcatVideosPayload {
  clips: string[];
  output?: string;
  forceReencode?: boolean;
}

export interface ConcatVideosResponse {
  status: string;
  message: string;
  outputFile?: string;
  outputSizeBytes?: number;
  executionTimeMs?: number;
  totalClips?: number;
}

/**
 * Ghép nối nhiều file clip thành 1 video tổng hợp qua FFmpeg Concat của SV1 (POST /api/video/concat)
 */
export interface MergeSelectedClipsPayload {
  videoName: string;
  videoHash?: string;
  videoUrl?: string;
  lesson: string;
  user?: string;
  segments: Array<{
    start: number;
    end: number;
    topic?: string;
    videoName?: string;
    videoUrl?: string;
    videoHash?: string;
  }>;
}

export interface MergeSelectedClipsResponse {
  status: string;
  message: string;
  file: string;
  outputFile: string;
  downloadUrl: string;
  protectedDownloadUrl?: string;
  outputSizeBytes?: number;
  executionTimeMs?: number;
  mergedCount: number;
}

/**
 * Cắt và ghép các phân đoạn được tích chọn trên Timeline (kể cả cách quãng) thành 1 file MP4 (POST /api/video/merge-clips).
 */
export async function mergeSelectedClipsBackend(
  payload: MergeSelectedClipsPayload
): Promise<ApiResponse<MergeSelectedClipsResponse>> {
  const validSegments = (payload.segments || []).filter(
    (s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start
  );
  if (validSegments.length < 2) {
    return {
      error: "Cần tích chọn ít nhất 2 phân đoạn hợp lệ để gộp thành 1 video.",
      source: "fallback",
    };
  }

  try {
    const res = await apiFetch(`${API_BASE}/merge-clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoName: payload.videoName,
        videoHash: payload.videoHash,
        videoUrl: payload.videoUrl,
        lesson: payload.lesson || "clips",
        user: payload.user || "admin",
        segments: validSegments,
      }),
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = (await res.json()) as { error?: string | { message?: string } };
        if (typeof errJson.error === "string") {
          errorMsg = errJson.error;
        } else if (errJson.error && typeof errJson.error.message === "string") {
          errorMsg = errJson.error.message;
        }
      } catch {
        // Bỏ qua nếu body không phải JSON
      }
      throw new Error(errorMsg);
    }

    const data = (await res.json()) as MergeSelectedClipsResponse;
    if (data.outputFile) {
      data.protectedDownloadUrl = await resolveProtectedDownloadClipUrl(data.outputFile);
    }
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không thể gộp các phân đoạn đã chọn",
      source: "fallback",
    };
  }
}

export async function submitConcatVideos(
  payload: ConcatVideosPayload
): Promise<ApiResponse<ConcatVideosResponse>> {
  try {
    const res = await apiFetch(`${API_BASE}/concat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) {
          errorMsg = errJson.error;
        }
      } catch {}
      throw new Error(errorMsg);
    }

    const data: ConcatVideosResponse = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không thể kết nối API ghép nối video (Video Concat)",
      source: "fallback",
    };
  }
}

/**
 * Gửi yêu cầu xóa một phân đoạn (segment) tới Backend API.
 */
export async function deleteSegmentBackend(
  videoId: string | number,
  segmentId: string
): Promise<ApiResponse<{ deleted: boolean; message: string; segments?: Segment[] }>> {
  try {
    const res = await apiFetch(`${API_BASE}/${videoId}/segments/${encodeURIComponent(segmentId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      const data = await res.json();
      return { data, source: "api" };
    }
    return { error: `HTTP ${res.status}`, source: "fallback" };
  } catch (err) {
    return { error: String(err), source: "fallback" };
  }
}

export interface SaveSegmentsResponse {
  status: string;
  videoId: number;
  totalTopics: number;
  message: string;
}

/**
 * Lấy cấu trúc phân đoạn từ Database theo Video ID (GET /api/video/{id}/segments)
 */
export async function getSegments(
  videoId: number
): Promise<ApiResponse<SegmentsData>> {
  try {
    const res = await apiFetch(buildVideoSegmentsUrl(videoId), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    const data: SegmentsData = await res.json();
    return { data, source: "api" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không thể lấy danh sách phân đoạn từ Database";
    return {
      error: message,
      source: "fallback",
    };
  }
}

/**
 * Lưu trực tiếp cấu trúc phân đoạn vào Database theo Video ID (POST /api/video/{id}/segments)
 */
export async function saveSegments(
  videoId: number,
  segs: Segment[]
): Promise<ApiResponse<SaveSegmentsResponse>> {
  try {
    const res = await apiFetch(buildVideoSegmentsUrl(videoId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(segs),
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    const data: SaveSegmentsResponse = await res.json();
    return { data, source: "api" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không thể lưu phân đoạn vào Database";
    return {
      error: message,
      source: "fallback",
    };
  }
}
