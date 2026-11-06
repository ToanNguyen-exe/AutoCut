"use client";

import React, { useState, useEffect } from "react";
import { SegmentsData } from "@/types";
import { formatTime } from "@/lib/utils";
import { Play, Pause, RotateCcw, FastForward, Rewind, Video } from "lucide-react";

interface VideoPlayerPreviewProps {
  data: SegmentsData;
  currentTime: number;
  onSeek: (seconds: number) => void;
  activeSegmentId?: string;
  onSelectSegment: (segmentId: string) => void;
}

const SECTION_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  "Lý thuyết": { bg: "bg-indigo-600/40", border: "border-indigo-500", text: "text-indigo-300" },
  "Thực hành ví dụ": { bg: "bg-emerald-600/40", border: "border-emerald-500", text: "text-emerald-300" },
  "Bài tập": { bg: "bg-amber-600/40", border: "border-amber-500", text: "text-amber-300" },
  "Giới thiệu": { bg: "bg-blue-600/40", border: "border-blue-500", text: "text-blue-300" },
  "Hỏi đáp": { bg: "bg-purple-600/40", border: "border-purple-500", text: "text-purple-300" },
  "Tổng kết": { bg: "bg-pink-600/40", border: "border-pink-500", text: "text-pink-300" },
  "Ngoài lề": { bg: "bg-slate-600/40", border: "border-slate-500", text: "text-slate-400" },
};

