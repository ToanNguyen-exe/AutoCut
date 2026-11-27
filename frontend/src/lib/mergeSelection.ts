import type { Segment, JoinedVideoClip } from "@/types";

export interface MergeClipSourceItem {
  start: number;
  end: number;
  topic?: string;
  videoName: string;
  videoUrl?: string;
  videoHash?: string;
}

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
