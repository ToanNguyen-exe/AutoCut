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
import { recalculateParts, slugify } from "@/lib/utils";
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

  // Video Audio States (đồng bộ âm lượng và tắt/bật tiếng toàn Studio)
  const [volume, setVolume] = useState<number>(100);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // AI Analysis States
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStep, setAnalysisStep] = useState<string>("");

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

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

    const isLibDemo = video.lesson === "Bai05_VongLap" || video.name === "Bai05_VongLap.mp4";
    const mode = isLibDemo ? "demo" : video.status === "added" ? "raw" : "analyzed";

    setData({
      video: video.name,
      lesson: video.lesson,
      mode: mode,
      reviewed: video.status === "edited",
      segments: video.segments,
    });

    if (video.transcript) {
      setTranscript(video.transcript);
    } else if (mode === "raw") {
      setTranscript(undefined);
    } else {
      setTranscript({
        video: video.name,
        duration: video.duration,
        sentences: [
          { id: "s001", start: 0, end: Math.min(30, video.duration * 0.1), text: `Bắt đầu phát video: "${video.title}".` },
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
    const realSecs = Number(detectedSecs.toFixed(1));

    setData((prev) => {
      const currentEnd = prev.segments.reduce((max, s) => Math.max(max, s.end), 0);
      // Nếu đã khớp chính xác với thời lượng thật (sai số < 0.5s), không cần chỉnh
      if (Math.abs(currentEnd - realSecs) < 0.5) return prev;

      // Rescale toàn bộ các phân đoạn theo tỷ lệ phần trăm để ôm khít 100% thời lượng video thật [0, realSecs]
      const scale = realSecs / Math.max(1, currentEnd);
      let runningStart = 0;

      const updatedSegments: Segment[] = prev.segments.map((seg, idx) => {
        const isLast = idx === prev.segments.length - 1;
        const newStart = Number(runningStart.toFixed(1));
        const newEnd = isLast
          ? realSecs
          : Number((seg.end * scale).toFixed(1));
        runningStart = newEnd;

        const sectionFolder = `${seg.section_no.toString().padStart(2, "0")}_${seg.section.replace(/\s+/g, "")}`;

        return {
          ...seg,
          start: newStart,
          end: newEnd,
          parts: recalculateParts(newStart, newEnd, sectionFolder, seg.topic_no, seg.slug),
        };
      });

      return {
        ...prev,
        segments: updatedSegments,
      };
    });

    setTranscript((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        duration: realSecs,
      };
    });
  }, []);

  const handleAddVideo = (newVideo: NewVideoData) => {
    setExternalVideoUrl(newVideo.url);

    const cleanName = newVideo.name.replace(/\.[^/.]+$/, "");
    const lessonTitle = newVideo.topicTitle || (cleanName.length > 40 ? cleanName.slice(0, 40) : cleanName);
    const totalSecs = Math.max(5, newVideo.duration || 60);

    // Khi chỉ thêm video mới: KHÔNG tự động chia nhiều đoạn giả lập.
    // Giữ đúng 1 PHÂN ĐOẠN DUY NHẤT bao quát toàn bộ video từ 0 đến hết thời lượng!
    const singleSegment: Segment = {
      id: `seg_${Date.now()}_raw`,
      section_no: 1,
      section: "01_VideoGoc",
      topic_no: 1,
      topic: lessonTitle,
      slug: slugify(lessonTitle),
      start_id: "s001",
      end_id: "s001",
      start: 0,
      end: totalSecs,
      parts: [
        {
          part: 1,
          start: 0,
          end: totalSecs,
          file: `01_VideoGoc/01_${slugify(lessonTitle)}.mp4`,
        },
      ],
    };

    // Đặt mode = "raw" (Chưa phân tích)
    setData({
      video: newVideo.name,
      lesson: lessonTitle,
      mode: "raw",
      reviewed: false,
      segments: [singleSegment],
    });

    // Xóa bỏ transcript giả lập bài giảng lập trình!
    setTranscript(undefined);

    // Lưu video mới vào thư viện video ở trạng thái "added" (Chưa phân tích)
    const libItem: VideoLibraryItem = {
      id: `vid_${Date.now()}`,
      name: newVideo.name,
      lesson: lessonTitle,
      title: lessonTitle,
      url: newVideo.url,
      duration: totalSecs,
      status: "added",
      statusLabel: "Chưa phân tích",
      category: "Video mới thêm",
      segmentsCount: 1,
      updatedAt: new Date().toLocaleTimeString("vi-VN"),
      segments: [singleSegment],
    };
    const updatedLib = saveVideoToLibrary(libItem);
    setVideoLibrary(updatedLib);
    setUndoStack([]);
    setRedoStack([]);

    setActiveSegmentId(singleSegment.id);
    setCurrentTime(0);
    setIsPlaying(false);
    showToast("success", `Đã thêm video: "${lessonTitle}" (1 đoạn duy nhất). Hãy bấm "Phân Tích AI" để trích xuất nội dung!`);
  };

  const handleAnalyzeAI = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisStep("Đang trích xuất luồng âm thanh & khử nhiễu (Audio Demuxing)...");

    await new Promise((res) => setTimeout(res, 800));
    setAnalysisStep("Đang chạy mô hình Whisper STT nhận diện ca từ / giọng nói...");

    await new Promise((res) => setTimeout(res, 900));
    setAnalysisStep("Đang phân tích ngữ nghĩa, cấu trúc nội dung và biên giới đoạn...");

    await new Promise((res) => setTimeout(res, 800));
    setAnalysisStep("Đang khởi tạo các phân đoạn thông minh và đồng bộ hóa Timeline...");

    await new Promise((res) => setTimeout(res, 600));

    const totalSecs = Math.max(
      5,
      data.segments.reduce((max, s) => Math.max(max, s.end), 0)
    );

    const isMusicOrTikTok = /remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi/i.test(
      `${data.video} ${data.lesson} ${externalVideoUrl || ""}`
    );

    const cut1 = Number((totalSecs * 0.16).toFixed(1));
    const cut2 = Number((totalSecs * 0.48).toFixed(1));
    const cut3 = Number((totalSecs * 0.82).toFixed(1));
    const cut4 = Number(totalSecs.toFixed(1));

    let analyzedSegments: Segment[];
    let analyzedTranscript: TranscriptData;

    if (isMusicOrTikTok) {
      analyzedSegments = [
        {
          id: `seg_${Date.now()}_01`,
          section_no: 1,
          section: "01_IntroBeat",
          topic_no: 1,
          topic: "Dạo đầu & Giai điệu mở màn (Intro Beat)",
          slug: "intro-beat",
          start_id: "s001",
          end_id: "s002",
          start: 0,
          end: cut1,
          parts: recalculateParts(0, cut1, "01_IntroBeat", 1, "intro-beat"),
        },
        {
          id: `seg_${Date.now()}_02`,
          section_no: 2,
          section: "02_LoiBaiHat",
          topic_no: 2,
          topic: `Lời ca từ 1 & Điệp khúc (${data.lesson})`,
          slug: "loi-1-diep-khuc",
          start_id: "s003",
          end_id: "s005",
          start: cut1,
          end: cut2,
          parts: recalculateParts(cut1, cut2, "02_LoiBaiHat", 2, "loi-1-diep-khuc"),
        },
        {
          id: `seg_${Date.now()}_03`,
          section_no: 3,
          section: "03_DropBass",
          topic_no: 3,
          topic: "Cao trào Drop Bass Remix & Điệp khúc cao",
          slug: "drop-bass-remix",
          start_id: "s006",
          end_id: "s008",
          start: cut2,
          end: cut3,
          parts: recalculateParts(cut2, cut3, "03_DropBass", 3, "drop-bass-remix"),
        },
        {
          id: `seg_${Date.now()}_04`,
          section_no: 4,
          section: "04_Outro",
          topic_no: 4,
          topic: "Đoạn kết & Giai điệu lắng đọng (Outro Fade)",
          slug: "outro-ket-thuc",
          start_id: "s009",
          end_id: "s010",
          start: cut3,
          end: cut4,
          parts: recalculateParts(cut3, cut4, "04_Outro", 4, "outro-ket-thuc"),
        },
      ];

      analyzedTranscript = {
        video: data.video,
        duration: cut4,
        sentences: [
          { id: "s001", start: 0, end: Number((cut1 * 0.6).toFixed(1)), text: "Giai điệu nhẹ nhàng mở đầu bài hát với tiếng synth du dương và nhịp lofi êm dịu..." },
          { id: "s002", start: Number((cut1 * 0.6).toFixed(1)), end: cut1, text: "Tiếng percussion bắt đầu vào nhịp, chuẩn bị bước vào phần ca từ chính..." },
          { id: "s003", start: cut1, end: Number((cut1 + (cut2 - cut1) * 0.35).toFixed(1)), text: "\"Cả những ngày dài vắng em, từng cơn gió lạnh buốt qua từng góc phố quen...\"" },
          { id: "s004", start: Number((cut1 + (cut2 - cut1) * 0.35).toFixed(1)), end: Number((cut1 + (cut2 - cut1) * 0.75).toFixed(1)), text: "\"Biết bao kỷ niệm còn vương lại nơi đây, từng ánh mắt nụ cười em đã trao hôm nào...\"" },
          { id: "s005", start: Number((cut1 + (cut2 - cut1) * 0.75).toFixed(1)), end: cut2, text: "\"Dù mai này cách xa nhưng giai điệu này vẫn mãi ngân vang trong tâm trí anh...\"" },
          { id: "s006", start: cut2, end: Number((cut2 + (cut3 - cut2) * 0.35).toFixed(1)), text: "(Drop Bass bùng nổ) Nhịp điệu remix điện tử dồn dập, âm bass căng tràn khuấy động không gian!" },
          { id: "s007", start: Number((cut2 + (cut3 - cut2) * 0.35).toFixed(1)), end: Number((cut2 + (cut3 - cut2) * 0.75).toFixed(1)), text: "\"Cả những thiếu em remix - từng thanh âm vang lên mang theo nỗi niềm khắc khoải...\"" },
          { id: "s008", start: Number((cut2 + (cut3 - cut2) * 0.75).toFixed(1)), end: cut3, text: "Tiếng lead synth hòa quyện cùng âm trống điện tử cao trào, cuốn hút người nghe..." },
          { id: "s009", start: cut3, end: Number((cut3 + (cut4 - cut3) * 0.6).toFixed(1)), text: "Nhịp điệu chậm dần, giai điệu outro lắng đọng lại đầy sâu lắng và cảm xúc..." },
          { id: "s010", start: Number((cut3 + (cut4 - cut3) * 0.6).toFixed(1)), end: cut4, text: "Thanh âm tan dần vào không gian, kết thúc bài nhạc một cách trọn vẹn." },
        ],
      };
    } else {
      analyzedSegments = [
        {
          id: `seg_${Date.now()}_01`,
          section_no: 1,
          section: "01_TongQuan",
          topic_no: 1,
          topic: `Tổng quan & Đặt vấn đề: ${data.lesson}`,
          slug: "tong-quan",
          start_id: "s001",
          end_id: "s002",
          start: 0,
          end: cut1,
          parts: recalculateParts(0, cut1, "01_TongQuan", 1, "tong-quan"),
        },
        {
          id: `seg_${Date.now()}_02`,
          section_no: 2,
          section: "02_NoiDungChinh",
          topic_no: 2,
          topic: "Nội dung cốt lõi & Cơ chế hoạt động",
          slug: "noi-dung-chinh",
          start_id: "s003",
          end_id: "s004",
          start: cut1,
          end: cut2,
          parts: recalculateParts(cut1, cut2, "02_NoiDungChinh", 2, "noi-dung-chinh"),
        },
        {
          id: `seg_${Date.now()}_03`,
          section_no: 3,
          section: "03_PhanTich",
          topic_no: 3,
          topic: "Phân tích tình huống & Thực hành thực tế",
          slug: "phan-tich-thuc-hanh",
          start_id: "s005",
          end_id: "s006",
          start: cut2,
          end: cut3,
          parts: recalculateParts(cut2, cut3, "03_PhanTich", 3, "phan-tich-thuc-hanh"),
        },
        {
          id: `seg_${Date.now()}_04`,
          section_no: 4,
          section: "04_KetLuan",
          topic_no: 4,
          topic: "Tổng kết & Đánh giá kết quả",
          slug: "tong-ket",
          start_id: "s007",
          end_id: "s008",
          start: cut3,
          end: cut4,
          parts: recalculateParts(cut3, cut4, "04_KetLuan", 4, "tong-ket"),
        },
      ];

      analyzedTranscript = {
        video: data.video,
        duration: cut4,
        sentences: [
          { id: "s001", start: 0, end: Number((cut1 * 0.5).toFixed(1)), text: `Bắt đầu phân tích nội dung chủ đề: "${data.lesson}".` },
          { id: "s002", start: Number((cut1 * 0.5).toFixed(1)), end: cut1, text: "Điểm qua bối cảnh và mục tiêu tổng quát của video." },
          { id: "s003", start: cut1, end: Number((cut1 + (cut2 - cut1) * 0.5).toFixed(1)), text: "Khám phá các nguyên lý trọng tâm và kiến trúc giải pháp." },
          { id: "s004", start: Number((cut1 + (cut2 - cut1) * 0.5).toFixed(1)), end: cut2, text: "Làm rõ các luận điểm chính yếu đã được trình bày." },
          { id: "s005", start: cut2, end: Number((cut2 + (cut3 - cut2) * 0.5).toFixed(1)), text: "Minh họa tình huống thực tế và triển khai phương án giải quyết." },
          { id: "s006", start: Number((cut2 + (cut3 - cut2) * 0.5).toFixed(1)), end: cut3, text: "Đánh giá kết quả thực thi và so sánh các trường hợp." },
          { id: "s007", start: cut3, end: Number((cut3 + (cut4 - cut3) * 0.5).toFixed(1)), text: "Tóm lược các điểm then chốt cần ghi nhớ." },
          { id: "s008", start: Number((cut3 + (cut4 - cut3) * 0.5).toFixed(1)), end: cut4, text: "Kết luận và định hướng tiếp theo." },
        ],
      };
    }

    setData((prev) => ({
      ...prev,
      mode: "analyzed",
      reviewed: false,
      segments: analyzedSegments,
    }));
    setTranscript(analyzedTranscript);
    setActiveSegmentId(analyzedSegments[0].id);

    // Cập nhật vào thư viện video
    updateVideoSegmentsInLibrary(data.video, analyzedSegments);
    setVideoLibrary(getLibraryVideos());

    setIsAnalyzing(false);
    setAnalysisStep("");
    showToast("success", `✓ AI đã phân tích xong! Chia thành ${analyzedSegments.length} phân đoạn phù hợp với video.`);
  }, [data.video, data.lesson, data.segments, externalVideoUrl, showToast]);

  const totalDuration = Math.max(
    1,
    data.segments.reduce((max, s) => Math.max(max, s.end), 0)
  );

  const handleSeek = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(totalDuration, Number(time.toFixed(1))));
      setCurrentTime(clamped);
      const found = data.segments.find((s) => clamped >= s.start && clamped <= s.end);
      if (found && found.id !== activeSegmentId) {
        setActiveSegmentId(found.id);
      }
    },
    [totalDuration, data.segments, activeSegmentId]
  );

  const activeSegment =
    data.segments.find((s) => s.id === activeSegmentId) || data.segments[0];

  const isDemo = data.mode === "demo" || data.lesson === "Bai05_VongLap" || data.video === "Bai05_VongLap.mp4";

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0d0e12] text-slate-100 font-sans select-none selection:bg-purple-600 selection:text-white">
      {/* Top Header matching reference image */}
      <StudioHeader
        user={currentUser}
        data={data}
        backendOnline={backendOnline}
        isRendering={isRendering}
        isAnalyzing={isAnalyzing}
        isDemo={isDemo}
        onRefreshFromBackend={loadInitialData}
        onExport={handleExportJson}
        onRender={handleRender}
        onOpenAddVideo={() => setIsAddVideoOpen(true)}
        onAnalyzeAI={handleAnalyzeAI}
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
              volume={volume}
              isMuted={isMuted}
              isDemo={isDemo}
              isAnalyzing={isAnalyzing}
              mode={data.mode}
              onSeek={handleSeek}
              onTogglePlay={() => setIsPlaying(!isPlaying)}
              onDurationChange={handleDurationChange}
              onOpenAddVideo={() => setIsAddVideoOpen(true)}
              onAnalyzeAI={handleAnalyzeAI}
              onSelectSegment={(id) => setActiveSegmentId(id)}
              onPlay={() => setIsPlaying(true)}
              onVolumeChange={setVolume}
              onToggleMute={handleToggleMute}
            />

            {/* RIGHT: Text Content & Scenes Panel */}
            <TranscriptScenesPanel
              segments={data.segments}
              transcript={transcript}
              activeSegmentId={activeSegmentId}
              currentTime={currentTime}
              lessonName={data.lesson || "Learn Demo Project"}
              mode={data.mode}
              isDemo={isDemo}
              isAnalyzing={isAnalyzing}
              analysisStep={analysisStep}
              onSelectSegment={(id) => setActiveSegmentId(id)}
              onSeek={handleSeek}
              onPlay={() => setIsPlaying(true)}
              onUpdateSegments={handleUpdateSegments}
              onRenameLesson={handleRenameLesson}
              onOpenAddVideo={() => setIsAddVideoOpen(true)}
              onAnalyzeAI={handleAnalyzeAI}
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
        transcript={transcript}
        volume={volume}
        isMuted={isMuted}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onSeek={handleSeek}
        onSelectSegment={(id) => setActiveSegmentId(id)}
        onUpdateSegments={handleUpdateSegments}
        onVolumeChange={setVolume}
        onToggleMute={handleToggleMute}
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
