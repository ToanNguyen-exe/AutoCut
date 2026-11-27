import type { VideoPart, Sentence, Segment } from "@/types";

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

/**
 * Tự động tạo danh sách phân đoạn (Segment[]) từ danh sách câu thoại (Sentence[])
 */
export function generateSegmentsFromSentences(
  sentences: Sentence[],
  totalDuration: number,
  videoName: string,
  lesson: string
): Segment[] {
  if (!sentences || sentences.length === 0) {
    const dur = totalDuration > 0 ? totalDuration : 60;
    return [
      {
        id: `seg_${Date.now()}_01`,
        section_no: 1,
        section: "01_NoiDung",
        topic_no: 1,
        topic: lesson || videoName,
        slug: slugify(lesson || videoName),
        start_id: "S0001",
        end_id: "S0001",
        start: 0,
        end: dur,
        parts: recalculateParts(0, dur, "01_NoiDung", 1, slugify(lesson || videoName)),
      },
    ];
  }

  const segments: Segment[] = [];
  const numSections = Math.min(5, Math.max(2, Math.ceil(sentences.length / 3)));
  const sentencesPerSection = Math.ceil(sentences.length / numSections);
  let currentStart = 0.0;

  for (let i = 0; i < numSections; i++) {
    const startIdx = i * sentencesPerSection;
    const endIdx = Math.min(sentences.length, (i + 1) * sentencesPerSection);
    if (startIdx >= sentences.length) break;

    const group = sentences.slice(startIdx, endIdx);
    const segStart = currentStart;
    let segEnd: number;

    if (i === numSections - 1 || endIdx >= sentences.length) {
      segEnd = totalDuration > segStart ? totalDuration : group[group.length - 1].end;
    } else {
      const nextGroupFirstSent = sentences[endIdx];
      segEnd = Number(((group[group.length - 1].end + nextGroupFirstSent.start) / 2).toFixed(1));
      if (segEnd <= segStart) {
        segEnd = group[group.length - 1].end;
      }
    }
    currentStart = segEnd;
    const secNo = i + 1;
    const secName = `0${secNo}_Doan_${secNo}`;

    const topicText = group[0]?.text
      ? group[0].text.length > 55
        ? `${group[0].text.slice(0, 52).trim()}...`
        : group[0].text.trim()
      : `Phân đoạn ${secNo}`;

    const slug = `doan-${secNo}`;

    segments.push({
      id: `seg_${Date.now()}_0${secNo}`,
      section_no: secNo,
      section: secName,
      topic_no: secNo,
      topic: topicText,
      slug: slug,
      start_id: group[0].id || `S${secNo}01`,
      end_id: group[group.length - 1].id || `S${secNo}99`,
      start: segStart,
      end: segEnd,
      parts: recalculateParts(segStart, segEnd, secName, secNo, slug),
    });
  }

  return segments;
}

/**
 * Tách một phân đoạn thành 2 phần tại thời điểm splitTime:
 * - Nửa đầu: giữ nguyên id cũ (F00: định danh ổn định)
 * - Nửa sau: cấp id mới bằng crypto.randomUUID()
 */
export function splitSegment(orig: Segment, splitTime: number): [Segment, Segment] {
  const seg1: Segment = {
    ...orig,
    id: orig.id, // Nửa đầu giữ id cũ
    end: splitTime,
    topic: `${orig.topic} (Phần 1)`,
    slug: slugify(`${orig.topic} p1`),
    parts: recalculateParts(
      orig.start,
      splitTime,
      `${orig.section_no.toString().padStart(2, "0")}_${slugify(orig.section)}`,
      orig.topic_no,
      slugify(`${orig.topic} p1`)
    ),
  };

  const newId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `seg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const seg2: Segment = {
    ...orig,
    id: newId, // Nửa sau dùng crypto.randomUUID()
    start: splitTime,
    topic: `${orig.topic} (Phần 2)`,
    slug: slugify(`${orig.topic} p2`),
    topic_no: orig.topic_no + 1,
    parts: recalculateParts(
      splitTime,
      orig.end,
      `${orig.section_no.toString().padStart(2, "0")}_${slugify(orig.section)}`,
      orig.topic_no + 1,
      slugify(`${orig.topic} p2`)
    ),
  };

  return [seg1, seg2];
}
