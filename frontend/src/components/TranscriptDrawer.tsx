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
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col p-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-bold text-white">Transcript (B2 Whisper)</h3>
              <p className="text-xs text-slate-400">
                {sentences.length} câu bóc băng được đánh mã S0001...
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

        {/* Search */}
        <div className="my-4 relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo nội dung câu hoặc mã S0001..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        {/* List of Sentences */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs">
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
                className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-800/30 transition cursor-pointer group"
              >
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="font-mono font-bold text-indigo-400 flex items-center gap-1">
                    <Hash className="w-3 h-3 text-indigo-500" />
                    {s.id}
                  </span>
                  <span className="font-mono text-slate-500 group-hover:text-slate-300">
                    {formatTime(s.start)} - {formatTime(s.end)}
                  </span>
                </div>
                <div className="text-xs text-slate-300 leading-relaxed">{s.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
