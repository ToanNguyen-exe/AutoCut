"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Segment, TranscriptData } from "@/types";
import { formatTime, recalculateParts, slugify } from "@/lib/utils";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  MousePointer,
  Undo2,
  Redo2,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  ArrowLeftRight,
  Plus,
} from "lucide-react";

interface StudioTimelineProps {
  segments: Segment[];
  currentTime: number;
  totalDuration: number;
  activeSegmentId?: string;
  isPlaying?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  transcript?: TranscriptData;
  volume?: number;
  isMuted?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onTogglePlay?: () => void;
  onSeek: (time: number) => void;
  onSelectSegment: (id: string) => void;
  onUpdateSegments: (newSegments: Segment[]) => void;
  onVolumeChange?: (vol: number) => void;
  onToggleMute?: () => void;
  onOpenSegmentDetail?: (segment: Segment, index: number) => void;
  onShowToast?: (type: "success" | "error" | "info", msg: string) => void;
}

export const StudioTimeline: React.FC<StudioTimelineProps> = ({
  segments,
  currentTime,
  totalDuration,
  activeSegmentId,
  isPlaying,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onTogglePlay,
  onSeek,
  onSelectSegment,
  onUpdateSegments,
  onOpenSegmentDetail,
  onShowToast,
}) => {
  const [internalPlaying, setInternalPlaying] = useState(false);
  const playing = isPlaying !== undefined ? isPlaying : internalPlaying;
  const togglePlay = useCallback(() => {
    if (onTogglePlay) {
      onTogglePlay();
    } else {
      setInternalPlaying((prev) => !prev);
    }
  }, [onTogglePlay]);

  const [zoomLevel, setZoomLevel] = useState(100);

  // Resizable timeline height (kéo lên kéo xuống)
  const [timelineHeight, setTimelineHeight] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("autocut_timeline_height");
      if (saved) return Math.max(160, Math.min(500, parseInt(saved, 10)));
    }
    return 240;
  });
  const isResizingRef = useRef(false);

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startY = e.clientY;
    const startH = timelineHeight;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startY - ev.clientY; // Kéo chuột lên trên -> timeline cao lên
      const nextH = Math.max(160, Math.min(500, startH + delta));
      setTimelineHeight(nextH);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      try {
        localStorage.setItem("autocut_timeline_height", timelineHeight.toString());
      } catch {
        // ignore storage error
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Scrubbing & Hover preview states
  const [isScrubbing, setIsScrubbing] = useState(false);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement)?.isContentEditable;

      if (isInput) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        onSeek(Math.max(0, currentTime - (e.shiftKey ? 10 : 2)));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        onSeek(Math.min(totalDuration, currentTime + (e.shiftKey ? 10 : 2)));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (onRedo && canRedo) onRedo();
        } else {
          if (onUndo && canUndo) onUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (onRedo && canRedo) onRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, currentTime, totalDuration, onSeek, onUndo, onRedo, canUndo, canRedo]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !timelineContainerRef.current) return;
    setIsScrubbing(true);
    const rect = timelineContainerRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = Number((ratio * totalDuration).toFixed(1));
    onSeek(targetTime);

    const targetSeg = segments.find((s) => targetTime >= s.start && targetTime <= s.end);
    if (targetSeg) {
      onSelectSegment(targetSeg.id);
    }

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineContainerRef.current) return;
    const rect = timelineContainerRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = Number((ratio * totalDuration).toFixed(1));

    if (isScrubbing) {
      onSeek(targetTime);
      const targetSeg = segments.find((s) => targetTime >= s.start && targetTime <= s.end);
      if (targetSeg) {
        onSelectSegment(targetSeg.id);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isScrubbing) {
      setIsScrubbing(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handlePrevSegment = () => {
    const curIdx = segments.findIndex((s) => s.id === activeSegmentId);
    if (curIdx > 0) {
      const prev = segments[curIdx - 1];
      onSelectSegment(prev.id);
      onSeek(prev.start);
    } else {
      onSeek(0);
    }
  };

  const handleNextSegment = () => {
    const curIdx = segments.findIndex((s) => s.id === activeSegmentId);
    if (curIdx >= 0 && curIdx < segments.length - 1) {
      const next = segments[curIdx + 1];
      onSelectSegment(next.id);
      onSeek(next.start);
    }
  };

  // Split Segment at Current Playhead Position
  const handleSplitAtPlayhead = () => {
    const splitTime = Number(currentTime.toFixed(1));
    const targetIdx = segments.findIndex(
      (s) => splitTime > s.start + 0.2 && splitTime < s.end - 0.2
    );

    if (targetIdx === -1) {
      if (onShowToast) {
        onShowToast(
          "info",
          "Vui lòng kéo con trỏ đỏ (playhead) vào giữa phân đoạn (cách mép ít nhất 0.2 giây) để thực hiện cắt tách đoạn!"
        );
      }
      return;
    }

    const orig = segments[targetIdx];
    const seg1: Segment = {
      ...orig,
      id: `${orig.id}_a`,
      end: splitTime,
      topic: `${orig.topic} (Phần 1)`,
      slug: slugify(`${orig.topic} p1`),
      parts: recalculateParts(
        orig.start,
        splitTime,
        `${orig.section_no.toString().padStart(2, "0")}_${slugify(orig.section)}`,
        orig.topic_no,
        slugify(`${orig.topic} p1`)
      ),
    };

    const seg2: Segment = {
      ...orig,
      id: `${orig.id}_b`,
      start: splitTime,
      topic: `${orig.topic} (Phần 2)`,
      slug: slugify(`${orig.topic} p2`),
      topic_no: orig.topic_no + 1,
      parts: recalculateParts(
        splitTime,
        orig.end,
        `${orig.section_no.toString().padStart(2, "0")}_${slugify(orig.section)}`,
        orig.topic_no + 1,
        slugify(`${orig.topic} p2`)
      ),
    };

    const newSegments = [...segments];
    newSegments.splice(targetIdx, 1, seg1, seg2);
    onUpdateSegments(newSegments);
    onSelectSegment(seg2.id);
  };

  // Delete currently selected segment (Trash Tool)
  const handleDeleteActive = () => {
    if (!activeSegmentId) return;
    if (segments.length <= 1) {
      return;
    }
    const filtered = segments.filter((s) => s.id !== activeSegmentId);
    onUpdateSegments(filtered);
    if (filtered.length > 0) {
      onSelectSegment(filtered[0].id);
      onSeek(filtered[0].start);
    }
  };

  // Audio waveform vertical bars matching emerald green in reference image
  const waveformBars = useMemo(() => {
    const count = 90;
    const bars: number[] = [];

    for (let i = 0; i < count; i++) {
      const wave1 = Math.sin(i * 0.28) * 35;
      const wave2 = Math.cos(i * 0.6) * 20;
      const noise = Math.abs(Math.sin((i + 1) * 23.7)) * 25;
      const height = Math.min(95, Math.max(25, Math.round(50 + wave1 + wave2 + noise)));
      bars.push(height);
    }
    return bars;
  }, []);

  // Generate ruler markers: 00:00, 00:53, 01:47, 02:40, 03:34, 04:27, 05:21, 06:14...
  const rulerTicks = useMemo(() => {
    const stepSec = Math.max(30, Math.round(totalDuration / 10));
    const ticks: { sec: number; label: string; ratio: number }[] = [];
    for (let t = 0; t <= totalDuration; t += stepSec) {
      ticks.push({
        sec: t,
        label: formatTime(t),
        ratio: (t / Math.max(1, totalDuration)) * 100,
      });
    }
    return ticks;
  }, [totalDuration]);

  // Position of red playhead line
  const playheadPercent = (currentTime / Math.max(1, totalDuration)) * 100;

  return (
    <div
      style={{ height: `${timelineHeight}px` }}
      className="bg-white border-t border-slate-200/90 shrink-0 select-none flex flex-col z-20 text-slate-800 shadow-[0_-1px_3px_rgba(0,0,0,0.02)] relative transition-none"
    >
      {/* Thanh kéo điều chỉnh độ cao Timeline (Kéo lên kéo xuống) */}
      <div
        onMouseDown={handleStartResize}
        className="w-full h-3.5 -top-1.5 absolute left-0 right-0 z-50 cursor-ns-resize group flex items-center justify-center hover:bg-indigo-500/15 active:bg-indigo-600 transition select-none"
        title="Kéo lên / kéo xuống để điều chỉnh độ cao của Timeline"
      >
        <div className="w-16 h-1 rounded-full bg-slate-300 group-hover:bg-indigo-600 transition shadow-xs flex items-center justify-center gap-1">
          <div className="w-1 h-1 rounded-full bg-white opacity-60" />
          <div className="w-1 h-1 rounded-full bg-white opacity-60" />
          <div className="w-1 h-1 rounded-full bg-white opacity-60" />
        </div>
      </div>

      {/* 1. Timeline Toolbar */}
      <div className="h-12 border-b border-slate-200/90 px-4 flex items-center justify-between bg-white shrink-0">
        {/* Left Toolbar Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Mouse pointer */}
          <button
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            title="Con trỏ chọn"
          >
            <MousePointer className="w-4 h-4" />
          </button>

          {/* Undo */}
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded-lg transition ${
              canUndo
                ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                : "text-slate-300 cursor-not-allowed"
            }`}
            title="Hoàn tác (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>

          {/* Redo */}
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 rounded-lg transition ${
              canRedo
                ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                : "text-slate-300 cursor-not-allowed"
            }`}
            title="Làm lại (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          {/* Split / Cắt */}
          <button
            onClick={handleSplitAtPlayhead}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold text-slate-700 hover:text-indigo-600 hover:bg-slate-100 border border-slate-200/80 transition"
            title="Tách phân đoạn tại con trỏ đỏ"
          >
            <Scissors className="w-4 h-4 text-indigo-600" />
            <span>Cắt</span>
          </button>

          {/* Delete active segment */}
          <button
            onClick={handleDeleteActive}
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
            title="Xóa phân đoạn đang chọn"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-4 bg-slate-200 mx-1" />

          {/* Prev */}
          <button
            onClick={handlePrevSegment}
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            title="Phân đoạn trước"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Big Indigo Play Button in Center */}
          <button
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-xs transition transform hover:scale-105 active:scale-95"
            title={playing ? "Tạm dừng (Space)" : "Phát (Space)"}
          >
            {playing ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Next */}
          <button
            onClick={handleNextSegment}
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            title="Phân đoạn kế tiếp"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Chuyển video button */}
          <button
            onClick={() => onSeek(0)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 hover:text-indigo-600 hover:bg-slate-100 transition ml-1"
            title="Chuyển video / Phát lại từ đầu"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span className="hidden sm:inline">Chuyển video</span>
          </button>
        </div>

        {/* Right Toolbar Controls: Zoom & + Công cụ */}
        <div className="flex items-center gap-3">
          {/* Zoom Controls */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <button
              onClick={() => setZoomLevel(Math.max(100, zoomLevel - 25))}
              className="p-1 hover:text-slate-900 transition"
              title="Thu nhỏ timeline"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <input
              type="range"
              min="100"
              max="250"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="w-20 h-1 bg-slate-200 rounded appearance-none accent-indigo-600 cursor-pointer"
            />
            <button
              onClick={() => setZoomLevel(Math.min(250, zoomLevel + 25))}
              className="p-1 hover:text-slate-900 transition"
              title="Phóng to timeline"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          {/* Nút "+ Công cụ" */}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold shadow-2xs transition"
            title="Thêm công cụ biên tập"
          >
            <Plus className="w-4 h-4" />
            <span>Công cụ</span>
          </button>
        </div>
      </div>

      {/* 2. Multi-Track Timeline Canvas with Red Playhead */}
      <div className="flex bg-white overflow-x-auto overflow-y-auto relative flex-1 min-h-0">
        {/* Left Track Names: "Nội dung" and "Âm thanh" */}
        <div className="w-28 bg-white shrink-0 flex flex-col select-none z-20 pl-4 pr-2 border-r border-slate-100 sticky left-0">
          {/* Ruler space */}
          <div className="h-8" />

          {/* Track 1 Label: Nội dung */}
          <div className="h-20 flex items-center text-sm font-bold text-slate-800">
            Nội dung
          </div>

          {/* Track 2 Label: Âm thanh */}
          <div className="h-16 flex items-center text-sm font-bold text-slate-800">
            Âm thanh
          </div>
        </div>

        {/* Right Interactive Track Area */}
        <div
          ref={timelineContainerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ minWidth: `${Math.max(100, zoomLevel)}%` }}
          className={`flex-1 flex flex-col relative select-none pr-6 ${
            isScrubbing ? "cursor-ew-resize" : "cursor-pointer"
          }`}
        >
          {/* Top Ruler Bar */}
          <div className="h-8 relative text-xs font-mono font-medium text-slate-500 flex items-center overflow-hidden border-b border-slate-100">
            {rulerTicks.map((tick, i) => (
              <div
                key={i}
                style={{ left: `${tick.ratio}%` }}
                className="absolute top-0 bottom-0 pl-1 flex items-center pointer-events-none"
              >
                <span>{tick.label}</span>
              </div>
            ))}
          </div>

          {/* Track 1: Nội dung (Segment Clips in Lavender/Indigo Pastel) */}
          <div className="h-20 relative w-full flex items-center">
            {segments.map((seg, idx) => {
              const leftPct = (seg.start / Math.max(1, totalDuration)) * 100;
              const widthPct = Math.min(
                100 - leftPct,
                ((seg.end - seg.start) / Math.max(1, totalDuration)) * 100
              );
              const isSelected = activeSegmentId === seg.id;

              return (
                <div
                  key={seg.id}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                  className="absolute top-1 bottom-1 px-0.5"
                >
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSegment(seg.id);
                      onSeek(seg.start);
                      // Mở Modal chi tiết phân đoạn khi click
                      if (onOpenSegmentDetail) {
                        onOpenSegmentDetail(seg, idx + 1);
                      }
                    }}
                    title={`#${idx + 1} ${seg.topic} (${formatTime(seg.end - seg.start)}) - Nhấp để xem chi tiết`}
                    className={`w-full h-full rounded-xl border transition-all duration-150 flex flex-col justify-between p-2.5 cursor-pointer shadow-2xs overflow-hidden select-none ${
                      isSelected
                        ? "bg-[#e0e7ff] border-indigo-500 ring-2 ring-indigo-200 z-10 shadow-xs"
                        : "bg-[#eef2ff] border-indigo-200 hover:border-indigo-400 z-0"
                    }`}
                  >
                    {/* Top Row: Title + Duration */}
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                      <span className="text-sm font-bold text-slate-900 truncate min-w-0">
                        #{idx + 1} {seg.topic}
                      </span>
                      <span className="text-xs font-mono font-bold text-indigo-700 ml-1 shrink-0 bg-white/80 px-1.5 py-0.5 rounded shadow-2xs">
                        {formatTime(seg.end - seg.start)}
                      </span>
                    </div>

                    {/* Bottom Row: Decorative Accent bar + optional slug */}
                    <div className="flex items-center gap-2 mt-auto">
                      <div className="w-14 sm:w-20 h-1.5 bg-indigo-400/80 rounded-full shrink-0" />
                      {seg.slug && seg.slug !== slugify(seg.topic) && (
                        <span className="text-[11px] font-mono text-slate-500 truncate min-w-0 opacity-80">
                          {seg.slug}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Track 2: Âm thanh (Emerald green waveform inside mint pill container) */}
          <div className="h-16 relative w-full flex items-center py-1">
            <div className="w-full h-full bg-[#ecfdf5] rounded-2xl border border-emerald-200/90 flex items-center justify-between px-3 gap-0.5 overflow-hidden">
              {waveformBars.map((height, i) => (
                <div
                  key={i}
                  style={{ height: `${height}%` }}
                  className="w-1 bg-[#10b981] rounded-full shrink-0 transition-all duration-150"
                />
              ))}
            </div>
          </div>

          {/* RED PLAYHEAD LINE & TOP CIRCLE KNOB RUNNING THROUGH BOTH TRACKS */}
          <div
            style={{ left: `${playheadPercent}%` }}
            className="absolute top-0 bottom-0 pointer-events-none z-30 -ml-[1px] flex flex-col items-center"
          >
            {/* Red knob on ruler */}
            <div className="w-4 h-4 bg-[#ef4444] rounded-full shadow-md -mt-0.5 ring-2 ring-white" />
            {/* Red vertical needle line */}
            <div className="w-[2px] bg-[#ef4444] flex-1" />
          </div>
        </div>
      </div>
    </div>
  );
};
