"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SegmentsData, Segment, TranscriptData, User } from "@/types";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchMockSegments,
  fetchMockTranscript,
  fetchConfig,
  submitRenderSegments,
  FALLBACK_SEGMENTS,
} from "@/lib/api";

import { StudioSidebar } from "@/components/StudioSidebar";
import { StudioHeader } from "@/components/StudioHeader";
import { TranscriptScenesPanel } from "@/components/TranscriptScenesPanel";
import { VideoCanvasViewport } from "@/components/VideoCanvasViewport";
import { StudioTimeline } from "@/components/StudioTimeline";
import { ReviewTable } from "@/components/ReviewTable";
import { StatsCards } from "@/components/StatsCards";
import { TranscriptDrawer } from "@/components/TranscriptDrawer";
import { AddVideoModal, NewVideoData } from "@/components/AddVideoModal";
import { VideoLibraryDrawer } from "@/components/VideoLibraryDrawer";
import { VideoLibraryItem } from "@/types";
import {
  getLibraryVideos,
  saveVideoToLibrary,
  updateVideoSegmentsInLibrary,
} from "@/lib/videoLibrary";
import { formatTime, recalculateParts } from "@/lib/utils";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<"studio" | "table">("studio");

  const [data, setData] = useState<SegmentsData>(FALLBACK_SEGMENTS);
  const [transcript, setTranscript] = useState<TranscriptData | undefined>();
  const [backendOnline, setBackendOnline] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>("seg01");
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState<boolean>(false);
  const [isAddVideoOpen, setIsAddVideoOpen] = useState<boolean>(false);
  const [externalVideoUrl, setExternalVideoUrl] = useState<string | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [videoLibrary, setVideoLibrary] = useState<VideoLibraryItem[]>([]);
  const [undoStack, setUndoStack] = useState<Segment[][]>([]);
  const [redoStack, setRedoStack] = useState<Segment[][]>([]);

  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // Check login authentication
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.push("/login");
    } else {
      setCurrentUser(user);
    }
  }, [router]);

  // Load initial data from Spring Boot Backend
  const loadInitialData = useCallback(async () => {
    const configRes = await fetchConfig();
    const isOnline = configRes.source === "api";
    setBackendOnline(isOnline);

    const segRes = await fetchMockSegments();
    if (segRes.data) {
      setData(segRes.data);
      if (segRes.data.segments.length > 0) {
        setActiveSegmentId(segRes.data.segments[0].id);
      }
    }

    const transRes = await fetchMockTranscript();
    if (transRes.data) {
      setTranscript(transRes.data);
    }

    if (isOnline) {
      showToast("success", "Đã kết nối thành công với máy chủ xử lý!");
    } else {
      showToast("info", "Đang sử dụng dữ liệu Mock Studio cục bộ.");
    }
  }, [showToast]);

  useEffect(() => {
    loadInitialData();
    setVideoLibrary(getLibraryVideos());
  }, [loadInitialData]);

  // Segment modifications with Undo history
  const handleUpdateSegments = (newSegments: Segment[]) => {
    setUndoStack((prev) => [...prev.slice(-30), data.segments]);
    setRedoStack([]);

    setData((prev) => ({
      ...prev,
      segments: newSegments,
      reviewed: false,
    }));

    updateVideoSegmentsInLibrary(data.video, newSegments);
    setVideoLibrary(getLibraryVideos());
  };

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, prev.length - 1));
    setRedoStack((prev) => [...prev.slice(-30), data.segments]);

    setData((prev) => ({
      ...prev,
      segments: previous,
    }));
    showToast("info", "Đã quay lại bước trước (Undo)!");
  }, [undoStack, data.segments, showToast]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, prev.length - 1));
    setUndoStack((prev) => [...prev.slice(-30), data.segments]);

    setData((prev) => ({
      ...prev,
      segments: next,
    }));
    showToast("info", "Đã làm lại bước tiếp theo (Redo)!");
  }, [redoStack, data.segments, showToast]);

  // Keyboard shortcut Ctrl+Z & Ctrl+Y
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  const handleSelectLibraryVideo = (video: VideoLibraryItem) => {
    setExternalVideoUrl(video.url);
    setUndoStack([]);
    setRedoStack([]);

    setData({
      video: video.name,
      lesson: video.lesson,
      mode: "guided",
      reviewed: video.status === "edited",
      segments: video.segments,
    });

    if (video.transcript) {
      setTranscript(video.transcript);
    } else {
      setTranscript({
        video: video.name,
        duration: video.duration,
        sentences: [
          { id: "s001", start: 0, end: Math.min(30, video.duration * 0.1), text: `Bắt đầu phát bài giảng: "${video.title}".` },
          { id: "s002", start: video.duration * 0.2, end: video.duration * 0.3, text: "Nội dung bài giảng đang được phát trực tiếp trên hệ thống AutoCut Studio." },
        ],
      });
    }

    if (video.segments.length > 0) {
      setActiveSegmentId(video.segments[0].id);
    }
    setCurrentTime(0);
    setIsPlaying(true);
    setIsLibraryOpen(false);

    showToast("success", `Đang phát video: "${video.title}"`);
  };

  const handleRenameLesson = (newName: string) => {
    setData((prev) => ({
      ...prev,
      lesson: newName,
    }));
    showToast("info", `Đã cập nhật tên dự án: "${newName}"`);
  };

  const handleExportJson = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `segments_${data.lesson || "reviewed"}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("success", "Đã xuất file segments.json thành công!");
  };

  const handleRender = async () => {
    setIsRendering(true);
    try {
      const result = await submitRenderSegments({ ...data, reviewed: true });
      if (result.success) {
        showToast(
          "success",
          `${result.message} ${result.savedPlan ? `(Lưu tại: ${result.savedPlan})` : ""}`
        );
      } else {
        showToast("error", `Lỗi: ${result.message}`);
      }
    } finally {
      setIsRendering(false);
    }
  };

  const handleDurationChange = useCallback((detectedSecs: number) => {
    if (!detectedSecs || isNaN(detectedSecs) || detectedSecs <= 0) return;

    setData((prev) => {
      const currentEnd = prev.segments.reduce((max, s) => Math.max(max, s.end), 0);
      if (Math.abs(currentEnd - detectedSecs) < 15) return prev;

      const updatedSegments = [...prev.segments];
      const lastIdx = updatedSegments.length - 1;
      if (lastIdx >= 0) {
        const lastSeg = updatedSegments[lastIdx];
        const newStart = lastSeg.start;
        const newEnd = Math.max(newStart + 30, Number(detectedSecs.toFixed(1)));
        const sectionFolder = `${lastSeg.section_no.toString().padStart(2, "0")}_${lastSeg.section.replace(/\s+/g, "")}`;

        updatedSegments[lastIdx] = {
          ...lastSeg,
          end: newEnd,
          parts: recalculateParts(newStart, newEnd, sectionFolder, lastSeg.topic_no, lastSeg.slug),
        };
      }
      return {
        ...prev,
        segments: updatedSegments,
      };
    });
  }, []);

  const handleAddVideo = (newVideo: NewVideoData) => {
    setExternalVideoUrl(newVideo.url);

    const cleanName = newVideo.name.replace(/\.[^/.]+$/, "");
    const lessonTitle = cleanName.length > 40 ? cleanName.slice(0, 40) : cleanName;
    const totalSecs = Math.max(60, newVideo.duration || 7200);

    // Tạo các phân đoạn bao phủ toàn bộ thời lượng video (kể cả 2h = 7200s)
    const cut1 = Number((totalSecs * 0.15).toFixed(1));
    const cut2 = Number((totalSecs * 0.50).toFixed(1));
    const cut3 = Number((totalSecs * 0.82).toFixed(1));
    const cut4 = Number(totalSecs.toFixed(1));

    const newSegments: Segment[] = [
      {
        id: `seg_${Date.now()}_01`,
        section_no: 1,
        section: "01_TongQuan",
        topic_no: 1,
        topic: `Giới thiệu & Định hướng bài giảng (${lessonTitle})`,
        slug: "gioi-thieu",
        start_id: "s001",
        end_id: "s025",
        start: 0,
        end: cut1,
        parts: recalculateParts(0, cut1, "01_TongQuan", 1, "gioi-thieu"),
      },
      {
        id: `seg_${Date.now()}_02`,
        section_no: 2,
        section: "02_LyThuyet",
        topic_no: 2,
        topic: "Lý thuyết & Khái niệm cốt lõi",
        slug: "ly-thuyet-cot-loi",
        start_id: "s026",
        end_id: "s080",
        start: cut1,
        end: cut2,
        parts: recalculateParts(cut1, cut2, "02_LyThuyet", 2, "ly-thuyet-cot-loi"),
      },
      {
        id: `seg_${Date.now()}_03`,
        section_no: 3,
        section: "03_ThucHanh",
        topic_no: 3,
        topic: "Phân tích tình huống & Thực hành ví dụ",
        slug: "thuc-hanh-vi-du",
        start_id: "s081",
        end_id: "s140",
        start: cut2,
        end: cut3,
        parts: recalculateParts(cut2, cut3, "03_ThucHanh", 3, "thuc-hanh-vi-du"),
      },
      {
        id: `seg_${Date.now()}_04`,
        section_no: 4,
        section: "04_TongKet",
        topic_no: 4,
        topic: "Tổng kết bài học & Bài tập tự luyện",
        slug: "tong-ket",
        start_id: "s141",
        end_id: "s180",
        start: cut3,
        end: cut4,
        parts: recalculateParts(cut3, cut4, "04_TongKet", 4, "tong-ket"),
      },
    ];

    // Reset toàn bộ dữ liệu dự án sang video mới, xóa sạch các phân đoạn vòng lặp cũ!
    setData({
      video: newVideo.name,
      lesson: lessonTitle,
      mode: "guided",
      reviewed: false,
      segments: newSegments,
    });

    // Tạo transcript mới khớp với thời lượng và chủ đề video mới
    setTranscript({
      video: newVideo.name,
      duration: cut4,
      sentences: [
        { id: "s001", start: 0, end: Math.min(25, cut1 * 0.2), text: `Chào các bạn, hôm nay chúng ta bắt đầu bài giảng "${cleanName}".` },
        { id: "s025", start: Math.min(30, cut1 * 0.3), end: cut1, text: "Trong phần tổng quan này, chúng ta sẽ điểm qua các mục tiêu chính cần đạt được." },
        { id: "s026", start: cut1, end: cut1 + Math.min(60, (cut2 - cut1) * 0.3), text: "Bây giờ chúng ta sẽ đi vào phần lý thuyết và nền tảng cốt lõi của bài học." },
        { id: "s080", start: cut2 - Math.min(45, (cut2 - cut1) * 0.2), end: cut2, text: "Đây là các công thức và quy tắc quan trọng mà các bạn cần ghi nhớ." },
        { id: "s081", start: cut2, end: cut2 + Math.min(60, (cut3 - cut2) * 0.3), text: "Tiếp theo, hãy cùng mở trình biên dịch để giải quyết các ví dụ thực tế." },
        { id: "s140", start: cut3 - Math.min(50, (cut3 - cut2) * 0.2), end: cut3, text: "Quan sát kết quả đầu ra và phân tích các trường hợp ngoại lệ có thể xảy ra." },
        { id: "s141", start: cut3, end: cut3 + Math.min(60, (cut4 - cut3) * 0.3), text: "Để kết thúc bài học, chúng ta sẽ tóm tắt lại kiến thức và giao bài tập về nhà." },
        { id: "s180", start: Math.max(cut3 + 70, cut4 - 30), end: cut4, text: "Chúc các bạn học tập tốt và hẹn gặp lại trong bài giảng tiếp theo!" },
      ],
    });

    // Lưu video mới vào thư viện video
    const libItem: VideoLibraryItem = {
      id: `vid_${Date.now()}`,
      name: newVideo.name,
      lesson: lessonTitle,
      title: newVideo.topicTitle || lessonTitle,
      url: newVideo.url,
      duration: cut4,
      status: "added",
      statusLabel: "Đã thêm",
      category: "Video mới thêm",
      segmentsCount: newSegments.length,
      updatedAt: new Date().toLocaleTimeString("vi-VN"),
      segments: newSegments,
    };
    const updatedLib = saveVideoToLibrary(libItem);
    setVideoLibrary(updatedLib);
    setUndoStack([]);
    setRedoStack([]);

    setActiveSegmentId(newSegments[0].id);
    setCurrentTime(0);
    setIsPlaying(false);
    showToast("success", `Đã tạo dự án mới: "${lessonTitle}" (Thời lượng: ${formatTime(totalSecs)})!`);
  };

  const totalDuration = Math.max(
    1,
    data.segments.reduce((max, s) => Math.max(max, s.end), 0)
  );

  const activeSegment =
    data.segments.find((s) => s.id === activeSegmentId) || data.segments[0];

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0d0e12] text-slate-100 font-sans select-none selection:bg-purple-600 selection:text-white">
      {/* Top Header matching reference image */}
      <StudioHeader
        user={currentUser}
        data={data}
        backendOnline={backendOnline}
        isRendering={isRendering}
        onRefreshFromBackend={loadInitialData}
        onExport={handleExportJson}
        onRender={handleRender}
        onOpenAddVideo={() => setIsAddVideoOpen(true)}
        onUserUpdate={(u) => setCurrentUser(u)}
      />

      {/* Main Body Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Icon Sidebar */}
        <StudioSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenTranscriptDrawer={() => setIsTranscriptOpen(true)}
          onOpenVideoLibrary={() => setIsLibraryOpen(true)}
        />

        {/* Content View Switcher */}
        {activeTab === "studio" ? (
          /* Studio View: CENTER: Large Video Canvas, RIGHT: Text Content & Scenes */
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* CENTER: Big Video Viewport */}
            <VideoCanvasViewport
              currentSegment={activeSegment}
              currentTime={currentTime}
              totalDuration={totalDuration}
              videoTitle={data.video}
              externalVideoUrl={externalVideoUrl}
              isPlaying={isPlaying}
              onSeek={(time) => setCurrentTime(time)}
              onTogglePlay={() => setIsPlaying(!isPlaying)}
              onDurationChange={handleDurationChange}
              onOpenAddVideo={() => setIsAddVideoOpen(true)}
              onSelectSegment={(id) => setActiveSegmentId(id)}
              onPlay={() => setIsPlaying(true)}
            />

            {/* RIGHT: Text Content & Scenes Panel */}
            <TranscriptScenesPanel
              segments={data.segments}
              transcript={transcript}
              activeSegmentId={activeSegmentId}
              currentTime={currentTime}
              lessonName={data.lesson || "Learn Demo Project"}
              onSelectSegment={(id) => setActiveSegmentId(id)}
              onSeek={(time) => setCurrentTime(time)}
              onPlay={() => setIsPlaying(true)}
              onUpdateSegments={handleUpdateSegments}
              onRenameLesson={handleRenameLesson}
              onOpenAddVideo={() => setIsAddVideoOpen(true)}
            />
          </div>
        ) : (
          /* Table View: Standard B9 Review Table for grading & detailed metrics */
          <div className="flex-1 overflow-y-auto p-6 bg-[#0d0e12]">
            <div className="max-w-7xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-white">
                  Bảng Duyệt Chi Tiết Phân Đoạn (B9 Specification)
                </h2>
                <button
                  onClick={() => setActiveTab("studio")}
                  className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition"
                >
                  &larr; Trở về Studio Editor
                </button>
              </div>
              <StatsCards
                data={data}
                onToggleReviewed={() =>
                  setData((prev) => ({ ...prev, reviewed: !prev.reviewed }))
                }
              />
              <ReviewTable
                segments={data.segments}
                activeSegmentId={activeSegmentId}
                onUpdateSegments={handleUpdateSegments}
                onPreviewSegment={(start, id) => {
                  setCurrentTime(start);
                  setActiveSegmentId(id);
                  setActiveTab("studio");
                }}
              />
            </div>
          </div>
        )}

        {/* Floating Notification Toast */}
        {notification && (
          <div
            className={`absolute top-4 right-4 z-50 p-3 rounded-xl border flex items-center gap-2.5 text-xs shadow-2xl backdrop-blur-md animate-in fade-in duration-200 ${
              notification.type === "success"
                ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-300"
                : notification.type === "error"
                ? "bg-rose-950/80 border-rose-500/50 text-rose-300"
                : "bg-slate-900/90 border-purple-500/50 text-purple-300"
            }`}
          >
            {notification.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-purple-400 shrink-0" />
            )}
            <span className="font-medium">{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="ml-2 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Bottom Multi-Track Timeline & Transport Bar */}
      <StudioTimeline
        segments={data.segments}
        currentTime={currentTime}
        totalDuration={totalDuration}
        activeSegmentId={activeSegmentId}
        isPlaying={isPlaying}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onSeek={(t) => setCurrentTime(t)}
        onSelectSegment={(id) => setActiveSegmentId(id)}
        onUpdateSegments={handleUpdateSegments}
      />

      {/* Transcript Drawer */}
      <TranscriptDrawer
        transcript={transcript}
        isOpen={isTranscriptOpen}
        onClose={() => setIsTranscriptOpen(false)}
        onSeek={(seconds) => {
          setCurrentTime(seconds);
          const found = data.segments.find(
            (s) => seconds >= s.start && seconds <= s.end
          );
          if (found) setActiveSegmentId(found.id);
        }}
      />

      {/* Add External Video Modal (URL or File Upload) */}
      <AddVideoModal
        isOpen={isAddVideoOpen}
        onClose={() => setIsAddVideoOpen(false)}
        onAddVideo={handleAddVideo}
      />

      {/* Video Library Drawer (Kho Video Đã sửa, Chưa sửa, Mới thêm) */}
      <VideoLibraryDrawer
        isOpen={isLibraryOpen}
        activeVideoName={data.video}
        videos={videoLibrary}
        onClose={() => setIsLibraryOpen(false)}
        onSelectVideo={handleSelectLibraryVideo}
        onOpenAddVideo={() => setIsAddVideoOpen(true)}
      />
    </div>
  );
}
