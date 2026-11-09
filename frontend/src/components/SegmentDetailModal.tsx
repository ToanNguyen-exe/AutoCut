"use client";

import React from "react";
import { Segment, Sentence } from "@/types";
import { formatTime } from "@/lib/utils";
import {
  X,
  Play,
  Clock,
  Sparkles,
  FileText,
  Volume2,
} from "lucide-react";

interface SegmentDetailModalProps {
  isOpen: boolean;
  segment: Segment | null;
  segmentIndex: number; // 1-based index (e.g. 1, 2, 3...)
  videoTitle: string;
  sentences: Sentence[];
  currentTime: number;
  onClose: () => void;
  onSeek: (seconds: number) => void;
  onPlay: () => void;
}

export const SegmentDetailModal: React.FC<SegmentDetailModalProps> = ({
  isOpen,
  segment,
  segmentIndex,
  videoTitle,
  sentences,
  currentTime,
  onClose,
  onSeek,
  onPlay,
}) => {
  if (!isOpen || !segment) return null;

  const duration = Math.max(0, segment.end - segment.start);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-800 max-h-[85vh] animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              #{segmentIndex}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Phân đoạn #{segmentIndex}
                </span>
                <span className="text-xs text-slate-400 font-mono">•</span>
                <span className="text-xs font-mono font-medium text-slate-500">
                  {formatTime(segment.start)} ➔ {formatTime(segment.end)} ({formatTime(duration)})
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-0.5 truncate max-w-md sm:max-w-lg">
                {segment.topic}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title="Đóng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* AI Analysis Summary Banner */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-50/80 to-blue-50/80 border border-indigo-100 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-indigo-600 text-white shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="space-y-1 text-xs">
              <div className="font-bold text-indigo-950 flex items-center gap-1.5">
                <span>Nội dung phân tích bởi AI</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ✓ Tự động nhận diện
                </span>
              </div>
              <p className="text-slate-600 leading-relaxed font-medium">
                Video thuộc dự án <strong>{videoTitle}</strong>. Phân đoạn này kéo dài{" "}
                <strong>{formatTime(duration)}</strong> ({duration.toFixed(1)}s), gồm{" "}
                <strong>{sentences.length} câu thoại/nội dung chi tiết</strong> đã được bóc băng chính xác.
              </p>
            </div>
          </div>

          {/* Sub-sentences / Detailed Sentences List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
              <div className="flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>Toàn bộ nội dung nhỏ trong phân đoạn ({sentences.length} câu)</span>
              </div>
              <span className="text-[11px] text-slate-400 font-normal italic">
                (Click vào câu để tua và nghe phát ngay)
              </span>
            </div>

            {sentences.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                Chưa có câu thoại nhỏ nào trong khoảng thời gian này.
              </div>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {sentences.map((sent, sIdx) => {
                  const isActive = currentTime >= sent.start && currentTime <= sent.end;
                  const sentDur = Math.max(0.1, sent.end - sent.start);

                  return (
                    <div
                      key={sent.id || `sent-${sIdx}`}
                      onClick={() => {
                        onSeek(sent.start);
                        onPlay();
                      }}
                      className={`group p-3 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        isActive
                          ? "bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200/60 shadow-xs"
                          : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 shadow-2xs"
                      }`}
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                            {sent.id}
                          </span>
                          <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-slate-400" />
                            <span>{formatTime(sent.start)}</span>
                            <span className="text-slate-400">➔</span>
                            <span>{formatTime(sent.end)}</span>
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {sentDur.toFixed(1)}s
                          </span>

                          {isActive && (
                            <span className="text-[10px] font-bold text-indigo-700 flex items-center gap-1 bg-indigo-100 border border-indigo-200 px-1.5 py-0.2 rounded-full animate-pulse ml-auto">
                              <Volume2 className="w-3 h-3 text-indigo-600" />
                              <span>Đang phát</span>
                            </span>
                          )}
                        </div>

                        <p
                          className={`text-xs leading-relaxed ${
                            isActive ? "text-indigo-950 font-semibold" : "text-slate-700 font-normal"
                          }`}
                        >
                          {sent.text}
                        </p>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(sent.start);
                          onPlay();
                        }}
                        className="p-2 rounded-lg bg-slate-100 group-hover:bg-indigo-600 text-slate-500 group-hover:text-white transition shrink-0 mt-0.5"
                        title="Phát câu này"
                      >
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 font-medium">
            Mục #{segment.topic_no} • {segment.section}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 transition"
            >
              Đóng
            </button>
            <button
              onClick={() => {
                onSeek(segment.start);
                onPlay();
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition flex items-center gap-1.5 hover:scale-102 active:scale-98"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Phát phân đoạn này</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
