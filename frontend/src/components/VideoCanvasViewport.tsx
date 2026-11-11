"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Segment, JoinedVideoClip } from "@/types";
import { formatTime } from "@/lib/utils";
import { resolvePlayableVideoUrl } from "@/lib/videoLibrary";
import {
  Maximize2,
  Play,
  RotateCcw,
  Volume2,
  Sparkles,
  Film,
  Link2,
  UploadCloud,
} from "lucide-react";

interface VideoCanvasViewportProps {
  currentSegment?: Segment;
  segments?: Segment[];
  currentTime: number;
  totalDuration: number;
  videoTitle: string;
  externalVideoUrl?: string | null;
  joinedVideos?: JoinedVideoClip[];
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
  joinedVideos = [],
  segments = [],
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

  // Xác định clip đang hoạt động dựa trên currentTime và danh sách joinedVideos
  const { activeClip, activeClipIndex } = useMemo(() => {
    if (!joinedVideos || joinedVideos.length === 0) {
      return { activeClip: null, activeClipIndex: 0 };
    }
    const idx = joinedVideos.findIndex(
      (v) => currentTime >= v.startOffset && currentTime < v.endOffset
    );
    if (idx >= 0) {
      return { activeClip: joinedVideos[idx], activeClipIndex: idx };
    }
    return {
      activeClip: joinedVideos[joinedVideos.length - 1],
      activeClipIndex: joinedVideos.length - 1,
    };
  }, [joinedVideos, currentTime]);

  const rawUrl = activeClip?.url || externalVideoUrl || null;
  const activeVideoUrl = useMemo(() => {
    const fileName = activeClip?.fileName || activeClip?.title || "Bai08_Ep_kieu_du_lieu.mp4";
    if (!rawUrl) {
      return resolvePlayableVideoUrl(undefined, fileName);
    }
    return resolvePlayableVideoUrl(rawUrl, fileName);
  }, [rawUrl, activeClip]);

  const localTargetTime = activeClip
    ? Math.max(0, Math.min(activeClip.duration, currentTime - activeClip.startOffset))
    : currentTime;

