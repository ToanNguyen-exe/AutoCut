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
      <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between text-slate-600 mb-2 font-semibold">
          <span className="text-xs">Bài học & Video gốc</span>
          <Film className="w-4 h-4 text-indigo-700" />
        </div>
        <div className="text-base font-bold text-slate-900 truncate" title={data.lesson || data.video}>
          {data.lesson || data.video}
        </div>
        <div className="text-xs text-slate-500 truncate mt-1">{data.video}</div>
      </div>

      {/* 2. Tổng thời lượng */}
      <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between text-slate-600 mb-2 font-semibold">
          <span className="text-xs">Tổng thời lượng</span>
          <Clock className="w-4 h-4 text-indigo-700" />
        </div>
        <div className="text-2xl font-bold text-slate-900 tracking-tight">
          {formatTime(totalDuration)}
        </div>
        <div className="text-xs text-slate-600 mt-1 font-mono font-semibold">
          {totalDuration.toFixed(1)} giây
        </div>
      </div>

      {/* 3. Số lượng chủ đề */}
      <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between text-slate-600 mb-2 font-semibold">
          <span className="text-xs">Chủ đề phân đoạn</span>
          <BookOpen className="w-4 h-4 text-emerald-700" />
        </div>
        <div className="text-2xl font-bold text-slate-900 tracking-tight">
          {data.segments.length}
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {data.segments.length > 0 ? "2 cấp: Phần → Chủ đề" : "Chưa có chủ đề"}
        </div>
      </div>

      {/* 4. Tổng file xuất bản */}
      <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between text-slate-600 mb-2 font-semibold">
          <span className="text-xs">Video con xuất bản</span>
          <Layers className="w-4 h-4 text-indigo-700" />
        </div>
        <div className="text-2xl font-bold text-indigo-800 tracking-tight">
          {totalParts}{" "}
          <span className="text-xs font-normal text-slate-500">files</span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {longSegmentsCount > 0 ? (
            <span className="text-amber-800 font-bold">
              {longSegmentsCount} đoạn đã tách &gt; 7 phút
            </span>
          ) : (
            <span>Tất cả ≤ 7 phút</span>
          )}
        </div>
      </div>

      {/* 5. Trạng thái duyệt */}
      <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-600 mb-1 font-semibold">
          <span className="text-xs">Trạng thái duyệt</span>
          {data.reviewed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-600" />
          )}
        </div>
        <div>
          <button
            onClick={onToggleReviewed}
            className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition border flex items-center justify-center gap-1.5 ${
              data.reviewed
                ? "bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200"
                : "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200"
            }`}
          >
            {data.reviewed ? "✓ Đã duyệt (Reviewed)" : "⚠ Chờ duyệt (Click đổi)"}
          </button>
        </div>
      </div>
    </div>
  );
};
