import { SegmentsData, TranscriptData } from "@/types";

const rawBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/video";
export const API_BASE = rawBase.endsWith("/api/video")
  ? rawBase
  : `${rawBase.replace(/\/+$/, "")}/api/video`;

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  source: "api" | "fallback";
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
    const res = await fetch(`${API_BASE}/mock-segments`, {
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
    const res = await fetch(`${API_BASE}/mock-transcript`, {
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
    const res = await fetch(`${API_BASE}/cache/${encodeURIComponent(hash)}`, {
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
    const res = await fetch(`${API_BASE}/config`, {
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

export interface RenderResponse {
  success: boolean;
  status?: string;
  message: string;
  savedPlan?: string;
}

/**
 * Gửi kế hoạch phân đoạn đã duyệt lên Backend để thực hiện cắt video (POST /api/video/render - B10)
 */
export async function submitRenderSegments(
  segmentsData: SegmentsData
): Promise<RenderResponse> {
  try {
    const res = await fetch(`${API_BASE}/render`, {
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
    };

    return {
      success: true,
      status: json.status,
      message: json.message || "Đã tiếp nhận và chuẩn bị cắt phân đoạn.",
      savedPlan: json.savedPlan,
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
  file_name: string;
  file_size: number;
  sha256: string;
  cloud_url: string;
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

    const res = await fetch(`${API_BASE}/upload-sample`, {
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
    const res = await fetch(`${API_BASE}/list`, {
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
}): Promise<ApiResponse<AnalyzeResponse>> {
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

    const data: AnalyzeResponse = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Lỗi khi gọi AI phân tích trên backend",
      source: "fallback",
    };
  }
}
