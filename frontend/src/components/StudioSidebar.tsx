"use client";

import React from "react";
import {
  Home,
  Wand2,
  FileText,
  AudioWaveform,
  Bot,
  Film,
  Subtitles,
  Settings,
  Lock,
  Crown,
  TableProperties,
} from "lucide-react";

interface StudioSidebarProps {
  activeTab: "studio" | "table";
  onTabChange: (tab: "studio" | "table") => void;
  onOpenTranscriptDrawer: () => void;
  onOpenVideoLibrary?: () => void;
}

export const StudioSidebar: React.FC<StudioSidebarProps> = ({
  activeTab,
  onTabChange,
  onOpenTranscriptDrawer,
  onOpenVideoLibrary,
}) => {
  return (
    <aside className="w-14 bg-white/70 dark:bg-black/50 backdrop-blur-md border-r border-slate-200/80 dark:border-white/10 flex flex-col items-center justify-between py-4 select-none shrink-0 z-30 transition-colors duration-200">
      {/* Top icon group */}
      <div className="flex flex-col items-center gap-2.5 w-full">
        {/* Studio View */}
        <button
          onClick={() => onTabChange("studio")}
          title="Studio Dựng Video (Giao diện chính)"
          className={`p-2.5 rounded-xl transition ${
            activeTab === "studio"
              ? "bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-700/60 shadow-2xs"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10"
          }`}
        >
          <Home className="w-5 h-5" />
        </button>

        {/* Table Review View (B9) */}
        <button
          onClick={() => onTabChange("table")}
          title="Bảng Duyệt Phân Đoạn (B9)"
          className={`p-2.5 rounded-xl transition ${
            activeTab === "table"
              ? "bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-700/60 shadow-2xs"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10"
          }`}
        >
          <TableProperties className="w-5 h-5" />
        </button>

        <div className="w-6 h-[1px] bg-slate-200/80 dark:bg-white/10 my-0.5" />

        {/* AI Magic Segment */}
        <button
          title="Tự động phân đoạn AI (B4 LLM)"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10 transition"
        >
          <Wand2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </button>

        {/* Transcript document */}
        <button
          onClick={onOpenTranscriptDrawer}
          title="Tra cứu Transcript Whisper (B2)"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10 transition relative"
        >
          <FileText className="w-5 h-5" />
          <span className="w-2 h-2 rounded-full bg-indigo-600 absolute top-1.5 right-1.5" />
        </button>

        {/* Audio Waveform */}
        <button
          title="Khoảng lặng âm thanh & Điểm cắt (B3)"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10 transition"
        >
          <AudioWaveform className="w-5 h-5" />
        </button>

        {/* Bot AI */}
        <button
          title="Trợ lý LLM Phân đoạn"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10 transition"
        >
          <Bot className="w-5 h-5" />
        </button>

        {/* Video Library Drawer */}
        <button
          onClick={onOpenVideoLibrary}
          title="Kho Video Dự Án (Đã sửa, Chưa sửa, Mới thêm)"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10 transition relative group"
        >
          <Film className="w-5 h-5 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition" />
          <span className="w-2 h-2 rounded-full bg-emerald-500 absolute top-1.5 right-1.5 ring-2 ring-white/50" />
        </button>

        {/* Subtitles */}
        <button
          title="Phụ đề & Chapters"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10 transition"
        >
          <Subtitles className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom icon group */}
      <div className="flex flex-col items-center gap-2.5 w-full">
        <button
          title="Cấu hình hệ thống"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10 transition"
        >
          <Settings className="w-5 h-5" />
        </button>

        <button
          title="Khóa dự án"
          className="p-2.5 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition"
        >
          <Lock className="w-4 h-4" />
        </button>

        {/* Pro Crown Badge */}
        <div
          title="AutoCut AI Studio Pro"
          className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-700/60 flex items-center justify-center text-amber-600 dark:text-amber-400 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/50 transition shadow-2xs"
        >
          <Crown className="w-4 h-4" />
        </div>
      </div>
    </aside>
  );
};
