"use client";

import React from "react";
import { SegmentsData } from "@/types";
import { formatTime } from "@/lib/utils";
import { Film, Clock, BookOpen, Layers, CheckCircle2, AlertCircle } from "lucide-react";

interface StatsCardsProps {
  data: SegmentsData;
  onToggleReviewed: () => void;
}

export const StatsCards: React.FC<StatsCardsProps> = ({ data, onToggleReviewed }) => {
  const totalDuration = data.segments.reduce((max, s) => Math.max(max, s.end), 0);
  const totalParts = data.segments.reduce((acc, s) => acc + s.parts.length, 0);
  const longSegmentsCount = data.segments.filter((s) => s.parts.length > 1).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 my-6">
      {/* 1. Tên bài & Video */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-medium">Bài học & Video gốc</span>
          <Film className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="text-base font-semibold text-white truncate" title={data.video}>
          {data.lesson || data.video}
        </div>
        <div className="text-xs text-slate-400 truncate mt-1">{data.video}</div>
      </div>

      {/* 2. Tổng thời lượng */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-medium">Tổng thời lượng</span>
          <Clock className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="text-2xl font-bold text-white tracking-tight">
          {formatTime(totalDuration)}
        </div>
        <div className="text-xs text-slate-400 mt-1">
          {totalDuration.toFixed(1)} giây
        </div>
      </div>

      {/* 3. Số lượng chủ đề */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-medium">Chủ đề phân đoạn</span>
          <BookOpen className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="text-2xl font-bold text-white tracking-tight">
          {data.segments.length}
        </div>
        <div className="text-xs text-slate-400 mt-1">
          {data.segments.length > 0 ? "2 cấp: Phần → Chủ đề" : "Chưa có chủ đề"}
        </div>
      </div>

      {/* 4. Tổng file xuất bản */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-medium">Video con xuất bản</span>
          <Layers className="w-4 h-4 text-purple-400" />
        </div>
        <div className="text-2xl font-bold text-purple-300 tracking-tight">
          {totalParts}{" "}
          <span className="text-xs font-normal text-slate-400">files</span>
        </div>
        <div className="text-xs text-slate-400 mt-1">
          {longSegmentsCount > 0 ? (
            <span className="text-amber-400">
              {longSegmentsCount} đoạn đã tách &gt; 7 phút
            </span>
          ) : (
            <span>Tất cả ≤ 7 phút</span>
          )}
        </div>
      </div>

      {/* 5. Trạng thái duyệt */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4 shadow-sm backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-xs font-medium">Trạng thái duyệt</span>
          {data.reviewed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-400" />
          )}
        </div>
        <div>
          <button
            onClick={onToggleReviewed}
            className={`w-full py-1.5 px-3 rounded-lg text-xs font-semibold transition border flex items-center justify-center gap-1.5 ${
              data.reviewed
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
            }`}
          >
            {data.reviewed ? "✓ Đã duyệt (Reviewed)" : "⚠ Chờ duyệt (Click đổi)"}
          </button>
        </div>
        <div className="text-[11px] text-slate-500 text-center mt-1">
          Bắt buộc duyệt trước khi Render
        </div>
      </div>
    </div>
  );
};
