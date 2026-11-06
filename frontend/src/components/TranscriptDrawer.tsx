"use client";

import React, { useState } from "react";
import { TranscriptData } from "@/types";
import { formatTime } from "@/lib/utils";
import { FileText, Search, X, Hash } from "lucide-react";

interface TranscriptDrawerProps {
  transcript?: TranscriptData;
  isOpen: boolean;
  onClose: () => void;
  onSeek: (seconds: number) => void;
}

export const TranscriptDrawer: React.FC<TranscriptDrawerProps> = ({
  transcript,
  isOpen,
  onClose,
  onSeek,
}) => {
  const [search, setSearch] = useState("");

  if (!isOpen) return null;

  const sentences = transcript?.sentences || [];
  const filtered = sentences.filter(
    (s) =>
      s.text.toLowerCase().includes(search.toLowerCase()) ||
      s.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col p-5 text-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-2xs">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Transcript (B2 Whisper)</h3>
              <p className="text-xs text-slate-500">
                {sentences.length} câu bóc băng được đánh mã S0001...
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="my-4 relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo nội dung câu hoặc mã S0001..."
            className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* List of Sentences */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              Không tìm thấy câu nào phù hợp
            </div>
          ) : (
            filtered.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  onSeek(s.start);
                  onClose();
                }}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition cursor-pointer group shadow-2xs"
              >
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="font-mono font-bold text-indigo-700 flex items-center gap-1">
                    <Hash className="w-3 h-3 text-indigo-500" />
                    {s.id}
                  </span>
                  <span className="font-mono text-slate-500 group-hover:text-slate-700 font-medium">
                    {formatTime(s.start)} - {formatTime(s.end)}
                  </span>
                </div>
                <div className="text-xs text-slate-700 leading-relaxed font-normal">{s.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
