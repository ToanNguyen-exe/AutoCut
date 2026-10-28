import { SegmentsData, TranscriptData } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/video";

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  source: "api" | "fallback";
}

// Dữ liệu fallback nếu backend chưa khởi động
export const FALLBACK_SEGMENTS: SegmentsData = {
  video: "Bai05_VongLap.mp4",
  lesson: "Bai05_VongLap",
  mode: "guided",
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
 * Lấy dữ liệu segments mẫu từ Backend Spring Boot
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
 * Lấy transcript mẫu từ Backend
 */
export async function fetchMockTranscript(): Promise<ApiResponse<TranscriptData>> {
  try {
    const res = await fetch(`${API_BASE}/mock-transcript`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
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

/**
 * Lấy cấu hình runtime từ config.yaml của Backend
 */
export async function fetchConfig(): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    const res = await fetch(`${API_BASE}/config`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = await res.json();
    return { data, source: "api" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Backend chưa chạy",
      source: "fallback",
    };
  }
}

/**
 * Gửi kế hoạch phân đoạn đã duyệt lên Backend để chuẩn bị cắt video (B10)
 */
export async function submitRenderSegments(
  segmentsData: SegmentsData
): Promise<{ success: boolean; message: string; savedPlan?: string }> {
  try {
    const res = await fetch(`${API_BASE}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(segmentsData),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `HTTP ${res.status}`);
    }

    const json = await res.json();
    return {
      success: true,
      message: json.message || "Đã gửi phân đoạn duyệt thành công!",
      savedPlan: json.savedPlan,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Lỗi khi gửi yêu cầu render",
    };
  }
}
