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
    <aside className="w-14 bg-[#121318] border-r border-slate-800 flex flex-col items-center justify-between py-4 select-none shrink-0 z-30">
      {/* Top icon group */}
      <div className="flex flex-col items-center gap-4 w-full">
        {/* Studio View */}
        <button
          onClick={() => onTabChange("studio")}
          title="Studio Dựng Video (Giao diện chính)"
          className={`p-2.5 rounded-xl transition ${
            activeTab === "studio"
              ? "bg-purple-600/20 text-purple-400 border border-purple-500/30"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
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
              ? "bg-purple-600/20 text-purple-400 border border-purple-500/30"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
        >
          <TableProperties className="w-5 h-5" />
        </button>

        <div className="w-6 h-[1px] bg-slate-800 my-1" />

        {/* AI Magic Segment */}
        <button
          title="Tự động phân đoạn AI (B4 LLM)"
          className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <Wand2 className="w-5 h-5 text-indigo-400" />
        </button>

        {/* Transcript document */}
        <button
          onClick={onOpenTranscriptDrawer}
          title="Tra cứu Transcript Whisper (B2)"
          className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition relative"
        >
          <FileText className="w-5 h-5" />
          <span className="w-2 h-2 rounded-full bg-purple-500 absolute top-1.5 right-1.5" />
        </button>

        {/* Audio Waveform */}
        <button
          title="Khoảng lặng âm thanh & Điểm cắt (B3)"
          className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <AudioWaveform className="w-5 h-5" />
        </button>

        {/* Bot AI */}
        <button
          title="Trợ lý LLM Phân đoạn"
          className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <Bot className="w-5 h-5" />
        </button>

        {/* Video Library Drawer */}
        <button
          onClick={onOpenVideoLibrary}
          title="Kho Video Dự Án (Đã sửa, Chưa sửa, Mới thêm)"
          className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition relative group"
        >
          <Film className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition" />
          <span className="w-2 h-2 rounded-full bg-emerald-400 absolute top-1.5 right-1.5 ring-2 ring-[#121318]" />
        </button>

        {/* Subtitles */}
        <button
          title="Phụ đề & Chapters"
          className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <Subtitles className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom icon group */}
      <div className="flex flex-col items-center gap-4 w-full">
        <button
          title="Cấu hình hệ thống"
          className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <Settings className="w-5 h-5" />
        </button>

        <button
          title="Khóa dự án"
          className="p-2.5 rounded-xl text-slate-500 hover:text-slate-300 transition"
        >
          <Lock className="w-4 h-4" />
        </button>

        {/* Pro Crown Badge */}
        <div
          title="AutoCut AI Studio Pro"
          className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 cursor-pointer hover:bg-amber-500/20 transition"
        >
          <Crown className="w-4 h-4" />
        </div>
      </div>
    </aside>
  );
};