export const VideoPlayerPreview: React.FC<VideoPlayerPreviewProps> = ({
  data,
  currentTime,
  onSeek,
  activeSegmentId,
  onSelectSegment,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const totalDuration = Math.max(1, data.segments.reduce((max, s) => Math.max(max, s.end), 0));

  // Giả lập playback timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        onSeek(Math.min(totalDuration, currentTime + 1));
        if (currentTime >= totalDuration) {
          setIsPlaying(false);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentTime, totalDuration, onSeek]);

  // Tìm segment hiện tại theo currentTime
  const currentSegment = data.segments.find(
    (s) => currentTime >= s.start && currentTime <= s.end
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl mb-6">
      <div className="flex flex-col lg:flex-row gap-6 items-center">
        {/* Virtual Video Screen */}
        <div className="w-full lg:w-3/5 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden aspect-video relative flex flex-col justify-between p-4 shadow-inner">
          {/* Header watermark */}
          <div className="flex items-center justify-between z-10">
            <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-800/80 text-slate-300 backdrop-blur-sm border border-slate-700">
              <Video className="w-3.5 h-3.5 text-indigo-400" />
              {data.video}
            </span>
            {currentSegment && (
              <span className="text-xs px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
                {currentSegment.section}
              </span>
            )}
          </div>

          {/* Central Overlay Info */}
          <div className="text-center my-auto z-10 px-4">
            {currentSegment ? (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-indigo-400 font-bold">
                  Phân đoạn #{currentSegment.topic_no}: {currentSegment.section}
                </div>
                <div className="text-2xl lg:text-3xl font-extrabold text-white drop-shadow-md">
                  {currentSegment.topic}
                </div>
                <div className="text-xs text-slate-400">
                  Khoảng câu: {currentSegment.start_id} → {currentSegment.end_id} ({formatTime(currentSegment.start)} - {formatTime(currentSegment.end)})
                </div>
                {currentSegment.parts.length > 1 && (
                  <div className="inline-block mt-2 text-xs px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full font-medium">
                    Tách thành {currentSegment.parts.length} phần con
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-500 text-sm">
                Nhấp vào thanh timeline hoặc nút &quot;Xem thử&quot; để phát phân đoạn
              </div>
            )}
          </div>

          {/* Bottom Time Bar in Player */}
          <div className="flex items-center justify-between text-xs text-slate-400 z-10 bg-slate-900/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="font-mono text-white font-medium">{formatTime(currentTime)}</span>
            <span className="font-mono">{formatTime(totalDuration)}</span>
          </div>

          {/* Background Ambient Glow */}
          <div className="absolute inset-0 bg-gradient-to-t from-indigo-950/30 to-transparent pointer-events-none" />
        </div>

        {/* Controls & Mini Info */}
        <div className="w-full lg:w-2/5 flex flex-col justify-between h-full space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white mb-1">
              Bộ phát xem thử & Kiểm tra mốc cắt
            </h3>
            <p className="text-xs text-slate-400">
              Kiểm tra điểm bắt đầu và kết thúc của từng phân đoạn trước khi ra lệnh cắt video bằng FFmpeg.
            </p>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-center gap-3 py-4 bg-slate-800/40 rounded-xl border border-slate-700/50">
            <button
              onClick={() => onSeek(Math.max(0, currentTime - 5))}
              title="Lùi 5 giây"
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
            >
              <Rewind className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-3.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition transform hover:scale-105"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>

            <button
              onClick={() => onSeek(Math.min(totalDuration, currentTime + 5))}
              title="Tiến 5 giây"
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
            >
              <FastForward className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                setIsPlaying(false);
                onSeek(0);
              }}
              title="Về đầu video"
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Segment Jump List */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-400">Nhảy nhanh tới chủ đề:</div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {data.segments.map((seg) => {
                const isActive = activeSegmentId === seg.id || currentSegment?.id === seg.id;
                return (
                  <button
                    key={seg.id}
                    onClick={() => {
                      onSeek(seg.start);
                      onSelectSegment(seg.id);
                    }}
                    className={`text-xs px-2 py-1 rounded-md transition truncate max-w-[160px] ${
                      isActive
                        ? "bg-indigo-600 text-white font-medium"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                    title={`${seg.topic} (${formatTime(seg.start)} - ${formatTime(seg.end)})`}
                  >
                    {seg.topic}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Visual Multi-Segment Timeline */}
      <div className="mt-6 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span className="font-medium text-slate-300">Dòng thời gian phân đoạn (Timeline Segments)</span>
          <span className="font-mono text-indigo-400">
            {formatTime(currentTime)} / {formatTime(totalDuration)}
          </span>
        </div>

        {/* Timeline track */}
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
            onSeek(Number((ratio * totalDuration).toFixed(1)));
          }}
          className="relative h-10 w-full bg-slate-950 rounded-lg overflow-hidden cursor-pointer border border-slate-800 flex"
        >
          {data.segments.map((seg) => {
            const widthPct = Math.max(0.5, ((seg.end - seg.start) / totalDuration) * 100);
            const style = SECTION_COLORS[seg.section] || {
              bg: "bg-indigo-600/40",
              border: "border-indigo-500",
              text: "text-indigo-300",
            };
            const isSelected = activeSegmentId === seg.id;

            return (
              <div
                key={seg.id}
                style={{ width: `${widthPct}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(seg.start);
                  onSelectSegment(seg.id);
                }}
                title={`${seg.section} - ${seg.topic} (${formatTime(seg.start)} - ${formatTime(seg.end)})`}
                className={`h-full border-r ${style.border} ${style.bg} relative transition-all hover:brightness-125 group flex items-center justify-center px-1 overflow-hidden ${
                  isSelected ? "ring-2 ring-indigo-400 ring-inset brightness-125" : ""
                }`}
              >
                <span className={`text-[10px] font-semibold truncate ${style.text} group-hover:scale-105 transition-transform`}>
                  {seg.topic}
                </span>
              </div>
            );
          })}

          {/* Playhead pointer */}
          <div
            style={{ left: `${(currentTime / totalDuration) * 100}%` }}
            className="absolute top-0 bottom-0 w-1 bg-red-500 shadow-md shadow-red-500/50 z-20 pointer-events-none transition-[left] duration-150"
          >
            <div className="w-2.5 h-2.5 bg-red-500 rotate-45 -ml-[3px] -mt-1 rounded-xs" />
          </div>
        </div>
      </div>
    </div>
  );
};
