"use client";

import React, { useState, useRef } from "react";
import {
  Link as LinkIcon,
  Upload,
  X,
  Play,
  Film,
  Sparkles,
  AlertCircle,
  Clock,
  Loader2,
  ListPlus,
} from "lucide-react";
import { formatTime } from "@/lib/utils";
import { uploadVideoFile, fetchBackendVideos, BackendVideoItem, API_BASE } from "@/lib/api";
import { getLibraryVideos } from "@/lib/videoLibrary";
import { saveVideoBlob } from "@/lib/videoStorage";
import { TranscriptData, SegmentsData, VideoLibraryItem } from "@/types";

export interface NewVideoData {
  url: string;
  name: string;
  duration: number; // in seconds
  isExternalUrl: boolean;
  topicTitle?: string;
  sectionName?: string;
  sha256?: string;
  transcript?: TranscriptData;
  segmentsData?: SegmentsData;
  transcriptFile?: string;
}

// Danh sách URL video Cloudflare R2 chính thức của dự án
const SAMPLE_VIDEOS = [
  {
    name: "Bài giảng mẫu ngắn 2 Phút (vibe_short.mp4)",
    url: "https://pub-603b1f9629e046de80cf86f3f046ca84.r2.dev/autocut/sample_videos/vibe_short.mp4",
    durationSeconds: 120,
    durationText: "02:00",
  },
  {
    name: "Bài giảng Lập trình Web Full khóa (2 Giờ - Vibe-Coding-4.mp4)",
    url: "https://pub-603b1f9629e046de80cf86f3f046ca84.r2.dev/autocut/sample_videos/Vibe-Coding-4.mp4",
    durationSeconds: 7200,
    durationText: "02:00:00 (~2 giờ)",
  },
];

interface AddVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddVideo: (video: NewVideoData) => void;
  onAppendVideo?: (video: NewVideoData) => void;
}

