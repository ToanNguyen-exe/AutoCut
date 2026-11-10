"use client";

import React, { useState, useRef, useEffect } from "react";
import { Segment } from "@/types";
import { formatTime } from "@/lib/utils";
import { saveVideoBlob } from "@/lib/videoStorage";
import {
  Monitor,
  Smartphone,
  Video,
  Upload,
  Maximize2,
  X,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Sparkles,
} from "lucide-react";

interface VideoCanvasViewportProps {
  currentSegment?: Segment;
  currentTime: number;
  totalDuration: number;
  videoTitle: string;
  externalVideoUrl?: string | null;
  isPlaying?: boolean;
  volume?: number;
  isMuted?: boolean;
  isDemo?: boolean;
  isAnalyzing?: boolean;
  analysisProgress?: number;
  analysisStep?: string;
  mode?: string;
  onSeek?: (time: number) => void;
  onTogglePlay?: () => void;
  onDurationChange?: (duration: number) => void;
  onOpenAddVideo?: () => void;
  onAnalyzeAI?: () => void;
  onSelectSegment?: (segmentId: string) => void;
  onPlay?: () => void;
  onVolumeChange?: (vol: number) => void;
  onToggleMute?: () => void;
}

export const VideoCanvasViewport: React.FC<VideoCanvasViewportProps> = ({
  currentSegment,
  currentTime,
  totalDuration,
  videoTitle,
  externalVideoUrl,
  isPlaying = false,
  volume = 100,
  isMuted = false,
  isDemo = false,
  isAnalyzing = false,
  analysisProgress = 0,
  analysisStep = "",
  mode = "guided",
  onSeek,
  onTogglePlay,
  onDurationChange,
  onOpenAddVideo,
  onAnalyzeAI,
  onSelectSegment,
  onPlay,
  onVolumeChange,
  onToggleMute,
}) => {
  const [aspect, setAspect] = useState<"landscape" | "portrait">("landscape");
  const [videoSrc, setVideoSrc] = useState<string | null>(externalVideoUrl || null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [needsUserUnmute, setNeedsUserUnmute] = useState<boolean>(false);
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (externalVideoUrl) {
      setVideoSrc(externalVideoUrl);
      setVideoLoadError(null);
    }
  }, [externalVideoUrl]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [isPlayerScrubbing, setIsPlayerScrubbing] = useState(false);

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || !onSeek || !progressBarRef.current) return;
    setIsPlayerScrubbing(true);
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(Number((ratio * totalDuration).toFixed(1)));
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPlayerScrubbing || !onSeek || !progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(Number((ratio * totalDuration).toFixed(1)));
  };

  const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPlayerScrubbing) {
      setIsPlayerScrubbing(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleUserUnmute = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.volume = Math.max(0.1, volume / 100);
      setNeedsUserUnmute(false);
      if (onToggleMute && isMuted) {
        onToggleMute();
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await saveVideoBlob(file.name, file);
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setVideoFileName(file.name);
      setVideoLoadError(null);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const realDuration = videoRef.current.duration;
      if (realDuration && isFinite(realDuration) && realDuration > 0) {
        if (onDurationChange) {
          onDurationChange(realDuration);
        }
      }

      videoRef.current.currentTime = currentTime;
      videoRef.current.volume = isMuted ? 0 : volume / 100;
      videoRef.current.muted = isMuted;

      if (isPlaying) {
        videoRef.current
          .play()
          .then(() => setNeedsUserUnmute(false))
          .catch(() => {
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().then(() => setNeedsUserUnmute(true)).catch(() => {});
            }
          });
      }
    }
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = isMuted ? 0 : volume / 100;
      if (!isMuted && volume > 0) {
        setNeedsUserUnmute(false);
      }
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current
          .play()
          .then(() => setNeedsUserUnmute(false))
          .catch(() => {
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().then(() => setNeedsUserUnmute(true)).catch(() => {});
            }
          });
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (videoRef.current) {
      const diff = Math.abs(videoRef.current.currentTime - currentTime);
      if (diff > 0.3) {
        videoRef.current.currentTime = currentTime;
      }
    }
  }, [currentTime]);

  const handleTimeUpdate = () => {
    if (videoRef.current && isPlaying && onSeek) {
      const current = videoRef.current.currentTime;
      if (Math.abs(current - currentTime) >= 0.5) {
        onSeek(Number(current.toFixed(1)));
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDragOver) setIsDragOver(true);
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
        const seg = JSON.parse(raw);
        if (seg && typeof seg.start === "number") {
          if (onSeek) onSeek(seg.start);
          if (onSelectSegment && seg.id) onSelectSegment(seg.id);
          if (onPlay) onPlay();
        }
      }
    } catch {
      // ignore
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-200/60 overflow-hidden select-none min-h-0 min-w-0 text-slate-800">
      {/* Top Header Bar of Viewport */}
      <div className="h-10 border-b border-slate-300 px-4 flex items-center justify-between shrink-0 bg-slate-100 z-20">
        {/* Left: Video Status Indicator */}
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              videoSrc ? "bg-emerald-500 animate-pulse" : "bg-indigo-600"
            }`}
          />
          <span className="text-xs font-bold text-slate-900 tracking-wide truncate max-w-[280px]">
            {videoFileName || videoTitle || "Bai05_VongLap.mp4"}
          </span>
          {isDemo ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
              Demo Mẫu
            </span>
          ) : isAnalyzing ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-300 font-bold animate-pulse flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-indigo-600 animate-spin" />
              <span>⚡ Đang phân tích AI: {Math.round(analysisProgress)}%</span>
            </span>
          ) : mode === "raw" ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300 font-bold">
              Chưa phân tích (1 đoạn)
            </span>
          ) : videoSrc ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold">
              ✓ Đã phân tích bởi AI
            </span>
          ) : null}
        </div>

        {/* Right: Controls (Upload video, Aspect toggle, Fullscreen) */}
        <div className="flex items-center gap-2">
          {/* Quick AI Analyze Button if raw */}
          {mode === "raw" && onAnalyzeAI && (
            <button
              onClick={onAnalyzeAI}
              disabled={isAnalyzing}
              className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition hover:scale-102 active:scale-98"
              title="Phân tích nội dung và chia đoạn bằng AI"
            >
              <Sparkles className="w-3 h-3 text-amber-300" />
              <span>Phân Tích AI</span>
            </button>
          )}

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
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition"
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
              className="p-1.5 rounded-lg bg-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-300 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Landscape / Portrait switcher */}
          <button
            onClick={() => setAspect(aspect === "landscape" ? "portrait" : "landscape")}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 shadow-2xs transition"
            title="Đổi tỉ lệ khung hình (16:9 / 9:16)"
          >
            {aspect === "landscape" ? (
              <>
                <Monitor className="w-3.5 h-3.5 text-indigo-600" />
                <span>16:9 Landscape</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                <span>9:16 Portrait</span>
              </>
            )}
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:text-slate-900 hover:bg-slate-200 border border-slate-300 shadow-2xs transition"
            title="Phóng to toàn màn hình"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Centered Viewport Screen */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 min-h-0 min-w-0 w-full h-full flex items-center justify-center p-2 sm:p-3 relative overflow-hidden bg-slate-200/60"
      >
        {/* Video Monitor Container */}
        <div
          ref={containerRef}
          className={`relative bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-300 flex items-center justify-center transition-all duration-200 group ${
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
            <div className="absolute inset-0 z-40 bg-indigo-900/85 backdrop-blur-xs border-2 border-dashed border-indigo-400 rounded-xl flex flex-col items-center justify-center gap-2.5 text-white animate-in fade-in duration-150">
              <div className="w-14 h-14 rounded-2xl bg-indigo-600/40 border border-indigo-400 flex items-center justify-center text-indigo-200 shadow-xl animate-bounce">
                <Play className="w-7 h-7 fill-current ml-0.5" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white tracking-wide flex items-center justify-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Thả vào đây để phát phân đoạn này!</span>
                </p>
                <p className="text-xs text-indigo-200 mt-1">
                  Studio sẽ tự động tua thời gian và phát ngay lập tức
                </p>
              </div>
            </div>
          )}

          {/* Real Video Element OR Simulated Canvas */}
          {/* AI Analyzing Progress Overlay */}
          {isAnalyzing && (
            <div className="absolute inset-0 z-35 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-white text-center animate-in fade-in duration-200">
              <div className="relative mb-3">
                <div className="w-16 h-16 rounded-full border-3 border-indigo-400/30 border-t-indigo-400 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-amber-300 animate-pulse" />
                </div>
              </div>
              <div className="text-3xl font-black font-mono text-white tracking-tight mb-1">
                {Math.round(analysisProgress)}%
              </div>
              <p className="text-xs font-bold text-indigo-200 mb-3 max-w-xs truncate">
                {analysisStep || "Đang phân tích video bằng AI..."}
              </p>
              <div className="w-64 bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700 shadow-inner">
                <div
                  className="bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-500 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(5, analysisProgress))}%` }}
                />
              </div>
            </div>
          )}

          {videoSrc ? (
            <div className="w-full h-full flex items-center justify-center bg-black relative">
              <video
                ref={videoRef}
                src={videoSrc}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onClick={onTogglePlay}
                onError={() => {
                  const isWebpage =
                    videoSrc &&
                    (videoSrc.includes("tiktok.com") ||
                      videoSrc.includes("youtube.com") ||
                      videoSrc.includes("youtu.be") ||
                      videoSrc.includes("facebook.com"));
                  if (isWebpage) {
                    setVideoLoadError(
                      "Link bạn nhập là trang web TikTok / mạng xã hội. Thẻ phát của trình duyệt cần tệp video trực tiếp (.mp4). Studio vẫn lưu giữ toàn bộ phân đoạn và thời lượng để bạn duyệt và chỉnh sửa bình thường!"
                    );
                  } else {
                    setVideoLoadError(
                      "Không thể phát video từ URL này (do CORS hoặc định dạng web). Bạn có thể bấm 'Đổi video' để tải tệp MP4 từ máy lên."
                    );
                  }
                }}
                className="w-full h-full object-contain cursor-pointer"
                playsInline
              />

              {/* Webpage / Load Error Fallback Overlay */}
              {videoLoadError && (
                <div className="absolute inset-0 z-20 bg-slate-900/95 backdrop-blur-xs p-6 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-2">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">Chế độ Studio Dự Án Phân Đoạn</h4>
                  <p className="text-xs text-slate-300 max-w-sm mb-4 leading-relaxed">
                    {videoLoadError}
                  </p>
                  <button
                    onClick={() => {
                      if (onOpenAddVideo) onOpenAddVideo();
                      else fileInputRef.current?.click();
                    }}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition hover:scale-105 active:scale-95"
                  >
                    + Tải tệp MP4 từ máy tính lên
                  </button>
                </div>
              )}

              {/* Floating Top Info Pill */}
              <div className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <div className="text-[11px] font-semibold text-white/95 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/20 shadow-md flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="truncate max-w-[220px]">{videoFileName || videoTitle}</span>
                  {currentSegment && (
                    <span className="text-indigo-300 ml-1 font-mono">
                      • #{currentSegment.topic_no} {currentSegment.topic}
                    </span>
                  )}
                </div>
              </div>

              {/* Browser Autoplay Sound Banner */}
              {needsUserUnmute && (
                <button
                  onClick={handleUserUnmute}
                  className="absolute top-12 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xl flex items-center gap-2 animate-bounce border border-indigo-400 cursor-pointer"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Trình duyệt đang chặn âm thanh - Nhấn vào đây để BẬT TIẾNG 🔊</span>
                </button>
              )}

              {/* Interactive Player Controls */}
              <div className="absolute bottom-0 left-0 right-0 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-3 pt-6 flex flex-col gap-2">
                {/* Progress Bar Seeker with Playhead */}
                <div
                  ref={progressBarRef}
                  onPointerDown={handleProgressPointerDown}
                  onPointerMove={handleProgressPointerMove}
                  onPointerUp={handleProgressPointerUp}
                  className="w-full h-4 flex items-center cursor-pointer group/bar relative"
                >
                  <div className="w-full h-1.5 group-hover/bar:h-2 bg-white/30 rounded-full overflow-hidden transition-all relative">
                    <div
                      style={{
                        width: `${(currentTime / Math.max(1, totalDuration)) * 100}%`,
                      }}
                      className="h-full bg-indigo-500 rounded-full"
                    />
                  </div>

                  {/* Playhead Dot */}
                  <div
                    style={{
                      left: `${(currentTime / Math.max(1, totalDuration)) * 100}%`,
                    }}
                    className="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-indigo-600 transition-[transform] group-hover/bar:scale-110 pointer-events-none"
                  />
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-between text-white text-xs">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={onTogglePlay}
                      className="p-1 hover:text-indigo-400 transition"
                      title={isPlaying ? "Tạm dừng" : "Phát"}
                    >
                      {isPlaying ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      )}
                    </button>

                    <button
                      onClick={() => onSeek && onSeek(Math.max(0, currentTime - 10))}
                      className="p-1 hover:text-indigo-400 transition"
                      title="Lùi 10 giây"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() =>
                        onSeek && onSeek(Math.min(totalDuration, currentTime + 10))
                      }
                      className="p-1 hover:text-indigo-400 transition"
                      title="Tiến 10 giây"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>

                    <div className="font-mono text-[11px] text-slate-300 ml-1">
                      <span className="text-white font-bold">{formatTime(currentTime)}</span>
                      <span className="text-slate-500 mx-1">/</span>
                      <span>{formatTime(totalDuration)}</span>
                    </div>

                    {/* Video Player Volume Slider */}
                    <div className="flex items-center gap-1.5 ml-2">
                      <button
                        onClick={() => {
                          if (needsUserUnmute) handleUserUnmute();
                          else if (onToggleMute) onToggleMute();
                        }}
                        className="p-1 hover:text-indigo-400 transition"
                        title={isMuted ? "Bật âm thanh" : "Tắt tiếng"}
                      >
                        {isMuted || volume === 0 ? (
                          <VolumeX className="w-4 h-4 text-rose-400" />
                        ) : (
                          <Volume2 className="w-4 h-4 text-slate-300" />
                        )}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={isMuted ? 0 : volume}
                        onChange={(e) => {
                          if (needsUserUnmute) handleUserUnmute();
                          if (onVolumeChange) onVolumeChange(Number(e.target.value));
                        }}
                        className="w-14 h-1 bg-white/30 rounded appearance-none cursor-pointer accent-indigo-500"
                      />
                      <span className="font-mono text-[10px] text-slate-300 w-6">
                        {isMuted ? "0%" : `${volume}%`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleFullscreen}
                      className="p-1 hover:text-indigo-400 transition"
                      title="Toàn màn hình"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Khi chưa nạp video: Hiển thị giao diện Studio giả lập to rõ */
            <div className="w-full h-full flex items-center justify-center relative overflow-hidden pointer-events-none select-none p-6 bg-slate-900">
              <div className="relative text-center z-10 px-6 py-4 space-y-3 max-w-lg">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 mx-auto flex items-center justify-center shadow-md">
                  <Video className="w-8 h-8 text-indigo-400" />
                </div>

                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-widest text-indigo-400 font-bold">
                    {isDemo
                      ? (currentSegment?.section || "DEMO MẪU")
                      : (currentSegment?.section || "DỰ ÁN STUDIO")}
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-white tracking-tight drop-shadow-md">
                    {isDemo
                      ? (currentSegment?.topic || "Vòng lặp bài giảng")
                      : (videoFileName || videoTitle || currentSegment?.topic || "Dự án video")}
                  </div>
                  {currentSegment && (
                    <div className="text-xs font-mono text-slate-300">
                      Mục #{currentSegment.topic_no}: {formatTime(currentSegment.start)} &rarr; {formatTime(currentSegment.end)}
                      <span className="text-indigo-400 ml-2">({(currentSegment.end - currentSegment.start).toFixed(1)}s)</span>
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
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition hover:scale-102 active:scale-98 shadow-md"
                  >
                    <Upload className="w-4 h-4 text-white" />
                    <span>
                      {isDemo
                        ? "Thêm video bài giảng từ link URL hoặc tải từ máy"
                        : `Nạp lại tệp "${videoFileName || videoTitle}" để phát tiếp`}
                    </span>
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
