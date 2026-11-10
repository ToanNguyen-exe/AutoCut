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
  Clock,
  LayoutList,
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
  analysisProgress?: number;
  analysisStep?: string;
  onSelectSegment: (segmentId: string) => void;
  onSeek: (seconds: number) => void;
  onPlay?: () => void;
  onUpdateSegments: (newSegments: Segment[]) => void;
  onRenameLesson: (newName: string) => void;
  onOpenAddVideo?: () => void;
  onAnalyzeAI?: () => void;
}

// Helper tạo đồ họa xem trước sinh động tương ứng với nội dung chủ đề bài giảng hoặc âm nhạc (Light Pastel theme)
const renderSceneGraphic = (
  seg: Segment,
  idx: number,
  isRawVideo: boolean = false,
  lessonContext: string = ""
) => {
  const topicLower = (seg.topic || "").toLowerCase();
  const sectionLower = (seg.section || "").toLowerCase();
  const contextLower = (lessonContext || "").toLowerCase();

  // 0. Phân loại Video Gốc chưa phân tích (Raw Video)
  if (isRawVideo || sectionLower.includes("videogoc") || topicLower.includes("video gốc")) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-blue-100 via-slate-100 to-indigo-100 p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-blue-200">
        <div className="flex items-center justify-between border-b border-blue-200 pb-0.5 mb-0.5">
          <span className="text-[7px] text-blue-800 font-bold truncate max-w-[65px] font-sans">
            Video Gốc
          </span>
          <Film className="w-2.5 h-2.5 text-blue-700" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <div className="w-6 h-6 rounded-full bg-blue-200/80 border border-blue-300 flex items-center justify-center text-blue-800">
            <Play className="w-3 h-3 fill-current ml-0.5" />
          </div>
          <span className="text-[7px] text-slate-600 font-mono font-semibold">Toàn bộ video</span>
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-blue-200 font-semibold">
          <span className="text-blue-800 font-bold">CHƯA PHÂN TÍCH</span>
          <span className="text-slate-500">RAW</span>
        </div>
      </div>
    );
  }

  // 1. Phân loại Âm nhạc / TikTok / Remix / Giai điệu / Lời bài hát / Download
  const isMusic =
    /download|remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi/i.test(
      `${contextLower} ${topicLower} ${sectionLower}`
    );

  if (isMusic) {
    const isDrop = topicLower.includes("drop") || sectionLower.includes("drop");
    const isVocal =
      topicLower.includes("lời") ||
      topicLower.includes("vocal") ||
      topicLower.includes("ca từ") ||
      sectionLower.includes("loi");
    const isOutro = topicLower.includes("outro") || sectionLower.includes("outro");
    const isIntro = idx === 0 || topicLower.includes("intro") || sectionLower.includes("intro");

    const badgeTitle = isDrop
      ? "Drop Bass"
      : isVocal
      ? "Vocal & Ca từ"
      : isOutro
      ? "Outro Fade"
      : isIntro
      ? "Intro Beat"
      : `Đoạn #${idx + 1}`;

    const subBadge = isDrop ? "DROP BASS" : isVocal ? "VOCAL" : isIntro ? "INTRO" : "AUDIO";

    return (
      <div className="w-full h-full bg-gradient-to-br from-pink-100 via-rose-50 to-purple-100 p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-pink-300">
        <div className="flex items-center justify-between border-b border-pink-200 pb-0.5 mb-0.5">
          <span className="text-[7px] text-pink-800 font-bold truncate max-w-[65px] font-sans">
            {badgeTitle}
          </span>
          <Music className="w-2.5 h-2.5 text-pink-600" />
        </div>
        {/* Equalizer Waveform Graphic */}
        <div className="flex-1 flex items-end justify-center gap-1 px-1 py-1">
          <div className="w-1 bg-pink-500 rounded-t h-3" />
          <div className="w-1 bg-purple-500 rounded-t h-5" />
          <div className="w-1 bg-pink-400 rounded-t h-2" />
          <div className="w-1 bg-indigo-500 rounded-t h-6" />
          <div className="w-1 bg-pink-500 rounded-t h-4" />
          <div className="w-1 bg-purple-600 rounded-t h-7" />
          <div className="w-1 bg-pink-400 rounded-t h-3" />
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-600 pt-0.5 border-t border-pink-200 font-semibold">
          <span className="text-pink-800 font-bold">{subBadge}</span>
          <span className="text-slate-500">AUDIO</span>
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
      <div className="w-full h-full bg-slate-100 p-1.5 flex flex-col justify-between text-[8px] font-mono select-none overflow-hidden border border-slate-300">
        {/* Top mini IDE header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-0.5 mb-0.5">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>
          <span className="text-[7px] text-slate-600 font-sans truncate max-w-[45px]">
            {topicLower.includes("while") ? "while.js" : "for_loop.cpp"}
          </span>
          <Code2 className="w-2.5 h-2.5 text-indigo-700" />
        </div>
        {/* Code syntax lines */}
        <div className="space-y-0.5 text-[7px] leading-tight flex-1">
          <div className="text-indigo-800 truncate font-semibold">
            <span className="text-slate-400 mr-1">1</span>
            {topicLower.includes("while") ? "while (count < 10) {" : "for (int i=0; i<n; i++) {"}
          </div>
          <div className="text-emerald-800 pl-2 truncate font-semibold">
            <span className="text-slate-400 mr-1">2</span>
            {topicLower.includes("while") ? "count++;" : "sum += arr[i];"}
          </div>
          <div className="text-slate-600 truncate">
            <span className="text-slate-400 mr-1">3</span>
            {"}"}
          </div>
        </div>
        {/* Bottom category tag */}
        <div className="flex items-center justify-between text-[7px] text-slate-500 pt-0.5 border-t border-slate-200 font-semibold">
          <span className="text-indigo-700 font-bold">CÚ PHÁP</span>
          <span className="text-slate-500">IDE</span>
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
      <div className="w-full h-full bg-emerald-100/70 p-1.5 flex flex-col justify-between text-[8px] font-mono select-none overflow-hidden border border-emerald-300">
        <div className="flex items-center justify-between border-b border-emerald-200 pb-0.5 mb-0.5">
          <div className="flex items-center gap-1 text-[7px] text-emerald-900 font-sans font-bold">
            <Terminal className="w-2.5 h-2.5" />
            <span>Terminal</span>
          </div>
          <span className="text-[7px] text-emerald-900 bg-emerald-200 px-1 rounded font-bold">RUN</span>
        </div>
        <div className="space-y-0.5 text-[7px] leading-tight flex-1">
          <div className="text-slate-700 truncate font-medium">$ ./run_example</div>
          <div className="text-emerald-800 font-semibold truncate">&gt; Input: n = 100</div>
          <div className="text-indigo-800 font-semibold truncate">&gt; Output: 5050 [OK]</div>
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-600 pt-0.5 border-t border-emerald-200 font-semibold">
          <span className="text-emerald-800 font-bold">THỰC HÀNH</span>
          <span className="text-slate-500">OUTPUT</span>
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
      <div className="w-full h-full bg-amber-100/70 p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-amber-300">
        <div className="flex items-center justify-between border-b border-amber-200 pb-0.5 mb-0.5">
          <span className="text-[7px] text-amber-900 font-bold font-sans">Bài tập & Ôn tập</span>
          <CheckCircle2 className="w-2.5 h-2.5 text-amber-700" />
        </div>
        <div className="space-y-0.5 text-[7px] leading-tight flex-1">
          <div className="flex items-center gap-1 text-slate-800 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
            <span className="truncate">1. In cửu chương</span>
          </div>
          <div className="flex items-center gap-1 text-slate-800 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />
            <span className="truncate">2. Số nguyên tố</span>
          </div>
        </div>
        <div className="flex items-center justify-between text-[7px] text-slate-600 pt-0.5 border-t border-amber-200 font-semibold">
          <span className="text-amber-900 font-bold">TỔNG KẾT</span>
          <span className="text-slate-500">Q&A</span>
        </div>
      </div>
    );
  }

  // 5. Mặc định: Slide bài giảng tổng quan / giới thiệu
  return (
    <div className="w-full h-full bg-gradient-to-br from-indigo-100/80 via-slate-100 to-blue-100/80 p-1.5 flex flex-col justify-between text-[8px] select-none overflow-hidden border border-slate-300">
      <div className="flex items-center justify-between border-b border-slate-200 pb-0.5 mb-0.5">
        <span className="text-[7px] text-indigo-900 font-bold truncate max-w-[65px] font-sans">
          {seg.topic || "Bài giảng"}
        </span>
        <Layout className="w-2.5 h-2.5 text-indigo-700" />
      </div>
      <div className="space-y-1 flex-1 flex flex-col justify-center">
        <div className="h-1.5 w-4/5 bg-indigo-300 rounded-full" />
        <div className="h-1.5 w-3/5 bg-slate-300 rounded-full" />
        <div className="h-1.5 w-1/2 bg-blue-300 rounded-full" />
      </div>
      <div className="flex items-center justify-between text-[7px] text-slate-600 pt-0.5 border-t border-slate-200 font-semibold">
        <span className="text-indigo-800 font-bold">PHÂN ĐOẠN #{idx + 1}</span>
        <span className="text-slate-500">SCENE</span>
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
  analysisProgress = 0,
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
  const [viewMode, setViewMode] = useState<"timeline" | "segments">("timeline");

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

    const sectionFolder = `${seg.section_no.toString().padStart(2, "0")}_${slugify(seg.section)}`;
    seg.parts = recalculateParts(seg.start, seg.end, sectionFolder, seg.topic_no, seg.slug);

    updated[index] = seg;
    onUpdateSegments(updated);
    setEditingTopicId(null);
  };

  return (
    <div className="w-[380px] lg:w-[430px] xl:w-[470px] shrink-0 flex flex-col bg-slate-50 border-l border-slate-300 overflow-hidden select-none text-slate-800">
      {/* Top Project Bar */}
      <div className="h-14 border-b border-slate-300 px-4 flex items-center justify-between shrink-0 bg-slate-100">
        <div className="flex items-center gap-2 flex-1 mr-2 min-w-0">
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                className="bg-white border border-indigo-400 rounded-md px-2 py-1 text-sm text-slate-900 focus:outline-none flex-1 min-w-0 font-semibold shadow-2xs"
                autoFocus
              />
              <button
                onClick={handleSaveTitle}
                className="p-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 shrink-0 transition"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => setIsEditingTitle(true)}
              className="group flex items-center gap-2 cursor-pointer min-w-0"
            >
              <h2 className="text-sm lg:text-base font-bold text-slate-900 tracking-tight truncate max-w-[200px] lg:max-w-[240px]">
                {lessonName || "Learn Demo Project"}
              </h2>
              <Edit3 className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-600 transition shrink-0" />
            </div>
          )}

          {/* Status Badge */}
          {isDemo ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
              Demo Mẫu
            </span>
          ) : isAnalyzing ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300 animate-pulse flex items-center gap-1 shrink-0">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              Đang phân tích: {Math.round(analysisProgress)}%
            </span>
          ) : isRaw ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300 shrink-0">
              Chưa phân tích
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1 shrink-0">
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-700" />
              Đã phân tích AI
            </span>
          )}
        </div>

        {/* Action Button: Phân Tích AI / Chạy lại AI */}
        {isAnalyzing ? (
          <button
            disabled
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-800 border border-indigo-300 shrink-0 font-mono shadow-2xs"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
            <span>AI: {Math.round(analysisProgress)}%</span>
          </button>
        ) : isRaw && onAnalyzeAI ? (
          <button
            onClick={onAnalyzeAI}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition hover:scale-102 active:scale-98 shrink-0"
            title="Khởi chạy Whisper & AI để phân tích video và phân đoạn"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Phân Tích AI</span>
          </button>
        ) : onAnalyzeAI ? (
          <button
            onClick={onAnalyzeAI}
            className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-indigo-800 border border-slate-300 transition shrink-0 shadow-2xs"
            title="Chạy lại phân tích AI nếu nội dung chưa vừa ý"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-700" />
            <span>Chạy lại AI</span>
          </button>
        ) : (
          <button
            onClick={() => alert("Tính năng Auto-Segment LLM đang đồng bộ với transcript!")}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 border border-slate-300 transition shrink-0 shadow-2xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Rewrite</span>
          </button>
        )}
      </div>

      {/* Main split: Thumbnails column on left + Script text column on right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sub-strip: Numbered Scene Thumbnails */}
        <div className="w-28 sm:w-32 bg-slate-200/50 border-r border-slate-300 p-2 overflow-y-auto space-y-2.5 shrink-0 select-none">
          {/* Header hint */}
          <div className="text-[9px] font-bold text-indigo-800 flex items-center justify-center gap-1 py-1 px-1 bg-indigo-100 rounded border border-indigo-300 text-center leading-tight">
            <span>{isAnalyzing ? `Đang xử lý ${Math.round(analysisProgress)}%` : "Kéo / Bấm phát"}</span>
          </div>

          {isAnalyzing ? (
            /* Animated Loading placeholders */
            [1, 2, 3].map((n) => (
              <div
                key={n}
                className="aspect-[16/10] bg-slate-100 rounded-lg border border-indigo-200 animate-pulse flex flex-col items-center justify-center gap-1 shadow-2xs"
              >
                <div className="w-4 h-4 rounded-full border-2 border-indigo-300 border-t-indigo-600 animate-spin" />
                <span className="text-[7px] text-indigo-700 font-mono font-bold">Phân đoạn #{n}</span>
              </div>
            ))
          ) : (
            segments.map((seg, idx) => {
              const isSelected = activeSegmentId === seg.id || (!activeSegmentId && idx === 0);
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
                  className={`group relative rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-all duration-200 transform hover:scale-[1.03] hover:shadow-md ${
                    isSelected
                      ? "ring-2 ring-indigo-600 shadow-sm scale-[1.02]"
                      : "border border-slate-300 hover:border-indigo-400 opacity-95 hover:opacity-100"
                  }`}
                  title={`Kéo vào màn hình hoặc bấm để phát: "${seg.topic}" (${formatTime(seg.start)} - ${formatTime(seg.end)})`}
                >
                  <div className="aspect-[16/10] bg-slate-100 rounded relative overflow-hidden flex items-center justify-center">
                    {renderSceneGraphic(seg, idx, isRaw, lessonName)}

                    <span className="absolute top-1 left-1 bg-slate-900/80 backdrop-blur-xs text-[9px] font-mono font-bold text-white px-1.5 py-0.2 rounded shadow-2xs z-10">
                      #{idx + 1}
                    </span>

                    <div className="absolute top-1 right-1 z-10 p-0.5 rounded bg-slate-900/60 text-slate-300 group-hover:text-white opacity-60 group-hover:opacity-100 transition">
                      <GripVertical className="w-2.5 h-2.5" />
                    </div>

                    <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[0.5px] opacity-0 group-hover:opacity-100 transition-all duration-200 flex flex-col items-center justify-center gap-0.5 z-20 pointer-events-none">
                      <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md transform scale-75 group-hover:scale-100 transition-transform">
                        <Play className="w-3 h-3 fill-current ml-0.5" />
                      </div>
                      <span className="text-[8px] font-bold text-white tracking-wider uppercase drop-shadow">
                        Phát ngay
                      </span>
                    </div>

                    <span className="absolute bottom-0.5 right-1 text-[8px] font-mono font-bold text-white bg-slate-900/80 px-1 py-0.2 rounded z-10">
                      {formatTime(seg.end - seg.start)}
                    </span>
                  </div>
                </div>
              );
            })
          )}

          {/* Plus Add Scene Button */}
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
            className="w-full aspect-[16/10] rounded-lg border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/60 text-slate-600 hover:text-indigo-700 flex flex-col items-center justify-center gap-1 transition group bg-slate-100/70 shadow-2xs"
            title="Thêm video mới từ URL hoặc tải lên từ máy (+)"
          >
            <Plus className="w-4 h-4 group-hover:scale-110 transition-transform text-slate-600 group-hover:text-indigo-600" />
            <span className="text-[9px] font-bold text-slate-700 group-hover:text-indigo-700">Thêm URL</span>
          </button>
        </div>

        {/* Right Sub-strip: Transcript Text or AI Processing State */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 flex flex-col bg-slate-50">
          {isAnalyzing ? (
            /* AI Processing View with Progress % */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 my-auto">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-base font-black text-indigo-700 font-mono">
                    {Math.round(analysisProgress)}%
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 max-w-sm">
                <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-slate-900">
                  <Sparkles className="w-4 h-4 text-indigo-600 animate-pulse" />
                  <span>Đang phân tích video bằng AI...</span>
                </div>
                <p className="text-xs text-indigo-700 font-mono font-semibold px-2 py-1 bg-indigo-50 rounded-lg border border-indigo-200">
                  {analysisStep || "Đang xử lý Whisper & LLM..."}
                </p>
              </div>

              {/* Progress bar container */}
              <div className="w-full max-w-xs space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-slate-600 font-mono">
                  <span>Tiến độ hoàn thành</span>
                  <span className="text-indigo-700 font-black">{Math.round(analysisProgress)}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden border border-slate-300 shadow-inner">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 h-full rounded-full transition-all duration-300 ease-out shadow-xs"
                    style={{ width: `${Math.min(100, Math.max(5, analysisProgress))}%` }}
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500 italic max-w-xs font-medium">
                Hệ thống đang trích xuất âm thanh, nhận diện giọng nói và phân đoạn tự động.
              </p>
            </div>
          ) : isRaw ? (
            /* Raw / Unanalyzed Video Prompt */
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-3.5 my-auto">
              <div className="w-12 h-12 rounded-2xl bg-indigo-100 border border-indigo-300 flex items-center justify-center text-indigo-700 shadow-2xs">
                <Sparkles className="w-6 h-6 text-indigo-600" />
              </div>
              <div className="space-y-1.5 max-w-xs">
                <h3 className="text-base font-bold text-slate-900">Video Gốc (1 Đoạn Duy Nhất)</h3>
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  Video vừa nạp hiện được giữ nguyên <span className="text-indigo-800 font-bold">1 phân đoạn duy nhất</span> bao trùm toàn bộ thời lượng.
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Hệ thống không tự ý bịa đặt nội dung bài giảng. Hãy bấm nút bên dưới để AI tự động nhận diện ca từ, âm nhạc hoặc giọng nói thực tế!
                </p>
              </div>
              {onAnalyzeAI && (
                <button
                  onClick={onAnalyzeAI}
                  className="w-full max-w-xs py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 group cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-amber-300 group-hover:rotate-12 transition-transform" />
                  <span>⚡ Bắt Đầu Phân Tích Bằng AI</span>
                </button>
              )}
              <div className="text-[11px] text-slate-600 border-t border-slate-300 pt-3 w-full max-w-xs flex flex-col gap-1 text-left font-semibold">
                <span>✨ Tự động nhận diện thể loại: Âm nhạc / TikTok / Bài giảng</span>
                <span>✂️ Hoặc dùng công cụ Cắt trên Timeline bên dưới</span>
              </div>
            </div>
          ) : (
            /* Analyzed or Demo Segments List */
            <>
              {/* Demo Notice Banner if Demo */}
              {isDemo && (
                <div className="p-2.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs flex items-center justify-between shrink-0 font-medium">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span><strong>Dữ liệu mẫu (Demo):</strong> Bài giảng C++ để thử giao diện. Tải video của bạn để AI phân tích thật!</span>
                  </div>
                  {onOpenAddVideo && (
                    <button
                      onClick={onOpenAddVideo}
                      className="text-[11px] font-bold text-amber-800 hover:text-amber-950 underline ml-2 shrink-0"
                    >
                      Thêm video
                    </button>
                  )}
                </div>
              )}

              {/* Analyzed Success Notice */}
              {!isDemo && (
                <div className="p-2 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-900 text-[11px] flex items-center justify-between shrink-0 font-semibold">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Đã phân tích nội dung bởi AI ({segments.length} phân đoạn)</span>
                  </span>
                  {onAnalyzeAI && (
                    <button
                      onClick={onAnalyzeAI}
                      className="text-indigo-700 hover:text-indigo-900 font-bold flex items-center gap-1 hover:underline ml-2"
                      title="Chạy lại nếu kết quả chưa vừa ý"
                    >
                      <Sparkles className="w-3 h-3 text-indigo-700" />
                      <span>Chạy lại</span>
                    </button>
                  )}
                </div>
              )}

              {/* Mode Selector: Detailed Timeline vs Segments */}
              <div className="flex items-center justify-between p-1 bg-slate-200/80 rounded-xl border border-slate-300 shrink-0 select-none">
                <button
                  type="button"
                  onClick={() => setViewMode("timeline")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                    viewMode === "timeline"
                      ? "bg-indigo-600 text-white shadow-xs font-bold"
                      : "text-slate-700 hover:text-slate-900 hover:bg-slate-300/60"
                  }`}
                  title="Hiển thị timeline chi tiết từng câu/lời thoại với mốc thời gian"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>⏱️ Timeline Chi Tiết</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("segments")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                    viewMode === "segments"
                      ? "bg-indigo-600 text-white shadow-xs font-bold"
                      : "text-slate-700 hover:text-slate-900 hover:bg-slate-300/60"
                  }`}
                  title="Hiển thị gom nhóm theo phân đoạn chủ đề"
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>📑 Theo Phân Đoạn</span>
                </button>
              </div>

              {/* View 1: Detailed Sentence Timeline */}
              {viewMode === "timeline" ? (
                <div className="space-y-2.5 relative pl-4 border-l-2 border-indigo-300 ml-2 mt-1">
                  {transcript?.sentences && transcript.sentences.length > 0 ? (
                    transcript.sentences.map((sent, sentIdx) => {
                      const isWordActive = currentTime >= sent.start && currentTime <= sent.end;
                      const durationSec = Math.max(0.1, sent.end - sent.start);

                      return (
                        <div
                          key={sent.id || `sent-${sentIdx}`}
                          onClick={() => {
                            onSeek(sent.start);
                            if (onPlay) onPlay();
                          }}
                          className={`group relative pl-3.5 pr-3 py-2.5 rounded-xl border transition-all duration-150 cursor-pointer ${
                            isWordActive
                              ? "bg-indigo-100 border-indigo-500 shadow-xs ring-1 ring-indigo-300"
                              : "bg-slate-100/90 border-slate-300 hover:bg-slate-200/70 hover:border-slate-400 shadow-2xs"
                          }`}
                        >
                          {/* Timeline node marker on the vertical track */}
                          <div
                            className={`absolute -left-[23px] top-3.5 w-3 h-3 rounded-full border-2 transition-all duration-200 flex items-center justify-center ${
                              isWordActive
                                ? "bg-indigo-600 border-white ring-4 ring-indigo-200 scale-125"
                                : "bg-slate-100 border-indigo-400 group-hover:border-indigo-600 group-hover:scale-110"
                            }`}
                          >
                            {isWordActive && <div className="w-1 h-1 rounded-full bg-white animate-ping" />}
                          </div>

                          {/* Header: ID + Timestamp badge + Duration */}
                          <div className="flex items-center justify-between gap-1 mb-1.5 select-none">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[10px] font-bold text-indigo-800 bg-indigo-100 border border-indigo-300 px-1.5 py-0.5 rounded">
                                {sent.id}
                              </span>

                              <span className="font-mono text-[11px] font-bold text-slate-800 bg-slate-200 border border-slate-300 px-2 py-0.5 rounded flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5 text-slate-500" />
                                <span>{formatTime(sent.start)}</span>
                                <span className="text-slate-400">➔</span>
                                <span>{formatTime(sent.end)}</span>
                              </span>

                              <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                                {durationSec.toFixed(1)}s
                              </span>
                            </div>

                            {/* Playing badge */}
                            {isWordActive ? (
                              <span className="text-[10px] font-bold text-indigo-800 flex items-center gap-1 bg-indigo-200/80 border border-indigo-300 px-1.5 py-0.5 rounded animate-pulse">
                                <Play className="w-2.5 h-2.5 fill-current" />
                                <span>Đang phát</span>
                              </span>
                            ) : (
                              <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 text-[10px] text-indigo-700 font-bold">
                                <Play className="w-2.5 h-2.5 fill-current" />
                                <span>Phát</span>
                              </div>
                            )}
                          </div>

                          {/* Dialogue or Lyric Sentence text */}
                          <p
                            className={`text-xs leading-relaxed transition-colors ${
                              isWordActive ? "text-indigo-950 font-bold" : "text-slate-800 group-hover:text-slate-950 font-normal"
                            }`}
                          >
                            {sent.text}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-500 italic font-medium">
                      Chưa có câu transcript nào. Hãy bấm &quot;Phân Tích AI&quot; để bóc băng chi tiết!
                    </div>
                  )}
                </div>
              ) : (
                /* View 2: Grouped by Segments */
                segments.map((seg, idx) => {
                  const isSelected = activeSegmentId === seg.id || (!activeSegmentId && idx === 0);
                  const isCurrentPlaying = currentTime >= seg.start && currentTime <= seg.end;

                  const segSentences =
                    transcript?.sentences.filter((s) => s.start >= seg.start && s.start <= seg.end) || [];

                  return (
                    <div
                      key={seg.id}
                      id={`seg-block-${seg.id}`}
                      className={`p-3.5 rounded-xl transition border ${
                        isSelected
                          ? "bg-indigo-100/70 border-indigo-400 shadow-2xs"
                          : isCurrentPlaying
                          ? "bg-slate-100 border-slate-300"
                          : "bg-slate-100/70 border-slate-200 hover:bg-slate-200/60"
                      }`}
                    >
                      {/* Speaker / Section Tag */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-indigo-800">{seg.section}</span>
                          <span className="text-slate-400 text-xs">•</span>
                          <span className="text-xs text-slate-600 font-mono font-bold">#{idx + 1}</span>
                        </div>

                        <span className="text-[11px] font-mono font-bold text-slate-800 bg-slate-200 border border-slate-300 px-2 py-0.5 rounded">
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
                              className="bg-white border border-indigo-500 rounded px-2 py-0.5 text-xs text-slate-900 focus:outline-none flex-1 font-semibold"
                              autoFocus
                              onKeyDown={(e) => e.key === "Enter" && handleSaveTopic(idx)}
                            />
                            <button
                              onClick={() => handleSaveTopic(idx)}
                              className="p-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => handleStartEditTopic(seg)}
                            className="group/topic flex items-center gap-1.5 cursor-pointer text-sm font-bold text-slate-900 hover:text-indigo-700 transition"
                            title="Nhấp để sửa tên chủ đề"
                          >
                            <span>{seg.topic}</span>
                            <Edit3 className="w-3 h-3 text-slate-500 group-hover/topic:text-indigo-600 transition" />
                          </div>
                        )}
                      </div>

                      {/* Sentence transcript */}
                      <div className="text-xs text-slate-800 leading-relaxed space-y-2 mt-2 font-normal">
                        {segSentences.length > 0 ? (
                          segSentences.map((sent) => {
                            const isWordActive = currentTime >= sent.start && currentTime <= sent.end;
                            return (
                              <div
                                key={sent.id}
                                onClick={() => {
                                  onSeek(sent.start);
                                  if (onPlay) onPlay();
                                }}
                                className={`cursor-pointer transition p-2 rounded-lg border ${
                                  isWordActive
                                    ? "bg-indigo-100 text-indigo-950 border-indigo-400 font-semibold shadow-2xs"
                                    : "bg-slate-100/90 border-slate-300 hover:bg-slate-200/80 text-slate-800"
                                }`}
                              >
                                <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px]">
                                  <span className="text-indigo-800 font-bold">[{sent.id}]</span>
                                  <span className="text-slate-800 bg-slate-200 px-1.5 py-0.2 rounded border border-slate-300 font-bold">
                                    {formatTime(sent.start)} ➔ {formatTime(sent.end)}
                                  </span>
                                  <span className="text-slate-500 font-medium">
                                    ({(sent.end - sent.start).toFixed(1)}s)
                                  </span>
                                  {isWordActive && (
                                    <span className="ml-auto text-[9px] text-indigo-800 font-bold animate-pulse">
                                      ● Đang phát
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs">{sent.text}</div>
                              </div>
                            );
                          })
                        ) : (
                          <div
                            onClick={() => onSeek(seg.start)}
                            className="cursor-pointer hover:text-slate-900 text-slate-500 italic font-medium"
                          >
                            Đoạn video từ {formatTime(seg.start)} đến {formatTime(seg.end)}. Nhấp để nhảy tới điểm phát.
                          </div>
                        )}
                      </div>

                      {/* Subparts note if split > 7 min */}
                      {seg.parts.length > 1 && (
                        <div className="mt-3 pt-2 border-t border-slate-300 flex items-center justify-between text-[11px] text-amber-800 font-mono font-bold">
                          <span>⚡ Vượt 7 phút: Tự tách thành {seg.parts.length} phần</span>
                          <span className="text-slate-600">
                            {seg.parts.map((p) => p.file.split("/").pop()).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
