"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Segment, TranscriptData } from "@/types";
import { formatTime, recalculateParts, slugify } from "@/lib/utils";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCw,
  Bookmark,
  Volume2,
  VolumeX,
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
}

export const StudioTimeline: React.FC<StudioTimelineProps> = ({
  segments,
  currentTime,
  totalDuration,
  activeSegmentId,
  isPlaying,
  canUndo = false,
  canRedo = false,
  transcript,
  volume: propVolume,
  isMuted: propMuted,
  onUndo,
  onRedo,
  onTogglePlay,
  onSeek,
  onSelectSegment,
  onUpdateSegments,
  onVolumeChange,
  onToggleMute,
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

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);

  const [internalVolume, setInternalVolume] = useState(100);
  const [internalMuted, setInternalMuted] = useState(false);
  const volume = propVolume !== undefined ? propVolume : internalVolume;
  const isMuted = propMuted !== undefined ? propMuted : internalMuted;
  const setVolume = onVolumeChange || setInternalVolume;
  const toggleMute = onToggleMute || (() => setInternalMuted((prev) => !prev));

  // Scrubbing & Hover preview states
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // Playback timer (runs when playing and not scrubbing)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (playing && !isScrubbing) {
      timer = setInterval(() => {
        const nextTime = Math.min(totalDuration, currentTime + 0.5);
        onSeek(nextTime);
        if (nextTime >= totalDuration) {
          if (onTogglePlay) onTogglePlay();
          else setInternalPlaying(false);
        }
      }, 500);
    }
    return () => clearInterval(timer);
  }, [playing, isScrubbing, currentTime, totalDuration, onSeek, onTogglePlay]);

  // Keyboard navigation shortcuts: Space (play/pause), Left/Right (seek 5s), J/K/L
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        onSeek(Math.max(0, currentTime - 5));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        onSeek(Math.min(totalDuration, currentTime + 5));
      } else if (e.key === "j" || e.key === "J") {
        onSeek(Math.max(0, currentTime - 10));
      } else if (e.key === "l" || e.key === "L") {
        onSeek(Math.min(totalDuration, currentTime + 10));
      } else if (e.key === "k" || e.key === "K") {
        togglePlay();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, onSeek, currentTime, totalDuration]);

  // Jump to Prev / Next Segment or step back
  const handlePrevSegment = () => {
    const currentIdx = segments.findIndex((s) => s.id === activeSegmentId);
    if (currentIdx > 0 && currentTime <= segments[currentIdx].start + 2) {
      const prev = segments[currentIdx - 1];
      onSelectSegment(prev.id);
      onSeek(prev.start);
    } else if (currentIdx >= 0) {
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

  // Compute time from clientX coordinate on timeline
  const calculateTimeFromEvent = useCallback(
    (clientX: number): number => {
      if (!timelineContainerRef.current) return currentTime;
      const rect = timelineContainerRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      return Number((ratio * totalDuration).toFixed(1));
    },
    [currentTime, totalDuration]
  );

  // Pointer Scrubbing Handlers (Click + Smooth Dragging across entire track)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only primary mouse button
    setIsScrubbing(true);
    const newTime = calculateTimeFromEvent(e.clientX);
    onSeek(newTime);

    const matchingSeg = segments.find((s) => newTime >= s.start && newTime <= s.end);
    if (matchingSeg) {
      onSelectSegment(matchingSeg.id);
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
    const xPos = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setHoverX(xPos);

    const newTime = calculateTimeFromEvent(e.clientX);
    setHoverTime(newTime);

    if (isScrubbing) {
      onSeek(newTime);
      const matchingSeg = segments.find((s) => newTime >= s.start && newTime <= s.end);
      if (matchingSeg) {
        onSelectSegment(matchingSeg.id);
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

  const handlePointerLeave = () => {
    if (!isScrubbing) {
      setHoverTime(null);
    }
  };

  // Generate waveform vertical bars ("Dạng kẻ dọc như ảnh 2")
  const waveformBars = useMemo(() => {
    const count = 180;
    const bars: number[] = [];

    if (transcript && transcript.sentences && transcript.sentences.length > 0) {
      for (let i = 0; i < count; i++) {
        const t = (i / count) * totalDuration;
        const inSentence = transcript.sentences.some(
          (s) => t >= s.start && t <= s.end
        );

        let height: number;
        if (inSentence) {
          const wave = Math.sin(i * 0.4) * 20 + Math.cos(i * 0.8) * 15;
          const noise = Math.abs(Math.sin((i + 1) * 31.7)) * 28;
          height = Math.min(95, Math.max(30, Math.round(52 + wave + noise)));
        } else {
          const noise = Math.abs(Math.sin((i + 1) * 17.3)) * 12;
          height = Math.min(22, Math.max(10, Math.round(12 + noise)));
        }

        if (i === 0) height = 95; // Initial peak accent matching reference image 2
        bars.push(height);
      }
      return bars;
    }

    // Default lecture audio waveform simulation
    for (let i = 0; i < count; i++) {
      const cluster = Math.sin(i * 0.12) * Math.cos(i * 0.04);
      const speechBurst = Math.sin(i * 0.35) * 0.3 + Math.cos(i * 0.7) * 0.2;
      const variation = Math.abs(Math.sin((i + 1) * 37.17)) * 0.38;
      let height =
        0.2 +
        Math.abs(cluster) * 0.45 +
        Math.abs(speechBurst) * 0.3 +
        variation * 0.2;

      // Realistic speech pauses
      if (i % 24 >= 21 || i % 47 >= 44) {
        height = height * 0.26;
      }
      if (i === 0) height = 0.95; // Accent first bar like image 2
      bars.push(Math.min(96, Math.max(10, Math.round(height * 100))));
    }
    return bars;
  }, [transcript, totalDuration]);

  // Generate ruler markers
  const rulerTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(
    (r) => {
      const sec = r * totalDuration;
      return {
        ratio: r * 100,
        label: formatTime(sec),
      };
    }
  );

  return (
    <div className="bg-[#121318] border-t border-slate-800 shrink-0 select-none flex flex-col z-20">
      {/* 1. Transport Bar (Matching reference: [Hide Timeline]  00:00.00 / 30:20.00  |<< Play >>| Loop Bookmark   Volume 80%) */}
      <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between">
        {/* Left: Hide/Show Timeline */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition"
        >
          {isCollapsed ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
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
              title="Phân đoạn trước (hoặc lùi 5s)"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>

            {/* Glowing White Play/Pause Button as in Reference Image */}
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 text-black flex items-center justify-center shadow-lg shadow-white/10 transition transform hover:scale-105 active:scale-95"
              title={playing ? "Tạm dừng (Space)" : "Phát (Space)"}
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
              title="Phân đoạn kế tiếp (hoặc tiến 5s)"
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

        {/* Right: Volume slider with Mute toggle */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <button
            onClick={toggleMute}
            className="hover:text-white transition p-1"
            title={isMuted ? "Bật âm thanh" : "Tắt tiếng"}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <span className="font-mono text-[11px] w-7 text-right">
            {isMuted ? "0%" : `${volume}%`}
          </span>
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

            {/* Instruction hint: Click or Drag to Seek */}
            <div className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              <span>Kéo hoặc click bất kỳ điểm nào để tua video (Hỗ trợ phím mũi tên &larr; &rarr;)</span>
            </div>

            {/* Zoom Slider */}
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setZoomLevel(Math.max(100, zoomLevel - 25))}
                className="p-1 hover:text-white"
                title="Thu nhỏ timeline"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min="100"
                max="250"
                value={zoomLevel}
                onChange={(e) => setZoomLevel(Number(e.target.value))}
                className="w-20 h-1 bg-slate-800 rounded appearance-none accent-purple-500 cursor-pointer"
              />
              <button
                onClick={() => setZoomLevel(Math.min(250, zoomLevel + 25))}
                className="p-1 hover:text-white"
                title="Phóng to timeline"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-[10px] text-slate-500 w-8">
                {zoomLevel}%
              </span>
            </div>
          </div>

          {/* 3. Ruler & Multi-Track Area (CapCut Multi-track Style) */}
          <div className="flex bg-[#0d0e12] overflow-x-auto relative">
            {/* Left Track Headers (V1 Video & A1 Audio) */}
            <div className="w-16 bg-[#121318] border-r border-slate-800 shrink-0 flex flex-col select-none z-20">
              {/* Ruler header space */}
              <div className="h-6 bg-[#16171d] border-b border-slate-800/80 flex items-center justify-center text-[10px] font-mono text-slate-500">
                00:00
              </div>

              {/* V1 Video Track Header */}
              <div className="h-14 border-b border-slate-800/80 flex items-center justify-between text-slate-400 text-xs px-2 bg-[#121318]">
                <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-purple-400">
                  <Video className="w-3.5 h-3.5" />
                  <span>V1</span>
                </div>
                <div className="flex items-center gap-1 text-slate-500">
                  <Eye className="w-3 h-3 hover:text-white" />
                  <Lock className="w-3 h-3 hover:text-white" />
                </div>
              </div>

              {/* A1 Audio Track Header */}
              <div className="h-14 flex items-center justify-between text-slate-400 text-xs px-2 bg-[#121318]">
                <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-emerald-400">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>A1</span>
                </div>
                <div className="flex items-center gap-1 text-slate-500">
                  <Volume2 className="w-3 h-3 hover:text-white" />
                  <Lock className="w-3 h-3 hover:text-white" />
                </div>
              </div>
            </div>

            {/* Right Interactive Track Timeline Canvas */}
            <div
              ref={timelineContainerRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              style={{ minWidth: `${Math.max(100, zoomLevel)}%` }}
              className={`flex-1 flex flex-col relative select-none ${
                isScrubbing ? "cursor-ew-resize" : "cursor-pointer"
              }`}
            >
              {/* Top Ruler Bar with Time Markers */}
              <div className="h-6 bg-[#16171d] border-b border-slate-800/80 relative text-[10px] font-mono text-slate-500 flex items-center overflow-hidden">
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

              {/* Track 1: Video Segment Clips (V1) - Absolute Time Positioned */}
              <div className="h-14 bg-[#0a0b0e] border-b border-slate-800/80 relative w-full overflow-hidden">
                {segments.map((seg) => {
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
                        width: `${Math.max(1.2, widthPct)}%`,
                      }}
                      className={`absolute top-1 bottom-1 rounded-md border-2 overflow-hidden transition-all group flex flex-col justify-between p-1.5 ${
                        isSelected
                          ? "border-purple-500 bg-purple-950/70 shadow-lg shadow-purple-500/20 z-10"
                          : "border-purple-600/60 bg-purple-950/30 hover:border-purple-400 z-0"
                      }`}
                    >
                      {/* Clip Title inside track box */}
                      <div className="flex items-center justify-between z-10 pointer-events-none">
                        <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-white truncate">
                          <Video className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                          <span className="truncate">{seg.slug}</span>
                        </div>
                        <span className="text-[9px] font-mono text-purple-300 shrink-0 ml-1">
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
                      <div className="text-[10px] text-slate-300 truncate z-10 font-sans pointer-events-none">
                        {seg.topic}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Track 2: Audio Waveform Vertical Bars ("Dạng kẻ dọc như ảnh 2" - A1) - Full 100% Width */}
              <div className="h-14 bg-[#14151b] relative w-full overflow-hidden border-b border-slate-800">
                {/* Waveform Vertical Bars SVG spanning 100% without getting cut short */}
                <svg
                  className="w-full h-full pointer-events-none block"
                  viewBox={`0 0 ${waveformBars.length * 4} 56`}
                  preserveAspectRatio="none"
                >
                  {waveformBars.map((heightPercent, idx) => {
                    const barProgressRatio = idx / waveformBars.length;
                    const currentProgressRatio =
                      currentTime / Math.max(1, totalDuration);
                    const isPlayed = barProgressRatio <= currentProgressRatio;
                    const barH = Math.max(3, (heightPercent / 100) * 48);
                    const x = idx * 4;
                    const y = 52 - barH;

                    return (
                      <rect
                        key={idx}
                        x={x + 0.6}
                        y={y}
                        width={2.6}
                        height={barH}
                        rx={0.8}
                        fill={isPlayed ? "#f1f5f9" : "#475569"}
                        fillOpacity={isPlayed ? 1 : 0.65}
                      />
                    );
                  })}
                  {/* Subtle Baseline at Bottom */}
                  <line
                    x1="0"
                    y1="52"
                    x2={waveformBars.length * 4}
                    y2="52"
                    stroke="#334155"
                    strokeWidth="1"
                  />
                </svg>

                {/* Reference Image 2 Style Timestamp at Bottom-Right */}
                <div className="absolute bottom-1 right-2 z-10 pointer-events-none font-mono text-[11px] font-bold text-slate-300 bg-black/70 px-1.5 py-0.5 rounded border border-white/10 backdrop-blur-xs">
                  {formatTime(currentTime)}
                </div>
              </div>

              {/* Continuous Vertical Playhead Cursor across ALL tracks */}
              <div
                style={{
                  left: `${(currentTime / Math.max(1, totalDuration)) * 100}%`,
                }}
                className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_white] z-30 pointer-events-none transition-[left] duration-75"
              >
                {/* Top CapCut Playhead Diamond Handle */}
                <div className="w-3.5 h-3.5 bg-white -ml-[6px] -mt-1 rotate-45 rounded-xs shadow-md shadow-black/60 border border-slate-300" />
                {/* Bottom marker dot */}
                <div className="absolute bottom-0 w-2 h-2 bg-white -ml-[3px] rounded-full shadow-md" />
              </div>

              {/* Hover Guide Line with Tooltip */}
              {hoverTime !== null && !isScrubbing && (
                <div
                  style={{ left: `${hoverX}px` }}
                  className="absolute top-0 bottom-0 w-[1px] bg-purple-400/80 pointer-events-none z-20 flex flex-col items-center"
                >
                  <div className="bg-purple-600 text-white font-mono text-[10px] font-bold px-1.5 py-0.5 rounded -mt-5 shadow-lg border border-purple-400">
                    {formatTime(hoverTime)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
