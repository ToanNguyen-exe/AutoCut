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
  PlusCircle,
  Play,
  Sparkles,
  Layers,
  FileVideo,
} from "lucide-react";

interface VideoLibraryDrawerProps {
  isOpen: boolean;
  activeVideoName?: string;
  videos: VideoLibraryItem[];
  onClose: () => void;
  onSelectVideo: (video: VideoLibraryItem) => void;
  onOpenAddVideo: () => void;
}

export const VideoLibraryDrawer: React.FC<VideoLibraryDrawerProps> = ({
  isOpen,
  activeVideoName,
  videos,
  onClose,
  onSelectVideo,
  onOpenAddVideo,
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
    <div className="fixed inset-0 z-50 flex justify-start bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-[#121318] border-r border-slate-800 h-full flex flex-col shadow-2xl z-50 animate-in slide-in-from-left duration-200">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Thư Viện Video Dự Án
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                  {videos.length} video
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Chọn video để nạp và phát trực tiếp vào Studio
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Add Video Bar */}
        <div className="p-3 bg-purple-950/20 border-b border-slate-800/80 flex items-center justify-between shrink-0">
          <span className="text-xs text-purple-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Thêm video ngoài từ URL hoặc máy</span>
          </span>
          <button
            onClick={() => {
              onClose();
              onOpenAddVideo();
            }}
            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white shadow-sm transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>+ Thêm mới</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-800/80 bg-[#16171d]/60 shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên bài giảng, môn học..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setFilter("all")}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg whitespace-nowrap transition ${
                filter === "all"
                  ? "bg-purple-600 text-white"
                  : "bg-slate-800/70 text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              Tất cả ({videos.length})
            </button>
            <button
              onClick={() => setFilter("edited")}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "edited"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800/70 text-emerald-400/80 hover:text-emerald-300 hover:bg-slate-800"
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Đã sửa ({editedCount})</span>
            </button>
            <button
              onClick={() => setFilter("pending")}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "pending"
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800/70 text-amber-400/80 hover:text-amber-300 hover:bg-slate-800"
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>Chưa sửa ({pendingCount})</span>
            </button>
            <button
              onClick={() => setFilter("added")}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "added"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-800/70 text-indigo-400/80 hover:text-indigo-300 hover:bg-slate-800"
              }`}
            >
              <FileVideo className="w-3 h-3" />
              <span>Đã thêm ({addedCount})</span>
            </button>
          </div>
        </div>

        {/* Video Cards List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {filteredVideos.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Film className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Không tìm thấy video nào phù hợp</p>
            </div>
          ) : (
            filteredVideos.map((video) => {
              const isActive = activeVideoName === video.name;

              return (
                <div
                  key={video.id}
                  onClick={() => onSelectVideo(video)}
                  className={`p-3 rounded-2xl border transition cursor-pointer relative group ${
                    isActive
                      ? "bg-purple-950/30 border-purple-500/60 shadow-lg shadow-purple-950/40"
                      : "bg-[#16171d]/80 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60"
                  }`}
                >
                  {/* Status & Category Badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 truncate max-w-[170px]">
                      {video.category}
                    </span>

                    {video.status === "edited" && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Đã chỉnh sửa</span>
                      </span>
                    )}

                    {video.status === "pending" && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>Chưa sửa</span>
                      </span>
                    )}

                    {video.status === "added" && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center gap-1">
                        <PlusCircle className="w-3 h-3" />
                        <span>Video đã thêm</span>
                      </span>
                    )}
                  </div>

                  {/* Title & Filename */}
                  <div className="flex items-start gap-3">
                    {/* Thumbnail / Video Icon Box */}
                    <div className="w-16 h-12 rounded-xl bg-slate-900 border border-slate-800 shrink-0 relative flex items-center justify-center overflow-hidden group-hover:border-purple-500/40 transition">
                      <Play className="w-4 h-4 text-slate-500 group-hover:text-purple-400 group-hover:scale-125 transition" />
                      <span className="absolute bottom-0.5 right-1 text-[9px] font-mono text-slate-300 font-bold bg-black/70 px-1 rounded">
                        {formatTime(video.duration)}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-white group-hover:text-purple-300 transition truncate">
                        {video.title}
                      </h4>
                      <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                        {video.name}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3 text-purple-400" />
                          <span>{video.segments?.length || video.segmentsCount} phân đoạn</span>
                        </span>
                        <span>•</span>
                        <span>Cập nhật: {video.updatedAt}</span>
                      </div>
                    </div>
                  </div>

                  {/* Active Indicator */}
                  {isActive && (
                    <div className="mt-2.5 pt-2 border-t border-purple-500/20 flex items-center justify-between text-[11px] text-purple-300">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        Đang phát trong Studio
                      </span>
                      <span className="text-[10px] font-mono text-purple-400">Đang hoạt động</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
