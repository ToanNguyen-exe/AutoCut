"use client";

import React, { useRef } from "react";
import {
  Scissors,
  Download,
  Upload,
  RefreshCw,
  Send,
} from "lucide-react";
import { SegmentsData } from "@/types";

interface HeaderProps {
  data: SegmentsData;
  backendOnline: boolean;
  isRendering: boolean;
  onRefreshFromBackend: () => void;
  onImportJson: (imported: SegmentsData) => void;
  onExportJson: () => void;
  onRender: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  data,
  backendOnline,
  isRendering,
  onRefreshFromBackend,
  onImportJson,
  onExportJson,
  onRender,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.segments && Array.isArray(parsed.segments)) {
          onImportJson(parsed as SegmentsData);
        } else {
          alert("Tệp JSON không đúng cấu trúc segments.json!");
        }
      } catch (err) {
        alert("Lỗi phân tích cú pháp tệp JSON: " + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800 shadow-lg px-4 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Brand & Status */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">
                AutoCut <span className="text-indigo-400">AI</span>
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                Preset: lecture_programming
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>Chế độ: <strong className="text-slate-300">{data.mode.toUpperCase()}</strong></span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    backendOnline ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                  }`}
                />
                {backendOnline ? (
                  <span className="text-emerald-400 font-medium">Backend Connected</span>
                ) : (
                  <span className="text-amber-400">Backend Offline (Chạy chế độ Demo)</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Nạp từ backend */}
          <button
            onClick={onRefreshFromBackend}
            title="Lấy dữ liệu mock mới nhất từ Spring Boot Backend"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition border border-slate-700 shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Nạp Backend</span>
          </button>

          {/* Import JSON */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Nạp tệp segments.json từ máy tính"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition border border-slate-700 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Nạp JSON</span>
          </button>

          {/* Export JSON */}
          <button
            onClick={onExportJson}
            title="Tải về segments.json đã duyệt"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition border border-slate-700 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Lưu JSON</span>
          </button>

          {/* Gửi Render Cắt Video */}
          <button
            onClick={onRender}
            disabled={isRendering}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-md shadow-indigo-500/25 transition disabled:opacity-50"
          >
            {isRendering ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Đang xử lý...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Gửi Render Video (B10)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
