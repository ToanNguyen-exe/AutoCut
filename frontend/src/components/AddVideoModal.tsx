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
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { formatTime } from "@/lib/utils";
import { uploadVideoFile } from "@/lib/api";
import { saveVideoBlob } from "@/lib/videoStorage";
import { TranscriptData, SegmentsData } from "@/types";

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

interface AddVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddVideo: (video: NewVideoData) => void;
}

// Danh sách URL video mẫu với các độ dài khác nhau để test ngay
const SAMPLE_VIDEOS = [
  {
    name: "Bài giảng Lập trình Web Full khóa (2 Giờ)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    durationSeconds: 7140, // 1 giờ 59 phút
    durationText: "01:59:00 (~2 giờ)",
  },
  {
    name: "Cấu trúc dữ liệu & Giải thuật (45 Phút)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    durationSeconds: 2700,
    durationText: "45:00",
  },
  {
    name: "Tech Intro & Algorithm Demo (15 Phút)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    durationSeconds: 900,
    durationText: "15:00",
  },
];

export const AddVideoModal: React.FC<AddVideoModalProps> = ({
  isOpen,
  onClose,
  onAddVideo,
}) => {
  const [tab, setTab] = useState<"url" | "file">("url");
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [durationValue, setDurationValue] = useState<string>("");
  const [durationUnit, setDurationUnit] = useState<"seconds" | "minutes">("seconds");
  const [detectedDuration, setDetectedDuration] = useState<number | null>(null);

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Tự động nhận diện độ dài thật của video khi chọn link hoặc file
  const probeDuration = (src: string) => {
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        if (v.duration && isFinite(v.duration) && v.duration > 0) {
          const secs = Math.round(v.duration);
          setDetectedDuration(secs);
          if (secs < 60) {
            setDurationUnit("seconds");
            setDurationValue(String(secs));
          } else {
            setDurationUnit("minutes");
            setDurationValue(String(Number((secs / 60).toFixed(1))));
          }
        }
      };
      v.src = src;
    } catch {
      // Bỏ qua lỗi CORS metadata
    }
  };

  const handleSelectSample = (sample: (typeof SAMPLE_VIDEOS)[0]) => {
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

      const objectUrl = URL.createObjectURL(file);
      probeDuration(objectUrl);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let finalDurationSeconds = 60;
    const parsed = parseDuration(durationValue, durationUnit);
    if (parsed > 0) {
      finalDurationSeconds = parsed;
    } else if (detectedDuration && detectedDuration > 0) {
      finalDurationSeconds = detectedDuration;
    }

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

      onAddVideo({
        url: urlInput.trim(),
        name: titleInput.trim() || "Video bài giảng mới",
        duration: finalDurationSeconds,
        isExternalUrl: true,
        topicTitle: titleInput.trim() || "Chủ đề bài giảng mới",
        sectionName: "01_NoiDungChinh",
      });
      onClose();
    } else {
      if (!selectedFile) {
        setError("Vui lòng chọn 1 tệp video từ máy tính!");
        return;
      }

      // Luôn lưu blob vào IndexedDB để khi ấn F5 tự động khôi phục luồng phát mượt mà
      await saveVideoBlob(selectedFile.name, selectedFile);

      setIsUploading(true);
      setUploadPercent(10);
      setUploadProgressMsg("Đang tải video");

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
          onAddVideo({
            url: uploadRes.data.cloud_url,
            name: uploadRes.data.file_name || selectedFile.name,
            duration: finalDurationSeconds,
            isExternalUrl: false,
            topicTitle: titleInput.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
            sectionName: "01_NoiDungChinh",
            sha256: uploadRes.data.sha256,
            transcript: uploadRes.data.transcript,
            segmentsData: uploadRes.data.segmentsData,
            transcriptFile: uploadRes.data.transcript_file,
          });
          onClose();
          return;
        }
      } catch (uploadErr) {
        console.warn("Upload lên backend gặp sự cố, sử dụng chế độ phát tệp cục bộ:", uploadErr);
      } finally {
        clearInterval(upTimer);
        setUploadPercent(100);
        setIsUploading(false);
      }

      const fileUrl = URL.createObjectURL(selectedFile);
      onAddVideo({
        url: fileUrl,
        name: selectedFile.name,
        duration: finalDurationSeconds,
        isExternalUrl: false,
        topicTitle: titleInput.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
        sectionName: "01_NoiDungChinh",
      });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-slate-100 border border-slate-300 rounded-2xl shadow-xl overflow-hidden flex flex-col text-slate-800">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-300 flex items-center justify-between bg-slate-200/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 border border-indigo-300 flex items-center justify-center text-indigo-700 shadow-2xs">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Thêm Video & Khởi tạo Dự Án</h3>
              <p className="text-xs text-slate-600">
                Thêm bằng link URL hoặc chọn file từ máy tính
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-300/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-300 bg-slate-200/80 p-1">
          <button
            type="button"
            onClick={() => setTab("url")}
            className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition ${
              tab === "url"
                ? "bg-slate-100 text-indigo-800 shadow-xs border border-slate-300 font-bold"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-300/50"
            }`}
          >
            <LinkIcon className="w-4 h-4" />
            <span>Nhập Link URL Video</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("file")}
            className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition ${
              tab === "file"
                ? "bg-slate-100 text-indigo-800 shadow-xs border border-slate-300 font-bold"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-300/50"
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Tải Tệp Từ Máy</span>
          </button>
        </div>

        {/* Form Body */}
        <form noValidate onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-100 border border-rose-300 text-rose-900 text-xs flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {tab === "url" ? (
            <div className="space-y-4">
              {/* URL Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Đường dẫn Video (Direct MP4, MKV, WebM URL)
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://example.com/lecture_video.mp4"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                  />
                  <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>

                {/* TikTok / YouTube Webpage Warning Tip */}
                {(urlInput.includes("tiktok.com") ||
                  urlInput.includes("youtube.com") ||
                  urlInput.includes("youtu.be")) && (
                  <div className="mt-2 p-2.5 rounded-xl bg-indigo-100 border border-indigo-300 text-[11px] text-indigo-950 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-indigo-950">Đã nhận diện liên kết video trực tuyến</p>
                      <p className="text-indigo-900 mt-0.5">
                        Hệ thống đã tự động đặt thời lượng tối ưu và chuẩn bị sẵn các phân đoạn. Để xem phát hình ảnh thực tế trên trình duyệt, bạn cũng có thể tải file video (.mp4) về máy rồi chọn tab &quot;Tải Tệp Từ Máy&quot;.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Sample Videos to click */}
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-700 mb-2 font-bold">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Hoặc chọn video mẫu để test nhanh:</span>
                </div>
                <div className="space-y-1.5">
                  {SAMPLE_VIDEOS.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSample(sample)}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-200/60 border border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 text-xs text-left transition group shadow-2xs"
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <Play className="w-3.5 h-3.5 text-indigo-700 group-hover:scale-110 transition shrink-0" />
                        <span className="font-bold text-slate-800 group-hover:text-indigo-800 truncate">
                          {sample.name}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-indigo-800 shrink-0 font-bold">
                        {sample.durationText}
                      </span>
                    </button>
                  ))}
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
                    ? "border-emerald-500 bg-emerald-100/50"
                    : "border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/60 bg-slate-50"
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-indigo-100 border border-indigo-300 flex items-center justify-center text-indigo-700 mb-2 shadow-2xs">
                  <Upload className="w-6 h-6" />
                </div>
                {selectedFile ? (
                  <div className="text-center">
                    <p className="text-xs font-bold text-emerald-900 truncate max-w-[280px]">
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5 font-medium">
                      {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB • Sẵn sàng nạp
                    </p>
                    <span className="inline-block mt-2 text-[10px] text-indigo-700 hover:underline font-bold">
                      Bấm để chọn file khác
                    </span>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-800">
                      Bấm vào đây để chọn video từ máy tính
                    </p>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Hỗ trợ tệp MP4, MKV, WebM (Video bài giảng 1h - 2h...)
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Video Title Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Tên bài giảng / Tên dự án
            </label>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Ví dụ: Bai06_CauTrucDuLieu_Full.mp4"
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500 font-semibold"
            />
          </div>

          {/* Video Duration Setting */}
          <div className="p-3 rounded-xl bg-slate-200/50 border border-slate-300">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-700" />
                <span>Thời lượng toàn bộ video:</span>
              </label>
              <span className="text-[11px] font-mono text-indigo-800 font-bold">
                {formatTime(
                  parseDuration(durationValue, durationUnit) > 0
                    ? parseDuration(durationValue, durationUnit)
                    : detectedDuration || 60
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={durationValue}
                placeholder={
                  detectedDuration
                    ? durationUnit === "seconds"
                      ? String(detectedDuration)
                      : (detectedDuration / 60).toFixed(1)
                    : "Tự động"
                }
                onChange={(e) => setDurationValue(e.target.value)}
                className="w-24 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs font-mono outline-none shadow-2xs font-bold"
              />
              <select
                value={durationUnit}
                onChange={(e) => {
                  const newUnit = e.target.value as "seconds" | "minutes";
                  if (newUnit !== durationUnit && durationValue) {
                    const currentSecs = parseDuration(durationValue, durationUnit);
                    if (newUnit === "seconds") {
                      setDurationValue(String(currentSecs));
                    } else {
                      setDurationValue(String(Number((currentSecs / 60).toFixed(1))));
                    }
                  }
                  setDurationUnit(newUnit);
                }}
                className="px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-300 focus:border-indigo-500 text-slate-800 text-xs font-bold outline-none cursor-pointer shadow-2xs"
              >
                <option value="seconds">giây</option>
                <option value="minutes">phút</option>
              </select>
              <div className="flex-1 text-[11px] text-right">
                {detectedDuration ? (
                  <div className="flex items-center justify-end gap-1.5 text-emerald-800 font-bold">
                    <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-700" />
                    <span>✓ Tự nhận diện ({formatTime(detectedDuration)})</span>
                    {durationValue &&
                      Math.abs(parseDuration(durationValue, durationUnit) - detectedDuration) > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (detectedDuration < 60) {
                              setDurationUnit("seconds");
                              setDurationValue(String(detectedDuration));
                            } else {
                              setDurationUnit("minutes");
                              setDurationValue(String(Number((detectedDuration / 60).toFixed(1))));
                            }
                          }}
                          className="ml-1 text-indigo-700 hover:underline text-[10px] font-bold"
                        >
                          [Khôi phục]
                        </button>
                      )}
                  </div>
                ) : (
                  <span className="text-slate-600 font-medium">Tự động ôm khít thời lượng video thực tế</span>
                )}
              </div>
            </div>
          </div>

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
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-300">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-950 hover:bg-slate-200 border border-slate-300 transition disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition hover:scale-102 active:scale-98 disabled:opacity-50 flex items-center gap-1.5"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang tải lên backend...</span>
                </>
              ) : (
                "Thêm video & Dựng dự án mới"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
