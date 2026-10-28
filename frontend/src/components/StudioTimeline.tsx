"use client";

import React, { useState, useEffect, useRef } from "react";
import { Segment } from "@/types";
import { formatTime, recalculateParts, slugify } from "@/lib/utils";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCw,
  Bookmark,
  Volume2,
  MousePointer,
  Undo2,
  Redo2,
  Scissors,
  BookmarkCheck,
  Trash2,
  ZoomIn,
  ZoomOut,
  Eye,
  Lock,
  Video,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface StudioTimelineProps {
  segments: Segment[];
  currentTime: number;
  totalDuration: number;
  activeSegmentId?: string;
  isPlaying?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onTogglePlay?: () => void;
  onSeek: (time: number) => void;
  onSelectSegment: (id: string) => void;
  onUpdateSegments: (newSegments: Segment[]) => void;
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
}) => {
  const [internalPlaying, setInternalPlaying] = useState(false);
  const playing = isPlaying !== undefined ? isPlaying : internalPlaying;
  const togglePlay = onTogglePlay || (() => setInternalPlaying(!internalPlaying));

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [volume, setVolume] = useState(80);
  const timelineTrackRef = useRef<HTMLDivElement>(null);

  // Playback timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (playing) {
      timer = setInterval(() => {
        onSeek(Math.min(totalDuration, currentTime + 0.5));
        if (currentTime >= totalDuration) {
          if (onTogglePlay) onTogglePlay();
          else setInternalPlaying(false);
        }
      }, 500);
    }
    return () => clearInterval(timer);
  }, [playing, currentTime, totalDuration, onSeek, onTogglePlay]);

  // Jump to Prev / Next Segment or step back
  const handlePrevSegment = () => {
    const currentIdx = segments.findIndex((s) => s.id === activeSegmentId);
    if (currentIdx > 0 && currentTime <= segments[currentIdx].start + 2) {
      // Nếu đang ở đầu phân đoạn hiện tại, nhảy về phân đoạn trước
      const prev = segments[currentIdx - 1];
      onSelectSegment(prev.id);
      onSeek(prev.start);
    } else if (currentIdx >= 0) {
      // Nhảy về đầu phân đoạn hiện tại
      onSeek(segments[currentIdx].start);
    } else if (currentTime > 5) {
      onSeek(Math.max(0, currentTime - 10));
    } else {
      onSeek(0);
    }
  };

  const handleNextSegment = () => {
    const currentIdx = segments.findIndex((s) => s.id === activeSegmentId);
    if (currentIdx >= 0 && currentIdx < segments.length - 1) {
      const next = segments[currentIdx + 1];
      onSelectSegment(next.id);
      onSeek(next.start);
    }
  };

  // Split Segment at current playhead position (Razor/Scissors Tool)
  const handleSplitAtPlayhead = () => {
    const targetIdx = segments.findIndex(
      (s) => currentTime > s.start && currentTime < s.end
    );
    if (targetIdx === -1) {
      alert("Hãy di chuyển con trỏ phát (Playhead) vào giữa một phân đoạn để cắt tách!");
      return;
    }

    const target = segments[targetIdx];
    const cutTime = Number(currentTime.toFixed(1));

    const seg1: Segment = {
      ...target,
      id: `${target.id}_a`,
      end: cutTime,
      topic: `${target.topic} (Phần 1)`,
      slug: `${target.slug}-p1`,
      parts: recalculateParts(
        target.start,
        cutTime,
        `${target.section_no.toString().padStart(2, "0")}_${slugify(target.section)}`,
        target.topic_no,
        `${target.slug}-p1`
      ),
    };

    const seg2: Segment = {
      ...target,
      id: `${target.id}_b`,
      start: cutTime,
      topic: `${target.topic} (Phần 2)`,
      slug: `${target.slug}-p2`,
      parts: recalculateParts(
        cutTime,
        target.end,
        `${target.section_no.toString().padStart(2, "0")}_${slugify(target.section)}`,
        target.topic_no + 1,
        `${target.slug}-p2`
      ),
    };

    const updated = [...segments];
    updated.splice(targetIdx, 1, seg1, seg2);
    onUpdateSegments(updated);
    onSelectSegment(seg2.id);
  };

  // Delete active segment
  const handleDeleteActive = () => {
    if (!activeSegmentId) return;
    const target = segments.find((s) => s.id === activeSegmentId);
    if (!target) return;
    if (confirm(`Bạn có chắc muốn xóa phân đoạn "${target.topic}"?`)) {
      const updated = segments.filter((s) => s.id !== activeSegmentId);
      onUpdateSegments(updated);
    }
  };

  // Handle click on timeline to scrub playhead
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineTrackRef.current) return;
    const rect = timelineTrackRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = Number((ratio * totalDuration).toFixed(1));
    onSeek(newTime);
  };

  // Generate ruler markers
  const rulerTicks = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0].map((r) => {
    const sec = r * totalDuration;
    return {
      ratio: r * 100,
      label: formatTime(sec),
    };
  });

  return (
    <div className="bg-[#121318] border-t border-slate-800 shrink-0 select-none flex flex-col z-20">
      {/* 1. Transport Bar (Matching reference image: [Hide Timeline]  0:25.90 / 02:00.00  |<< Play >>| Loop Bookmark   Volume 80%) */}
      <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between">
        {/* Left: Hide/Show Timeline */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition"
        >
          {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{isCollapsed ? "Show Timeline" : "Hide Timeline"}</span>
        </button>

        {/* Center: Monospace Time & Player Buttons */}
        <div className="flex items-center gap-4">
          {/* Time Counter in Digital Monospace */}
          <div className="font-mono text-xs font-bold text-slate-300 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800 tracking-wider">
            <span className="text-white">{formatTime(currentTime)}.00</span>
            <span className="text-slate-600 mx-1">/</span>
            <span className="text-slate-400">{formatTime(totalDuration)}.00</span>
          </div>

          {/* Transport Controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevSegment}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Phân đoạn trước"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>

            {/* Glowing White Play/Pause Button as in Reference Image */}
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 text-black flex items-center justify-center shadow-lg shadow-white/10 transition transform hover:scale-105 active:scale-95"
              title={playing ? "Tạm dừng" : "Phát"}
            >
              {playing ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={handleNextSegment}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Phân đoạn kế tiếp"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={() => onSeek(0)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition ml-1"
              title="Phát lại từ đầu"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            <button
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Đánh dấu điểm cắt"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Volume slider */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Volume2 className="w-4 h-4 text-slate-400" />
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <span className="font-mono text-[11px] w-7 text-right">{volume}%</span>
        </div>
      </div>

      {/* Collapsible Timeline Content */}
      {!isCollapsed && (
        <>
          {/* 2. Timeline Editing Toolbar (Pointer, Undo, Redo, Razor/Scissors, Marker, Trash, Zoom Slider) */}
          <div className="h-10 border-b border-slate-800/80 px-4 flex items-center justify-between text-slate-400 bg-[#16171d]/60">
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded bg-slate-800 text-white"
                title="Con trỏ chọn (Select)"
              >
                <MousePointer className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className={`p-1.5 rounded transition ${
                  canUndo
                    ? "hover:bg-slate-800 text-white cursor-pointer hover:scale-105 active:scale-95"
                    : "text-slate-600 cursor-not-allowed opacity-40"
                }`}
                title="Hoàn tác bước trước (Undo - Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                className={`p-1.5 rounded transition ${
                  canRedo
                    ? "hover:bg-slate-800 text-white cursor-pointer hover:scale-105 active:scale-95"
                    : "text-slate-600 cursor-not-allowed opacity-40"
                }`}
                title="Làm lại bước sau (Redo - Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>

              <div className="w-[1px] h-4 bg-slate-800 mx-1.5" />

              {/* Scissors Split Tool */}
              <button
                onClick={handleSplitAtPlayhead}
                className="p-1.5 rounded hover:bg-purple-600/30 text-purple-400 hover:text-purple-200 transition flex items-center gap-1 text-xs"
                title="Tách phân đoạn tại vị trí con trỏ phát (Split)"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium hidden sm:inline">Cắt</span>
              </button>

              <button
                className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition"
                title="Thêm điểm đánh dấu"
              >
                <BookmarkCheck className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleDeleteActive}
                className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                title="Xóa phân đoạn đang chọn"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Zoom Slider */}
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setZoomLevel(Math.max(50, zoomLevel - 25))}
                className="p-1 hover:text-white"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min="50"
                max="200"
                value={zoomLevel}
                onChange={(e) => setZoomLevel(Number(e.target.value))}
                className="w-20 h-1 bg-slate-800 rounded appearance-none accent-purple-500 cursor-pointer"
              />
              <button
                onClick={() => setZoomLevel(Math.min(200, zoomLevel + 25))}
                className="p-1 hover:text-white"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 3. Ruler & Multi-Track Area */}
          <div className="flex bg-[#0d0e12] overflow-x-auto relative">
            {/* Left Track Headers (Camera, Eye, Lock) */}
            <div className="w-16 bg-[#121318] border-r border-slate-800 shrink-0 flex flex-col justify-end p-2 select-none z-10">
              <div className="h-16 flex items-center justify-between text-slate-500 text-xs px-1">
                <Video className="w-3.5 h-3.5 text-slate-400" />
                <Eye className="w-3.5 h-3.5" />
                <Lock className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Right Track Timeline Canvas */}
            <div className="flex-1 flex flex-col min-w-[700px] relative">
              {/* Ruler Bar */}
              <div
                onClick={handleTimelineClick}
                className="h-6 bg-[#16171d] border-b border-slate-800/80 relative cursor-pointer text-[10px] font-mono text-slate-500 flex items-center"
              >
                {rulerTicks.map((tick, i) => (
                  <div
                    key={i}
                    style={{ left: `${tick.ratio}%` }}
                    className="absolute top-0 bottom-0 border-l border-slate-700/60 pl-1 flex items-center pointer-events-none"
                  >
                    <span>{tick.label}</span>
                  </div>
                ))}
              </div>

              {/* Clip Track (Purple Segment Clip Boxes with Filmstrip Thumbnails) */}
              <div
                ref={timelineTrackRef}
                onClick={handleTimelineClick}
                className="h-16 bg-[#0a0b0e] relative flex items-center cursor-pointer p-1"
              >
                {segments.map((seg) => {
                  const widthPct = Math.max(
                    1,
                    ((seg.end - seg.start) / Math.max(1, totalDuration)) * 100
                  );
                  const isSelected = activeSegmentId === seg.id;

                  return (
                    <div
                      key={seg.id}
                      style={{ width: `${widthPct}%` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSegment(seg.id);
                        onSeek(seg.start);
                      }}
                      className={`h-full rounded-md border-2 relative overflow-hidden transition-all group flex flex-col justify-between p-1.5 ${
                        isSelected
                          ? "border-purple-500 bg-purple-950/70 shadow-lg shadow-purple-500/20"
                          : "border-purple-600/60 bg-purple-950/30 hover:border-purple-400"
                      }`}
                    >
                      {/* Clip Title inside track box (matching reference: Video Clip Name) */}
                      <div className="flex items-center justify-between z-10">
                        <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-white truncate">
                          <Video className="w-2.5 h-2.5 text-purple-300" />
                          <span className="truncate">{seg.slug}</span>
                        </div>
                        <span className="text-[9px] font-mono text-purple-300 shrink-0">
                          {formatTime(seg.end - seg.start)}
                        </span>
                      </div>

                      {/* Filmstrip Repeating Thumbnails Simulation */}
                      <div className="absolute inset-0 top-5 opacity-25 group-hover:opacity-40 transition-opacity flex gap-1 pointer-events-none overflow-hidden">
                        {[...Array(12)].map((_, fi) => (
                          <div
                            key={fi}
                            className="w-12 h-8 bg-slate-800 rounded-xs shrink-0 border border-slate-700/50"
                          />
                        ))}
                      </div>

                      {/* Topic Name bottom label */}
                      <div className="text-[10px] text-slate-300 truncate z-10 font-sans">
                        {seg.topic}
                      </div>
                    </div>
                  );
                })}

                {/* White Vertical Playhead Cursor with Top Triangle (Matching reference image) */}
                <div
                  style={{
                    left: `${(currentTime / Math.max(1, totalDuration)) * 100}%`,
                  }}
                  className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_white] z-30 pointer-events-none transition-[left] duration-100"
                >
                  <div className="w-3 h-3 bg-white -ml-[5px] -mt-1.5 rotate-45 rounded-xs shadow-md" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
