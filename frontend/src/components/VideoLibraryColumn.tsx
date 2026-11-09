"use client";

import React, { useState } from "react";
import { Plus, Sparkles, Film } from "lucide-react";
import { Segment } from "@/types";
import { formatTime } from "@/lib/utils";

export interface LibraryVideoCard {
  id: string;
  title: string;
  fileName: string;
  durationStr: string;
  durationSeconds: number;
  gradientBg: string; // Tailwind gradient classes
  segmentCount: number;
  segmentIndex?: number;
  segmentData?: Segment;
}

interface VideoLibraryColumnProps {
  currentVideoName: string;
  videos: LibraryVideoCard[];
  currentSegments?: Segment[];
  activeSegmentId?: string;
  onSelectVideo: (video: LibraryVideoCard) => void;
  onSelectSegment?: (segment: Segment, index: number) => void;
  onOpenAddVideo: () => void;
}

const PASTEL_GRADIENTS = [
  "from-emerald-200 via-teal-100 to-lime-200",
  "from-amber-200 via-orange-100 to-yellow-200",
  "from-rose-200 via-pink-100 to-purple-200",
  "from-blue-200 via-indigo-100 to-cyan-200",
  "from-violet-200 via-purple-100 to-fuchsia-200",
  "from-teal-200 via-emerald-100 to-green-200",
];

export const VideoLibraryColumn: React.FC<VideoLibraryColumnProps> = ({
  currentVideoName,
  videos,
  currentSegments = [],
  activeSegmentId,
  onSelectVideo,
  onSelectSegment,
  onOpenAddVideo,
}) => {
  // Tab chuyển đổi: "Phân đoạn AI" (nếu có các đoạn đã phân tích) hoặc "Thư viện video"
  const hasSegments = currentSegments && currentSegments.length > 0;
  const [viewMode, setViewMode] = useState<"segments" | "library">(hasSegments ? "segments" : "library");

  return (
    <aside className="w-64 lg:w-72 bg-white border-r border-slate-200/90 flex flex-col shrink-0 select-none z-10 text-slate-800 shadow-[1px_0_3px_rgba(0,0,0,0.02)]">
      {/* Column Header: Thư viện video */}
      <div className="h-12 border-b border-slate-200/90 px-4 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">📁</span>
          <span className="font-bold text-base text-slate-900 tracking-tight">
            Thư viện video
          </span>
        </div>
      </div>

      {/* Sub Tabs: Phân đoạn AI (video nhỏ đã cắt) & Thư viện gốc */}
      {hasSegments && (
        <div className="px-3 pt-2.5 pb-1 bg-slate-50/70 border-b border-slate-200/80 flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setViewMode("segments")}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              viewMode === "segments"
                ? "bg-white text-indigo-700 shadow-2xs border border-indigo-200/80"
                : "text-slate-500 hover:text-slate-800 hover:bg-white/60"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Phân đoạn AI ({currentSegments.length})</span>
          </button>

          <button
            onClick={() => setViewMode("library")}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              viewMode === "library"
                ? "bg-white text-indigo-700 shadow-2xs border border-indigo-200/80"
                : "text-slate-500 hover:text-slate-800 hover:bg-white/60"
            }`}
          >
            <Film className="w-3.5 h-3.5 text-slate-400" />
            <span>Thư viện ({videos.length})</span>
          </button>
        </div>
      )}

      {/* Video Cards List */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3.5 bg-slate-50/40 min-h-0">
        {viewMode === "segments" && hasSegments ? (
          // Hiển thị danh sách các phân đoạn video mà AI đã phân tích
          currentSegments.map((seg, idx) => {
            const isCurrent = seg.id === activeSegmentId;
            const durationSec = Math.max(0, seg.end - seg.start);
            const gradientBg = PASTEL_GRADIENTS[idx % PASTEL_GRADIENTS.length];

            return (
              <div
                key={seg.id || `seg-${idx}`}
                onClick={() => onSelectSegment?.(seg, idx + 1)}
                className={`p-3 rounded-2xl cursor-pointer transition-all duration-150 flex flex-col gap-2.5 ${
                  isCurrent
                    ? "bg-white border-2 border-indigo-500 shadow-sm ring-2 ring-indigo-100"
                    : "bg-white border border-slate-200/90 hover:border-slate-300 shadow-2xs hover:shadow-xs"
                }`}
              >
                {/* Pastel Gradient Thumbnail matching reference image */}
                <div
                  className={`w-full h-24 rounded-xl relative overflow-hidden bg-gradient-to-tr ${gradientBg} flex items-center justify-center border border-black/5`}
                >
                  {/* Badge số phân đoạn ở góc trái */}
                  <div className="absolute top-2 left-2 bg-black/50 backdrop-blur-xs text-white text-xs font-bold px-2 py-0.5 rounded-lg shadow-2xs">
                    #{idx + 1}
                  </div>

                  {/* Duration chip on top-right */}
                  <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-xs text-slate-800 font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg shadow-2xs border border-white/60">
                    {formatTime(durationSec)}
                  </div>
                </div>

                {/* Title below thumbnail */}
                <div className="px-0.5">
                  <div className="text-xs font-bold text-indigo-600 mb-0.5">
                    Mục #{seg.topic_no || idx + 1}
                  </div>
                  <h4
                    className={`text-sm font-bold leading-snug line-clamp-2 ${
                      isCurrent ? "text-indigo-950" : "text-slate-800"
                    }`}
                  >
                    {seg.topic}
                  </h4>
                </div>
              </div>
            );
          })
        ) : (
          // Hiển thị danh sách các video trong thư viện gốc
          videos.map((item) => {
            const isActive =
              item.fileName.toLowerCase() === currentVideoName.toLowerCase() ||
              item.title.toLowerCase() === currentVideoName.toLowerCase();

            return (
              <div
                key={item.id}
                onClick={() => onSelectVideo(item)}
                className={`p-3 rounded-2xl cursor-pointer transition-all duration-150 flex flex-col gap-2.5 ${
                  isActive
                    ? "bg-white border-2 border-indigo-500 shadow-sm ring-2 ring-indigo-100"
                    : "bg-white border border-slate-200/90 hover:border-slate-300 shadow-2xs hover:shadow-xs"
                }`}
              >
                {/* Pastel Gradient Thumbnail */}
                <div
                  className={`w-full h-24 rounded-xl relative overflow-hidden bg-gradient-to-tr ${item.gradientBg} flex items-center justify-center border border-black/5`}
                >
                  {/* Duration chip on top-right */}
                  <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-xs text-slate-800 font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg shadow-2xs border border-white/60">
                    {item.durationStr}
                  </div>
                </div>

                {/* Title below thumbnail */}
                <div className="px-0.5">
                  <h4
                    className={`text-sm font-bold leading-snug line-clamp-2 ${
                      isActive ? "text-indigo-950" : "text-slate-800"
                    }`}
                  >
                    {item.title}
                  </h4>
                </div>
              </div>
            );
          })
        )}

        {/* Nút "+ Thêm video" nét đứt ở đáy */}
        <button
          onClick={onOpenAddVideo}
          className="w-full py-3.5 px-3 rounded-2xl border border-dashed border-slate-300 hover:border-indigo-400 bg-white hover:bg-indigo-50/50 text-slate-700 hover:text-indigo-700 text-sm font-bold flex items-center justify-center gap-2 transition duration-150 mt-1 cursor-pointer shadow-2xs"
        >
          <Plus className="w-4 h-4 text-slate-500 group-hover:text-indigo-600" />
          <span>+ Thêm video</span>
        </button>
      </div>
    </aside>
  );
};
