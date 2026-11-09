"use client";

import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { RenderedClipItem, getDownloadClipUrl, getDownloadZipUrl } from "@/lib/api";

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
  outputDirectory?: string;
  totalRendered?: number;
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
  outputDirectory,
  totalRendered,
  onClose,
  onExportJson,
}) => {
  const [copiedPath, setCopiedPath] = useState(false);

  useEffect(() => {
    if (copiedPath) {
      const timer = setTimeout(() => setCopiedPath(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [copiedPath]);

  if (!isOpen) return null;

  const isCompleted = !isRunning && !error && progressPercent >= 100;
  const isFailed = !isRunning && !!error;

  const handleCopyDir = () => {
    if (outputDirectory) {
      navigator.clipboard.writeText(outputDirectory);
      setCopiedPath(true);
    }
  };

  const handleDownloadZip = () => {
    const url = getDownloadZipUrl(lessonTitle || videoTitle);
    window.open(url, "_blank");
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
          {mode === "render" && isCompleted && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <FileVideo className="w-4 h-4 text-indigo-600" />
                    <span>Danh sách clip đã xuất bản ({renderedClips.length || totalRendered || 0} clip)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Các clip đã được cắt độc lập bằng libx264, âm thanh mượt mà.
                  </p>
                </div>

                {renderedClips.length > 0 && (
                  <button
                    onClick={handleDownloadZip}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition border border-indigo-200 cursor-pointer shadow-2xs"
                    title="Tải toàn bộ các clip con dưới dạng file nén ZIP"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Tải toàn bộ (.zip)</span>
                  </button>
                )}
              </div>

              {/* Clips list */}
              {renderedClips.length > 0 ? (
                <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto rounded-xl border border-slate-100">
                  {renderedClips.map((clip, idx) => (
                    <div
                      key={idx}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
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

                      <a
                        href={getDownloadClipUrl(clip.path || clip.file)}
                        download
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-indigo-50 text-indigo-700 text-xs font-bold border border-slate-200 hover:border-indigo-300 shadow-2xs transition shrink-0"
                        title="Tải file clip này về máy tính"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải về</span>
                      </a>
                    </div>
                  ))}
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
            {isCompleted && mode === "render" && renderedClips.length > 0 && (
              <button
                onClick={handleDownloadZip}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải tất cả clip (.zip)</span>
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
          </div>
        </div>
      </div>
    </div>
  );
};
