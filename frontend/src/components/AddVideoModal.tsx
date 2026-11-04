"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Link as LinkIcon,
  Upload,
  X,
  Play,
  Film,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Search,
  Copy,
  Check,
} from "lucide-react";
import { formatTime } from "@/lib/utils";
import { uploadVideoFile, fetchBackendVideos, BackendVideoItem, API_BASE } from "@/lib/api";
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

interface AddVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddVideo: (video: NewVideoData) => void;
  onSelectExistingVideo?: (video: VideoLibraryItem) => void;
  existingVideos?: VideoLibraryItem[];
  currentVideoUrl?: string | null;
  currentVideoName?: string | null;
}

export const AddVideoModal: React.FC<AddVideoModalProps> = ({
  isOpen,
  onClose,
  onAddVideo,
  onSelectExistingVideo,
  existingVideos,
  currentVideoUrl,
  currentVideoName,
}) => {
  const [tab, setTab] = useState<"url_list" | "file">("url_list");
  const [cloudVideos, setCloudVideos] = useState<BackendVideoItem[]>([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // States cho Ô URL và Tiêu đề phía trên
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [durationValue, setDurationValue] = useState<string>("");
  const [durationUnit, setDurationUnit] = useState<"seconds" | "minutes">("seconds");
  const [detectedDuration, setDetectedDuration] = useState<number | null>(null);

  // States cho Tab File Upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgressMsg, setUploadProgressMsg] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tự động load danh sách video mới nhất từ Database mỗi khi mở modal
  useEffect(() => {
    if (!isOpen) return;

    if (currentVideoUrl) {
      setUrlInput(currentVideoUrl);
    }
    if (currentVideoName) {
      setTitleInput(currentVideoName);
    }

    setIsLoadingVideos(true);
    fetchBackendVideos()
      .then((res) => {
        if (res.source === "api" && res.data) {
          setCloudVideos(res.data);
        }
      })
      .catch((err) => console.warn("Lỗi nạp danh sách video từ backend:", err))
      .finally(() => setIsLoadingVideos(false));
  }, [isOpen, currentVideoUrl, currentVideoName]);

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

  // Tổng hợp tất cả video khả dụng: Database Backend (/api/video/list) + Thư viện cục bộ
  const combinedVideos = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      title: string;
      url: string;
      sizeText: string;
      dateText: string;
      duration?: number;
      sha256?: string;
      rawLibraryItem?: VideoLibraryItem;
    }> = [];

    const seenUrls = new Set<string>();

    // 1. Nạp từ Backend Database trước (bao gồm video mới upload lên R2/DB)
    cloudVideos.forEach((cv, idx) => {
      const url = cv.cloudUrl || `${API_BASE}/stream/${cv.sha256Hash}`;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        let sizeText = "";
        if (cv.fileSize && cv.fileSize > 0) {
          const mb = cv.fileSize / (1024 * 1024);
          sizeText = mb >= 1000 ? (mb / 1024).toFixed(2) + " GB" : mb.toFixed(1) + " MB";
        }
        list.push({
          id: `db_${cv.id || idx}`,
          name: cv.fileName,
          title: cv.fileName.replace(/\.[^/.]+$/, ""),
          url: url,
          sizeText: sizeText,
          dateText: cv.createdAt ? new Date(cv.createdAt).toLocaleDateString("vi-VN") : "Hôm nay",
          sha256: cv.sha256Hash,
        });
      }
    });

    // 2. Nạp thêm từ thư viện hiện tại nếu chưa có
    if (existingVideos) {
      existingVideos.forEach((ev) => {
        if (ev.url && !seenUrls.has(ev.url)) {
          seenUrls.add(ev.url);
          list.push({
            id: ev.id,
            name: ev.name,
            title: ev.title || ev.name,
            url: ev.url,
            sizeText: ev.duration ? formatTime(ev.duration) : "",
            dateText: ev.updatedAt || "Có sẵn",
            duration: ev.duration,
            rawLibraryItem: ev,
          });
        }
      });
    }

    return list;
  }, [cloudVideos, existingVideos]);

  const filteredVideos = combinedVideos.filter((v) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return v.name.toLowerCase().includes(q) || v.title.toLowerCase().includes(q) || v.url.toLowerCase().includes(q);
  });

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

  // Khi click vào 1 clip trong danh sách: điền ngay link vào Ô URL và ô Tiêu đề phía trên
  const handlePickClipFromList = (clip: (typeof combinedVideos)[0]) => {
    setUrlInput(clip.url);
    setTitleInput(clip.title || clip.name);
    setError(null);
    probeDuration(clip.url);
  };

  // Nạp video được chọn vào Studio
  const handleApplySelectedVideo = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    if (!urlInput.trim()) {
      setError("Vui lòng nhập URL hoặc chọn một clip trong danh sách bên dưới!");
      return;
    }

    try {
      new URL(urlInput.trim());
    } catch {
      setError("Định dạng URL không hợp lệ! Vui lòng nhập link đầy đủ (ví dụ: https://.../video.mp4)");
      return;
    }

    // Kiểm tra xem có khớp với clip trong thư viện không
    const matched = existingVideos?.find((v) => v.url === urlInput.trim() || v.name === titleInput.trim());
    if (matched && onSelectExistingVideo) {
      onSelectExistingVideo(matched);
      onClose();
      return;
    }

    let finalDurationSeconds = 120;
    const parsed = parseDuration(durationValue, durationUnit);
    if (parsed > 0) {
      finalDurationSeconds = parsed;
    } else if (detectedDuration && detectedDuration > 0) {
      finalDurationSeconds = detectedDuration;
    } else if (urlInput.includes("Vibe-Coding-4")) {
      finalDurationSeconds = 7200;
    }

    onAddVideo({
      url: urlInput.trim(),
      name: titleInput.trim() || "Video bài giảng mới",
      duration: finalDurationSeconds,
      isExternalUrl: true,
      topicTitle: titleInput.trim() || "Video bài giảng",
      sectionName: "01_VideoGoc",
    });
    onClose();
  };

  const handleCopyUrl = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("video/")) {
        setError("Tệp đã chọn không phải định dạng video hợp lệ!");
        setSelectedFile(null);
        return;
      }

      setSelectedFile(file);
      setTitleInput(file.name.replace(/\.[^/.]+$/, ""));
      setError(null);

      const objectUrl = URL.createObjectURL(file);
      probeDuration(objectUrl);
    }
  };

  const handleUploadFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedFile) {
      setError("Vui lòng chọn 1 tệp video từ máy tính!");
      return;
    }

    let finalDurationSeconds = 60;
    const parsed = parseDuration(durationValue, durationUnit);
    if (parsed > 0) {
      finalDurationSeconds = parsed;
    } else if (detectedDuration && detectedDuration > 0) {
      finalDurationSeconds = detectedDuration;
    }

    setIsUploading(true);
    setUploadProgressMsg("Đang tải video lên máy chủ & khởi tạo trình phát trực tiếp...");

    try {
      const uploadRes = await uploadVideoFile(selectedFile);
      if (uploadRes.source === "api" && uploadRes.data?.cloud_url) {
        onAddVideo({
          url: uploadRes.data.cloud_url,
          name: uploadRes.data.file_name || selectedFile.name,
          duration: finalDurationSeconds,
          isExternalUrl: false,
          topicTitle: titleInput.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
          sectionName: "01_VideoGoc",
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

    // Fallback phát trực tiếp cục bộ bằng blob URL
    const fileUrl = URL.createObjectURL(selectedFile);
    onAddVideo({
      url: fileUrl,
      name: selectedFile.name,
      duration: finalDurationSeconds,
      isExternalUrl: false,
      topicTitle: titleInput.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
      sectionName: "01_VideoGoc",
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-[#16171d] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-200 max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Chọn & Thêm Video Vào Studio
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {combinedVideos.length} clip
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Chọn từ danh sách clip có sẵn hoặc nhập link URL để phát trực tiếp
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
        <div className="flex border-b border-slate-800 bg-[#121318] shrink-0">
          <button
            type="button"
            onClick={() => setTab("url_list")}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              tab === "url_list"
                ? "border-purple-500 text-purple-300 bg-purple-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <LinkIcon className="w-4 h-4" />
            <span>Chọn Từ Link & Danh Sách Clip ({combinedVideos.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("file")}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              tab === "file"
                ? "border-purple-500 text-purple-300 bg-purple-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Tải Tệp Mới Từ Máy</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {error && (
            <div className="p-3 mb-4 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: Ô URL PHÍA TRÊN + DANH SÁCH CLIP BÊN DƯỚI */}
          {tab === "url_list" && (
            <form onSubmit={handleApplySelectedVideo} className="space-y-4">
              {/* Ô ĐƯỜNG DẪN URL PHÍA TRÊN (LUÔN HIỂN THỊ ĐẦY ĐỦ LINK) */}
              <div className="p-3.5 bg-slate-900/90 border border-purple-500/30 rounded-xl space-y-2.5 shadow-inner">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white flex items-center gap-1.5">
                    <LinkIcon className="w-3.5 h-3.5 text-purple-400" />
                    <span>Đường dẫn Video URL (Đang chọn):</span>
                  </label>
                  {urlInput && (
                    <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Đã có link</span>
                    </span>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (e.target.value.trim()) probeDuration(e.target.value.trim());
                    }}
                    placeholder="https://.../video.mp4 (Bấm chọn clip trong danh sách bên dưới để tự điền)"
                    className="w-full pl-9 pr-14 py-2 bg-black/50 border border-slate-700 focus:border-purple-500 rounded-lg text-xs text-white placeholder-slate-500 font-mono outline-none"
                  />
                  <LinkIcon className="w-4 h-4 text-purple-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  {urlInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setUrlInput("");
                        setTitleInput("");
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 transition"
                    >
                      Xóa
                    </button>
                  )}
                </div>

                {/* Tiêu đề video tương ứng */}
                <div>
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="Tiêu đề clip / Tên bài giảng..."
                    className="w-full px-3 py-1.5 bg-black/50 border border-slate-700 focus:border-purple-500 rounded-lg text-xs text-slate-200 placeholder-slate-500 outline-none"
                  />
                </div>
              </div>

              {/* DANH SÁCH CLIP KHẢ DỤNG (BẤM VÀO SẼ ĐIỀN VÀO Ô TRÊN) */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-purple-400" />
                    <span>Hoặc bấm chọn clip từ danh sách ({combinedVideos.length}):</span>
                  </span>
                  <span className="text-[10px] text-slate-500">Bấm clip để tự động điền URL</span>
                </div>

                {/* Search Filter */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Lọc clip theo tên..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                {isLoadingVideos ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                    <span className="text-xs">Đang lấy danh sách clip mới nhất...</span>
                  </div>
                ) : filteredVideos.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    Không tìm thấy video nào khớp tìm kiếm.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {filteredVideos.map((clip) => {
                      const isSelected = urlInput.trim() === clip.url.trim();
                      return (
                        <div
                          key={clip.id}
                          onClick={() => handlePickClipFromList(clip)}
                          onDoubleClick={() => {
                            handlePickClipFromList(clip);
                            handleApplySelectedVideo();
                          }}
                          className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-purple-950/40 border-purple-500 shadow-sm shadow-purple-500/20"
                              : "bg-slate-900/70 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition ${
                                isSelected
                                  ? "bg-purple-600 text-white"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            </div>
                            <div className="min-w-0">
                              <h4
                                className={`text-xs font-semibold truncate ${
                                  isSelected ? "text-purple-300" : "text-white"
                                }`}
                              >
                                {clip.name}
                              </h4>
                              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-mono">
                                {clip.sizeText && (
                                  <span className="px-1 py-0.2 rounded bg-slate-800 text-slate-300">
                                    {clip.sizeText}
                                  </span>
                                )}
                                <span className="truncate max-w-[200px] text-slate-500">
                                  {clip.url}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => handleCopyUrl(e, clip.url)}
                              title="Copy URL"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                            >
                              {copiedUrl === clip.url ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <span
                              className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
                                isSelected
                                  ? "bg-purple-600 text-white"
                                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                              }`}
                            >
                              {isSelected ? "✓ Đang chọn" : "Chọn"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Nút Nạp vào Studio */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={!urlInput.trim()}
                  className="px-6 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-purple-600/30 hover:scale-105 active:scale-95"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Nạp & Phát Video Này</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: TẢI TỆP TỪ MÁY */}
          {tab === "file" && (
            <form onSubmit={handleUploadFileSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Chọn Tệp Video Từ Máy Tính (.mp4, .mkv, .webm)
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                    selectedFile
                      ? "border-emerald-500/60 bg-emerald-950/20"
                      : "border-slate-700 hover:border-purple-500 hover:bg-purple-500/5 bg-slate-900/50"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  {selectedFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <p className="text-xs font-semibold text-emerald-300 truncate max-w-sm">
                        {selectedFile.name}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Dung lượng: {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Upload className="w-8 h-8 text-slate-500" />
                      <p className="text-xs font-medium">Bấm vào đây để chọn video từ máy</p>
                      <p className="text-[10px] text-slate-500">Hỗ trợ các định dạng phổ biến</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Tên Bài Học / Tiêu Đề Clip
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Bài 01 - Nhập môn JavaScript"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              {isUploading ? (
                <div className="py-3 px-4 rounded-xl bg-purple-950/40 border border-purple-500/30 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400 shrink-0" />
                  <span className="text-xs text-purple-200">{uploadProgressMsg}</span>
                </div>
              ) : (
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setTab("url_list")}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    Quay lại
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedFile}
                    className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-medium transition flex items-center gap-1.5"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Tải Lên & Xem Ngay</span>
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
