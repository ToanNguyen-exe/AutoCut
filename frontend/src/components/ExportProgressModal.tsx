"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Sparkles,
  Scissors,
  CheckCircle2,
  AlertCircle,
  Download,
  FileVideo,
  Archive,
  FileJson,
  Loader2,
  Check,
} from "lucide-react";
import { Segment } from "@/types";
import { formatTime } from "@/lib/utils";
import {
  RenderedClipItem,
  getDownloadClipUrl,
  resolveProtectedDownloadClipUrl,
  resolveProtectedDownloadZipUrl,
  resolveProtectedDownloadSelectedZipUrl,
  triggerBrowserDownload,
} from "@/lib/api";

export type ProgressModalMode = "render" | "analyze";

export interface ProgressStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "running" | "completed" | "error";
}

interface ExportProgressModalProps {
  isOpen: boolean;
  mode: ProgressModalMode;
  videoTitle: string;
  lessonTitle: string;
  isRunning: boolean;
  progressPercent: number; // 0 - 100
  currentActionText: string;
  steps: ProgressStep[];
  error?: string | null;
  renderedClips?: RenderedClipItem[];
  previewUrl?: string;
  previewLabel?: string;
  outputDirectory?: string;
  totalRendered?: number;
  segments?: Segment[];
  isSelectingSegments?: boolean;
  onStartSelectedExport?: (selectedIds: string[], exportFormat: "separate" | "merged") => void;
  onClose: () => void;
  onExportJson?: () => void;
  onCancel?: () => void;
}

