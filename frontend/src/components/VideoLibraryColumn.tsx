"use client";

import React, { useState } from "react";
import { Sparkles, Film, ListPlus, Play } from "lucide-react";
import { Segment, TranscriptData } from "@/types";
import { formatTime } from "@/lib/utils";

export interface LibraryVideoCard {
  id: string;
  title: string;
  fileName: string;
  durationStr: string;
  durationSeconds: number;
  gradientBg: string; // Tailwind gradient classes
  segmentCount: number;
  url?: string;
  segmentIndex?: number;
  segmentData?: Segment;
  segments?: Segment[];
  transcript?: TranscriptData;
}

interface VideoLibraryColumnProps {
  currentVideoName: string;
  videos: LibraryVideoCard[];
  currentSegments?: Segment[];
  activeSegmentId?: string;
  onSelectVideo: (video: LibraryVideoCard) => void;
  onAppendVideo?: (video: LibraryVideoCard) => void;
  onSelectSegment?: (segment: Segment, index: number) => void;
  onOpenAddVideo?: () => void;
}

export const PASTEL_GRADIENTS = [
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
  onAppendVideo,
  onSelectSegment,
}) => {
  // Tab chuyển đổi: "Phân đoạn AI" (nếu có các đoạn đã phân tích) hoặc "Thư viện video"
  const hasSegments = currentSegments && currentSegments.length > 0;
  const [viewMode, setViewMode] = useState<"segments" | "library">(hasSegments ? "segments" : "library");

  const handleBottomAppendClick = () => {
    if (viewMode === "segments") {
      setViewMode("library");
    } else if (videos.length > 0 && onAppendVideo) {
      // Tìm video khác video đang phát để nối tiếp
      const candidate = videos.find(
        (v) => v.fileName.toLowerCase() !== currentVideoName.toLowerCase()
      ) || videos[0];
      if (candidate) {
        onAppendVideo(candidate);
      }
    }
  };

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
          // Hiển thị danh sách các phân đoạn video mà AI đã phân tích (bao gồm cả phân đoạn nối tiếp)
          currentSegments.map((seg, idx) => {
            const isCurrent = seg.id === activeSegmentId;
            const durationSec = Math.max(0, seg.end - seg.start);
            const isAppended = Boolean(seg.isAppended || (seg.videoIndex && seg.videoIndex > 1));
            const prev = idx > 0 ? currentSegments[idx - 1] : undefined;
            const prevAppended = Boolean(prev?.isAppended || (prev?.videoIndex && prev.videoIndex > 1));
            const isFirstAppended = isAppended && !prevAppended;
            const gradientBg = isAppended
              ? "from-emerald-200 via-teal-100 to-lime-200"
              : PASTEL_GRADIENTS[idx % PASTEL_GRADIENTS.length];

            return (
              <React.Fragment key={seg.id || `seg-${idx}`}>
                {/* Ranh giới chuyển đổi sang danh sách video nối tiếp */}
                {isFirstAppended && (
                  <div className="py-2 px-3 my-2 rounded-xl bg-emerald-50 border border-dashed border-emerald-300 flex items-center justify-between text-emerald-800 text-xs font-bold shadow-2xs">
                    <div className="flex items-center gap-1.5">
                      <ListPlus className="w-4 h-4 text-emerald-600" />
                      <span>Video Nối Tiếp Vào Sau</span>
                    </div>
                    <span className="text-[10px] bg-emerald-200/90 text-emerald-900 px-2 py-0.5 rounded-full font-bold">
                      Nối tiếp
                    </span>
                  </div>
                )}

                <div
                  onClick={() => onSelectSegment?.(seg, idx + 1)}
                  className={`p-3 rounded-2xl cursor-pointer transition-all duration-150 flex flex-col gap-2.5 ${
                    isCurrent
                      ? isAppended
                        ? "bg-white border-2 border-emerald-500 shadow-sm ring-2 ring-emerald-100"
                        : "bg-white border-2 border-indigo-500 shadow-sm ring-2 ring-indigo-100"
                      : isAppended
                      ? "bg-white border border-emerald-200 hover:border-emerald-300 shadow-2xs hover:shadow-xs"
                      : "bg-white border border-slate-200/90 hover:border-slate-300 shadow-2xs hover:shadow-xs"
                  }`}
                >
                  {/* Pastel Gradient Thumbnail matching reference image */}
                  <div
                    className={`w-full h-24 rounded-xl relative overflow-hidden bg-gradient-to-tr ${gradientBg} flex items-center justify-center border border-black/5`}
                  >
                    {/* Badge số phân đoạn ở góc trái */}
                    <div className={`absolute top-2 left-2 text-white text-xs font-bold px-2 py-0.5 rounded-lg shadow-2xs ${
                      isAppended ? "bg-emerald-800/80" : "bg-black/50"
                    }`}>
                      #{idx + 1} {isAppended ? "• Nối tiếp" : ""}
                    </div>

                    {/* Duration chip on top-right */}
                    <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-xs text-slate-800 font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg shadow-2xs border border-white/60">
                      {formatTime(durationSec)}
                    </div>
                  </div>

                  {/* Title below thumbnail */}
                  <div className="px-0.5">
                    <div className={`text-xs font-bold mb-0.5 ${isAppended ? "text-emerald-700" : "text-indigo-600"}`}>
                      {isAppended ? "[Nối tiếp] " : ""}Mục #{seg.topic_no || idx + 1}
                    </div>
                    <h4
                      className={`text-sm font-bold leading-snug line-clamp-2 ${
                        isCurrent
                          ? isAppended ? "text-emerald-950" : "text-indigo-950"
                          : "text-slate-800"
                      }`}
                    >
                      {seg.topic}
                    </h4>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        ) : (
          // Hiển thị danh sách các video trong thư viện gốc
          videos.map((item) => {
            const isActive =
              item.fileName.toLowerCase() === currentVideoName.toLowerCase() ||
              item.title.toLowerCase() === currentVideoName.toLowerCase() ||
              currentVideoName.toLowerCase().includes(item.title.toLowerCase());

            return (
              <div
                key={item.id}
                className={`p-3 rounded-2xl transition-all duration-150 flex flex-col gap-2.5 bg-white border ${
                  isActive
                    ? "border-2 border-indigo-500 shadow-sm ring-2 ring-indigo-100"
                    : "border-slate-200/90 hover:border-slate-300 shadow-2xs hover:shadow-xs"
                }`}
              >
                {/* Pastel Gradient Thumbnail */}
                <div
                  onClick={() => onSelectVideo(item)}
                  className={`w-full h-24 rounded-xl relative overflow-hidden bg-gradient-to-tr ${item.gradientBg} flex items-center justify-center border border-black/5 cursor-pointer group`}
                  title="Nhấp để mở riêng bài này"
                >
                  {/* Duration chip on top-right */}
                  <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-xs text-slate-800 font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg shadow-2xs border border-white/60">
                    {item.durationStr}
                  </div>

                  {/* Play icon overlay on hover */}
                  <div className="w-9 h-9 rounded-full bg-white/90 text-indigo-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </div>
                </div>

                {/* Title below thumbnail */}
                <div className="px-0.5">
                  <h4
                    onClick={() => onSelectVideo(item)}
                    className={`text-sm font-bold leading-snug line-clamp-2 cursor-pointer hover:text-indigo-600 transition-colors ${
                      isActive ? "text-indigo-950" : "text-slate-800"
                    }`}
                    title={item.title}
                  >
                    {item.title}
                  </h4>
                </div>

                {/* Nút hành động: Nối tiếp ra đằng sau video đang phát */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onAppendVideo) {
                        onAppendVideo(item);
                      }
                    }}
                    className="flex-1 py-1.5 px-2 rounded-xl bg-indigo-50 hover:bg-indigo-100/90 text-indigo-700 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer border border-indigo-200/70 shadow-2xs"
                    title={`Nối tiếp "${item.title}" ra đằng sau video đang phát trên Timeline`}
                  >
                    <ListPlus className="w-3.5 h-3.5 text-indigo-600" />
                    <span>+ Nối tiếp ra sau</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectVideo(item);
                    }}
                    className="py-1.5 px-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-medium transition cursor-pointer border border-slate-200"
                    title="Mở riêng video này trong Studio"
                  >
                    Mở riêng
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Nút "+ Nối tiếp video từ thư viện" ở đáy:
            Tuân thủ yêu cầu: Nút thêm từ bên ngoài chỉ để ở trên Header,
            còn nút trong thư viện này dùng để nối tiếp video ra đằng sau video đang phát. */}
        <button
          onClick={handleBottomAppendClick}
          className="w-full py-3 px-3 rounded-2xl border border-dashed border-indigo-300 hover:border-indigo-500 bg-white hover:bg-indigo-50/60 text-indigo-700 text-xs font-bold flex items-center justify-center gap-2 transition duration-150 mt-1 cursor-pointer shadow-2xs"
          title="Chọn video trong thư viện để nối tiếp vào sau video đang phát"
        >
          <ListPlus className="w-4 h-4 text-indigo-600" />
          <span>+ Nối tiếp video từ thư viện</span>
        </button>
      </div>
    </aside>
  );
};
