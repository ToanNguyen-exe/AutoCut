"use client";

import React, { useState } from "react";
import { Segment, TranscriptData } from "@/types";
import { formatTime, slugify, recalculateParts } from "@/lib/utils";
import {
  Sparkles,
  Edit3,
  Plus,
  Play,
  Check,
  GripVertical,
  Code2,
  Terminal,
  CheckCircle2,
  Layout,
} from "lucide-react";

interface TranscriptScenesPanelProps {
  segments: Segment[];
  transcript?: TranscriptData;
  activeSegmentId?: string;
  currentTime: number;
  lessonName: string;
  onSelectSegment: (segmentId: string) => void;
  onSeek: (seconds: number) => void;
  onPlay?: () => void;
  onUpdateSegments: (newSegments: Segment[]) => void;
  onRenameLesson: (newName: string) => void;
  onOpenAddVideo?: () => void;
}

// Helper tạo đồ họa xem trước sinh động tương ứng với nội dung chủ đề bài giảng
const renderSceneGraphic = (seg: Segment, idx: number) => {
  const topicLower = (seg.topic || "").toLowerCase();
  const sectionLower = (seg.section || "").toLowerCase();

  // 1. Phân loại theo nội dung: Code / Cú pháp / Vòng lặp
  if (
    topicLower.includes("for") ||
    topicLower.includes("while") ||
    topicLower.includes("lý thuyết") ||
    topicLower.includes("khái niệm") ||
    sectionLower.includes("lý thuyết") ||
    topicLower.includes("cú pháp")
  ) {
    return (
      <div className="w-full h-full bg-[#181a20] p-1.5 flex flex-col justify-between text-[8px] font-mono select-none overflow-hidden border border-slate-800/70">
        {/* Top mini IDE header */}
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-0.5 mb-0.5">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500/80" />
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500/80" />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-[7px] text-slate-500 font-sans truncate max-w-[45px]">
            {topicLower.includes("while") ? "while.js" : "for_loop.cpp"}
          </span>
          <Code2 className="w-2.5 h-2.5 text-purple-400" />
        </div>
        {/* Code syntax lines */}
        <div className="space-y-0.5 text-[7px] leading-tight flex-1">
          <div className="text-purple-400 truncate">
            <span className="text-slate-600 mr-1">1</span>
            {topicLower.includes("while") ? "while (count < 10) {" : "for (int i=0; i<n; i++) {"}
          </div>
          <div className="text-cyan-300 pl-2 truncate">
            <span className="text-slate-600 mr-1">2</span>
            {topicLower.includes("while") ? "count++;" : "sum += arr[i];"}
          </div>
          <div className="text-slate-400 truncate">
            <span className="text-slate-600 mr-1">3</span>
            {"}"}
          </div>
        </div>
        {/* Bottom category tag */}
        <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-slate-800/40">
          <span className="text-purple-400 font-semibold">CÚ PHÁP</span>
          <span className="text-slate-400">IDE</span>
        </div>
      </div>
    );
  }

  // 2. Thực hành / Ví dụ / Demo / Chạy thử
  if (
    topicLower.includes("thực hành") ||
    topicLower.includes("ví dụ") ||
    sectionLower.includes("thực hành") ||
    topicLower.includes("demo")
  ) {
    return (
      <div className="w-full h-full bg-[#0d1117] p-1.5 flex flex-col justify-between text-[8px] font-mono select-none overflow-hidden border border-slate-800/70">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-0.5 mb-0.5">
          <div className="flex items-center gap-1 text-[7px] text-emerald-400 font-sans font-bold">
            <Terminal className="w-2.5 h-2.5" />
            <span>Terminal</span>
          </div>
          <span className="text-[7px] text-emerald-500 bg-emerald-950/60 px-1 rounded">RUN</span>
        </div>
        <div className="space-y-0.5 text-[7px] leading-tight flex-1">
          <div className="text-slate-400 truncate">$ ./run_example</div>
          <div className="text-emerald-400 truncate">&gt; Input: n = 100</div>
          <div className="text-amber-300 truncate">&gt; Output: 5050 [OK]</div>
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-slate-800/40">
          <span className="text-emerald-400 font-semibold">THỰC HÀNH</span>
          <span className="text-slate-400">OUTPUT</span>
        </div>
      </div>
    );
  }

  // 3. Bài tập / Tổng kết
  if (
    topicLower.includes("tổng kết") ||
    topicLower.includes("bài tập") ||
    sectionLower.includes("tổng kết") ||
    sectionLower.includes("bài tập")
  ) {
    return (
      <div className="w-full h-full bg-[#151221] p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-slate-800/70">
        <div className="flex items-center justify-between border-b border-purple-900/40 pb-0.5 mb-0.5">
          <span className="text-[7px] text-purple-300 font-bold font-sans">Bài tập & Ôn tập</span>
          <CheckCircle2 className="w-2.5 h-2.5 text-purple-400" />
        </div>
        <div className="space-y-0.5 text-[7px] leading-tight flex-1">
          <div className="flex items-center gap-1 text-slate-300 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span className="truncate">1. In cửu chương</span>
          </div>
          <div className="flex items-center gap-1 text-slate-300 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span className="truncate">2. Số nguyên tố</span>
          </div>
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-purple-900/30">
          <span className="text-amber-400 font-semibold">TỔNG KẾT</span>
          <span className="text-slate-400">Q&A</span>
        </div>
      </div>
    );
  }

  // 4. Mặc định: Slide bài giảng tổng quan / giới thiệu
  return (
    <div className="w-full h-full bg-gradient-to-br from-[#1a1429] via-[#12131d] to-[#0f172a] p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-slate-800/70">
      <div className="flex items-center justify-between border-b border-purple-900/40 pb-0.5 mb-0.5">
        <span className="text-[7px] text-purple-300 font-bold truncate max-w-[65px] font-sans">
          {seg.topic || "Bài giảng"}
        </span>
        <Layout className="w-2.5 h-2.5 text-purple-400" />
      </div>
      <div className="space-y-1 flex-1 flex flex-col justify-center">
        <div className="h-1.5 w-4/5 bg-purple-500/30 rounded-full" />
        <div className="h-1.5 w-3/5 bg-indigo-500/25 rounded-full" />
        <div className="h-1.5 w-1/2 bg-slate-600/30 rounded-full" />
      </div>
      <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-purple-900/30">
        <span className="text-purple-400 font-semibold">SLIDE #{idx + 1}</span>
        <span className="text-slate-400">OVERVIEW</span>
      </div>
    </div>
  );
};

