import type { Segment, JoinedVideoClip } from "@/types";
import { slugify } from "./utils.ts";

export interface MergeClipSourceItem {
  start: number;
  end: number;
  topic?: string;
  videoName: string;
  videoUrl?: string;
  videoHash?: string;
}

export interface RenderSegmentPayload extends Segment {
  videoName?: string;
  videoUrl?: string;
  videoHash?: string;
}

export type TimelineMergeValidation =
  | { ok: true; indices: number[]; selectedSegments: Segment[] }
  | { ok: false; reason: string };

export type MergeTimelineResult =
  | { ok: true; segments: Segment[]; mergedSegment: Segment; mergedCount: number }
  | { ok: false; reason: string };

export function extractSha256FromStreamUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const match = url.match(/\/api\/video\/stream\/([a-fA-F0-9]{64})/);
  return match ? match[1] : undefined;
}

export function toggleSelectedSegmentId(selectedIds: string[], segmentId: string): string[] {
  if (!segmentId) return selectedIds;
  return selectedIds.includes(segmentId)
    ? selectedIds.filter((id) => id !== segmentId)
    : [...selectedIds, segmentId];
}

export function reconcileSelectedSegmentIds(selectedIds: string[], segments: Segment[]): string[] {
  if (selectedIds.length === 0 || segments.length === 0) return [];
  const validSet = new Set(segments.map((s) => s.id));
  return selectedIds.filter((id) => validSet.has(id));
}

export function getCheckedSegmentsInOrder(segments: Segment[], selectedIds: string[]): Segment[] {
  const validSet = new Set(selectedIds);
  return segments.filter((s) => validSet.has(s.id));
}

export function canMergeSelectedSegments(selectedIds: string[]): boolean {
  return selectedIds.length >= 2;
}

/**
 * Ánh xạ các phân đoạn đã tích chọn trên Timeline (tọa độ toàn cục) sang từng nguồn video
 * và mốc thời gian cục bộ tương ứng khi có 1 hoặc nhiều video nối tiếp (joinedVideos).
 */
export function buildMergeClipItems(
  selectedSegments: Segment[],
  joinedVideos: JoinedVideoClip[],
  fallbackVideo: { videoName: string; videoUrl?: string; videoHash?: string }
): MergeClipSourceItem[] {
  const orderedClips = [...(joinedVideos || [])].sort((a, b) => a.startOffset - b.startOffset);
  const items: MergeClipSourceItem[] = [];

  for (const seg of selectedSegments) {
    if (orderedClips.length > 0) {
      let mappedAny = false;
      for (const clip of orderedClips) {
        const overlapStart = Math.max(seg.start, clip.startOffset);
        const overlapEnd = Math.min(seg.end, clip.endOffset);
        if (overlapEnd - overlapStart >= 0.1) {
          const localStart = Number(Math.max(0, overlapStart - clip.startOffset).toFixed(3));
          const localEnd = Number(Math.max(localStart, overlapEnd - clip.startOffset).toFixed(3));
          const clipHash =
            extractSha256FromStreamUrl(clip.url) ||
            (orderedClips.length === 1 && !clip.url?.includes("/videos/") ? fallbackVideo.videoHash : undefined);
          items.push({
            start: localStart,
            end: localEnd,
            topic: seg.topic,
            videoName: clip.fileName || fallbackVideo.videoName,
            videoUrl: clip.url || fallbackVideo.videoUrl,
            videoHash: clipHash,
          });
          mappedAny = true;
        }
      }
      if (mappedAny) continue;
    }

    items.push({
      start: seg.start,
      end: seg.end,
      topic: seg.topic,
      videoName: fallbackVideo.videoName,
      videoUrl: fallbackVideo.videoUrl,
      videoHash: extractSha256FromStreamUrl(fallbackVideo.videoUrl) || fallbackVideo.videoHash,
    });
  }

  return items;
}

