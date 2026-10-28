import { VideoPart } from "@/types";

/**
 * Định dạng số giây sang chuỗi mm:ss hoặc hh:mm:ss
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Chuyển chuỗi hh:mm:ss hoặc mm:ss hoặc giây thành số thực (seconds)
 */
export function parseTime(timeStr: string): number {
  if (!timeStr) return 0;
  const trimmed = timeStr.trim();

  // Nếu là số thuần túy
  if (!isNaN(Number(trimmed))) {
    return Math.max(0, parseFloat(trimmed));
  }

  const parts = trimmed.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => isNaN(p))) return 0;

  if (parts.length === 3) {
    // hh:mm:ss
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // mm:ss
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

/**
 * Chuẩn hóa chuỗi tiếng Việt thành slug hợp lệ cho tên file/folder (Mục 3.3 CONVENTIONS)
 */
export function slugify(str: string): string {
  if (!str) return "topic";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Bỏ dấu tiếng Việt
    .replace(/[đĐ]/g, "d")
    .replace(/[/\\:*?"<>|]/g, "") // Xóa ký tự cấm hệ điều hành
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/**
 * Tính toán lại danh sách các phần con (parts) theo thuật toán B8
 * @param start Thời gian bắt đầu đoạn (giây)
 * @param end Thời gian kết thúc đoạn (giây)
 * @param sectionFolder Tên thư mục phần (vd: 01_LyThuyet)
 * @param topicNo Số thứ tự chủ đề
 * @param slug Slug của chủ đề
 * @param maxDuration Giới hạn tối đa (mặc định 420s)
 * @param maxOverflow Dung sai tối đa % (mặc định 10%)
 */
export function recalculateParts(
  start: number,
  end: number,
  sectionFolder: string,
  topicNo: number,
  slug: string,
  maxDuration = 420,
  maxOverflow = 10
): VideoPart[] {
  const duration = Math.max(0, end - start);
  const limit = maxDuration * (1 + maxOverflow / 100);

  const topicPrefix = topicNo.toString().padStart(2, "0");

  if (duration <= limit) {
    return [
      {
        part: 1,
        start: Number(start.toFixed(1)),
        end: Number(end.toFixed(1)),
        file: `${sectionFolder}/${topicPrefix}_${slug}.mp4`,
      },
    ];
  }

  // Tách video dài thành n phần
  const n = Math.ceil(duration / maxDuration);
  const parts: VideoPart[] = [];
  let cur = start;

  for (let i = 0; i < n - 1; i++) {
    const remainingParts = n - i;
    const targetCut = cur + (end - cur) / remainingParts;
    const cut = Number(targetCut.toFixed(1));
    parts.push({
      part: i + 1,
      start: Number(cur.toFixed(1)),
      end: cut,
      file: `${sectionFolder}/${topicPrefix}_${slug}_Phan${i + 1}.mp4`,
    });
    cur = cut;
  }

  parts.push({
    part: n,
    start: Number(cur.toFixed(1)),
    end: Number(end.toFixed(1)),
    file: `${sectionFolder}/${topicPrefix}_${slug}_Phan${n}.mp4`,
  });

  return parts;
}
