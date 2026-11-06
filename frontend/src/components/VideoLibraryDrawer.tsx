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
    <div className="fixed inset-0 z-50 flex justify-start bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-slate-100 border-r border-slate-300 h-full flex flex-col shadow-2xl z-50 animate-in slide-in-from-left duration-200 text-slate-800">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-300 flex items-center justify-between bg-slate-200/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 border border-indigo-300 flex items-center justify-center text-indigo-700 shadow-2xs">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Thư Viện Video Dự Án
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 border border-slate-300 font-bold">
                  {videos.length} video
                </span>
              </h3>
              <p className="text-[11px] text-slate-600 font-medium">
                Chọn video để nạp và phát trực tiếp vào Studio
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-300/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Add Video Bar */}
        <div className="p-3 bg-indigo-100/70 border-b border-indigo-200 flex items-center justify-between shrink-0">
          <span className="text-xs text-indigo-950 font-bold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-700" />
            <span>Thêm video ngoài từ URL hoặc máy</span>
          </span>
          <button
            onClick={() => {
              onClose();
              onOpenAddVideo();
            }}
            className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>+ Thêm mới</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-300 bg-slate-200/50 shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên bài giảng, môn học..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500 font-medium"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setFilter("all")}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition ${
                filter === "all"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-300 border border-slate-300"
              }`}
            >
              Tất cả ({videos.length})
            </button>
            <button
              onClick={() => setFilter("edited")}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "edited"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-slate-200 text-emerald-800 hover:bg-emerald-100 border border-slate-300"
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Đã sửa ({editedCount})</span>
            </button>
            <button
              onClick={() => setFilter("pending")}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "pending"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-slate-200 text-amber-800 hover:bg-amber-100 border border-slate-300"
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>Chưa sửa ({pendingCount})</span>
            </button>
            <button
              onClick={() => setFilter("added")}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                filter === "added"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-200 text-indigo-800 hover:bg-indigo-100 border border-slate-300"
              }`}
            >
              <FileVideo className="w-3 h-3" />
              <span>Đã thêm ({addedCount})</span>
            </button>
          </div>
        </div>

        {/* Video Cards List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-100">
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
                    <span className="truncate max-w-[150px] font-sans">
                      {video.category}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{formatTime(video.duration)}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3 text-slate-500" />
                        <span>{video.segmentsCount} đoạn</span>
                      </span>
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
