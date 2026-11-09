"use client";

import React, { useState, useRef, useEffect } from "react";
import { Segment } from "@/types";
import {
  Maximize2,
  Play,
  Volume2,
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
  currentTime,
  totalDuration,
  externalVideoUrl,
  isPlaying = false,
  volume = 100,
  isMuted = false,
  onSeek,
  onTogglePlay,
  onDurationChange,
  onOpenAddVideo,
  onSelectSegment,
  onPlay,
  onToggleMute,
}) => {
  const [aspect, setAspect] = useState<"landscape" | "portrait">("landscape");
  const [videoSrc, setVideoSrc] = useState<string | null>(externalVideoUrl || null);
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

  // Định dạng hiển thị giờ/phút/giây/khung hình (ví dụ 00:00:02:45 / 00:08:55:00)
  const formatTimecode = (sec: number) => {
    const totalSec = Math.floor(sec);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const frames = Math.floor((sec - totalSec) * 30); // 30 fps

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames
      .toString()
      .padStart(2, "0")}`;
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden select-none min-h-0 min-w-0 text-slate-800">
      {/* Top Header: Trình phát & 16:9 Landscape */}
      <div className="h-12 border-b border-slate-200/90 px-5 flex items-center justify-between shrink-0 bg-white z-20 select-none">
        {/* Left: Tiêu đề Trình phát */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-base text-slate-900 tracking-tight">
            Trình phát
          </span>
        </div>

        {/* Right: Tỉ lệ 16:9 Landscape & Nút thao tác */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAspect(aspect === "landscape" ? "portrait" : "landscape")}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition cursor-pointer shadow-2xs"
            title="Đổi tỉ lệ khung hình (16:9 Landscape / 9:16 Portrait)"
          >
            <span>{aspect === "landscape" ? "16:9 Landscape" : "9:16 Portrait"}</span>
          </button>
        </div>
      </div>

      {/* Main Centered Viewport Screen (Thu nhỏ lại để nhường diện tích cho Chatbox AI) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 min-h-0 min-w-0 w-full h-full flex flex-col items-center justify-center p-3 lg:p-4 relative overflow-hidden bg-white"
      >
        {/* Video Canvas Container (Compact size) */}
        <div
          ref={containerRef}
          className={`relative rounded-2xl overflow-hidden shadow-xs border border-slate-200/90 flex flex-col items-center justify-center transition-all duration-200 group ${
            aspect === "landscape" ? "aspect-video" : "aspect-[9/16]"
          }`}
          style={{
            maxHeight: "75%",
            maxWidth: "92%",
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
                <p className="text-sm font-bold text-white tracking-wide">
                  Thả vào đây để phát phân đoạn này!
                </p>
              </div>
            </div>
          )}

          {/* Real Video Element OR Crisp Modern Slide Canvas matching reference image */}
          {videoSrc ? (
            <div className="w-full h-full flex items-center justify-center bg-black relative">
              <video
                ref={videoRef}
                src={videoSrc}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onClick={onTogglePlay}
                onError={() => {
                  setVideoLoadError(
                    "Không thể phát video từ URL này. Bạn có thể nhấn '+ Thêm video' để tải tệp MP4 từ máy tính lên."
                  );
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
            </div>
          ) : (
            /* Crisp Modern Lecture Slide Matching Reference Image */
            <div className="w-full h-full bg-[#f4f7fb] flex flex-col justify-between p-6 sm:p-10 relative select-none">
              {/* Top-Right Domain Watermark */}
              <div className="w-full flex justify-end">
                <span className="text-xs sm:text-sm font-mono text-slate-400 font-semibold tracking-wide">
                  titv.vn
                </span>
              </div>

              {/* Center Lecture Slide Content */}
              <div className="my-auto space-y-2 text-left pl-2 sm:pl-6">
                <div className="text-xl sm:text-2xl font-black text-emerald-600 tracking-tight">
                  BÀI 08
                </div>
                <div className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight leading-tight">
                  <div>ÉP KIỂU DỮ LIỆU</div>
                  <div>TRONG LẬP TRÌNH PYTHON</div>
                </div>
                <div className="pt-2">
                  <span className="inline-block px-3 py-1.5 rounded-lg bg-[#a3e635] text-slate-900 text-xs sm:text-sm font-bold tracking-tight shadow-2xs">
                    TỰ HỌC LẬP TRÌNH PYTHON
                  </span>
                </div>
              </div>

              {/* Bottom Placeholder spacer */}
              <div className="w-full h-4" />
            </div>
          )}
        </div>

        {/* Bottom Time Counter & Fullscreen Icon matching reference image */}
        <div className="w-full max-w-[85%] flex items-center justify-between pt-2.5 px-2">
          {/* Digital Timecode (00:00:02:45 / 00:08:55:00) */}
          <div className="font-mono text-sm sm:text-base font-bold text-indigo-600 tracking-wider">
            {formatTimecode(currentTime)} / {formatTimecode(totalDuration)}
          </div>

          {/* Fullscreen icon */}
          <button
            onClick={toggleFullscreen}
            className="p-1 text-slate-400 hover:text-slate-800 transition"
            title="Toàn màn hình"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
