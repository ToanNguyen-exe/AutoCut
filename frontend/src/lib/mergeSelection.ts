import type { Segment } from "@/types";

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