function resolveSegmentVideoSourceIndex(seg: Segment, joinedVideos: JoinedVideoClip[] = []): number {
  if (typeof seg.videoIndex === "number" && seg.videoIndex > 0) {
    return seg.videoIndex - 1;
  }
  if (joinedVideos.length > 1) {
    const orderedClips = [...joinedVideos].sort((a, b) => a.startOffset - b.startOffset);
    const midpoint = (seg.start + seg.end) / 2;
    const clipIdx = orderedClips.findIndex((clip, idx) => {
      const isLast = idx === orderedClips.length - 1;
      return midpoint >= clip.startOffset && (isLast ? midpoint <= clip.endOffset : midpoint < clip.endOffset);
    });
    if (clipIdx >= 0) return clipIdx;
  }
  return 0;
}

function resolveSectionFolder(sectionNo: number, section: string): string {
  const clean = (section || "NoiDung").trim().replace(/\s+/g, "");
  if (/^\d{2}_/.test(clean)) {
    return clean;
  }
  return `${String(sectionNo || 1).padStart(2, "0")}_${clean || "NoiDung"}`;
}

function buildSinglePartFile(seg: Segment, sectionFolder: string, topicNo: number, slug: string): string {
  const existingFile = seg.parts?.[0]?.file;
  if (existingFile && existingFile.trim()) {
    return existingFile.trim().replace(/_Phan\d+(?=\.[^.]+$)/i, "");
  }
  const topicPrefix = String(topicNo || 1).padStart(2, "0");
  return `${sectionFolder}/${topicPrefix}_${slug || "clip"}.mp4`;
}

/**
 * Kiểm tra các phân đoạn được tích chọn có đủ điều kiện gộp trực tiếp trên track Nội dung hay không.
 */
export function getTimelineMergeValidation(
  segments: Segment[],
  selectedIds: string[],
  joinedVideos: JoinedVideoClip[] = []
): TimelineMergeValidation {
  const validIds = reconcileSelectedSegmentIds(selectedIds, segments);
  if (validIds.length < 2) {
    return { ok: false, reason: "Vui lòng tích chọn ít nhất 2 phân đoạn liền kề để gộp." };
  }

  const selectedSet = new Set(validIds);
  const indices: number[] = [];
  const selectedSegments: Segment[] = [];
  segments.forEach((seg, idx) => {
    if (selectedSet.has(seg.id)) {
      indices.push(idx);
      selectedSegments.push(seg);
    }
  });

  if (selectedSegments.length < 2) {
    return { ok: false, reason: "Vui lòng tích chọn ít nhất 2 phân đoạn liền kề để gộp." };
  }

  const firstSourceIdx = resolveSegmentVideoSourceIndex(selectedSegments[0], joinedVideos);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) {
      return {
        ok: false,
        reason: "Chỉ gộp được các phân đoạn liền kề nhau trên timeline.",
      };
    }

    const prevSeg = selectedSegments[i - 1];
    const curSeg = selectedSegments[i];
    if (curSeg.start - prevSeg.end > 0.4) {
      return {
        ok: false,
        reason: "Không thể gộp các phân đoạn bị ngăn cách bởi đoạn đã xóa.",
      };
    }

    if (resolveSegmentVideoSourceIndex(curSeg, joinedVideos) !== firstSourceIdx) {
      return {
        ok: false,
        reason: "Không thể gộp phân đoạn thuộc hai video khác nhau.",
      };
    }
  }

  return { ok: true, indices, selectedSegments };
}

/**
 * Gộp các phân đoạn liền kề trên track Nội dung thành 1 phân đoạn duy nhất mà không mutate đầu vào.
 */
