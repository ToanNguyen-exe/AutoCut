"use client";

import React, { useState } from "react";
import { Segment, Sentence } from "@/types";
import { formatTime } from "@/lib/utils";
import {
  X,
  Play,
  Clock,
  Sparkles,
  FileText,
  Volume2,
  Layers,
} from "lucide-react";

interface SegmentDetailModalProps {
  isOpen: boolean;
  segment: Segment | null;
  segmentIndex: number; // 1-based index (e.g. 1, 2, 3...)
  videoTitle: string;
  sentences: Sentence[];
  allSegments?: Segment[];
  currentTime: number;
  onClose: () => void;
  onSeek: (seconds: number) => void;
  onPlay: () => void;
  onSelectSegment?: (segment: Segment, index: number) => void;
}

export const SegmentDetailModal: React.FC<SegmentDetailModalProps> = ({
  isOpen,
  segment,
  segmentIndex,
  videoTitle,
  sentences = [],
  allSegments = [],
  currentTime,
  onClose,
  onSeek,
  onPlay,
  onSelectSegment,
}) => {
  const [activeTab, setActiveTab] = useState<"segment_only" | "all_sentences">("segment_only");

  if (!isOpen || !segment) return null;

  const duration = Math.max(0, segment.end - segment.start);

  // Lọc các câu thoại thuộc riêng phân đoạn này
  const segmentSentences = sentences.filter((s) => {
    // Câu nằm trong khoảng thời gian của phân đoạn
    return (s.start >= segment.start - 0.5 && s.start < segment.end) ||
           (s.end > segment.start && s.end <= segment.end + 0.5);
  });

  const displaySentences = activeTab === "segment_only" ? segmentSentences : sentences;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-800 max-h-[90vh] animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              #{segmentIndex}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Nội dung video #{segmentIndex} (Đã phân tích AI)
                </span>
                <span className="text-xs text-slate-400 font-mono">•</span>
                <span className="text-xs font-mono font-medium text-slate-500">
                  {formatTime(segment.start)} ➔ {formatTime(segment.end)} ({formatTime(duration)})
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-0.5 truncate max-w-md sm:max-w-xl">
                {segment.topic}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
            title="Đóng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 bg-white">
          {/* AI Analysis Summary Banner */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-blue-50/90 border border-indigo-100 flex items-start gap-3 shadow-2xs">
            <div className="p-2.5 rounded-xl bg-indigo-600 text-white shrink-0 mt-0.5 shadow-2xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="space-y-1 text-xs">
              <div className="font-bold text-indigo-950 flex items-center gap-2">
                <span className="text-sm">Kết quả phân tích AI</span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ✓ Phân đoạn #{segmentIndex} / {allSegments.length || 1}
                </span>
              </div>
              <p className="text-slate-600 leading-relaxed font-medium">
                Video: <strong>{videoTitle}</strong>. Phân đoạn này kéo dài{" "}
                <strong>{formatTime(duration)}</strong> ({duration.toFixed(1)}s), bóc băng được{" "}
                <strong>{segmentSentences.length} câu thoại chi tiết</strong>.
              </p>
            </div>
          </div>

          {/* Quick Segment Selector List (Toàn bộ các phân đoạn trong video) */}
          {allSegments.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>Các phân đoạn video AI đã phân tích ({allSegments.length} phân đoạn)</span>
                </div>
                <span className="text-[11px] text-slate-400 font-normal">
                  Click để xem nội dung phân đoạn tương ứng
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {allSegments.map((seg, idx) => {
                  const isCurrent = seg.id === segment.id;
                  const segDur = Math.max(0, seg.end - seg.start);
                  return (
                    <button
                      key={seg.id || idx}
                      onClick={() => onSelectSegment?.(seg, idx + 1)}
                      className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between gap-1 cursor-pointer ${
                        isCurrent
                          ? "bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 shadow-2xs"
                          : "bg-slate-50/70 hover:bg-slate-100 border-slate-200/90 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            isCurrent
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          #{idx + 1}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {formatTime(segDur)}
                        </span>
                      </div>
                      <div className="text-xs font-semibold truncate leading-tight mt-0.5">
                        {seg.topic}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab selector for Sentences: Phân đoạn hiện tại vs Toàn bộ video */}
          <div className="flex items-center justify-between border-b border-slate-200 pt-1 pb-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("segment_only")}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "segment_only"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Nội dung phân đoạn #{segmentIndex} ({segmentSentences.length} câu)</span>
              </button>

              <button
                onClick={() => setActiveTab("all_sentences")}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "all_sentences"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Toàn bộ nội dung video ({sentences.length} câu)</span>
              </button>
            </div>

            <span className="text-[11px] text-slate-400 italic hidden sm:inline">
              Click vào câu để tua và nghe ngay
            </span>
          </div>

          {/* Sentences List */}
          <div className="space-y-2">
            {displaySentences.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                Chưa có câu thoại nào trong khoảng thời gian này. Hãy bấm &quot;Phân tích AI&quot; để bóc băng!
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {displaySentences.map((sent, sIdx) => {
                  const isActive = currentTime >= sent.start && currentTime <= sent.end;
                  const isBelongToCurrent =
                    sent.start >= segment.start - 0.5 && sent.end <= segment.end + 0.5;
                  const sentDur = Math.max(0.1, sent.end - sent.start);

                  return (
                    <div
                      key={sent.id || `sent-${sIdx}`}
                      onClick={() => {
                        onSeek(sent.start);
                        onPlay();
                      }}
                      className={`group p-3 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        isActive
                          ? "bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200/60 shadow-xs"
                          : isBelongToCurrent
                            ? "bg-white border-indigo-100/80 hover:border-indigo-300 hover:bg-indigo-50/30 shadow-2xs"
                            : "bg-slate-50/60 border-slate-200/80 hover:border-slate-300 hover:bg-white opacity-80"
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
                            <span className="text-[10px] font-bold text-indigo-700 flex items-center gap-1 bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-full animate-pulse ml-auto">
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
                        className="p-2 rounded-xl bg-slate-100 group-hover:bg-indigo-600 text-slate-500 group-hover:text-white transition shrink-0 mt-0.5"
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
        <div className="p-4 border-t border-slate-200 bg-slate-50/90 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 font-medium">
            Phân đoạn #{segmentIndex} trong dự án: <span className="font-semibold text-slate-700">{videoTitle}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 transition cursor-pointer"
            >
              Đóng
            </button>
            <button
              onClick={() => {
                onSeek(segment.start);
                onPlay();
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition flex items-center gap-1.5 hover:scale-102 active:scale-98 cursor-pointer"
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
