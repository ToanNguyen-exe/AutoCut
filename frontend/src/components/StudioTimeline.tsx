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
    } else {
      onSeek(Math.max(0, currentTime - 5));
    }
  };

  const handleNextSegment = () => {
    const currentIdx = segments.findIndex((s) => s.id === activeSegmentId);
    if (currentIdx >= 0 && currentIdx < segments.length - 1) {
      const next = segments[currentIdx + 1];
      onSelectSegment(next.id);
      onSeek(next.start);
    } else {
      onSeek(Math.min(totalDuration, currentTime + 5));
    }
  };

  // Convert click/drag mouse coordinate to timeline seconds
  const calculateTimeFromX = useCallback(
    (clientX: number): number => {
      if (!timelineContainerRef.current) return currentTime;
      const rect = timelineContainerRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = clickX / rect.width;
      return Math.round(ratio * totalDuration * 10) / 10;
    },
    [currentTime, totalDuration]
  );

  // Mouse / Pointer handlers for CapCut-style Scrubbing
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Left click only
    if (e.button !== 0) return;
    setIsScrubbing(true);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const targetTime = calculateTimeFromX(e.clientX);
    onSeek(targetTime);

    // Auto select segment at clicked position
    const matchingSeg = segments.find(
      (s) => targetTime >= s.start && targetTime <= s.end
    );
    if (matchingSeg) {
      onSelectSegment(matchingSeg.id);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (timelineContainerRef.current) {
      const rect = timelineContainerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      setHoverX(x);
      setHoverTime((x / rect.width) * totalDuration);
    }

    if (isScrubbing) {
      const targetTime = calculateTimeFromX(e.clientX);
      onSeek(targetTime);

      const matchingSeg = segments.find(
        (s) => targetTime >= s.start && targetTime <= s.end
      );
      if (matchingSeg && matchingSeg.id !== activeSegmentId) {
        onSelectSegment(matchingSeg.id);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isScrubbing) {
      setIsScrubbing(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Safe ignore
      }
    }
  };

  const handlePointerLeave = () => {
    setHoverTime(null);
  };

  // Split segment at current Playhead position (Scissors Split Tool)
  const handleSplitAtPlayhead = () => {
    const targetIdx = segments.findIndex(
      (s) => currentTime > s.start + 1 && currentTime < s.end - 1
    );
    if (targetIdx === -1) {
      alert("Hãy di chuyển con trỏ phát vào bên trong một phân đoạn để thực hiện cắt tách!");
      return;
    }

    const orig = segments[targetIdx];
    const splitTime = Math.round(currentTime);

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
      alert("Không thể xóa toàn bộ phân đoạn. Dự án cần ít nhất 1 phân đoạn!");
      return;
    }
    const filtered = segments.filter((s) => s.id !== activeSegmentId);
    onUpdateSegments(filtered);
    if (filtered.length > 0) {
      onSelectSegment(filtered[0].id);
      onSeek(filtered[0].start);
    }
  };

  // Vertical waveform bars generator
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

        if (i === 0) height = 95;
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

      // Speech pauses
      if (i % 24 >= 21 || i % 47 >= 44) {
        height = height * 0.26;
      }
      if (i === 0) height = 0.95;
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
    <div className="bg-white border-t border-slate-200 shrink-0 select-none flex flex-col z-20 text-slate-800">
      {/* 1. Transport Bar */}
      <div className="h-12 border-b border-slate-200 px-4 flex items-center justify-between bg-white">
        {/* Left: Hide/Show Timeline */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition shadow-2xs"
        >
          {isCollapsed ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
          )}
          <span>{isCollapsed ? "Show Timeline" : "Hide Timeline"}</span>
        </button>

        {/* Center: Monospace Time & Player Buttons */}
        <div className="flex items-center gap-4">
          {/* Time Counter in Digital Monospace */}
          <div className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-300 tracking-wider shadow-2xs">
            <span className="text-slate-900">{formatTime(currentTime)}.00</span>
            <span className="text-slate-400 mx-1">/</span>
            <span className="text-slate-600">{formatTime(totalDuration)}.00</span>
          </div>

          {/* Transport Controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevSegment}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
              title="Phân đoạn trước (hoặc lùi 5s)"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>

            {/* Indigo Play/Pause Button */}
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-sm transition transform hover:scale-105 active:scale-95"
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
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
              title="Phân đoạn kế tiếp (hoặc tiến 5s)"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={() => onSeek(0)}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition ml-1"
              title="Phát lại từ đầu"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            <button
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
              title="Đánh dấu điểm cắt"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Volume slider with Mute toggle */}
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <button
            onClick={toggleMute}
            className="hover:text-slate-900 transition p-1"
            title={isMuted ? "Bật âm thanh" : "Tắt tiếng"}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-rose-600" />
            ) : (
              <Volume2 className="w-4 h-4 text-slate-700" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-16 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
          <span className="font-mono text-[11px] w-7 text-right text-slate-700 font-semibold">
            {isMuted ? "0%" : `${volume}%`}
          </span>
        </div>
      </div>

      {/* Collapsible Timeline Content */}
      {!isCollapsed && (
        <>
          {/* 2. Timeline Editing Toolbar */}
          <div className="h-10 border-b border-slate-200 px-4 flex items-center justify-between text-slate-600 bg-slate-50">
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded bg-white border border-slate-300 text-slate-800 shadow-2xs"
                title="Con trỏ chọn (Select)"
              >
                <MousePointer className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className={`p-1.5 rounded transition ${
                  canUndo
                    ? "hover:bg-slate-200 text-slate-700 cursor-pointer hover:scale-105 active:scale-95"
                    : "text-slate-300 cursor-not-allowed opacity-40"
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
                    ? "hover:bg-slate-200 text-slate-700 cursor-pointer hover:scale-105 active:scale-95"
                    : "text-slate-300 cursor-not-allowed opacity-40"
                }`}
                title="Làm lại bước sau (Redo - Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>

              <div className="w-[1px] h-4 bg-slate-300 mx-1.5" />

              {/* Scissors Split Tool */}
              <button
                onClick={handleSplitAtPlayhead}
                className="p-1.5 rounded bg-white hover:bg-indigo-50 text-indigo-700 hover:text-indigo-800 border border-indigo-200 transition flex items-center gap-1 text-xs shadow-2xs"
                title="Tách phân đoạn tại vị trí con trỏ phát (Split)"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold hidden sm:inline">Cắt</span>
              </button>

              <button
                className="p-1.5 rounded hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition"
                title="Thêm điểm đánh dấu"
              >
                <BookmarkCheck className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleDeleteActive}
                className="p-1.5 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition"
                title="Xóa phân đoạn đang chọn"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Instruction hint: Click or Drag to Seek */}
            <div className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
              <span>Kéo hoặc click bất kỳ điểm nào để tua video (Hỗ trợ phím mũi tên &larr; &rarr;)</span>
            </div>

            {/* Zoom Slider */}
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setZoomLevel(Math.max(100, zoomLevel - 25))}
                className="p-1 hover:text-slate-900"
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
                className="w-20 h-1 bg-slate-200 rounded appearance-none accent-indigo-600 cursor-pointer"
              />
              <button
                onClick={() => setZoomLevel(Math.min(250, zoomLevel + 25))}
                className="p-1 hover:text-slate-900"
                title="Phóng to timeline"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-[10px] text-slate-500 w-8 font-semibold">
                {zoomLevel}%
              </span>
            </div>
          </div>

          {/* 3. Ruler & Multi-Track Area */}
          <div className="flex bg-slate-100 overflow-x-auto relative">
            {/* Left Track Headers (V1 Video & A1 Audio) */}
            <div className="w-16 bg-white border-r border-slate-200 shrink-0 flex flex-col select-none z-20">
              {/* Ruler header space */}
              <div className="h-6 bg-slate-50 border-b border-slate-200 flex items-center justify-center text-[10px] font-mono text-slate-500 font-medium">
                00:00
              </div>

              {/* V1 Video Track Header */}
              <div className="h-14 border-b border-slate-200 flex items-center justify-between text-slate-600 text-xs px-2 bg-white">
                <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-indigo-700">
                  <Video className="w-3.5 h-3.5" />
                  <span>V1</span>
                </div>
                <div className="flex items-center gap-1 text-slate-400">
                  <Eye className="w-3 h-3 hover:text-slate-700" />
                  <Lock className="w-3 h-3 hover:text-slate-700" />
                </div>
              </div>

              {/* A1 Audio Track Header */}
              <div className="h-14 flex items-center justify-between text-slate-600 text-xs px-2 bg-white">
                <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-emerald-700">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>A1</span>
                </div>
                <div className="flex items-center gap-1 text-slate-400">
                  <Volume2 className="w-3 h-3 hover:text-slate-700" />
                  <Lock className="w-3 h-3 hover:text-slate-700" />
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
              <div className="h-6 bg-slate-50 border-b border-slate-200 relative text-[10px] font-mono text-slate-500 flex items-center overflow-hidden">
                {rulerTicks.map((tick, i) => (
                  <div
                    key={i}
                    style={{ left: `${tick.ratio}%` }}
                    className="absolute top-0 bottom-0 border-l border-slate-300 pl-1 flex items-center pointer-events-none font-medium"
                  >
                    <span>{tick.label}</span>
                  </div>
                ))}
              </div>

              {/* Track 1: Video Segment Clips (V1) */}
              <div className="h-14 bg-slate-50/70 border-b border-slate-200 relative w-full overflow-hidden">
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
                      className={`absolute top-1 bottom-1 rounded-md border overflow-hidden transition-all group flex flex-col justify-between p-1.5 ${
                        isSelected
                          ? "border-2 border-indigo-600 bg-indigo-50 shadow-sm z-10"
                          : "border-slate-300 bg-white hover:border-indigo-400 z-0 shadow-2xs"
                      }`}
                    >
                      {/* Clip Title inside track box */}
                      <div className="flex items-center justify-between z-10 pointer-events-none">
                        <div className="flex items-center gap-1 font-mono text-[11px] font-bold text-slate-900 truncate">
                          <Video className="w-2.5 h-2.5 text-indigo-600 shrink-0" />
                          <span className="truncate">{seg.slug}</span>
                        </div>
                        <span className="text-[9px] font-mono font-bold text-slate-600 shrink-0 ml-1">
                          {formatTime(seg.end - seg.start)}
                        </span>
                      </div>

                      {/* Filmstrip Repeating Thumbnails Simulation */}
                      <div className="absolute inset-0 top-5 opacity-15 group-hover:opacity-25 transition-opacity flex gap-1 pointer-events-none overflow-hidden">
                        {[...Array(12)].map((_, fi) => (
                          <div
                            key={fi}
                            className="w-12 h-8 bg-slate-200 rounded-xs shrink-0 border border-slate-300"
                          />
                        ))}
                      </div>

                      {/* Topic Name bottom label */}
                      <div className="text-[10px] text-slate-700 truncate z-10 font-sans pointer-events-none font-medium">
                        {seg.topic}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Track 2: Audio Waveform Vertical Bars (A1) */}
              <div className="h-14 bg-slate-100 relative w-full overflow-hidden border-b border-slate-200">
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
                        fill={isPlayed ? "#4f46e5" : "#cbd5e1"}
                        fillOpacity={isPlayed ? 1 : 0.8}
                      />
                    );
                  })}
                  {/* Subtle Baseline at Bottom */}
                  <line
                    x1="0"
                    y1="52"
                    x2={waveformBars.length * 4}
                    y2="52"
                    stroke="#94a3b8"
                    strokeWidth="1"
                  />
                </svg>

                {/* Timestamp at Bottom-Right */}
                <div className="absolute bottom-1 right-2 z-10 pointer-events-none font-mono text-[11px] font-bold text-slate-800 bg-white/90 px-1.5 py-0.5 rounded border border-slate-300 shadow-2xs backdrop-blur-xs">
                  {formatTime(currentTime)}
                </div>
              </div>

              {/* Continuous Vertical Playhead Cursor across ALL tracks */}
              <div
                style={{
                  left: `${(currentTime / Math.max(1, totalDuration)) * 100}%`,
                }}
                className="absolute top-0 bottom-0 w-[2px] bg-indigo-600 shadow-[0_0_6px_rgba(79,70,229,0.5)] z-30 pointer-events-none transition-[left] duration-75"
              >
                {/* Top Playhead Diamond Handle */}
                <div className="w-3.5 h-3.5 bg-indigo-600 -ml-[6px] -mt-1 rotate-45 rounded-xs shadow-md border border-white" />
                {/* Bottom marker dot */}
                <div className="absolute bottom-0 w-2 h-2 bg-indigo-600 -ml-[3px] rounded-full shadow-sm" />
              </div>

              {/* Hover Guide Line with Tooltip */}
              {hoverTime !== null && !isScrubbing && (
                <div
                  style={{ left: `${hoverX}px` }}
                  className="absolute top-0 bottom-0 w-[1px] bg-indigo-400 pointer-events-none z-20 flex flex-col items-center"
                >
                  <div className="bg-indigo-600 text-white font-mono text-[10px] font-bold px-1.5 py-0.5 rounded -mt-5 shadow-sm border border-indigo-500">
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
