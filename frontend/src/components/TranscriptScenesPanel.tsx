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
  RefreshCw,
  Music,
  Film,
  AlertCircle,
} from "lucide-react";

interface TranscriptScenesPanelProps {
  segments: Segment[];
  transcript?: TranscriptData;
  activeSegmentId?: string;
  currentTime: number;
  lessonName: string;
  mode?: string;
  isDemo?: boolean;
  isAnalyzing?: boolean;
  analysisStep?: string;
  onSelectSegment: (segmentId: string) => void;
  onSeek: (seconds: number) => void;
  onPlay?: () => void;
  onUpdateSegments: (newSegments: Segment[]) => void;
  onRenameLesson: (newName: string) => void;
  onOpenAddVideo?: () => void;
  onAnalyzeAI?: () => void;
}

// Helper tạo đồ họa xem trước sinh động tương ứng với nội dung chủ đề bài giảng hoặc âm nhạc
const renderSceneGraphic = (seg: Segment, idx: number, isRawVideo: boolean = false) => {
  const topicLower = (seg.topic || "").toLowerCase();
  const sectionLower = (seg.section || "").toLowerCase();

  // 0. Phân loại Video Gốc chưa phân tích (Raw Video)
  if (isRawVideo || sectionLower.includes("videogoc") || topicLower.includes("video gốc")) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#13151f] via-[#1a1b26] to-[#0f111a] p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-slate-800/80">
        <div className="flex items-center justify-between border-b border-slate-800 pb-0.5 mb-0.5">
          <span className="text-[7px] text-blue-300 font-bold truncate max-w-[65px] font-sans">
            Video Gốc
          </span>
          <Film className="w-2.5 h-2.5 text-blue-400" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Play className="w-3 h-3 fill-current ml-0.5" />
          </div>
          <span className="text-[7px] text-slate-400 font-mono">Toàn bộ video</span>
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-slate-800">
          <span className="text-blue-400 font-semibold">CHƯA PHÂN TÍCH</span>
          <span className="text-slate-400">RAW</span>
        </div>
      </div>
    );
  }

  // 1. Phân loại Âm nhạc / TikTok / Remix / Giai điệu / Lời bài hát
  if (
    topicLower.includes("remix") ||
    topicLower.includes("beat") ||
    topicLower.includes("nhạc") ||
    topicLower.includes("nhac") ||
    topicLower.includes("intro") ||
    topicLower.includes("drop") ||
    topicLower.includes("outro") ||
    topicLower.includes("lời") ||
    topicLower.includes("diep khuc") ||
    topicLower.includes("điệp khúc") ||
    topicLower.includes("ca từ") ||
    topicLower.includes("thiếu em")
  ) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#1c1228] via-[#150f20] to-[#0d0914] p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-pink-900/40">
        <div className="flex items-center justify-between border-b border-pink-900/30 pb-0.5 mb-0.5">
          <span className="text-[7px] text-pink-300 font-bold truncate max-w-[65px] font-sans">
            {topicLower.includes("drop")
              ? "Drop Bass"
              : topicLower.includes("lời") || topicLower.includes("điệp khúc")
              ? "Vocal & Ca từ"
              : topicLower.includes("outro")
              ? "Outro Fade"
              : "Intro Beat"}
          </span>
          <Music className="w-2.5 h-2.5 text-pink-400" />
        </div>
        {/* Equalizer Waveform Graphic */}
        <div className="flex-1 flex items-end justify-center gap-1 px-1 py-1">
          <div className="w-1 bg-gradient-to-t from-pink-600 to-purple-400 rounded-t h-3" />
          <div className="w-1 bg-gradient-to-t from-pink-600 to-purple-400 rounded-t h-5" />
          <div className="w-1 bg-gradient-to-t from-pink-600 to-purple-400 rounded-t h-2" />
          <div className="w-1 bg-gradient-to-t from-pink-600 to-purple-400 rounded-t h-6" />
          <div className="w-1 bg-gradient-to-t from-pink-600 to-purple-400 rounded-t h-4" />
          <div className="w-1 bg-gradient-to-t from-pink-600 to-purple-400 rounded-t h-7" />
          <div className="w-1 bg-gradient-to-t from-pink-600 to-purple-400 rounded-t h-3" />
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-pink-900/30">
          <span className="text-pink-400 font-semibold">
            {topicLower.includes("drop") ? "DROP BASS" : topicLower.includes("lời") ? "VOCAL" : "BEAT"}
          </span>
          <span className="text-slate-400">AUDIO</span>
        </div>
      </div>
    );
  }

  // 2. Phân loại theo nội dung: Code / Cú pháp / Vòng lặp
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

  // 3. Thực hành / Ví dụ / Demo / Chạy thử
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

  // 4. Bài tập / Tổng kết
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

  // 5. Mặc định: Slide bài giảng tổng quan / giới thiệu
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
        <span className="text-purple-400 font-semibold">PHÂN ĐOẠN #{idx + 1}</span>
        <span className="text-slate-400">SCENE</span>
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
  mode = "guided",
  isDemo = false,
  isAnalyzing = false,
  analysisStep = "",
  onSelectSegment,
  onSeek,
  onPlay,
  onUpdateSegments,
  onRenameLesson,
  onOpenAddVideo,
  onAnalyzeAI,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(lessonName);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTopicValue, setEditingTopicValue] = useState("");

  const isRaw = mode === "raw" || (segments.length === 1 && (!transcript || transcript.sentences.length === 0));

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
        <div className="flex items-center gap-2 flex-1 mr-2 min-w-0">
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                className="bg-slate-900 border border-purple-500 rounded-md px-2 py-1 text-sm text-white focus:outline-none flex-1 min-w-0 font-semibold"
                autoFocus
              />
              <button
                onClick={handleSaveTitle}
                className="p-1 rounded bg-purple-600 text-white hover:bg-purple-500 shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => setIsEditingTitle(true)}
              className="group flex items-center gap-2 cursor-pointer min-w-0"
            >
              <h2 className="text-sm lg:text-base font-bold text-white tracking-tight truncate max-w-[200px] lg:max-w-[240px]">
                {lessonName || "Learn Demo Project"}
              </h2>
              <Edit3 className="w-3.5 h-3.5 text-slate-500 group-hover:text-purple-400 transition shrink-0" />
            </div>
          )}

          {/* Status Badge */}
          {isDemo ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
              Demo Mẫu
            </span>
          ) : isAnalyzing ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse flex items-center gap-1 shrink-0">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              Đang phân tích...
            </span>
          ) : isRaw ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 shrink-0">
              Chưa phân tích
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shrink-0">
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
              Đã phân tích AI
            </span>
          )}
        </div>

        {/* Action Button: Phân Tích AI / Chạy lại AI / Rewrite */}
        {isAnalyzing ? (
          <button
            disabled
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-400 cursor-not-allowed shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
            <span>Đang chạy...</span>
          </button>
        ) : isRaw && onAnalyzeAI ? (
          <button
            onClick={onAnalyzeAI}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md shadow-purple-600/30 transition hover:scale-105 active:scale-95 shrink-0"
            title="Khởi chạy Whisper & AI để phân tích video và phân đoạn"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Phân Tích AI</span>
          </button>
        ) : onAnalyzeAI ? (
          <button
            onClick={onAnalyzeAI}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-purple-300 hover:text-white border border-purple-500/30 hover:border-purple-500 transition shrink-0"
            title="Chạy lại phân tích AI nếu nội dung chưa vừa ý"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Chạy lại AI</span>
          </button>
        ) : (
          <button
            onClick={() => alert("Tính năng Auto-Segment LLM (B4) đang đồng bộ với transcript!")}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Rewrite</span>
          </button>
        )}
      </div>

      {/* Main split: Thumbnails column on left + Script text column on right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sub-strip: Numbered Scene Thumbnails with Rich Visual Previews & Drag-to-Play */}
        <div className="w-28 sm:w-32 bg-[#121318] border-r border-slate-800/80 p-2 overflow-y-auto space-y-2.5 shrink-0 select-none">
          {/* Header hint */}
          <div className="text-[9px] font-semibold text-purple-300/80 flex items-center justify-center gap-1 py-1 px-1 bg-purple-950/30 rounded border border-purple-900/30 text-center leading-tight">
            <span>{isAnalyzing ? "Đang xử lý..." : "Kéo / Bấm phát"}</span>
          </div>

          {isAnalyzing ? (
            /* Animated Loading placeholders */
            [1, 2, 3].map((n) => (
              <div
                key={n}
                className="aspect-[16/10] bg-slate-900/80 rounded-lg border border-purple-500/20 animate-pulse flex flex-col items-center justify-center gap-1"
              >
                <div className="w-4 h-4 rounded-full border-2 border-purple-500/30 border-t-purple-400 animate-spin" />
                <span className="text-[7px] text-purple-300 font-mono">Phân đoạn #{n}</span>
              </div>
            ))
          ) : (
            segments.map((seg, idx) => {
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
                    {/* Dynamic Graphic corresponding to lecture/music topic */}
                    {renderSceneGraphic(seg, idx, isRaw)}

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
            })
          )}

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
                  section: "Chủ đề mới",
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
                      file: `01_Moi/${(segments.length + 1).toString().padStart(2, "0")}_chu-de-moi.mp4`,
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

        {/* Right Sub-strip: Transcript Text or AI Processing State or Raw Prompt */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col">
          {isAnalyzing ? (
            /* AI Processing View */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 my-auto">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-3 border-purple-500/20 border-t-purple-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-purple-400 animate-pulse" />
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Đang phân tích video bằng AI...</h3>
                <p className="text-xs text-purple-300 font-mono">{analysisStep || "Đang xử lý Whisper & LLM..."}</p>
              </div>
              <div className="w-full max-w-xs bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                <div className="bg-gradient-to-r from-purple-600 via-pink-500 to-indigo-600 h-full w-full animate-pulse" />
              </div>
              <p className="text-[11px] text-slate-500 italic max-w-xs">
                Hệ thống đang trích xuất waveform âm thanh, nhận diện lời bài hát/giọng nói và phân đoạn tự động.
              </p>
            </div>
          ) : isRaw ? (
            /* Raw / Unanalyzed Video Prompt */
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-4 my-auto">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600/30 to-indigo-600/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-xl shadow-purple-900/20">
                <Sparkles className="w-6 h-6 text-purple-400" />
              </div>
              <div className="space-y-1.5 max-w-xs">
                <h3 className="text-base font-bold text-white">Video Gốc (1 Đoạn Duy Nhất)</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Video vừa nạp hiện được giữ nguyên <span className="text-purple-300 font-semibold">1 phân đoạn duy nhất</span> bao trùm toàn bộ thời lượng.
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Hệ thống không tự ý bịa đặt nội dung bài giảng. Hãy bấm nút bên dưới để AI tự động nhận diện ca từ, âm nhạc hoặc giọng nói thực tế!
                </p>
              </div>
              {onAnalyzeAI && (
                <button
                  onClick={onAnalyzeAI}
                  className="w-full max-w-xs py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-xl shadow-purple-600/30 transition transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 group cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-amber-300 group-hover:rotate-12 transition-transform" />
                  <span>⚡ Bắt Đầu Phân Tích Bằng AI</span>
                </button>
              )}
              <div className="text-[11px] text-slate-500 border-t border-slate-800/80 pt-3 w-full max-w-xs flex flex-col gap-1 text-left">
                <span>✨ Tự động nhận diện thể loại: Âm nhạc / TikTok / Bài giảng</span>
                <span>✂️ Hoặc dùng công cụ Cắt trên Timeline bên dưới</span>
              </div>
            </div>
          ) : (
            /* Analyzed or Demo Segments List */
            <>
              {/* Demo Notice Banner if Demo */}
              {isDemo && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span><strong>Dữ liệu mẫu (Demo):</strong> Bài giảng C++ để thử giao diện. Tải video của bạn để AI phân tích thật!</span>
                  </div>
                  {onOpenAddVideo && (
                    <button
                      onClick={onOpenAddVideo}
                      className="text-[11px] font-semibold text-amber-400 hover:text-white underline ml-2 shrink-0"
                    >
                      Thêm video
                    </button>
                  )}
                </div>
              )}

              {/* Analyzed Success Notice */}
              {!isDemo && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] flex items-center justify-between shrink-0">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Đã phân tích nội dung bởi AI ({segments.length} phân đoạn)</span>
                  </span>
                  {onAnalyzeAI && (
                    <button
                      onClick={onAnalyzeAI}
                      className="text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1 hover:underline ml-2"
                      title="Chạy lại nếu kết quả chưa vừa ý"
                    >
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      <span>Chạy lại</span>
                    </button>
                  )}
                </div>
              )}

              {/* Segments List */}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
