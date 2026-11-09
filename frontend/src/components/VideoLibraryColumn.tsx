"use client";

import React from "react";
import { Plus } from "lucide-react";

export interface LibraryVideoCard {
  id: string;
  title: string;
  fileName: string;
  durationStr: string;
  durationSeconds: number;
  gradientBg: string; // Tailwind gradient classes
  segmentCount: number;
}

interface VideoLibraryColumnProps {
  currentVideoName: string;
  videos: LibraryVideoCard[];
  onSelectVideo: (video: LibraryVideoCard) => void;
  onOpenAddVideo: () => void;
}

export const VideoLibraryColumn: React.FC<VideoLibraryColumnProps> = ({
  currentVideoName,
  videos,
  onSelectVideo,
  onOpenAddVideo,
}) => {
  return (
    <aside className="w-60 lg:w-64 bg-white border-r border-slate-200/90 flex flex-col shrink-0 select-none z-10 text-slate-800 shadow-[1px_0_3px_rgba(0,0,0,0.02)]">
      {/* Column Header: Thư viện video */}
      <div className="h-12 border-b border-slate-200/90 px-4 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-normal">🗂</span>
          <span className="font-bold text-sm text-slate-900 tracking-tight">
            Thư viện video
          </span>
        </div>
      </div>

      {/* Video Cards List */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-slate-50/40 min-h-0">
        {videos.map((item) => {
          const isActive =
            item.fileName.toLowerCase() === currentVideoName.toLowerCase() ||
            item.title.toLowerCase() === currentVideoName.toLowerCase();

          return (
            <div
              key={item.id}
              onClick={() => onSelectVideo(item)}
              className={`p-2.5 rounded-2xl cursor-pointer transition-all duration-150 flex flex-col gap-2 ${
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
                <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-xs text-slate-700 font-mono text-[10px] font-bold px-2 py-0.5 rounded-md shadow-2xs border border-white/60">
                  {item.durationStr}
                </div>
              </div>

              {/* Title below thumbnail */}
              <div className="px-0.5">
                <h4
                  className={`text-xs font-semibold leading-snug line-clamp-2 ${
                    isActive ? "text-indigo-950 font-bold" : "text-slate-700"
                  }`}
                >
                  {item.title}
                </h4>
              </div>
            </div>
          );
        })}

        {/* Nút "+ Thêm video" nét đứt ở đáy */}
        <button
          onClick={onOpenAddVideo}
          className="w-full py-3 px-3 rounded-2xl border border-dashed border-slate-300 hover:border-indigo-400 bg-white hover:bg-indigo-50/50 text-slate-600 hover:text-indigo-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition duration-150 mt-1 cursor-pointer"
        >
          <Plus className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
          <span>+ Thêm video</span>
        </button>
      </div>
    </aside>
  );
};