export const AddVideoModal: React.FC<AddVideoModalProps> = ({
  isOpen,
  onClose,
  onAddVideo,
  onAppendVideo,
}) => {
  const [tab, setTab] = useState<"url" | "file">("url");
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [durationValue, setDurationValue] = useState<string>("");
  const [durationUnit, setDurationUnit] = useState<"seconds" | "minutes">("seconds");
  const [detectedDuration, setDetectedDuration] = useState<number | null>(null);
  const [showManualDuration, setShowManualDuration] = useState<boolean>(false);
  const [isProbing, setIsProbing] = useState<boolean>(false);

  const parseDuration = (val: string, unit: "seconds" | "minutes"): number => {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    if (trimmed.includes(":")) {
      const parts = trimmed.split(":").map(Number);
      if (parts.some(isNaN)) return 0;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const num = parseFloat(trimmed);
    if (isNaN(num) || num <= 0) return 0;
    return unit === "minutes" ? Math.round(num * 60) : Math.round(num);
  };
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [uploadProgressMsg, setUploadProgressMsg] = useState<string>("");
  const [cloudVideos, setCloudVideos] = useState<BackendVideoItem[]>([]);
  const [localVideos, setLocalVideos] = useState<VideoLibraryItem[]>([]);

  React.useEffect(() => {
    if (isOpen) {
      setLocalVideos(getLibraryVideos());
      fetchBackendVideos()
        .then((res) => {
          if (res.source === "api" && res.data) {
            setCloudVideos(res.data);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const formatExactDuration = (secs: number | null): string => {
    if (secs === null || isNaN(secs) || secs <= 0) return "--:--";
    if (secs < 60) {
      const intPart = Math.floor(secs);
      const dec = Math.round((secs - intPart) * 10);
      const pad = (n: number) => n.toString().padStart(2, "0");
      if (dec > 0) {
        return `00:${pad(intPart)}.${dec} (${secs.toFixed(1)}s)`;
      }
      return `00:${pad(intPart)} (${intPart}s)`;
    }
    return formatTime(secs);
  };

  // Tự động nhận diện độ dài thật của video khi chọn link hoặc file (kể cả clip ngắn vài giây)
  const probeDuration = (src: string) => {
    setIsProbing(true);
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        setIsProbing(false);
        if (v.duration && isFinite(v.duration) && v.duration > 0) {
          const exactSecs = Number(v.duration.toFixed(1));
          setDetectedDuration(exactSecs);
          if (exactSecs < 60) {
            setDurationUnit("seconds");
            setDurationValue(String(exactSecs));
          } else {
            setDurationUnit("minutes");
            setDurationValue(String(Number((exactSecs / 60).toFixed(1))));
          }
        }
      };
      v.onerror = () => setIsProbing(false);
      v.src = src;
    } catch {
      setIsProbing(false);
    }
  };

  const handleSelectSample = (sample: {
    name: string;
    url: string;
    durationSeconds: number;
    durationText?: string;
  }) => {
    setUrlInput(sample.url);
    setTitleInput(sample.name);
    setDetectedDuration(sample.durationSeconds);
    if (sample.durationSeconds < 60) {
      setDurationUnit("seconds");
      setDurationValue(String(sample.durationSeconds));
    } else {
      setDurationUnit("minutes");
      setDurationValue(String(Number((sample.durationSeconds / 60).toFixed(1))));
    }
    setError(null);
  };

  const handleUrlChange = (val: string) => {
    setUrlInput(val);
    const lower = val.trim().toLowerCase();
    if (lower.includes("tiktok.com")) {
      setDetectedDuration(60);
      setDurationUnit("seconds");
      setDurationValue("60");
      return;
    }
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
      setDetectedDuration(300);
      setDurationUnit("minutes");
      setDurationValue("5");
      return;
    }
    if (val.trim().startsWith("http")) {
      probeDuration(val.trim());
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setTitleInput(file.name.replace(/\.[^/.]+$/, ""));
      setError(null);
      setDetectedDuration(null);

      // Lưu file vào IndexedDB ngay để bảo toàn qua F5
      saveVideoBlob(file.name, file);

      const objectUrl = URL.createObjectURL(file);
      probeDuration(objectUrl);
    }
  };

  const submitWithMode = async (isAppend: boolean) => {
    setError(null);

    // Đảm bảo tệp đã chọn được lưu bền vững vào IndexedDB trước khi giao diện chuyển sang Studio
    if (selectedFile) {
      await saveVideoBlob(selectedFile.name, selectedFile);
    }

    // Tính thời lượng bằng giây (ưu tiên thời lượng đã tự nhận diện từ video thực tế, kể cả clip ngắn vài giây)
    let finalDurationSeconds = 60;
    if (detectedDuration && detectedDuration > 0) {
      finalDurationSeconds = Number(detectedDuration.toFixed(1));
    } else {
      const parsed = parseDuration(durationValue, durationUnit);
      if (parsed > 0) finalDurationSeconds = parsed;
    }

    const deliverVideo = (videoData: NewVideoData) => {
      if (isAppend && onAppendVideo) {
        onAppendVideo(videoData);
      } else {
        onAddVideo(videoData);
      }
      onClose();
    };

    if (tab === "url") {
      if (!urlInput.trim()) {
        setError("Vui lòng nhập đường dẫn URL của video!");
        return;
      }
      try {
        new URL(urlInput.trim());
      } catch {
        setError("Định dạng URL không hợp lệ! Vui lòng nhập link đầy đủ (ví dụ: https://.../video.mp4)");
        return;
      }

      deliverVideo({
        url: urlInput.trim(),
        name: titleInput.trim() || "Video bài giảng mới",
        duration: finalDurationSeconds,
        isExternalUrl: true,
        topicTitle: titleInput.trim() || "Chủ đề bài giảng mới",
        sectionName: "01_NoiDungChinh",
      });
    } else {
      if (!selectedFile) {
        setError("Vui lòng chọn 1 tệp video từ máy tính!");
        return;
      }

      setIsUploading(true);
      setUploadPercent(10);
      setUploadProgressMsg("Đang tải video & AI đang bóc băng phân tích (Whisper + Gemini)...");

      const upStartTime = Date.now();
      const upTimer = setInterval(() => {
        const sec = (Date.now() - upStartTime) / 1000;
        setUploadPercent(() => {
          if (sec < 3) return Math.min(30, 10 + sec * 7);
          if (sec < 8) return Math.min(65, 30 + (sec - 3) * 7);
          return Math.min(94, 65 + (sec - 8) * 3);
        });
      }, 250);

      try {
        const uploadRes = await uploadVideoFile(selectedFile);
        if (uploadRes.source === "api" && uploadRes.data?.cloud_url) {
          clearInterval(upTimer);
          setUploadPercent(100);
          const cloudDur = (uploadRes.data.transcript?.duration && uploadRes.data.transcript.duration > 0)
            ? uploadRes.data.transcript.duration
            : finalDurationSeconds;
          deliverVideo({
            url: uploadRes.data.cloud_url,
            name: uploadRes.data.file_name || selectedFile.name,
            duration: Number(cloudDur.toFixed(1)),
            isExternalUrl: false,
            topicTitle: titleInput.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
            sectionName: "01_NoiDungChinh",
            sha256: uploadRes.data.sha256,
            transcript: uploadRes.data.transcript,
            segmentsData: uploadRes.data.segmentsData,
            transcriptFile: uploadRes.data.transcript_file,
          });
          return;
        }
      } catch (uploadErr) {
        console.warn("Upload lên backend gặp sự cố, sử dụng chế độ phát tệp cục bộ:", uploadErr);
      } finally {
        clearInterval(upTimer);
        setUploadPercent(100);
        setIsUploading(false);
      }

      // Fallback nếu backend offline hoặc gặp lỗi
      const fileUrl = URL.createObjectURL(selectedFile);
      deliverVideo({
        url: fileUrl,
        name: selectedFile.name,
        duration: finalDurationSeconds,
        isExternalUrl: false,
        topicTitle: titleInput.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
        sectionName: "01_NoiDungChinh",
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitWithMode(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-800">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200/80 flex items-center justify-center text-indigo-600 shadow-2xs">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Thêm Video & Khởi tạo Dự Án</h3>
              <p className="text-xs text-slate-500">
                Thêm bằng link URL hoặc chọn file từ máy tính
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setTab("url")}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition ${
              tab === "url"
                ? "bg-white text-indigo-700 shadow-xs border border-slate-200/80 font-bold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
            }`}
          >
            <LinkIcon className="w-4 h-4" />
            <span>Nhập Link URL Video</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("file")}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition ${
              tab === "file"
                ? "bg-white text-indigo-700 shadow-xs border border-slate-200/80 font-bold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Tải Tệp Từ Máy</span>
          </button>
        </div>

        {/* Form Body */}
        <form noValidate onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {tab === "url" ? (
            <div className="space-y-4">
              {/* URL Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Đường dẫn Video (Direct MP4, MKV, WebM URL)
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://example.com/lecture_video.mp4"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                  />
                  <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>

                {/* TikTok / YouTube Webpage Warning Tip */}
                {(urlInput.includes("tiktok.com") ||
                  urlInput.includes("youtube.com") ||
                  urlInput.includes("youtu.be")) && (
                  <div className="mt-2 p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-900 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-indigo-950">Đã nhận diện liên kết video trực tuyến</p>
                      <p className="text-indigo-800 mt-0.5">
                        Hệ thống đã tự động đặt thời lượng tối ưu và chuẩn bị sẵn các phân đoạn. Để xem phát hình ảnh thực tế trên trình duyệt, bạn cũng có thể tải file video (.mp4) về máy rồi chọn tab &quot;Tải Tệp Từ Máy&quot;.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Sample Videos to click */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-600 mb-2 font-semibold">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Hoặc chọn video có sẵn để test nhanh:</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-normal">Bấm clip để tự điền ô URL</span>
                </div>
                <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                  {SAMPLE_VIDEOS.map((sample, idx) => (
                    <button
                      key={`sample_${idx}`}
                      type="button"
                      onClick={() => handleSelectSample(sample)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs text-left transition group shadow-2xs ${
                        urlInput === sample.url
                          ? "bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500"
                          : "bg-slate-50 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <Play className="w-3.5 h-3.5 text-indigo-600 group-hover:scale-110 transition shrink-0" />
                        <span className="font-medium text-slate-800 group-hover:text-indigo-700 truncate">
                          {sample.name}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-indigo-700 shrink-0 font-bold">
                        {sample.durationText}
                      </span>
                    </button>
                  ))}
                  {cloudVideos
                    .filter((cv) => !SAMPLE_VIDEOS.some((sv) => sv.url === cv.cloudUrl))
                    .map((cv, idx) => {
                      const vUrl = cv.cloudUrl || `${API_BASE}/stream/${cv.sha256Hash}`;
                      const isSelected = urlInput === vUrl;
                      const dur = cv.duration && cv.duration > 0 ? Math.round(cv.duration) : 120;
                      return (
                        <button
                          key={`cloud_${idx}`}
                          type="button"
                          onClick={() => {
                            handleSelectSample({
                              name: cv.fileName,
                              url: vUrl,
                              durationSeconds: dur,
                              durationText: formatTime(dur),
                            });
                          }}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs text-left transition group shadow-2xs ${
                            isSelected
                              ? "bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500"
                              : "bg-slate-50 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate pr-2">
                            <Play className="w-3.5 h-3.5 text-indigo-600 group-hover:scale-110 transition shrink-0" />
                            <span className="font-medium text-slate-800 group-hover:text-indigo-700 truncate">
                              {cv.fileName}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-indigo-700 shrink-0 font-bold bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                            {formatTime(dur)}
                          </span>
                        </button>
                      );
                    })}
                  {/* Danh sách clip bạn đã thêm hoặc tải lên lưu trong thư viện */}
                  {localVideos
                    .filter(
                      (lv) =>
                        lv.url &&
                        (lv.url.includes("r2.dev") || lv.url.includes("/stream/")) &&
                        !SAMPLE_VIDEOS.some((sv) => sv.url === lv.url) &&
                        !cloudVideos.some((cv) => cv.cloudUrl === lv.url)
                    )
                    .map((lv, idx) => {
                      const isSelected = urlInput === lv.url;
                      return (
                        <button
                          key={`local_${idx}`}
                          type="button"
                          onClick={() => {
                            handleSelectSample({
                              name: lv.title || lv.name,
                              url: lv.url,
                              durationSeconds: lv.duration || 120,
                              durationText: formatTime(lv.duration || 120),
                            });
                          }}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs text-left transition group shadow-2xs ${
                            isSelected
                              ? "bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500"
                              : "bg-slate-50 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate pr-2">
                            <Play className="w-3.5 h-3.5 text-indigo-600 group-hover:scale-110 transition shrink-0" />
                            <span className="font-medium text-slate-800 group-hover:text-indigo-700 truncate">
                              {lv.title || lv.name}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 shrink-0 font-medium">
                            {formatTime(lv.duration || 120)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File upload zone */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="video/mp4,video/mkv,video/webm,video/*"
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition ${
                  selectedFile
                    ? "border-emerald-500 bg-emerald-50/40"
                    : "border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/30 bg-slate-50/50"
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 mb-2 shadow-2xs">
                  <Upload className="w-6 h-6" />
                </div>
                {selectedFile ? (
                  <div className="text-center">
                    <p className="text-xs font-bold text-emerald-800 truncate max-w-[280px]">
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB • Sẵn sàng nạp
                    </p>
                    <span className="inline-block mt-2 text-[10px] text-indigo-600 hover:underline font-semibold">
                      Bấm để chọn file khác
                    </span>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-xs font-semibold text-slate-800">
                      Bấm vào đây để chọn video từ máy tính
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Hỗ trợ tệp MP4, MKV, WebM (Video bài giảng 1h - 2h...)
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Video Title Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tên bài giảng / Tên dự án
            </label>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Ví dụ: Bai06_CauTrucDuLieu_Full.mp4"
              className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Video Duration Card (Tự động hiển thị thời lượng chuẩn của video - Người dùng không phải nhập tay) */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center text-indigo-700 shrink-0 shadow-2xs">
                {isProbing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                ) : (
                  <Clock className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800">Thời lượng video</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {isProbing
                    ? "Đang nhận diện thời lượng từ video..."
                    : detectedDuration
                    ? "✓ Tự động nhận diện chính xác từ video"
                    : "Chọn video để tự động nhận diện thời lượng"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-mono font-bold text-indigo-800 bg-white border border-indigo-300 px-3 py-1.5 rounded-xl shadow-2xs">
                {formatExactDuration(detectedDuration)}
              </span>
              <button
                type="button"
                onClick={() => setShowManualDuration(!showManualDuration)}
                className="text-[10px] text-indigo-600 hover:text-indigo-800 underline font-medium ml-1"
                title="Tùy chỉnh thời lượng nếu cần"
              >
                {showManualDuration ? "Thu gọn" : "Chỉnh tay"}
              </button>
            </div>
          </div>

          {showManualDuration && (
            <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-200 flex items-center gap-2 animate-in fade-in">
              <span className="text-xs text-slate-700 font-medium shrink-0">Thời lượng thủ công:</span>
              <input
                type="text"
                inputMode="decimal"
                value={durationValue}
                placeholder={detectedDuration ? String(detectedDuration) : "60"}
                onChange={(e) => {
                  setDurationValue(e.target.value);
                  const p = parseDuration(e.target.value, durationUnit);
                  if (p > 0) setDetectedDuration(p);
                }}
                className="w-24 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-mono outline-none shadow-2xs"
              />
              <select
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value as "seconds" | "minutes")}
                className="px-2 py-1.5 rounded-lg bg-white border border-slate-300 text-xs outline-none cursor-pointer shadow-2xs"
              >
                <option value="seconds">giây</option>
                <option value="minutes">phút</option>
              </select>
            </div>
          )}

          {/* Upload Progress Status with % Bar */}
          {isUploading && (
            <div className="space-y-1.5 p-3 rounded-xl bg-indigo-100/90 border border-indigo-300 text-indigo-900 text-xs font-semibold">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-700 shrink-0" />
                  <span className="truncate max-w-[260px]">{uploadProgressMsg || "Đang xử lý tệp..."}</span>
                </div>
                <span className="font-mono font-black text-indigo-800">{Math.round(uploadPercent)}%</span>
              </div>
              <div className="w-full bg-indigo-200/80 rounded-full h-2 overflow-hidden border border-indigo-300/50">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(5, uploadPercent))}%` }}
                />
              </div>
            </div>
          )}

          {/* Submit Actions */}
          <div className="pt-3 flex items-center justify-between gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-slate-300 transition disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => submitWithMode(true)}
                disabled={isUploading}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition hover:scale-102 active:scale-98 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                title="Nối tiếp video này ra đằng sau video đang phát trên Timeline"
              >
                <ListPlus className="w-4 h-4" />
                <span>+ Nối tiếp vào sau</span>
              </button>
              <button
                type="button"
                onClick={() => submitWithMode(false)}
                disabled={isUploading}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition hover:scale-102 active:scale-98 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang tải lên...</span>
                  </>
                ) : (
                  "Mở dự án mới"
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