export const TranscriptScenesPanel: React.FC<TranscriptScenesPanelProps> = ({
  segments,
  transcript,
  activeSegmentId,
  currentTime,
  lessonName,
  onSelectSegment,
  onSeek,
  onPlay,
  onUpdateSegments,
  onRenameLesson,
  onOpenAddVideo,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(lessonName);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTopicValue, setEditingTopicValue] = useState("");

  const handleSaveTitle = () => {
    setIsEditingTitle(false);
    if (titleInput.trim()) {
      onRenameLesson(titleInput.trim());
    }
  };

  const handleStartEditTopic = (seg: Segment) => {
    setEditingTopicId(seg.id);
    setEditingTopicValue(seg.topic);
  };

  const handleSaveTopic = (index: number) => {
    if (!editingTopicId) return;
    const updated = [...segments];
    const seg = { ...updated[index] };
    seg.topic = editingTopicValue.trim() || seg.topic;
    seg.slug = slugify(seg.topic);

    // Recalculate parts
    const sectionFolder = `${seg.section_no.toString().padStart(2, "0")}_${slugify(seg.section)}`;
    seg.parts = recalculateParts(seg.start, seg.end, sectionFolder, seg.topic_no, seg.slug);

    updated[index] = seg;
    onUpdateSegments(updated);
    setEditingTopicId(null);
  };

  return (
    <div className="w-[380px] lg:w-[430px] xl:w-[470px] shrink-0 flex flex-col bg-[#16171d] border-l border-slate-800 overflow-hidden select-none">
      {/* Top Project Bar matching "Learn Demo Project   [Rewrite]" in reference image */}
      <div className="h-14 border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 flex-1 mr-2">
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5 flex-1">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                className="bg-slate-900 border border-purple-500 rounded-md px-2 py-1 text-sm text-white focus:outline-none flex-1 font-semibold"
                autoFocus
              />
              <button
                onClick={handleSaveTitle}
                className="p-1 rounded bg-purple-600 text-white hover:bg-purple-500"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => setIsEditingTitle(true)}
              className="group flex items-center gap-2 cursor-pointer"
            >
              <h2 className="text-base font-bold text-white tracking-tight truncate max-w-[280px]">
                {lessonName || "Learn Demo Project"}
              </h2>
              <Edit3 className="w-3.5 h-3.5 text-slate-500 group-hover:text-purple-400 transition" />
            </div>
          )}
        </div>

        {/* Rewrite / Auto Segment button */}
        <button
          onClick={() => alert("Tính năng Auto-Segment LLM (B4) đang đồng bộ với transcript!")}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Rewrite</span>
        </button>
      </div>

      {/* Main split: Thumbnails column on left + Script text column on right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sub-strip: Numbered Scene Thumbnails with Rich Visual Previews & Drag-to-Play */}
        <div className="w-28 sm:w-32 bg-[#121318] border-r border-slate-800/80 p-2 overflow-y-auto space-y-2.5 shrink-0 select-none">
          {/* Header hint */}
          <div className="text-[9px] font-semibold text-purple-300/80 flex items-center justify-center gap-1 py-1 px-1 bg-purple-950/30 rounded border border-purple-900/30 text-center leading-tight">
            <span>Kéo / Bấm phát</span>
          </div>

          {segments.map((seg, idx) => {
            const isSelected = (activeSegmentId === seg.id) || (!activeSegmentId && idx === 0);
            return (
              <div
                key={seg.id}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/json",
                    JSON.stringify({
                      id: seg.id,
                      start: seg.start,
                      end: seg.end,
                      topic: seg.topic,
                    })
                  );
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onClick={() => {
                  onSelectSegment(seg.id);
                  onSeek(seg.start);
                  if (onPlay) onPlay();
                }}
                className={`group relative rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-all duration-200 transform hover:scale-[1.03] hover:shadow-lg ${
                  isSelected
                    ? "ring-2 ring-purple-500 shadow-md shadow-purple-500/30 scale-[1.02]"
                    : "hover:ring-1 hover:ring-purple-400/50 opacity-90 hover:opacity-100"
                }`}
                title={`Kéo vào màn hình hoặc bấm để phát: "${seg.topic}" (${formatTime(seg.start)} - ${formatTime(seg.end)})`}
              >
                {/* Simulated Thumbnail Frame with High Fidelity Lecture Mockup */}
                <div className="aspect-[16/10] bg-slate-900 rounded relative overflow-hidden flex items-center justify-center border border-slate-800">
                  {/* Dynamic Graphic corresponding to lecture topic */}
                  {renderSceneGraphic(seg, idx)}

                  {/* Scene Number Badge in top left */}
                  <span className="absolute top-1 left-1 bg-black/85 backdrop-blur-xs text-[9px] font-mono font-bold text-white px-1.5 py-0.2 rounded shadow-sm z-10 border border-white/10">
                    #{idx + 1}
                  </span>

                  {/* Grip Drag Handle Icon in top right */}
                  <div className="absolute top-1 right-1 z-10 p-0.5 rounded bg-black/60 text-slate-400 group-hover:text-purple-300 opacity-60 group-hover:opacity-100 transition">
                    <GripVertical className="w-2.5 h-2.5" />
                  </div>

                  {/* Hover Overlay with Glowing Purple Play Button & Action Label */}
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-[0.5px] opacity-0 group-hover:opacity-100 transition-all duration-200 flex flex-col items-center justify-center gap-0.5 z-20 pointer-events-none">
                    <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-600/50 transform scale-75 group-hover:scale-100 transition-transform">
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                    </div>
                    <span className="text-[8px] font-bold text-white tracking-wider uppercase drop-shadow">
                      Phát ngay
                    </span>
                  </div>

                  {/* Duration label bottom */}
                  <span className="absolute bottom-0.5 right-1 text-[8px] font-mono text-slate-200 bg-black/85 px-1 py-0.2 rounded z-10 border border-white/10">
                    {formatTime(seg.end - seg.start)}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Plus Add Scene Button: mở modal thêm video URL hoặc upload tệp */}
          <button
            onClick={() => {
              if (onOpenAddVideo) {
                onOpenAddVideo();
              } else {
                const last = segments[segments.length - 1];
                const newStart = last ? last.end : 0;
                const newEnd = newStart + 300;
                const newSeg: Segment = {
                  id: `seg${(segments.length + 1).toString().padStart(2, "0")}`,
                  section_no: 1,
                  section: "Lý thuyết",
                  topic_no: segments.length + 1,
                  topic: "Chủ đề mới",
                  slug: "chu-de-moi",
                  start_id: "S0000",
                  end_id: "S0000",
                  start: newStart,
                  end: newEnd,
                  parts: [
                    {
                      part: 1,
                      start: newStart,
                      end: newEnd,
                      file: `01_LyThuyet/${(segments.length + 1).toString().padStart(2, "0")}_chu-de-moi.mp4`,
                    },
                  ],
                };
                onUpdateSegments([...segments, newSeg]);
              }
            }}
            className="w-full aspect-[16/10] rounded-lg border-2 border-dashed border-slate-700 hover:border-purple-500 hover:bg-purple-950/20 text-slate-500 hover:text-purple-300 flex flex-col items-center justify-center gap-1 transition group"
            title="Thêm video mới từ URL hoặc tải lên từ máy (+)"
          >
            <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-[9px] font-semibold text-slate-400 group-hover:text-purple-300">Thêm URL</span>
          </button>
        </div>

        {/* Right Sub-strip: Transcript Text with Speakers & Interactive Sentences */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {segments.map((seg, idx) => {
            const isSelected = (activeSegmentId === seg.id) || (!activeSegmentId && idx === 0);
            const isCurrentPlaying = currentTime >= seg.start && currentTime <= seg.end;

            // Find matching transcript sentences if available
            const segSentences = transcript?.sentences.filter(
              (s) => s.start >= seg.start && s.start <= seg.end
            ) || [];

            return (
              <div
                key={seg.id}
                id={`seg-block-${seg.id}`}
                className={`p-3.5 rounded-xl transition border ${
                  isSelected
                    ? "bg-purple-950/20 border-purple-500/40"
                    : isCurrentPlaying
                    ? "bg-slate-900/60 border-slate-700/60"
                    : "bg-transparent border-transparent hover:bg-slate-900/30"
                }`}
              >
                {/* Speaker / Section Tag */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-purple-400">
                      {seg.section}
                    </span>
                    <span className="text-slate-600 text-xs">•</span>
                    <span className="text-xs text-slate-400 font-mono">
                      #{idx + 1}
                    </span>
                  </div>

                  <span className="text-[11px] font-mono text-slate-500">
                    {formatTime(seg.start)} - {formatTime(seg.end)}
                  </span>
                </div>

                {/* Topic Title (Editable) */}
                <div className="mb-2">
                  {editingTopicId === seg.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={editingTopicValue}
                        onChange={(e) => setEditingTopicValue(e.target.value)}
                        className="bg-slate-900 border border-purple-500 rounded px-2 py-0.5 text-xs text-white focus:outline-none flex-1 font-semibold"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && handleSaveTopic(idx)}
                      />
                      <button
                        onClick={() => handleSaveTopic(idx)}
                        className="p-1 rounded bg-purple-600 text-white hover:bg-purple-500"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => handleStartEditTopic(seg)}
                      className="group/topic flex items-center gap-1.5 cursor-pointer text-sm font-semibold text-white hover:text-purple-300 transition"
                      title="Nhấp để sửa tên chủ đề"
                    >
                      <span>{seg.topic}</span>
                      <Edit3 className="w-3 h-3 text-slate-600 group-hover/topic:text-purple-400 transition" />
                    </div>
                  )}
                </div>

                {/* Sentence transcript text or placeholder */}
                <div className="text-xs text-slate-300 leading-relaxed space-y-2 mt-2 font-normal">
                  {segSentences.length > 0 ? (
                    segSentences.map((sent) => {
                      const isWordActive = currentTime >= sent.start && currentTime <= sent.end;
                      return (
                        <div
                          key={sent.id}
                          onClick={() => onSeek(sent.start)}
                          className={`cursor-pointer hover:text-white transition p-1.5 rounded ${
                            isWordActive
                              ? "bg-purple-600/20 text-purple-200 border-l-2 border-purple-400"
                              : ""
                          }`}
                        >
                          <span className="font-mono text-[10px] text-purple-400 font-semibold mr-1.5">
                            [{sent.id}]
                          </span>
                          <span>{sent.text}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div
                      onClick={() => onSeek(seg.start)}
                      className="cursor-pointer hover:text-white text-slate-400 italic"
                    >
                      Đoạn video từ {formatTime(seg.start)} đến {formatTime(seg.end)}. Nhấp để nhảy tới điểm phát.
                    </div>
                  )}
                </div>

                {/* Subparts note if split > 7 min */}
                {seg.parts.length > 1 && (
                  <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-amber-400 font-mono">
                    <span>⚡ Vượt 7 phút: Tự tách thành {seg.parts.length} phần</span>
                    <span className="text-slate-500">{seg.parts.map((p) => p.file.split("/")[1]).join(", ")}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
