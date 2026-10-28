"use client";

import React, { useState, useRef, useEffect } from "react";
import { Segment } from "@/types";
import { formatTime } from "@/lib/utils";
import {
  Monitor,
  Smartphone,
  Video,
  Upload,
  Maximize2,
  X,
  Play,
  Sparkles,
} from "lucide-react";

interface VideoCanvasViewportProps {
  currentSegment?: Segment;
  currentTime: number;
  totalDuration: number;
  videoTitle: string;
  externalVideoUrl?: string | null;
  isPlaying?: boolean;
  onSeek?: (time: number) => void;
  onTogglePlay?: () => void;
  onDurationChange?: (duration: number) => void;
  onOpenAddVideo?: () => void;
  onSelectSegment?: (segmentId: string) => void;
  onPlay?: () => void;
}

export const VideoCanvasViewport: React.FC<VideoCanvasViewportProps> = ({
  currentSegment,
  currentTime,
  totalDuration,
  videoTitle,
  externalVideoUrl,
  isPlaying = false,
  onSeek,
  onTogglePlay,
  onDurationChange,
  onOpenAddVideo,
  onSelectSegment,
  onPlay,
}) => {
  const [aspect, setAspect] = useState<"landscape" | "portrait">("landscape");
  const [videoSrc, setVideoSrc] = useState<string | null>(externalVideoUrl || null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  useEffect(() => {
    if (externalVideoUrl) {
      setVideoSrc(externalVideoUrl);
    }
  }, [externalVideoUrl]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Xử lý nạp file video từ máy tính
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
      }
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setVideoFileName(file.name);
    }
  };

  // Đồng bộ Play/Pause với thẻ <video>
  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  // Đồng bộ tua thời gian (Seek) với thẻ <video>
  useEffect(() => {
    if (!videoRef.current) return;
    if (Math.abs(videoRef.current.currentTime - currentTime) > 0.4) {
      videoRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  // Khi metadata video được load (lấy thời lượng thật)
  const handleLoadedMetadata = () => {
    if (videoRef.current && onDurationChange) {
      const dur = videoRef.current.duration;
      if (dur && !isNaN(dur) && dur > 0) {
        onDurationChange(Number(dur.toFixed(1)));
      }
    }
  };

  // Cập nhật currentTime khi video tự chạy
  const handleTimeUpdate = () => {
    if (videoRef.current && onSeek && isPlaying) {
      onSeek(Number(videoRef.current.currentTime.toFixed(1)));
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Xử lý kéo thả phân đoạn từ cột danh sách vào màn hình để phát
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (raw) {
        const data = JSON.parse(raw);
        if (data.start !== undefined) {
          if (onSeek) onSeek(data.start);
          if (data.id && onSelectSegment) onSelectSegment(data.id);
          if (onPlay) onPlay();
          else if (onTogglePlay && !isPlaying) onTogglePlay();
        }
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0b0c10] overflow-hidden select-none min-h-0 min-w-0">
      {/* Top Header Bar of Viewport */}
      <div className="h-10 border-b border-slate-800/80 px-4 flex items-center justify-between shrink-0 bg-[#121318]/90 z-20">
        {/* Left: Video Status Indicator */}
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              videoSrc ? "bg-emerald-400 animate-pulse" : "bg-purple-500"
            }`}
          />
          <span className="text-xs font-bold text-white tracking-wide truncate max-w-[280px]">
            {videoFileName || videoTitle || "Bai05_VongLap.mp4"}
          </span>
          {videoSrc && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Đang phát video thật
            </span>
          )}
        </div>

        {/* Right: Controls (Upload video, Aspect toggle, Fullscreen) */}
        <div className="flex items-center gap-2">
          {/* Nút thêm / chọn video từ máy */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="video/mp4,video/mkv,video/webm,video/*"
            className="hidden"
          />
          <button
            onClick={() => {
              if (onOpenAddVideo) {
                onOpenAddVideo();
              } else {
                fileInputRef.current?.click();
              }
            }}
            title="Thêm video từ link URL hoặc tải tệp từ máy tính"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white shadow-sm transition"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{videoSrc ? "Đổi video" : "+ Thêm video"}</span>
          </button>

          {videoSrc && (
            <button
              onClick={() => {
                if (videoSrc) URL.revokeObjectURL(videoSrc);
                setVideoSrc(null);
                setVideoFileName(null);
              }}
              title="Đóng video và về màn hình giả lập"
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Landscape / Portrait switcher */}
          <button
            onClick={() => setAspect(aspect === "landscape" ? "portrait" : "landscape")}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#16171d] hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition"
            title="Đổi tỉ lệ khung hình (16:9 / 9:16)"
          >
            {aspect === "landscape" ? (
              <>
                <Monitor className="w-3.5 h-3.5 text-purple-400" />
                <span>16:9 Landscape</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                <span>9:16 Portrait</span>
              </>
            )}
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-[#16171d] text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 transition"
            title="Phóng to toàn màn hình"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Centered Viewport Screen: Đảm bảo video không bị tràn hay khuất góc trên và dưới */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 min-h-0 min-w-0 w-full h-full flex items-center justify-center p-2 sm:p-3 relative overflow-hidden bg-[#0d0e12]"
      >
        {/* Video Monitor Container: Bounded strictly by available viewport height & width */}
        <div
          ref={containerRef}
          className={`relative bg-black rounded-xl overflow-hidden shadow-2xl border border-slate-800 flex items-center justify-center transition-all duration-200 group ${
            aspect === "landscape" ? "aspect-video" : "aspect-[9/16]"
          }`}
          style={{
            maxHeight: "100%",
            maxWidth: "100%",
            height: "100%",
            width: "auto",
          }}
        >
          {/* Drop Target Indicator when dragging a scene card */}
          {isDragOver && (
            <div className="absolute inset-0 z-40 bg-purple-950/85 backdrop-blur-xs border-2 border-dashed border-purple-400 rounded-xl flex flex-col items-center justify-center gap-2.5 text-white animate-in fade-in duration-150">
              <div className="w-14 h-14 rounded-2xl bg-purple-600/40 border border-purple-400 flex items-center justify-center text-purple-300 shadow-2xl shadow-purple-600/40 animate-bounce">
                <Play className="w-7 h-7 fill-current ml-0.5" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white tracking-wide flex items-center justify-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Thả vào đây để phát phân đoạn này!</span>
                </p>
                <p className="text-xs text-purple-300 mt-1">
                  Studio sẽ tự động tua thời gian và phát ngay lập tức
                </p>
              </div>
            </div>
          )}

          {/* Real Video Element OR Simulated Canvas */}
          {videoSrc ? (
            /* Khi có video thật: video khớp 100% không bị che góc trên dưới */
            <div className="w-full h-full flex items-center justify-center bg-black relative">
              <video
                ref={videoRef}
                src={videoSrc}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onClick={onTogglePlay}
                className="w-full h-full object-contain cursor-pointer"
                playsInline
              />

              {/* Floating Top Info Pill (Chỉ hiện khi hover chuột để không che tab trình duyệt của video) */}
              <div className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <div className="text-[11px] font-semibold text-white/90 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 shadow-lg flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="truncate max-w-[220px]">{videoFileName || videoTitle}</span>
                  {currentSegment && (
                    <span className="text-purple-300 ml-1 font-mono">
                      • #{currentSegment.topic_no} {currentSegment.topic}
                    </span>
                  )}
                </div>
              </div>

              {/* Floating Bottom Time Badge (Chỉ hiện khi hover góc dưới) */}
              <div className="absolute bottom-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <div className="text-[11px] font-mono text-white/90 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 shadow-lg flex items-center gap-1.5">
                  <span className="text-purple-400 font-bold">{formatTime(currentTime)}</span>
                  <span className="text-slate-500">/</span>
                  <span>{formatTime(totalDuration)}</span>
                </div>
              </div>
            </div>
          ) : (
            /* Khi chưa nạp video: Hiển thị giao diện Studio giả lập to rõ */
            <div className="w-full h-full flex items-center justify-center relative overflow-hidden pointer-events-none select-none p-6">
              <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-[#0e1017] to-black" />
              <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px]" />

              <div className="relative text-center z-10 px-6 py-4 space-y-3 max-w-lg">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600/40 via-indigo-600/30 to-slate-800 border border-purple-500/40 mx-auto flex items-center justify-center shadow-xl shadow-purple-600/20">
                  <Video className="w-8 h-8 text-purple-400" />
                </div>

                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-widest text-purple-400 font-bold">
                    {currentSegment ? currentSegment.section : "Màn hình Studio xem trước"}
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-white tracking-tight drop-shadow-lg">
                    {currentSegment ? currentSegment.topic : "Vòng lặp bài giảng"}
                  </div>
                  {currentSegment && (
                    <div className="text-xs font-mono text-slate-300">
                      Mục #{currentSegment.topic_no}: {formatTime(currentSegment.start)} &rarr; {formatTime(currentSegment.end)}
                      <span className="text-purple-400 ml-2">({(currentSegment.end - currentSegment.start).toFixed(1)}s)</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 pointer-events-auto">
                  <button
                    onClick={() => {
                      if (onOpenAddVideo) {
                        onOpenAddVideo();
                      } else {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 text-xs font-semibold transition hover:scale-105 active:scale-95 shadow-lg shadow-purple-600/20"
                  >
                    <Upload className="w-4 h-4 text-purple-400" />
                    <span>Thêm video bài giảng từ link URL hoặc tải từ máy</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
