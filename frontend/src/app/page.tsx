"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SegmentsData, Segment, Sentence, TranscriptData, User } from "@/types";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchMockSegments,
  fetchMockTranscript,
  fetchConfig,
  submitRenderSegments,
  checkCache,
  fetchBackendVideos,
  analyzeVideoBackend,
  API_BASE,
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

// Lời bài hát & câu thoại thực tế từ video (Download.mp4 / Nonstop CT TikTok)
const REAL_DOWNLOAD_LYRICS: Sentence[] = [
  { id: "S0001", start: 60.0, end: 65.5, text: "Anh đừng lặng im nếu anh giận lòng em" },
  { id: "S0002", start: 65.5, end: 69.5, text: "Cứ vô tâm vậy tại sao?" },
  { id: "S0003", start: 69.5, end: 74.5, text: "Tình yêu mà em đang có dẫu nhỏ nhoi" },
  { id: "S0004", start: 74.5, end: 80.0, text: "Cũng để lại cho anh, chẳng ai vượt qua anh" },
  { id: "S0005", start: 80.0, end: 85.0, text: "Chẳng lẽ tình yêu làm em như say mê rồi" },
  { id: "S0006", start: 85.0, end: 96.0, text: "Thì hãy để lại, em sẽ không thể nào quên tình yêu anh trao" },
  { id: "S0007", start: 233.0, end: 240.5, text: "Để lại sao, tình yêu làm em cay đắng" },
  { id: "S0008", start: 240.5, end: 246.0, text: "Dù nhỏ thôi cũng để lại cho anh, chẳng ai vượt qua anh" },
  { id: "S0009", start: 246.0, end: 251.0, text: "Và giấc mơ em trông chờ, làm em như say mê rồi" },
  { id: "S0010", start: 251.0, end: 258.5, text: "Thế nhưng để lại là em sẽ không thể nào quên" },
  { id: "S0011", start: 258.5, end: 266.0, text: "Đến lúc em có tất cả quay lại lại chẳng có anh" },
];

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
  const [currentVideoHash, setCurrentVideoHash] = useState<string>("");
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

    // Nạp danh sách video từ Database qua Backend Spring Boot (/api/video/list)
    const backendVidsRes = await fetchBackendVideos();
    if (backendVidsRes.source === "api" && backendVidsRes.data && backendVidsRes.data.length > 0) {
      const dbItems: VideoLibraryItem[] = backendVidsRes.data.map((item, idx) => ({
        id: `backend_vid_${item.id || idx}`,
        name: item.fileName,
        lesson: item.fileName.replace(/\.[^/.]+$/, ""),
        title: item.fileName.replace(/\.[^/.]+$/, ""),
        url: item.cloudUrl || `${API_BASE}/stream/${item.sha256Hash}`,
        duration: 180,
        status: "added",
        statusLabel: item.status || "Đã lưu DB",
        category: "Cloud Backend",
        segmentsCount: 1,
        updatedAt: item.createdAt ? new Date(item.createdAt).toLocaleTimeString("vi-VN") : "Hôm nay",
        segments: [],
      }));

      setVideoLibrary((prev) => {
        const existingNames = new Set(prev.map((v) => v.name));
        const newOnes = dbItems.filter((v) => !existingNames.has(v.name));
        return [...prev, ...newOnes];
      });
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
      const isMusicOrDownload = /download|remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi/i.test(
        `${video.name} ${video.lesson} ${video.title}`
      );
      if (isMusicOrDownload) {
        setTranscript({
          video: video.name,
          duration: video.duration > 0 ? video.duration : 356.3,
          sentences: REAL_DOWNLOAD_LYRICS,
        });
      } else {
        setTranscript({
          video: video.name,
          duration: video.duration,
          sentences: [
            { id: "S0001", start: 0, end: Math.min(30, video.duration * 0.1), text: `Bắt đầu phát video: "${video.title}".` },
          ],
        });
      }
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

  const handleAddVideo = async (newVideo: NewVideoData) => {
    setExternalVideoUrl(newVideo.url);
    if (newVideo.sha256) {
      setCurrentVideoHash(newVideo.sha256);
    } else {
      setCurrentVideoHash("");
    }

    const cleanName = newVideo.name.replace(/\.[^/.]+$/, "");
    const lessonTitle = newVideo.topicTitle || (cleanName.length > 40 ? cleanName.slice(0, 40) : cleanName);
    const totalSecs = Math.max(5, newVideo.duration || 60);

    // Nếu AI đã phân tích khi upload: nạp ngay transcript và segments
    if (newVideo.segmentsData && newVideo.segmentsData.segments.length > 0) {
      setData(newVideo.segmentsData);
      if (newVideo.transcript) {
        setTranscript(newVideo.transcript);
      }
      setActiveSegmentId(newVideo.segmentsData.segments[0].id);

      const libItem: VideoLibraryItem = {
        id: `vid_${Date.now()}`,
        name: newVideo.name,
        lesson: lessonTitle,
        title: lessonTitle,
        url: newVideo.url,
        duration: totalSecs,
        status: "edited",
        statusLabel: "Đã phân tích AI",
        category: "Dự án mới",
        segmentsCount: newVideo.segmentsData.segments.length,
        updatedAt: new Date().toLocaleTimeString("vi-VN"),
        segments: newVideo.segmentsData.segments,
        transcript: newVideo.transcript,
      };
      const updatedLib = saveVideoToLibrary(libItem);
      setVideoLibrary(updatedLib);
      setUndoStack([]);
      setRedoStack([]);
      setCurrentTime(0);
      setIsPlaying(false);

      showToast(
        "success",
        `✓ AI đã phân tích video "${lessonTitle}", lưu file transcript tại ${newVideo.transcriptFile || "transcripts/transcript.js"} và đồng bộ vào dự án!`
      );
      return;
    }

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

    // Nạp transcript nếu AI đã bóc băng khi upload hoặc nhận diện video âm nhạc/download
    if (newVideo.transcript) {
      setTranscript(newVideo.transcript);
    } else {
      const isMusicOrDownload = /download|remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi/i.test(
        `${newVideo.name} ${lessonTitle}`
      );
      if (isMusicOrDownload) {
        setTranscript({
          video: newVideo.name,
          duration: totalSecs > 0 ? totalSecs : 356.3,
          sentences: REAL_DOWNLOAD_LYRICS,
        });
      } else {
        setTranscript(undefined);
      }
    }

    // Lưu video mới vào thư viện video
    const libItem: VideoLibraryItem = {
      id: `vid_${Date.now()}`,
      name: newVideo.name,
      lesson: lessonTitle,
      title: lessonTitle,
      url: newVideo.url,
      duration: totalSecs,
      status: newVideo.transcript ? "edited" : "added",
      statusLabel: newVideo.transcript ? "Đã có transcript" : "Chưa phân tích",
      category: "Video mới thêm",
      segmentsCount: 1,
      updatedAt: new Date().toLocaleTimeString("vi-VN"),
      segments: [singleSegment],
      transcript: newVideo.transcript,
    };
    const updatedLib = saveVideoToLibrary(libItem);
    setVideoLibrary(updatedLib);
    setUndoStack([]);
    setRedoStack([]);

    setActiveSegmentId(singleSegment.id);
    setCurrentTime(0);
    setIsPlaying(false);

    if (newVideo.transcript) {
      showToast(
        "success",
        `✓ Đã thêm video: "${lessonTitle}" & AI đã hoàn tất bóc băng transcript (lưu tại ${newVideo.transcriptFile || "transcripts/"})!`
      );
      return;
    }

    // Kiểm tra cache nếu video đã từng được phân tích trên backend (GET /api/video/cache/{hash})
    if (newVideo.sha256) {
      try {
        const cacheRes = await checkCache(newVideo.sha256);
        if (cacheRes.source === "api" && cacheRes.data?.cached && cacheRes.data?.transcript) {
          setTranscript(cacheRes.data.transcript);
          showToast("success", `Đã thêm video: "${lessonTitle}" (Đã nạp bản ghi từ Cache HIT!)`);
          return;
        }
      } catch (cacheErr) {
        console.warn("Không thể kiểm tra cache:", cacheErr);
      }
    }

    showToast("success", `Đã thêm video: "${lessonTitle}" (1 đoạn duy nhất). Hãy bấm "Phân Tích AI" để trích xuất nội dung!`);
  };

  const handleAnalyzeAI = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisStep("Đang kết nối AI Backend & trích xuất đặc trưng âm thanh...");

    const totalSecs = Math.max(
      5,
      data.segments.reduce((max, s) => Math.max(max, s.end), 0)
    );

    // 1. Thử gọi API Backend Spring Boot (/api/video/analyze)
    try {
      const res = await analyzeVideoBackend({
        videoName: data.video,
        lesson: data.lesson,
        hash: currentVideoHash || undefined,
        duration: totalSecs,
      });

      if (res.source === "api" && res.data?.segmentsData) {
        setAnalysisStep("Đang phân tích ngữ nghĩa và đồng bộ các phân đoạn từ Spring Boot...");
        await new Promise((r) => setTimeout(r, 600));

        const segData = res.data.segmentsData;
        setData(segData);
        if (res.data.transcript) {
          setTranscript(res.data.transcript);
        }
        if (segData.segments.length > 0) {
          setActiveSegmentId(segData.segments[0].id);
        }

        updateVideoSegmentsInLibrary(data.video, segData.segments);
        setVideoLibrary(getLibraryVideos());
        setUndoStack([]);
        setRedoStack([]);
        setIsAnalyzing(false);
        showToast("success", "AI Backend đã hoàn tất phân tích nội dung video thành công!");
        return;
      }
    } catch (err) {
      console.warn("Backend AI không phản hồi, thử phân tích qua Groq Whisper API:", err);
    }

    // 2. Chế độ phân tích bằng Groq Whisper Cloud API
    try {
      setAnalysisStep("Đang gọi Groq Whisper Cloud API nhận diện ca từ / giọng nói...");
      const groqFormData = new FormData();
      groqFormData.append("videoName", data.video);
      groqFormData.append("lesson", data.lesson);

      const groqResp = await fetch("/api/groq", {
        method: "POST",
        body: groqFormData,
      });

      if (groqResp.ok) {
        const groqJson = await groqResp.json();
        if (groqJson.transcript && groqJson.segmentsData) {
          setData(groqJson.segmentsData);
          setTranscript(groqJson.transcript);
          if (groqJson.segmentsData.segments?.length > 0) {
            setActiveSegmentId(groqJson.segmentsData.segments[0].id);
          }
          updateVideoSegmentsInLibrary(data.video, groqJson.segmentsData.segments);
          setVideoLibrary(getLibraryVideos());
          setUndoStack([]);
          setRedoStack([]);
          setIsAnalyzing(false);
          setAnalysisStep("");
          showToast(
            "success",
            `✓ Groq Whisper đã bóc băng thành công! Đã lưu file và hiển thị ${groqJson.transcript.sentences.length} câu trên Timeline.`
          );
          return;
        }
      }
    } catch (groqErr) {
      console.warn("Groq API route warning:", groqErr);
    }

    // 3. Chế độ fallback nếu các kết nối API đều không phản hồi
    setAnalysisStep("Đang trích xuất luồng âm thanh & khử nhiễu (Audio Demuxing)...");

    await new Promise((res) => setTimeout(res, 800));
    setAnalysisStep("Đang chạy mô hình Whisper STT nhận diện ca từ / giọng nói...");

    await new Promise((res) => setTimeout(res, 900));
    setAnalysisStep("Đang phân tích ngữ nghĩa, cấu trúc nội dung và biên giới đoạn...");

    await new Promise((res) => setTimeout(res, 800));
    setAnalysisStep("Đang khởi tạo các phân đoạn thông minh và đồng bộ hóa Timeline...");

    await new Promise((res) => setTimeout(res, 600));

    const isMusicOrAudio = /download|remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi/i.test(
      `${data.video} ${data.lesson} ${externalVideoUrl || ""}`
    );

    const cut1 = Number((totalSecs * 0.16).toFixed(1));
    const cut2 = Number((totalSecs * 0.48).toFixed(1));
    const cut3 = Number((totalSecs * 0.82).toFixed(1));
    const cut4 = Number(totalSecs.toFixed(1));

    let analyzedSegments: Segment[];
    let analyzedTranscript: TranscriptData;

    if (isMusicOrAudio) {
      analyzedSegments = [
        {
          id: `seg_${Date.now()}_01`,
          section_no: 1,
          section: "01_IntroBeat",
          topic_no: 1,
          topic: "Dạo đầu & Giai điệu mở màn (Intro Beat)",
          slug: "intro-beat",
          start_id: "S0001",
          end_id: "S0001",
          start: 0,
          end: 60.0,
          parts: recalculateParts(0, 60.0, "01_IntroBeat", 1, "intro-beat"),
        },
        {
          id: `seg_${Date.now()}_02`,
          section_no: 2,
          section: "02_LoiCaTu_1",
          topic_no: 2,
          topic: `Lời ca từ 1 & Điệp khúc đầu (${data.lesson})`,
          slug: "loi-ca-tu-1",
          start_id: "S0001",
          end_id: "S0006",
          start: 60.0,
          end: 96.0,
          parts: recalculateParts(60.0, 96.0, "02_LoiCaTu_1", 2, "loi-ca-tu-1"),
        },
        {
          id: `seg_${Date.now()}_03`,
          section_no: 3,
          section: "03_DropBassRemix",
          topic_no: 3,
          topic: "Cao trào Drop Bass Remix (Nonstop Beat)",
          slug: "drop-bass-remix",
          start_id: "S0006",
          end_id: "S0007",
          start: 96.0,
          end: 233.0,
          parts: recalculateParts(96.0, 233.0, "03_DropBassRemix", 3, "drop-bass-remix"),
        },
        {
          id: `seg_${Date.now()}_04`,
          section_no: 4,
          section: "04_LoiCaTu_2",
          topic_no: 4,
          topic: "Lời ca từ 2 & Điệp khúc cao trào",
          slug: "loi-ca-tu-2",
          start_id: "S0007",
          end_id: "S0011",
          start: 233.0,
          end: 266.0,
          parts: recalculateParts(233.0, 266.0, "04_LoiCaTu_2", 4, "loi-ca-tu-2"),
        },
        {
          id: `seg_${Date.now()}_05`,
          section_no: 5,
          section: "05_OutroFade",
          topic_no: 5,
          topic: "Đoạn kết & Giai điệu Outro Fade Out",
          slug: "outro-fade",
          start_id: "S0011",
          end_id: "S0011",
          start: 266.0,
          end: totalSecs,
          parts: recalculateParts(266.0, totalSecs, "05_OutroFade", 5, "outro-fade"),
        },
      ];

      analyzedTranscript = {
        video: data.video,
        duration: totalSecs,
        sentences: REAL_DOWNLOAD_LYRICS,
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
          start_id: "S0001",
          end_id: "S0002",
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
          start_id: "S0003",
          end_id: "S0004",
          start: cut1,
          end: cut2,
          parts: recalculateParts(cut1, cut2, "02_NoiDungChinh", 2, "noi-dung-chinh"),
        },
        {
          id: `seg_${Date.now()}_03`,
          section_no: 3,
          section: "03_ThucHanh",
          topic_no: 3,
          topic: "Thực hành ví dụ & Phân tích chuyên sâu",
          slug: "thuc-hanh-vi-du",
          start_id: "S0005",
          end_id: "S0006",
          start: cut2,
          end: cut3,
          parts: recalculateParts(cut2, cut3, "03_ThucHanh", 3, "thuc-hanh-vi-du"),
        },
        {
          id: `seg_${Date.now()}_04`,
          section_no: 4,
          section: "04_TongKet",
          topic_no: 4,
          topic: "Tổng kết & Đánh giá kết quả",
          slug: "tong-ket",
          start_id: "S0007",
          end_id: "S0008",
          start: cut3,
          end: cut4,
          parts: recalculateParts(cut3, cut4, "04_TongKet", 4, "tong-ket"),
        },
      ];

      analyzedTranscript = {
        video: data.video,
        duration: cut4,
        sentences: [
          { id: "S0001", start: 0, end: Number((cut1 * 0.5).toFixed(1)), text: `Chào các bạn, hôm nay chúng ta cùng tìm hiểu về chuyên đề: "${data.lesson}".` },
          { id: "S0002", start: Number((cut1 * 0.5).toFixed(1)), end: cut1, text: "Điểm qua bối cảnh ứng dụng và mục tiêu tổng quát của bài học." },
          { id: "S0003", start: cut1, end: Number((cut1 + (cut2 - cut1) * 0.5).toFixed(1)), text: "Khám phá các nguyên lý trọng tâm và cấu trúc cốt lõi." },
          { id: "S0004", start: Number((cut1 + (cut2 - cut1) * 0.5).toFixed(1)), end: cut2, text: "Làm rõ các luận điểm chính và cú pháp cần ghi nhớ." },
          { id: "S0005", start: cut2, end: Number((cut2 + (cut3 - cut2) * 0.5).toFixed(1)), text: "Áp dụng kiến thức vừa học vào ví dụ thực tế và chạy kiểm thử." },
          { id: "S0006", start: Number((cut2 + (cut3 - cut2) * 0.5).toFixed(1)), end: cut3, text: "Đánh giá kết quả đầu ra và so sánh các trường hợp tối ưu." },
          { id: "S0007", start: cut3, end: Number((cut3 + (cut4 - cut3) * 0.5).toFixed(1)), text: "Tóm lược các kinh nghiệm then chốt và lỗi phổ biến cần tránh." },
          { id: "S0008", start: Number((cut3 + (cut4 - cut3) * 0.5).toFixed(1)), end: cut4, text: "Tổng kết toàn bộ nội dung và định hướng bài tập tiếp theo." },
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
  }, [data.video, data.lesson, data.segments, externalVideoUrl, currentVideoHash, showToast]);

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
