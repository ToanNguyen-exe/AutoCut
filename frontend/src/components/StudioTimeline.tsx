"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Link2,
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

const generateSegmentWaveform = (
  start: number,
  end: number,
  barCount: number,
  transcript?: TranscriptData
) => {
  const bars: number[] = [];
  const duration = Math.max(0.1, end - start);

  for (let i = 0; i < barCount; i++) {
    const t = start + (i / barCount) * duration;
    let height = 30;

    if (transcript?.sentences && transcript.sentences.length > 0) {
      const inSentence = transcript.sentences.some((s) => t >= s.start && t <= s.end);
      if (inSentence) {
        const wave = Math.sin(i * 0.45) * 22 + Math.cos(i * 0.9) * 16;
        const noise = Math.abs(Math.sin((i + 1) * 31.7)) * 26;
        height = Math.min(95, Math.max(35, Math.round(55 + wave + noise)));
      } else {
        const noise = Math.abs(Math.sin((i + 1) * 17.3)) * 14;
        height = Math.min(25, Math.max(12, Math.round(15 + noise)));
      }
    } else {
      const wave = Math.sin(i * 0.35) * 20 + Math.cos(i * 0.7) * 15;
      const noise = Math.abs(Math.sin((i + 1) * 43.1)) * 25;
      height = Math.min(92, Math.max(25, Math.round(50 + wave + noise)));
    }

    if (i === 0 || i === barCount - 1) height = Math.max(height, 50);
    bars.push(height);
  }
  return bars;
};

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

  // Playback timer (CHỈ chạy khi không có player thật ngoài truyền vào)
  useEffect(() => {
    if (onTogglePlay) return; // Đã có VideoCanvasViewport quản lý phát video, tránh xung đột

    let timer: NodeJS.Timeout;
    if (playing && !isScrubbing) {
      timer = setInterval(() => {
        const nextTime = Math.min(totalDuration, currentTime + 0.5);
        onSeek(nextTime);
        if (nextTime >= totalDuration) {
          setInternalPlaying(false);
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

  // Segment Drag & Resize state (Kéo đổi điểm đầu/cuối hoặc kéo di chuyển phân đoạn)
  const [resizingSeg, setResizingSeg] = useState<{
    id: string;
    edge: "start" | "end" | "move";
    startX: number;
    origStart: number;
    origEnd: number;
    currentStart: number;
    currentEnd: number;
  } | null>(null);

  const handleStartEdgeDrag = (e: React.PointerEvent, seg: Segment) => {
    e.stopPropagation();
    onSelectSegment(seg.id);
    setResizingSeg({
      id: seg.id,
      edge: "start",
      startX: e.clientX,
      origStart: seg.start,
      origEnd: seg.end,
      currentStart: seg.start,
      currentEnd: seg.end,
    });
  };

  const handleEndEdgeDrag = (e: React.PointerEvent, seg: Segment) => {
    e.stopPropagation();
    onSelectSegment(seg.id);
    setResizingSeg({
      id: seg.id,
      edge: "end",
      startX: e.clientX,
      origStart: seg.start,
      origEnd: seg.end,
      currentStart: seg.start,
      currentEnd: seg.end,
    });
  };

  const handleMoveDrag = (e: React.PointerEvent, seg: Segment) => {
    e.stopPropagation();
    onSelectSegment(seg.id);
    setResizingSeg({
      id: seg.id,
      edge: "move",
      startX: e.clientX,
      origStart: seg.start,
      origEnd: seg.end,
      currentStart: seg.start,
      currentEnd: seg.end,
    });
  };

  const handleEdgePointerMove = (e: React.PointerEvent) => {
    if (!resizingSeg || !timelineContainerRef.current) return;
    const rect = timelineContainerRef.current.getBoundingClientRect();
    const deltaX = e.clientX - resizingSeg.startX;
    const deltaTime = (deltaX / rect.width) * totalDuration;

    if (resizingSeg.edge === "start") {
      const newStart = Math.max(0, Math.min(resizingSeg.origEnd - 0.5, Number((resizingSeg.origStart + deltaTime).toFixed(1))));
      setResizingSeg((prev) => prev ? { ...prev, currentStart: newStart } : null);
      onSeek(newStart);
    } else if (resizingSeg.edge === "end") {
      const newEnd = Math.min(totalDuration, Math.max(resizingSeg.origStart + 0.5, Number((resizingSeg.origEnd + deltaTime).toFixed(1))));
      setResizingSeg((prev) => prev ? { ...prev, currentEnd: newEnd } : null);
      onSeek(newEnd);
    } else if (resizingSeg.edge === "move") {
      const duration = resizingSeg.origEnd - resizingSeg.origStart;
      const newStart = Math.max(0, Math.min(totalDuration - duration, Number((resizingSeg.origStart + deltaTime).toFixed(1))));
      const newEnd = Number((newStart + duration).toFixed(1));
      setResizingSeg((prev) => prev ? { ...prev, currentStart: newStart, currentEnd: newEnd } : null);
      onSeek(newStart);
    }
  };

  const handleEdgePointerUp = () => {
    if (!resizingSeg) return;
    const finalStart = resizingSeg.currentStart;
    const finalEnd = resizingSeg.currentEnd;
    const targetId = resizingSeg.id;
    setResizingSeg(null);

    const updated = segments.map((s) => {
      if (s.id !== targetId) return s;
      const sectionFolder = `${s.section_no.toString().padStart(2, "0")}_${slugify(s.section)}`;
      const newParts = recalculateParts(finalStart, finalEnd, sectionFolder, s.topic_no, s.slug);

      // Đồng bộ chuẩn mã câu S0001, S0002... từ transcript của SV2
      let newStartId = s.start_id;
      let newEndId = s.end_id;
      if (transcript?.sentences && transcript.sentences.length > 0) {
        const startSentence =
          transcript.sentences.find((sent) => finalStart <= sent.end) ||
          transcript.sentences[0];
        const endSentence =
          [...transcript.sentences]
            .reverse()
            .find((sent) => finalEnd >= sent.start) ||
          transcript.sentences[transcript.sentences.length - 1];
        if (startSentence) newStartId = startSentence.id;
        if (endSentence) newEndId = endSentence.id;
      }

      return {
        ...s,
        start: finalStart,
        end: finalEnd,
        start_id: newStartId,
        end_id: newEndId,
        parts: newParts,
      };
    });
    onUpdateSegments(updated);
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
                  <span title="Video & Audio liên kết đồng bộ" className="flex items-center text-purple-400">
                    <Link2 className="w-3 h-3" />
                  </span>
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
                  <span title="Video & Audio liên kết đồng bộ" className="flex items-center text-emerald-400">
                    <Link2 className="w-3 h-3" />
                  </span>
                  <Volume2 className="w-3 h-3 hover:text-white" />
                  <Lock className="w-3 h-3 hover:text-white" />
                </div>
              </div>
            </div>

            {/* Right Interactive Track Timeline Canvas */}
            <div
              ref={timelineContainerRef}
              onPointerDown={(e) => {
                if (resizingSeg) return;
                handlePointerDown(e);
              }}
              onPointerMove={(e) => {
                if (resizingSeg) {
                  handleEdgePointerMove(e);
                } else {
                  handlePointerMove(e);
                }
              }}
              onPointerUp={(e) => {
                if (resizingSeg) {
                  handleEdgePointerUp();
                } else {
                  handlePointerUp(e);
                }
              }}
              onPointerLeave={() => {
                if (resizingSeg) {
                  handleEdgePointerUp();
                } else {
                  handlePointerLeave();
                }
              }}
              style={{ minWidth: `${Math.max(100, zoomLevel)}%` }}
              className={`flex-1 flex flex-col relative select-none ${
                resizingSeg
                  ? resizingSeg.edge === "move"
                    ? "cursor-grabbing"
                    : "cursor-ew-resize"
                  : isScrubbing
                  ? "cursor-ew-resize"
                  : "cursor-pointer"
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
                  const isCurrentResizing = resizingSeg?.id === seg.id;
                  const curStart = isCurrentResizing ? resizingSeg.currentStart : seg.start;
                  const curEnd = isCurrentResizing ? resizingSeg.currentEnd : seg.end;

                  const leftPct = (curStart / Math.max(1, totalDuration)) * 100;
                  const widthPct = Math.min(
                    100 - leftPct,
                    ((curEnd - curStart) / Math.max(1, totalDuration)) * 100
                  );
                  const isSelected = activeSegmentId === seg.id;

                  return (
                    <div
                      key={seg.id}
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(1.2, widthPct)}%`,
                      }}
                      className={`absolute top-1 bottom-1 rounded-md border-2 transition-all group flex flex-col justify-between p-1 select-none ${
                        isSelected || isCurrentResizing
                          ? "border-purple-400 bg-purple-950/80 shadow-lg shadow-purple-500/30 z-10"
                          : "border-purple-600/60 bg-purple-950/30 hover:border-purple-400 z-0"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSegment(seg.id);
                        onSeek(seg.start);
                      }}
                    >
                      {/* Left Resize Handle (Kéo start) */}
                      <div
                        onPointerDown={(e) => handleStartEdgeDrag(e, seg)}
                        title="Kéo trái/phải để chỉnh điểm bắt đầu (Start)"
                        className="absolute left-0 top-0 bottom-0 w-3 bg-purple-500/0 hover:bg-purple-500/90 cursor-ew-resize z-20 flex items-center justify-center transition-colors group-hover:bg-purple-500/30 rounded-l"
                      >
                        <div className="w-0.5 h-4 bg-white/80 rounded-full" />
                      </div>

                      {/* Right Resize Handle (Kéo end) */}
                      <div
                        onPointerDown={(e) => handleEndEdgeDrag(e, seg)}
                        title="Kéo trái/phải để chỉnh điểm kết thúc (End)"
                        className="absolute right-0 top-0 bottom-0 w-3 bg-purple-500/0 hover:bg-purple-500/90 cursor-ew-resize z-20 flex items-center justify-center transition-colors group-hover:bg-purple-500/30 rounded-r"
                      >
                        <div className="w-0.5 h-4 bg-white/80 rounded-full" />
                      </div>

                      {/* Header bar: Kéo di chuyển toàn bộ đoạn */}
                      <div
                        onPointerDown={(e) => handleMoveDrag(e, seg)}
                        title="Bấm giữ và kéo để di chuyển vị trí phân đoạn"
                        className="flex items-center justify-between z-10 cursor-grab active:cursor-grabbing select-none px-2"
                      >
                        <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-white truncate pointer-events-none">
                          <Video className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                          <span className="truncate">{seg.slug}</span>
                        </div>
                        <span className="text-[9px] font-mono text-purple-300 shrink-0 ml-1 pointer-events-none">
                          {formatTime(curEnd - curStart)}
                        </span>
                      </div>

                      {/* Live dragging tooltip badge */}
                      {isCurrentResizing && (
                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 border border-purple-400 text-purple-200 px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap shadow-lg z-30 pointer-events-none">
                          {formatTime(curStart)} &rarr; {formatTime(curEnd)} ({formatTime(curEnd - curStart)})
                        </div>
                      )}

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
                      <div className="text-[10px] text-slate-300 truncate z-10 font-sans pointer-events-none px-2">
                        {seg.topic}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Track 2: Audio Track (A1) - ĐỒNG BỘ 100% VỚI PHÂN ĐOẠN VIDEO TRACK V1 */}
              <div className="h-14 bg-[#0a0b0e] relative w-full overflow-hidden border-b border-slate-800">
                {segments.map((seg) => {
                  const isCurrentResizing = resizingSeg?.id === seg.id;
                  const curStart = isCurrentResizing ? resizingSeg.currentStart : seg.start;
                  const curEnd = isCurrentResizing ? resizingSeg.currentEnd : seg.end;
                  const segDuration = Math.max(0.1, curEnd - curStart);

                  const leftPct = (curStart / Math.max(1, totalDuration)) * 100;
                  const widthPct = Math.min(
                    100 - leftPct,
                    (segDuration / Math.max(1, totalDuration)) * 100
                  );
                  const isSelected = activeSegmentId === seg.id;

                  const barCount = Math.max(16, Math.min(80, Math.round(segDuration * 3)));
                  const bars = generateSegmentWaveform(curStart, curEnd, barCount, transcript);

                  return (
                    <div
                      key={`audio-${seg.id}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(1.2, widthPct)}%`,
                      }}
                      className={`absolute top-1 bottom-1 rounded-md border-2 transition-all group flex flex-col justify-between p-1 select-none overflow-hidden ${
                        isSelected || isCurrentResizing
                          ? "border-emerald-400 bg-emerald-950/80 shadow-lg shadow-emerald-500/30 z-10"
                          : "border-emerald-600/50 bg-emerald-950/30 hover:border-emerald-400 z-0"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSegment(seg.id);
                        onSeek(seg.start);
                      }}
                    >
                      {/* Left Resize Handle (Kéo start) */}
                      <div
                        onPointerDown={(e) => handleStartEdgeDrag(e, seg)}
                        title="Kéo trái/phải để chỉnh điểm bắt đầu (Start)"
                        className="absolute left-0 top-0 bottom-0 w-3 bg-emerald-500/0 hover:bg-emerald-500/90 cursor-ew-resize z-20 flex items-center justify-center transition-colors group-hover:bg-emerald-500/30 rounded-l"
                      >
                        <div className="w-0.5 h-4 bg-white/80 rounded-full" />
                      </div>

                      {/* Right Resize Handle (Kéo end) */}
                      <div
                        onPointerDown={(e) => handleEndEdgeDrag(e, seg)}
                        title="Kéo trái/phải để chỉnh điểm kết thúc (End)"
                        className="absolute right-0 top-0 bottom-0 w-3 bg-emerald-500/0 hover:bg-emerald-500/90 cursor-ew-resize z-20 flex items-center justify-center transition-colors group-hover:bg-emerald-500/30 rounded-r"
                      >
                        <div className="w-0.5 h-4 bg-white/80 rounded-full" />
                      </div>

                      {/* Header bar: Kéo di chuyển toàn bộ đoạn */}
                      <div
                        onPointerDown={(e) => handleMoveDrag(e, seg)}
                        title="Bấm giữ và kéo để di chuyển vị trí phân đoạn âm thanh & video"
                        className="flex items-center justify-between z-10 cursor-grab active:cursor-grabbing select-none px-2"
                      >
                        <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-emerald-300 truncate pointer-events-none">
                          <Volume2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{seg.slug}</span>
                        </div>
                        <span className="text-[9px] font-mono text-emerald-400 shrink-0 ml-1 pointer-events-none">
                          {formatTime(segDuration)}
                        </span>
                      </div>

                      {/* Waveform Sóng âm động đồng bộ cho phân đoạn */}
                      <div className="absolute inset-0 top-4 bottom-1 px-1.5 flex items-end gap-[1.5px] pointer-events-none overflow-hidden opacity-85">
                        {bars.map((bar, bIdx) => {
                          const barTime = curStart + (bIdx / barCount) * segDuration;
                          const isPlayed = currentTime >= barTime;
                          return (
                            <div
                              key={bIdx}
                              style={{ height: `${bar}%` }}
                              className={`flex-1 min-w-[2px] rounded-t-xs transition-colors duration-75 ${
                                isPlayed ? "bg-emerald-300" : "bg-emerald-700/60"
                              }`}
                            />
                          );
                        })}
                      </div>

                      {/* Bottom topic label */}
                      <div className="text-[9px] text-emerald-200/70 truncate z-10 font-sans pointer-events-none px-2">
                        {seg.topic}
                      </div>
                    </div>
                  );
                })}

                {/* Reference Timestamp at Bottom-Right */}
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
