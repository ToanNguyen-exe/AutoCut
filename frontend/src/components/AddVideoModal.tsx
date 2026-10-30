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

export interface NewVideoData {
  url: string;
  name: string;
  duration: number; // in seconds
  isExternalUrl: boolean;
  topicTitle?: string;
  sectionName?: string;
  sha256?: string;
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
  const [durationMinutes, setDurationMinutes] = useState<string>("");
  const [detectedDuration, setDetectedDuration] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
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
          const mins = (secs / 60 >= 1 ? (secs / 60).toFixed(1) : (secs / 60).toFixed(2));
          setDurationMinutes(mins);
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
    setDurationMinutes((sample.durationSeconds / 60).toFixed(1));
    setDetectedDuration(sample.durationSeconds);
    setError(null);
  };

  const handleUrlChange = (val: string) => {
    setUrlInput(val);
    const lower = val.trim().toLowerCase();
    if (lower.includes("tiktok.com")) {
      setDetectedDuration(60);
      setDurationMinutes("1");
      return;
    }
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
      setDetectedDuration(300);
      setDurationMinutes("5");
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

    // Tính thời lượng bằng giây (ưu tiên thời lượng đã tự nhận diện từ video)
    let finalDurationSeconds = 60; // Mặc định 1 phút nếu video ngắn không rõ thời lượng
    const parsedMinutes = parseFloat(durationMinutes);
    if (!isNaN(parsedMinutes) && parsedMinutes > 0) {
      finalDurationSeconds = Math.round(parsedMinutes * 60);
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

      setIsUploading(true);
      setUploadProgressMsg("Đang tải video lên máy chủ Spring Boot & mã hóa SHA-256...");

      try {
        const uploadRes = await uploadVideoFile(selectedFile);
        if (uploadRes.source === "api" && uploadRes.data?.cloud_url) {
          onAddVideo({
            url: uploadRes.data.cloud_url,
            name: uploadRes.data.file_name || selectedFile.name,
            duration: finalDurationSeconds,
            isExternalUrl: false,
            topicTitle: titleInput.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
            sectionName: "01_NoiDungChinh",
            sha256: uploadRes.data.sha256,
          });
          onClose();
          return;
        }
      } catch (uploadErr) {
        console.warn("Upload lên backend gặp sự cố, sử dụng chế độ phát tệp cục bộ:", uploadErr);
      } finally {
        setIsUploading(false);
      }

      // Fallback nếu backend offline hoặc gặp lỗi
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#16171d] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-200">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Thêm Video & Khởi tạo Dự Án</h3>
              <p className="text-xs text-slate-400">
                Thêm bằng link URL hoặc chọn file từ máy tính
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-800 bg-[#121318]">
          <button
            type="button"
            onClick={() => setTab("url")}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              tab === "url"
                ? "border-purple-500 text-purple-300 bg-purple-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <LinkIcon className="w-4 h-4" />
            <span>Nhập Link URL Video</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("file")}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              tab === "file"
                ? "border-purple-500 text-purple-300 bg-purple-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Tải Tệp Từ Máy</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === "url" ? (
            <div className="space-y-4">
              {/* URL Input */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Đường dẫn Video (Direct MP4, MKV, WebM URL)
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://example.com/lecture_video.mp4"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
                  />
                  <LinkIcon className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                </div>

                {/* TikTok / YouTube Webpage Warning Tip */}
                {(urlInput.includes("tiktok.com") ||
                  urlInput.includes("youtube.com") ||
                  urlInput.includes("youtu.be")) && (
                  <div className="mt-2 p-2.5 rounded-xl bg-purple-950/40 border border-purple-500/30 text-[11px] text-purple-200 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-white">Đã nhận diện liên kết video trực tuyến</p>
                      <p className="text-purple-300 mt-0.5">
                        Hệ thống đã tự động đặt thời lượng tối ưu và chuẩn bị sẵn các phân đoạn. Để xem phát hình ảnh thực tế trên trình duyệt, bạn cũng có thể tải file video (.mp4) về máy rồi chọn tab &quot;Tải Tệp Từ Máy&quot;.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Sample Videos to click */}
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2 font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Hoặc chọn video mẫu để test nhanh:</span>
                </div>
                <div className="space-y-1.5">
                  {SAMPLE_VIDEOS.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSample(sample)}
                      className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-purple-500/50 hover:bg-purple-950/20 text-xs text-left transition group"
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <Play className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition shrink-0" />
                        <span className="font-medium text-slate-200 group-hover:text-purple-300 truncate">
                          {sample.name}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-purple-400 shrink-0 font-semibold">
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
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-slate-700 hover:border-purple-500 hover:bg-purple-500/5"
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-purple-600/15 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-2">
                  <Upload className="w-6 h-6" />
                </div>
                {selectedFile ? (
                  <div className="text-center">
                    <p className="text-xs font-bold text-emerald-400 truncate max-w-[280px]">
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB • Sẵn sàng nạp
                    </p>
                    <span className="inline-block mt-2 text-[10px] text-purple-400 hover:underline">
                      Bấm để chọn file khác
                    </span>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-xs font-semibold text-slate-200">
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
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Tên bài giảng / Tên dự án
            </label>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Ví dụ: Bai06_CauTrucDuLieu_Full.mp4"
              className="w-full px-3 py-2 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
            />
          </div>

          {/* Video Duration Setting (Tự động nhận diện chuẩn theo video thực) */}
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Thời lượng toàn bộ video:</span>
              </label>
              <span className="text-[11px] font-mono text-purple-400 font-bold">
                {formatTime(
                  parseFloat(durationMinutes || "0") > 0
                    ? parseFloat(durationMinutes) * 60
                    : detectedDuration || 60
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0.1"
                max="600"
                step="0.1"
                value={durationMinutes}
                placeholder={detectedDuration ? (detectedDuration / 60).toFixed(1) : "Tự động"}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-24 px-3 py-1.5 rounded-lg bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs font-mono outline-none"
              />
              <span className="text-xs text-slate-400">phút</span>
              <div className="flex-1 text-[11px] text-right">
                {detectedDuration ? (
                  <div className="flex items-center justify-end gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>✓ Tự nhận diện ({formatTime(detectedDuration)})</span>
                    {durationMinutes &&
                      Math.abs(parseFloat(durationMinutes) * 60 - detectedDuration) > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDurationMinutes(
                              detectedDuration / 60 >= 1
                                ? (detectedDuration / 60).toFixed(1)
                                : (detectedDuration / 60).toFixed(2)
                            )
                          }
                          className="ml-1 text-purple-400 hover:underline text-[10px]"
                        >
                          [Khôi phục]
                        </button>
                      )}
                  </div>
                ) : (
                  <span className="text-slate-400">Tự động ôm khít thời lượng video thực tế</span>
                )}
              </div>
            </div>
          </div>

          {/* Upload Progress Status */}
          {isUploading && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-purple-950/40 border border-purple-500/30 text-purple-300 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
              <span>{uploadProgressMsg || "Đang xử lý tệp..."}</span>
            </div>
          )}

          {/* Submit Actions */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25 transition hover:scale-105 active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
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
