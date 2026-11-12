"use client";

import React, { useState } from "react";
import { VideoLibraryItem } from "@/types";
import { formatTime } from "@/lib/utils";
import {
  Film,
  X,
  Search,
  CheckCircle2,
  Clock,
  Play,
  Sparkles,
} from "lucide-react";

interface VideoLibraryDrawerProps {
  isOpen: boolean;
  activeVideoName?: string;
  videos: VideoLibraryItem[];
  onClose: () => void;
  onSelectVideo: (video: VideoLibraryItem) => void;
  onAppendVideo?: (video: VideoLibraryItem) => void;
  onOpenAddVideo?: () => void;
}

export const VideoLibraryDrawer: React.FC<VideoLibraryDrawerProps> = ({
  isOpen,
  activeVideoName,
  videos,
  onClose,
  onSelectVideo,
  onAppendVideo,
}) => {
  const [filter, setFilter] = useState<"all" | "edited" | "pending" | "added">("all");
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const filteredVideos = videos.filter((v) => {
    const matchesFilter = filter === "all" || v.status === filter;
    const matchesSearch =
      v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const editedCount = videos.filter((v) => v.status === "edited").length;
  const pendingCount = videos.filter((v) => v.status === "pending").length;
  const addedCount = videos.filter((v) => v.status === "added").length;

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/30 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white border-r border-slate-200/90 h-full flex flex-col shadow-2xl z-50 animate-in slide-in-from-left duration-200 text-slate-800">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200/80 flex items-center justify-center text-indigo-600 shadow-2xs">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Thư Viện Video Dự Án
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
                  {videos.length} video
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Chọn video để nạp và phát trực tiếp vào Studio
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Banner */}
        <div className="p-3 bg-indigo-50/80 border-b border-indigo-100 flex items-center justify-between shrink-0">
          <span className="text-xs text-indigo-900 font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Thư viện video (Nhấp mở riêng hoặc nối tiếp vào Timeline)</span>
          </span>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên bài giảng, môn học..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white border border-slate-200 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500 font-medium"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setFilter("all")}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap transition ${
                filter === "all"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              Tất cả ({videos.length})
            </button>
            <button
              onClick={() => setFilter("edited")}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "edited"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-white text-emerald-700 hover:bg-emerald-50 border border-slate-200"
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Đã sửa ({editedCount})</span>
            </button>
            <button
              onClick={() => setFilter("pending")}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "pending"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-white text-amber-700 hover:bg-amber-50 border border-slate-200"
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>Chưa sửa ({pendingCount})</span>
            </button>
            <button
              onClick={() => setFilter("added")}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "added"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-white text-blue-700 hover:bg-blue-50 border border-slate-200"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>Mới thêm ({addedCount})</span>
            </button>
          </div>
        </div>

        {/* Video Cards List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50">
          {filteredVideos.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Film className="w-10 h-10 mx-auto text-slate-400 mb-2" />
              <p className="text-xs font-semibold">Không tìm thấy video nào</p>
            </div>
          ) : (
            filteredVideos.map((video) => {
              const isActive = activeVideoName === video.name;

              return (
                <div
                  key={video.id}
                  onClick={() => {
                    onSelectVideo(video);
                    onClose();
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer group flex flex-col gap-2 ${
                    isActive
                      ? "bg-indigo-100/80 border-indigo-500 shadow-sm ring-1 ring-indigo-300"
                      : "bg-slate-50 border-slate-300 hover:border-indigo-400 hover:bg-slate-200/60 shadow-2xs"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-indigo-100 border border-indigo-300 flex items-center justify-center text-indigo-700 shrink-0 group-hover:scale-105 transition-transform">
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 truncate transition-colors">
                          {video.title}
                        </h4>
                        <p className="text-[10px] text-slate-500 font-mono truncate">
                          {video.name}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                        video.status === "edited"
                          ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                          : video.status === "pending"
                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                          : "bg-indigo-100 text-indigo-900 border border-indigo-300"
                      }`}
                    >
                      {video.status === "edited"
                        ? "Đã sửa"
                        : video.status === "pending"
                        ? "Chưa sửa"
                        : "Đã thêm"}
                    </span>
                  </div>

                  {/* Card bottom info */}
                  <div className="flex items-center justify-between text-[11px] text-slate-600 pt-2 border-t border-slate-200 font-semibold">
                    <span className="truncate max-w-[120px] font-sans">
                      {video.category}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{formatTime(video.duration)}</span>
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onAppendVideo) onAppendVideo(video);
                          onClose();
                        }}
                        className="px-2 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold border border-indigo-200 transition"
                        title="Nối tiếp video này ra sau video đang phát trên Timeline"
                      >
                        + Nối tiếp
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