export const ExportProgressModal: React.FC<ExportProgressModalProps> = ({
  isOpen,
  mode,
  videoTitle,
  lessonTitle,
  isRunning,
  progressPercent,
  currentActionText,
  steps,
  error,
  renderedClips = [],
  previewUrl,
  previewLabel,
  outputDirectory,
  totalRendered,
  segments = [],
  isSelectingSegments = false,
  onStartSelectedExport,
  onClose,
  onExportJson,
}) => {
  const [copiedPath, setCopiedPath] = useState(false);
  const [selectedIdsForExport, setSelectedIdsForExport] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState<"separate" | "merged">("separate");
  const [downloadSelectedPaths, setDownloadSelectedPaths] = useState<string[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const seenClipPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && isSelectingSegments) {
      setSelectedIdsForExport(segments.map((s) => s.id));
      setExportFormat("separate");
    }
  }, [isOpen, isSelectingSegments, segments]);

  useEffect(() => {
    if (renderedClips.length === 0) {
      seenClipPathsRef.current.clear();
      setDownloadSelectedPaths([]);
      return;
    }
    const newlyAdded: string[] = [];
    for (const clip of renderedClips) {
      const p = clip.path || clip.file;
      if (p && !seenClipPathsRef.current.has(p)) {
        seenClipPathsRef.current.add(p);
        newlyAdded.push(p);
      }
    }
    if (newlyAdded.length > 0) {
      setDownloadSelectedPaths((prev) => [...prev, ...newlyAdded]);
    }
  }, [renderedClips]);

  useEffect(() => {
    if (copiedPath) {
      const timer = setTimeout(() => setCopiedPath(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [copiedPath]);

  if (!isOpen) return null;

  const isCompleted = !isRunning && !error && progressPercent >= 100;
  const isFailed = !isRunning && !!error;
  const isPickerActive = mode === "render" && isSelectingSegments;

  const toggleSegmentForExport = (id: string) => {
    setSelectedIdsForExport((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleDownloadClipPath = (clipPath: string) => {
    setDownloadSelectedPaths((prev) =>
      prev.includes(clipPath) ? prev.filter((p) => p !== clipPath) : [...prev, clipPath]
    );
  };

  const selectedDurationSum = segments
    .filter((s) => selectedIdsForExport.includes(s.id))
    .reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);

  const handleCopyDir = () => {
    if (outputDirectory) {
      navigator.clipboard.writeText(outputDirectory);
      setCopiedPath(true);
    }
  };

  const handleDownloadZip = async () => {
    const lName = lessonTitle || videoTitle || "clips";
    const pathsToZip =
      downloadSelectedPaths.length > 0
        ? downloadSelectedPaths
        : renderedClips.map((c) => c.path || c.file).filter(Boolean);
    const url =
      pathsToZip.length > 0
        ? await resolveProtectedDownloadSelectedZipUrl(lName, pathsToZip)
        : await resolveProtectedDownloadZipUrl(lName);
    const cleanName = lName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    triggerBrowserDownload(url, `${cleanName}_exported_clips.zip`);
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-xs ${
                mode === "render"
                  ? "bg-indigo-50 text-indigo-600 border border-indigo-100"
                  : "bg-emerald-50 text-emerald-600 border border-emerald-100"
              }`}
            >
              {mode === "render" ? (
                <Scissors className="w-5 h-5" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900 leading-tight">
                {mode === "render"
                  ? "Tiến Độ Cắt Video & Xuất Bản"
                  : "Tiến Độ Phân Tích Nội Dung Video (AI)"}
              </h3>
              <p className="text-xs text-slate-500 font-medium truncate max-w-md mt-0.5">
                {videoTitle} {lessonTitle ? `• ${lessonTitle}` : ""}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isRunning}
            className={`p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition ${
              isRunning ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
            }`}
            title={isRunning ? "Đang xử lý, vui lòng chờ..." : "Đóng"}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 min-h-0 bg-slate-50/30">
          {isPickerActive ? (
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Chọn các đoạn muốn cắt &amp; tải về
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Chỉ cắt đúng các đoạn bạn chọn (không cần đợi render toàn bộ video). Mẹo: bạn cũng có thể tick sẵn ngoài timeline rồi bấm Export.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedIdsForExport(segments.map((s) => s.id))}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 cursor-pointer"
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIdsForExport([])}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 cursor-pointer"
                  >
                    Bỏ chọn
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto rounded-xl border border-slate-200/80">
                {segments.map((seg, idx) => {
                  const checked = selectedIdsForExport.includes(seg.id);
                  const dur = Math.max(0, seg.end - seg.start);
                  return (
                    <label
                      key={seg.id}
                      onClick={() => toggleSegmentForExport(seg.id)}
                      className={`p-3 flex items-center justify-between gap-3 cursor-pointer transition ${
                        checked ? "bg-indigo-50/60" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition ${
                            checked
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "bg-white border-slate-300 text-transparent"
                          }`}
                        >
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">
                            #{idx + 1} {seg.topic}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {formatTime(seg.start)} → {formatTime(seg.end)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded-lg border border-indigo-100 shrink-0">
                        {formatTime(dur)}
                      </span>
                    </label>
                  );
                })}
              </div>

              {selectedIdsForExport.length >= 2 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setExportFormat("separate")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      exportFormat === "separate"
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Xuất từng clip rời (Nhanh • Stream Copy)
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportFormat("merged")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      exportFormat === "merged"
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Gộp thành 1 file MP4 duy nhất
                  </button>
                </div>
              )}

              <div className="text-xs text-slate-500 font-medium">
                Đã chọn <strong className="text-indigo-700">{selectedIdsForExport.length}/{segments.length}</strong> đoạn • Tổng thời lượng cần cắt:{" "}
                <strong className="font-mono text-slate-800">{formatTime(selectedDurationSum)}</strong>
              </div>
            </div>
          ) : (
            <>
          {/* Progress Bar & Current Status */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3.5">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                {isRunning ? (
                  <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                ) : isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                )}
                <span>
                  {isCompleted
                    ? "Hoàn thành xử lý 100%!"
                    : isFailed
                    ? "Đã xảy ra lỗi trong quá trình xử lý"
                    : currentActionText || "Đang xử lý..."}
                </span>
              </div>
              <span className="font-mono font-bold text-sm text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-100/80">
                {Math.round(progressPercent)}%
              </span>
            </div>

            {/* Progress Track */}
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/60">
              <div
                className={`h-full rounded-full transition-all duration-300 relative ${
                  isFailed
                    ? "bg-rose-500"
                    : isCompleted
                    ? "bg-emerald-500"
                    : "bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-500"
                }`}
                style={{ width: `${Math.max(3, Math.min(100, progressPercent))}%` }}
              >
                {isRunning && (
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                )}
              </div>
            </div>

            <p className="text-xs text-slate-500 flex items-center justify-between">
              <span>
                {isRunning
                  ? "Hệ thống đang thực thi FFmpeg libx264, vui lòng không tải lại trang..."
                  : isCompleted
                  ? "Tất cả các mốc thời gian đã được áp dụng padding_start (0.3s) và padding_end (0.5s)."
                  : "Vui lòng kiểm tra lại kết nối hoặc file video nguồn."}
              </span>
              <span className="font-mono text-slate-400">
                {mode === "render" ? "Accurate Cut (SV1)" : "Whisper AI STT"}
              </span>
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold">Xử lý thất bại</h4>
                <p className="text-xs text-rose-600 mt-0.5 leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {/* Step-by-Step Breakdown */}
          {steps && steps.length > 0 && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Các giai đoạn thực hiện
              </h4>

              <div className="space-y-2.5">
                {steps.map((st, i) => (
                  <div
                    key={st.id || i}
                    className={`flex items-start gap-3 p-3 rounded-xl transition ${
                      st.status === "running"
                        ? "bg-indigo-50/70 border border-indigo-200/80"
                        : st.status === "completed"
                        ? "bg-slate-50/80 border border-slate-100"
                        : "bg-white border border-slate-100/60 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {st.status === "completed" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : st.status === "running" ? (
                        <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-slate-300 flex items-center justify-center text-[10px] text-slate-400 font-bold">
                          {i + 1}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-sm font-bold ${
                            st.status === "running"
                              ? "text-indigo-900"
                              : st.status === "completed"
                              ? "text-slate-800"
                              : "text-slate-500"
                          }`}
                        >
                          {st.title}
                        </span>
                        {st.status === "running" && (
                          <span className="text-[11px] font-bold text-indigo-600 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                            Đang chạy...
                          </span>
                        )}
                      </div>
                      {st.description && (
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                          {st.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Success Output: Rendered Clips List with Direct Download Links */}
          {mode === "render" && !isPickerActive && (isCompleted || renderedClips.length > 0) && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <FileVideo className="w-4 h-4 text-indigo-600" />
                    <span>Danh sách clip đã cắt ({renderedClips.length || totalRendered || 0} clip)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Cắt xong đoạn nào tải ngay đoạn đó, hoặc tích chọn các clip muốn nén ZIP tải về.
                  </p>
                </div>

                {renderedClips.length > 1 && downloadSelectedPaths.length > 0 && (
                  <button
                    onClick={handleDownloadZip}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition border border-indigo-200 cursor-pointer shadow-2xs shrink-0"
                    title="Tải các clip đã tích dưới dạng file nén ZIP"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Tải đã chọn ({downloadSelectedPaths.length}) .zip</span>
                  </button>
                )}
              </div>

              {/* Lỗi khi tạo vé tải xuống */}
              {downloadError && (
                <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
                  {downloadError}
                </div>
              )}

              {/* Xem trước ngay tại chỗ (không bật popup riêng) */}
              {previewUrl && (
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-black">
                  <div className="px-3 py-2 bg-slate-900 text-slate-200 text-xs font-bold flex items-center justify-between">
                    <span className="truncate">{previewLabel || "Xem trước video đã gộp"}</span>
                  </div>
                  <video src={previewUrl} controls className="w-full max-h-72 bg-black" />
                </div>
              )}

              {/* Clips list */}
              {renderedClips.length > 0 ? (
                <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto rounded-xl border border-slate-100">
                  {renderedClips.map((clip, idx) => {
                    const clipKey = clip.path || clip.file;
                    const isCheckedForZip = downloadSelectedPaths.includes(clipKey);
                    return (
                    <div
                      key={clipKey || idx}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {renderedClips.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleDownloadClipPath(clipKey)}
                            className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition cursor-pointer ${
                              isCheckedForZip
                                ? "bg-indigo-600 border-indigo-600 text-white"
                                : "bg-white border-slate-300 text-transparent"
                            }`}
                            title="Chọn/bỏ chọn clip này vào gói ZIP"
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                          </button>
                        )}
                        <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate" title={clip.file}>
                            {clip.file}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                            <span>{formatFileSize(clip.sizeBytes)}</span>
                            {clip.executionMs > 0 && (
                              <span>• {clip.executionMs} ms</span>
                            )}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          const downloadUrl = await resolveProtectedDownloadClipUrl(
                            clip.path || clip.file,
                            lessonTitle || videoTitle
                          );
                          // Không bao giờ điều hướng khi thiếu vé: nếu không có vé, backend sẽ trả
                          // 401 AUTH_REQUIRED và người dùng chỉ thấy JSON lỗi trong tab mới.
                          if (!downloadUrl) {
                            setDownloadError(
                              "Không tạo được vé tải xuống. Phiên đăng nhập có thể đã hết hạn — hãy đăng nhập lại rồi thử lại."
                            );
                            return;
                          }
                          setDownloadError(null);
                          triggerBrowserDownload(downloadUrl, clip.file || "clip.mp4");
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-indigo-50 text-indigo-700 text-xs font-bold border border-slate-200 hover:border-indigo-300 shadow-2xs transition shrink-0 cursor-pointer"
                        title="Tải file clip này về máy tính"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải về</span>
                      </button>
                    </div>
                  );})}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-600">
                  Đã hoàn tất cắt và lưu tại thư mục hệ thống: <br />
                  <span className="font-mono font-bold text-slate-800 mt-1 inline-block">
                    {outputDirectory || "output/" + lessonTitle}
                  </span>
                </div>
              )}

              {/* Output directory copy row */}
              {outputDirectory && (
                <div className="pt-2 flex items-center justify-between text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
                  <span className="truncate max-w-[420px]" title={outputDirectory}>
                    📁 Thư mục: <code className="font-mono text-slate-800 font-bold">{outputDirectory}</code>
                  </span>
                  <button
                    onClick={handleCopyDir}
                    className="text-indigo-600 hover:text-indigo-800 font-bold shrink-0 ml-2"
                  >
                    {copiedPath ? "Đã copy!" : "Copy đường dẫn"}
                  </button>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-between shrink-0">
          <div>
            {onExportJson && (
              <button
                onClick={onExportJson}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 shadow-2xs transition cursor-pointer"
              >
                <FileJson className="w-3.5 h-3.5 text-slate-500" />
                <span>Tải kịch bản (JSON)</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {isPickerActive ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={selectedIdsForExport.length === 0}
                  onClick={() =>
                    onStartSelectedExport?.(
                      selectedIdsForExport,
                      selectedIdsForExport.length < 2 ? "separate" : exportFormat
                    )
                  }
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition ${
                    selectedIdsForExport.length > 0
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Bắt đầu Export ({selectedIdsForExport.length} đoạn)</span>
                </button>
              </>
            ) : (
              <>
                {isCompleted && mode === "render" && renderedClips.length > 1 && downloadSelectedPaths.length > 0 && (
                  <button
                    onClick={handleDownloadZip}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải các clip đã chọn (.zip)</span>
                  </button>
                )}

                <button
                  onClick={onClose}
                  disabled={isRunning}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-2xs ${
                    isRunning
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                  }`}
                >
                  {isCompleted ? "Hoàn tất & Đóng" : isFailed ? "Đóng" : "Đang xử lý..."}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