  const [videoSrc, setVideoSrc] = useState<string | null>(activeVideoUrl);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [needsUserUnmute, setNeedsUserUnmute] = useState<boolean>(false);
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (activeVideoUrl) {
      setVideoSrc(activeVideoUrl);
      setVideoLoadError(null);
    }
  }, [activeVideoUrl]);

  const handleVideoError = async () => {
    const fileName = activeClip?.fileName || "Bai08_Ep_kieu_du_lieu.mp4";

    // 1. Kiểm tra trong IndexedDB xem có blob của file đã lưu không
    try {
      const { getVideoBlob } = await import("@/lib/videoStorage");
      const blob = await getVideoBlob(fileName);
      if (blob) {
        const freshBlobUrl = URL.createObjectURL(blob);
        if (videoSrc !== freshBlobUrl) {
          console.info("Khôi phục video từ IndexedDB thành công cho:", fileName);
          setVideoSrc(freshBlobUrl);
          setVideoLoadError(null);
          return;
        }
      }
    } catch {
      // ignore
    }

    // 2. Thử fallback API stream
    const apiStreamUrl = `/api/stream?file=${encodeURIComponent(fileName)}`;

    if (videoSrc !== apiStreamUrl) {
      console.warn("Thử fallback video stream cho:", fileName);
      setVideoSrc(apiStreamUrl);
      setVideoLoadError(null);
    } else {
      setVideoLoadError(
        "Không thể tải video từ luồng hiện tại. Bạn có thể nhấn 'Thử lại' hoặc 'Tải video lên'."
      );
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const activeClipRef = useRef(activeClip);
  activeClipRef.current = activeClip;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onSelectSegmentRef = useRef(onSelectSegment);
  onSelectSegmentRef.current = onSelectSegment;

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
      if (realDuration && isFinite(realDuration) && realDuration > 0 && (!joinedVideos || joinedVideos.length <= 1)) {
        if (onDurationChange) {
          onDurationChange(realDuration);
        }
      }

      videoRef.current.currentTime = localTargetTime;
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
        // Kiểm tra nếu currentTime đang rơi vào khoảng đã xóa trước khi phát:
        const segs = segmentsRef.current;
        const cTime = currentTimeRef.current;
        const clip = activeClipRef.current;
        if (segs && segs.length > 0) {
          const sorted = [...segs].sort((a, b) => a.start - b.start);
          const inSeg = sorted.some((s) => cTime >= s.start - 0.1 && cTime < s.end);
          if (!inSeg) {
            const next = sorted.find((s) => s.start > cTime) || sorted[0];
            const localTarget = clip
              ? Math.max(0, Math.min(clip.duration, next.start - clip.startOffset))
              : next.start;
            videoRef.current.currentTime = localTarget;
            onSeekRef.current?.(next.start);
            onSelectSegmentRef.current?.(next.id);
          }
        }

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
      const diff = Math.abs(videoRef.current.currentTime - localTargetTime);
      if (diff > 0.3) {
        videoRef.current.currentTime = localTargetTime;
      }
    }
  }, [localTargetTime]);

  const handleTimeUpdate = () => {
    if (!videoRef.current || !isPlaying) return;

    const current = videoRef.current.currentTime;
    const timelineTime = activeClip
      ? Number((activeClip.startOffset + current).toFixed(1))
      : Number(current.toFixed(1));

    // Tính năng tự động BỎ QUA các phân đoạn đã xóa khi phát video
    if (segments && segments.length > 0) {
      const sortedSegs = [...segments].sort((a, b) => a.start - b.start);
      const firstSeg = sortedSegs[0];
      const lastSeg = sortedSegs[sortedSegs.length - 1];

      // 1. Nếu vị trí trước phân đoạn hợp lệ đầu tiên: Nhảy thẳng đến đầu phân đoạn đó
      if (timelineTime < firstSeg.start - 0.2) {
        const localTarget = activeClip
          ? Math.max(0, Math.min(activeClip.duration, firstSeg.start - activeClip.startOffset))
          : firstSeg.start;
        videoRef.current.currentTime = localTarget;
        if (onSeek) onSeek(firstSeg.start);
        if (onSelectSegment) onSelectSegment(firstSeg.id);
        return;
      }

      // 2. Nếu vị trí đã vượt qua phân đoạn hợp lệ cuối cùng: Dừng phát
      if (timelineTime >= lastSeg.end) {
        videoRef.current.pause();
        if (onTogglePlay) onTogglePlay();
        if (onSeek) onSeek(lastSeg.end);
        return;
      }

      // 3. Kiểm tra xem timelineTime có nằm trong phân đoạn hợp lệ nào không
      const inAnySegment = sortedSegs.some(
        (s) => timelineTime >= s.start - 0.1 && timelineTime < s.end
      );

      // Nếu timelineTime rơi vào khoảng trống (đoạn đã bị xóa giữa 2 phân đoạn)
      if (!inAnySegment) {
        const nextSeg = sortedSegs.find((s) => s.start > timelineTime);
        if (nextSeg) {
          // BỎ QUA ĐOẠN ĐÃ XÓA: Tua nhanh tới đầu phân đoạn kế tiếp!
          const localTarget = activeClip
            ? Math.max(0, Math.min(activeClip.duration, nextSeg.start - activeClip.startOffset))
            : nextSeg.start;
          videoRef.current.currentTime = localTarget;
          if (onSeek) onSeek(nextSeg.start);
          if (onSelectSegment) onSelectSegment(nextSeg.id);
          return;
        }
      }
    }

    if (onSeek && Math.abs(timelineTime - currentTime) >= 0.4) {
      onSeek(timelineTime);
    }
  };

  const handleEnded = () => {
    if (joinedVideos && joinedVideos.length > 1 && activeClip) {
      const currentIdx = joinedVideos.findIndex((v) => v.id === activeClip.id);
      if (currentIdx >= 0 && currentIdx < joinedVideos.length - 1) {
        const nextClip = joinedVideos[currentIdx + 1];
        if (onSeek) {
          onSeek(nextClip.startOffset);
        }
        return;
      }
    }
    if (onTogglePlay && isPlaying) {
      onTogglePlay();
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
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden select-none min-h-0 min-w-0 text-slate-800 dark:text-slate-100 transition-colors duration-200">
      {/* Top Header: Trình phát & 16:9 Landscape */}
      <div className="h-12 border-b border-slate-200/80 dark:border-white/10 px-5 flex items-center justify-between shrink-0 bg-white/70 dark:bg-black/50 backdrop-blur-md z-20 select-none">
        {/* Left: Tiêu đề Trình phát + Badge video đang phát khi nối tiếp */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-base text-slate-900 dark:text-white tracking-tight">
            Trình phát
          </span>
          {activeClip && joinedVideos && joinedVideos.length > 1 && (
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs border ${
                activeClipIndex > 0
                  ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                  : "bg-indigo-50 border-indigo-200 text-indigo-800"
              }`}
              title={`Đang phát: ${activeClip.title} (${formatTime(activeClip.duration)})`}
            >
              {activeClipIndex > 0 ? (
                <Link2 className="w-3 h-3 text-emerald-600" />
              ) : (
                <Film className="w-3 h-3 text-indigo-600" />
              )}
              <span>
                {activeClipIndex > 0
                  ? `[Video ${activeClipIndex + 1}/${joinedVideos.length} • Nối tiếp] `
                  : `[Video 1/${joinedVideos.length}] `}
                {activeClip.title}
              </span>
            </span>
          )}
        </div>

        {/* Right: Tỉ lệ 16:9 Landscape & Nút thao tác */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAspect(aspect === "landscape" ? "portrait" : "landscape")}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-white/10 transition cursor-pointer shadow-2xs"
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
        className="flex-1 min-h-0 min-w-0 w-full h-full flex flex-col items-center justify-center p-3 lg:p-4 relative overflow-hidden bg-transparent transition-colors duration-200"
      >
        {/* Video Canvas Container (Thu nhỏ gọn gàng để nhường không gian cho bảng Trợ lý AI) */}
        <div
          ref={containerRef}
          className={`relative rounded-2xl overflow-hidden shadow-lg border border-slate-200/90 dark:border-white/15 flex flex-col items-center justify-center transition-all duration-200 group ${
            aspect === "landscape" ? "aspect-video" : "aspect-[9/16]"
          }`}
          style={{
            maxHeight: "58%",
            maxWidth: "76%",
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
                onEnded={handleEnded}
                onClick={onTogglePlay}
                onError={handleVideoError}
                className="w-full h-full object-contain cursor-pointer"
                playsInline
              />

              {/* Play overlay when paused */}
              {!isPlaying && !videoLoadError && (
                <div
                  onClick={onTogglePlay}
                  className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition cursor-pointer group"
                >
                  <div className="w-14 h-14 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <Play className="w-7 h-7 fill-current ml-1" />
                  </div>
                </div>
              )}

              {/* Webpage / Load Error Fallback Overlay */}
              {videoLoadError && (
                <div className="absolute inset-x-4 bottom-4 z-20 bg-slate-900/90 backdrop-blur-md p-3.5 rounded-2xl border border-slate-700 flex items-center justify-between shadow-2xl animate-in slide-in-from-bottom duration-200">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-bold text-white">Chế độ Studio Dự Án Phân Đoạn</p>
                      <p className="text-[11px] text-slate-300 line-clamp-1">{videoLoadError}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const fileName = activeClip?.fileName || "Bai08_Ep_kieu_du_lieu.mp4";
                        setVideoSrc(`/api/stream?file=${encodeURIComponent(fileName)}&t=${Date.now()}`);
                        setVideoLoadError(null);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-600 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Thử lại</span>
                    </button>
                    <button
                      onClick={() => {
                        if (onOpenAddVideo) onOpenAddVideo();
                        else fileInputRef.current?.click();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition cursor-pointer flex items-center gap-1.5"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Tải MP4</span>
                    </button>
                  </div>
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
        <div className="w-full max-w-[76%] flex items-center justify-between pt-2.5 px-2">
          {/* Digital Timecode (00:00:02:45 / 00:08:55:00) */}
          <div className="font-mono text-sm sm:text-base font-bold text-indigo-600 dark:text-indigo-400 tracking-wider">
            {formatTimecode(currentTime)} / {formatTimecode(totalDuration)}
          </div>

          {/* Fullscreen icon */}
          <button
            onClick={toggleFullscreen}
            className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
            title="Toàn màn hình"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
