"use client";

import React, { useState } from "react";
import { Segment } from "@/types";
import { formatTime, parseTime, slugify, recalculateParts } from "@/lib/utils";
import {
  Play,
  Trash2,
  Combine,
  ChevronDown,
  ChevronRight,
  Plus,
  Folder,
  FileVideo,
} from "lucide-react";

interface ReviewTableProps {
  segments: Segment[];
  activeSegmentId?: string;
  onUpdateSegments: (newSegments: Segment[]) => void;
  onPreviewSegment: (start: number, segmentId: string) => void;
}

const SECTION_OPTIONS = [
  "Lý thuyết",
  "Thực hành ví dụ",
  "Bài tập",
  "Giới thiệu",
  "Hỏi đáp",
  "Tổng kết",
  "Ngoài lề",
];

export const ReviewTable: React.FC<ReviewTableProps> = ({
  segments,
  activeSegmentId,
  onUpdateSegments,
  onPreviewSegment,
}) => {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Cập nhật trường dữ liệu cho 1 segment
  const handleFieldChange = (
    index: number,
    field: keyof Segment,
    value: string | number
  ) => {
    const updated = [...segments];
    const item = { ...updated[index] };

    if (field === "section") {
      item.section = String(value);
    } else if (field === "topic") {
      item.topic = String(value);
      item.slug = slugify(String(value));
    } else if (field === "slug") {
      item.slug = slugify(String(value));
    } else if (field === "start" || field === "end") {
      const numVal = typeof value === "number" ? value : parseTime(String(value));
      if (field === "start") item.start = numVal;
      if (field === "end") item.end = numVal;
    }

    // Tự động tính lại B8: số phần và mảng parts
    const sectionSlug = slugify(item.section).replace(/-/g, "");
    const sectionPrefix = item.section_no.toString().padStart(2, "0");
    const sectionFolder = `${sectionPrefix}_${capitalizeFirstLetter(sectionSlug)}`;

    item.parts = recalculateParts(
      item.start,
      item.end,
      sectionFolder,
      item.topic_no,
      item.slug
    );

    updated[index] = item;
    onUpdateSegments(updated);
  };

  // Xóa đoạn
  const handleDelete = (index: number) => {
    if (confirm(`Bạn có chắc muốn xóa phân đoạn "${segments[index].topic}"?`)) {
      const updated = segments.filter((_, i) => i !== index);
      onUpdateSegments(updated);
    }
  };

  // Gộp đoạn hiện tại với đoạn liền kề sau (B7 & B9)
  const handleMergeNext = (index: number) => {
    if (index >= segments.length - 1) return;

    const current = segments[index];
    const next = segments[index + 1];

    const mergedTopic = `${current.topic} & ${next.topic}`;
    const mergedSlug = slugify(mergedTopic);

    const sectionSlug = slugify(current.section).replace(/-/g, "");
    const sectionPrefix = current.section_no.toString().padStart(2, "0");
    const sectionFolder = `${sectionPrefix}_${capitalizeFirstLetter(sectionSlug)}`;

    const mergedSegment: Segment = {
      ...current,
      end: next.end,
      end_id: next.end_id,
      topic: mergedTopic,
      slug: mergedSlug,
      parts: recalculateParts(
        current.start,
        next.end,
        sectionFolder,
        current.topic_no,
        mergedSlug
      ),
    };

    const updated = [...segments];
    updated.splice(index, 2, mergedSegment);

    // Đánh lại số thứ tự topic_no
    const reindexed = updated.map((s, idx) => ({
      ...s,
      topic_no: idx + 1,
    }));

    onUpdateSegments(reindexed);
  };

  // Thêm một phân đoạn rỗng mới ở cuối
  const handleAddNewSegment = () => {
    const lastSeg = segments[segments.length - 1];
    const newStart = lastSeg ? lastSeg.end : 0;
    const newEnd = newStart + 300; // 5 phút mặc định

    const newSegment: Segment = {
      id: `seg${(segments.length + 1).toString().padStart(2, "0")}`,
      section_no: 1,
      section: "Lý thuyết",
      topic_no: segments.length + 1,
      topic: "Chủ đề mới",
      slug: "chu-de-moi",
      start_id: "S0000",
      end_id: "S0000",
      start: newStart,
      end: newEnd,
      parts: [
        {
          part: 1,
          start: newStart,
          end: newEnd,
          file: `01_LyThuyet/${(segments.length + 1).toString().padStart(2, "0")}_chu-de-moi.mp4`,
        },
      ],
    };

    onUpdateSegments([...segments, newSegment]);
  };

  function capitalizeFirstLetter(string: string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden mb-8 text-slate-800">
      {/* Table Header Controls */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>Bảng Duyệt &amp; Hiệu Chỉnh Phân Đoạn</span>
            <span className="text-xs font-normal text-slate-500">
              ({segments.length} chủ đề)
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cho phép sửa tên phần, tên chủ đề, mốc thời gian, gộp đoạn liền kề và tự động tính số phần con cần tách.
          </p>
        </div>

        <button
          onClick={handleAddNewSegment}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Thêm phân đoạn</span>
        </button>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-100/70 text-xs text-slate-600 uppercase tracking-wider border-b border-slate-200 font-semibold">
            <tr>
              <th className="py-3 px-3 w-10 text-center">#</th>
              <th className="py-3 px-3 min-w-[150px]">Phần (Section)</th>
              <th className="py-3 px-3 min-w-[200px]">Chủ đề (Topic)</th>
              <th className="py-3 px-3 w-28">Bắt đầu</th>
              <th className="py-3 px-3 w-28">Kết thúc</th>
              <th className="py-3 px-3 w-24 text-center">Độ dài</th>
              <th className="py-3 px-3 w-36 text-center">Số phần tách</th>
              <th className="py-3 px-3 w-36 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {segments.map((seg, idx) => {
              const duration = Math.max(0, seg.end - seg.start);
              const isOverLimit = duration > 420 * 1.1; // 462s
              const isUnderLimit = duration < 30; // 30s
              const isExpanded = expandedRows[seg.id];
              const isActive = activeSegmentId === seg.id;

              return (
                <React.Fragment key={seg.id || idx}>
                  <tr
                    className={`hover:bg-slate-50 transition-colors ${
                      isActive ? "bg-indigo-50/60" : ""
                    }`}
                  >
                    {/* Expand/Index */}
                    <td className="py-3 px-3 text-center font-mono text-xs text-slate-500">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => toggleExpand(seg.id)}
                          className="p-1 hover:text-slate-900 text-slate-400 transition"
                          title="Xem chi tiết các video con (parts)"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <span>{idx + 1}</span>
                      </div>
                    </td>

                    {/* Section Selector / Input */}
                    <td className="py-3 px-3">
                      <select
                        value={seg.section}
                        onChange={(e) =>
                          handleFieldChange(idx, "section", e.target.value)
                        }
                        className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition shadow-2xs font-medium"
                      >
                        {SECTION_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Topic Name */}
                    <td className="py-3 px-3">
                      <input
                        type="text"
                        value={seg.topic}
                        onChange={(e) =>
                          handleFieldChange(idx, "topic", e.target.value)
                        }
                        className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 transition font-medium shadow-2xs"
                      />
                      <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                        slug: {seg.slug}
                      </div>
                    </td>

                    {/* Start Time */}
                    <td className="py-3 px-3">
                      <input
                        type="text"
                        defaultValue={formatTime(seg.start)}
                        key={`start-${seg.id}-${seg.start}`}
                        onBlur={(e) =>
                          handleFieldChange(idx, "start", e.target.value)
                        }
                        placeholder="mm:ss"
                        className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500 transition text-center shadow-2xs"
                      />
                      <div className="text-[10px] text-slate-400 text-center font-mono">
                        {seg.start_id}
                      </div>
                    </td>

                    {/* End Time */}
                    <td className="py-3 px-3">
                      <input
                        type="text"
                        defaultValue={formatTime(seg.end)}
                        key={`end-${seg.id}-${seg.end}`}
                        onBlur={(e) =>
                          handleFieldChange(idx, "end", e.target.value)
                        }
                        placeholder="mm:ss"
                        className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500 transition text-center shadow-2xs"
                      />
                      <div className="text-[10px] text-slate-400 text-center font-mono">
                        {seg.end_id}
                      </div>
                    </td>

                    {/* Duration Badge */}
                    <td className="py-3 px-3 text-center">
                      <div
                        className={`inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded-md font-semibold ${
                          isOverLimit
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : isUnderLimit
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                        title={
                          isOverLimit
                            ? "Vượt 7 phút (hệ thống sẽ tự động tách thành nhiều phần)"
                            : isUnderLimit
                            ? "Ngắn hơn 30 giây (nên gộp)"
                            : "Đạt chuẩn thời lượng"
                        }
                      >
                        {formatTime(duration)}
                      </div>
                    </td>

                    {/* Parts Count Badge */}
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                          seg.parts.length > 1
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                      >
                        {seg.parts.length > 1
                          ? `Tách ${seg.parts.length} phần`
                          : "1 phần (gốc)"}
                      </span>
                    </td>

                    {/* Action Buttons */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Xem thử */}
                        <button
                          onClick={() => onPreviewSegment(seg.start, seg.id)}
                          title="Xem trước đoạn này trên video player"
                          className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>

                        {/* Gộp đoạn liền kề sau */}
                        {idx < segments.length - 1 && (
                          <button
                            onClick={() => handleMergeNext(idx)}
                            title="Gộp với đoạn kế tiếp"
                            className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                          >
                            <Combine className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Xóa */}
                        <button
                          onClick={() => handleDelete(idx)}
                          title="Xóa phân đoạn này"
                          className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Sub-parts Breakdown */}
                  {isExpanded && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={8} className="py-3 px-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs space-y-2 shadow-2xs">
                          <div className="font-semibold text-slate-700 flex items-center gap-2">
                            <Folder className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Kế hoạch xuất file video con:</span>
                          </div>
                          <div className="space-y-1.5">
                            {seg.parts.map((p) => (
                              <div
                                key={p.part}
                                className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 gap-2"
                              >
                                <div className="flex items-center gap-2 font-mono text-indigo-700 font-semibold">
                                  <FileVideo className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>{p.file}</span>
                                </div>
                                <div className="flex items-center gap-4 text-slate-600 font-mono">
                                  <span>Phần {p.part}</span>
                                  <span>
                                    {formatTime(p.start)} → {formatTime(p.end)}
                                  </span>
                                  <span className="text-emerald-700 font-semibold">
                                    ({(p.end - p.start).toFixed(1)}s)
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