export function mergeTimelineSegments(
  segments: Segment[],
  selectedIds: string[],
  joinedVideos: JoinedVideoClip[] = []
): MergeTimelineResult {
  const validation = getTimelineMergeValidation(segments, selectedIds, joinedVideos);
  if (!validation.ok) {
    return validation;
  }

  const { indices, selectedSegments } = validation;
  const first = selectedSegments[0];
  const last = selectedSegments[selectedSegments.length - 1];
  const nextTopicNo = indices[0] + 1;
  const mergedTopic = selectedSegments.map((s) => s.topic.trim()).filter(Boolean).join(" & ") || first.topic;
  const mergedSlug = slugify(mergedTopic) || first.slug || "merged";
  const sectionFolder = resolveSectionFolder(first.section_no, first.section);

  const mergedSegment: Segment = {
    ...first,
    id: first.id,
    topic_no: nextTopicNo,
    topic: mergedTopic,
    slug: mergedSlug,
    start_id: first.start_id,
    end_id: last.end_id,
    start: first.start,
    end: last.end,
    parts: [
      {
        part: 1,
        start: Number(first.start.toFixed(1)),
        end: Number(last.end.toFixed(1)),
        file: `${sectionFolder}/${String(nextTopicNo).padStart(2, "0")}_${mergedSlug}.mp4`,
      },
    ],
  };

  const nextSegments = [...segments];
  nextSegments.splice(indices[0], selectedSegments.length, mergedSegment);
  const renumbered = nextSegments.map((seg, idx) => ({
    ...seg,
    topic_no: idx + 1,
  }));

  return {
    ok: true,
    segments: renumbered,
    mergedSegment: renumbered[indices[0]],
    mergedCount: selectedSegments.length,
  };
}

/**
 * Chuyển đổi danh sách phân đoạn cần Export (tọa độ toàn timeline) sang mốc cục bộ và
 * nguồn video tương ứng với từng clip trong joinedVideos.
 */
export function buildRenderSegmentsPayload(
  selectedSegments: Segment[],
  joinedVideos: JoinedVideoClip[],
  fallbackVideo: { videoName: string; videoUrl?: string; videoHash?: string }
): RenderSegmentPayload[] {
  const orderedClips = [...(joinedVideos || [])].sort((a, b) => a.startOffset - b.startOffset);

  return selectedSegments.map((seg) => {
    let matchedClip: JoinedVideoClip | undefined;
    if (orderedClips.length > 0) {
      const midpoint = (seg.start + seg.end) / 2;
      matchedClip =
        orderedClips.find((clip, idx) => {
          const isLast = idx === orderedClips.length - 1;
          return (
            midpoint >= clip.startOffset &&
            (isLast ? midpoint <= clip.endOffset : midpoint < clip.endOffset)
          );
        }) || orderedClips[0];
    }

    const offset = matchedClip ? matchedClip.startOffset : 0;
    const localStart = Number(Math.max(0, seg.start - offset).toFixed(3));
    const localEnd = Number(Math.max(localStart, seg.end - offset).toFixed(3));
    const sectionFolder = resolveSectionFolder(seg.section_no, seg.section);
    const segSlug = seg.slug || slugify(seg.topic) || "clip";
    const singleFile = buildSinglePartFile(seg, sectionFolder, seg.topic_no, segSlug);
    const singleParts = [
      {
        part: 1,
        start: localStart,
        end: localEnd,
        file: singleFile,
      },
    ];

    const clipHash = matchedClip
      ? extractSha256FromStreamUrl(matchedClip.url) ||
        (orderedClips.length === 1 && !matchedClip.url?.includes("/videos/")
          ? fallbackVideo.videoHash
          : undefined)
      : extractSha256FromStreamUrl(fallbackVideo.videoUrl) || fallbackVideo.videoHash;

    return {
      ...seg,
      start: localStart,
      end: localEnd,
      parts: singleParts,
      videoName: matchedClip?.fileName || fallbackVideo.videoName,
      videoUrl: matchedClip?.url || fallbackVideo.videoUrl,
      videoHash: clipHash,
    };
  });
}
