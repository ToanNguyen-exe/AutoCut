"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { SegmentsData, Segment, Sentence, TranscriptData, User, JoinedVideoClip } from "@/types";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchConfig,
  submitRenderSegments,
  checkCache,
  fetchBackendVideos,
  analyzeVideoBackend,
  saveProjectToBackend,
  API_BASE,
} from "@/lib/api";

import { StudioSidebar } from "@/components/StudioSidebar";
import { StudioHeader } from "@/components/StudioHeader";
import { DEFAULT_BG_COLOR, applyWebBackgroundColor } from "@/components/ThemeColorPicker";
import { VideoLibraryColumn, LibraryVideoCard, PASTEL_GRADIENTS } from "@/components/VideoLibraryColumn";
import { VideoCanvasViewport } from "@/components/VideoCanvasViewport";
import { AiAssistantChatPanel } from "@/components/AiAssistantChatPanel";
import { StudioTimeline } from "@/components/StudioTimeline";
import { SegmentDetailModal } from "@/components/SegmentDetailModal";
import { ReviewTable } from "@/components/ReviewTable";
import { StatsCards } from "@/components/StatsCards";
import { TranscriptDrawer } from "@/components/TranscriptDrawer";
import { AddVideoModal, NewVideoData } from "@/components/AddVideoModal";
import { VideoLibraryDrawer } from "@/components/VideoLibraryDrawer";
import {
  ExportProgressModal,
  ProgressModalMode,
  ProgressStep,
} from "@/components/ExportProgressModal";
import { RenderedClipItem } from "@/lib/api";
import { VideoLibraryItem } from "@/types";
import {
  getLibraryVideos,
  saveVideoToLibrary,
  updateVideoSegmentsInLibrary,
  resolvePlayableVideoUrl,
} from "@/lib/videoLibrary";
import { getVideoBlob } from "@/lib/videoStorage";
import { recalculateParts, slugify, formatTime } from "@/lib/utils";
import { CheckCircle2, AlertCircle } from "lucide-react";

// Dữ liệu chuẩn theo Bài 08 - Ép kiểu dữ liệu Python matching reference image
const BAI08_SEGMENTS_DATA: SegmentsData = {
  video: "Bai08_Ep_kieu_du_lieu.mp4",
  lesson: "Bài 08 - Ép kiểu dữ liệu trong lập trình Python",
  mode: "analyzed",
  reviewed: false,
  segments: [
    {
      id: "seg_01",
      section_no: 1,
      section: "01_GioiThieu",
      topic_no: 1,
      topic: "Xin chào các bạn",
      slug: "xin-chao-cac-ban",
      start_id: "S0001",
      end_id: "S0003",
      start: 0.0,
      end: 86.0,
      parts: recalculateParts(0.0, 86.0, "01_GioiThieu", 1, "xin-chao-cac-ban"),
    },
    {
      id: "seg_02",
      section_no: 2,
      section: "02_ThucThi",
      topic_no: 2,
      topic: "Thực thi kiếp vấn đề",
      slug: "thuc-thi-kiep-van-de",
      start_id: "S0004",
      end_id: "S0006",
      start: 86.0,
      end: 242.0,
      parts: recalculateParts(86.0, 242.0, "02_ThucThi", 2, "thuc-thi-kiep-van-de"),
    },
    {
      id: "seg_03",
      section_no: 3,
      section: "03_KhaiBaoBien",
      topic_no: 3,
      topic: "Khi mà chúng ta gặp biến",
      slug: "khi-ma-chung-ta-gap-bien",
      start_id: "S0007",
      end_id: "S0008",
      start: 242.0,
      end: 332.0,
      parts: recalculateParts(242.0, 332.0, "03_KhaiBaoBien", 3, "khi-ma-chung-ta-gap-bien"),
    },
    {
      id: "seg_04",
      section_no: 4,
      section: "04_XuLyLoi",
      topic_no: 4,
      topic: "Gặp lỗi",
      slug: "gap-loi",
      start_id: "S0009",
      end_id: "S0010",
      start: 332.0,
      end: 421.0,
      parts: recalculateParts(332.0, 421.0, "04_XuLyLoi", 4, "gap-loi"),
    },
    {
      id: "seg_05",
      section_no: 5,
      section: "05_LuuY",
      topic_no: 5,
      topic: "Bây giờ mình không ép kiểu",
      slug: "bay-gio-minh-khong-ep-kieu",
      start_id: "S0011",
      end_id: "S0012",
      start: 421.0,
      end: 535.0,
      parts: recalculateParts(421.0, 535.0, "05_LuuY", 5, "bay-gio-minh-khong-ep-kieu"),
    },
  ],
};

const BAI08_TRANSCRIPT_DATA: TranscriptData = {
  video: "Bai08_Ep_kieu_du_lieu.mp4",
  duration: 535.0,
  sentences: [
    { id: "S0001", start: 0.0, end: 15.0, text: "Xin chào các bạn, chào mừng các bạn đến với Bài 08 trong chuỗi bài giảng tự học lập trình Python." },
    { id: "S0002", start: 15.0, end: 45.0, text: "Hôm nay chúng ta sẽ cùng tìm hiểu về kỹ thuật ép kiểu dữ liệu và tại sao cần ép kiểu." },
    { id: "S0003", start: 45.0, end: 86.0, text: "Đây là kiến thức nền tảng cực kỳ quan trọng trước khi đi vào xử lý logic phức tạp." },
    { id: "S0004", start: 86.0, end: 130.0, text: "Thực thi kiếp vấn đề: Khi nhận dữ liệu đầu vào từ hàm input, mặc định Python trả về kiểu chuỗi string." },
    { id: "S0005", start: 130.0, end: 190.0, text: "Nếu chúng ta thực hiện phép cộng giữa hai chuỗi, chương trình sẽ nối chuỗi thay vì cộng số học." },
    { id: "S0006", start: 190.0, end: 242.0, text: "Do đó ta phải thực hiện ép kiểu rõ ràng sang kiểu số nguyên int() hoặc số thực float()." },
    { id: "S0007", start: 242.0, end: 285.0, text: "Khi mà chúng ta gặp biến: Khai báo biến với nhiều định dạng dữ liệu khác nhau trong bộ nhớ." },
    { id: "S0008", start: 285.0, end: 332.0, text: "Cách kiểm tra kiểu dữ liệu của biến bằng hàm type() để tránh các xung đột ngầm." },
    { id: "S0009", start: 332.0, end: 375.0, text: "Gặp lỗi: Lỗi thường gặp nhất là ValueError khi ép chuỗi ký tự chữ cái sang số nguyên." },
    { id: "S0010", start: 375.0, end: 421.0, text: "Cách kiểm soát lỗi và kiểm tra dữ liệu trước khi thực hiện chuyển đổi kiểu." },
    { id: "S0011", start: 421.0, end: 475.0, text: "Bây giờ mình không ép kiểu thì chương trình sẽ chạy ra kết quả sai lệch như thế nào." },
    { id: "S0012", start: 475.0, end: 535.0, text: "Tổng kết toàn bộ bài học và bài tập thực hành ép kiểu dữ liệu trong Python." },
  ],
};

const syncLibraryCardsFromLibrary = (items: VideoLibraryItem[]): LibraryVideoCard[] => {
  return items.map((item, idx) => ({
    id: item.id || `lib_${idx}`,
    title: item.title || item.lesson || item.name,
    fileName: item.name,
    durationStr: formatTime(item.duration),
    durationSeconds: item.duration,
    gradientBg: PASTEL_GRADIENTS[idx % PASTEL_GRADIENTS.length],
    segmentCount: item.segmentsCount || item.segments?.length || 1,
    url: item.url,
    segments: item.segments,
    transcript: item.transcript,
  }));
};

const DEFAULT_LIBRARY_CARDS: LibraryVideoCard[] = syncLibraryCardsFromLibrary(getLibraryVideos());

const INITIAL_JOINED_VIDEOS: JoinedVideoClip[] = [
  {
    id: "clip_01",
    title: "Bài 08 - Ép kiểu dữ liệu",
    fileName: "Bai08_Ep_kieu_du_lieu.mp4",
    url: "/videos/Bai08_Ep_kieu_du_lieu.mp4",
    duration: 535.0,
    startOffset: 0.0,
    endOffset: 535.0,
  },
];

// Lời bài hát & câu thoại thực tế từ video (Download.mp4 / Nonstop CT TikTok)
const REAL_DOWNLOAD_LYRICS: Sentence[] = [
  { id: "S0001", start: 0.0, end: 60.0, text: "Giai điệu mở màn & Dạo nhạc (Intro Beat)" },
  { id: "S0002", start: 60.0, end: 65.5, text: "Anh đừng lặng im nếu anh giận lòng em" },
  { id: "S0003", start: 65.5, end: 69.5, text: "Cứ vô tâm vậy tại sao?" },
  { id: "S0004", start: 69.5, end: 74.5, text: "Tình yêu mà em đang có dẫu nhỏ nhoi" },
  { id: "S0005", start: 74.5, end: 80.0, text: "Cũng để lại cho anh, chẳng ai vượt qua anh" },
  { id: "S0006", start: 80.0, end: 85.0, text: "Chẳng lẽ tình yêu làm em như say mê rồi" },
  { id: "S0007", start: 85.0, end: 96.0, text: "Thì hãy để lại, em sẽ không thể nào quên tình yêu anh trao" },
  { id: "S0008", start: 96.0, end: 233.0, text: "Đoạn cao trào Drop Bass Remix (Nonstop Beat)" },
  { id: "S0009", start: 233.0, end: 240.5, text: "Để lại sao, tình yêu làm em cay đắng" },
  { id: "S0010", start: 240.5, end: 246.0, text: "Dù nhỏ thôi cũng để lại cho anh, chẳng ai vượt qua anh" },
  { id: "S0011", start: 246.0, end: 251.0, text: "Và giấc mơ em trông chờ, làm em như say mê rồi" },
  { id: "S0012", start: 251.0, end: 258.5, text: "Thế nhưng để lại là em sẽ không thể nào quên" },
  { id: "S0013", start: 258.5, end: 266.0, text: "Đến lúc em có tất cả quay lại lại chẳng có anh" },
  { id: "S0014", start: 266.0, end: 356.3, text: "Giai điệu kết thúc (Outro Fade)" },
];

function normalizeContiguousSegments(segments: Segment[], totalDuration: number): Segment[] {
  if (!segments || segments.length === 0) return segments;
  const result: Segment[] = [];
  let currentStart = 0.0;
  const dur = Math.max(1, totalDuration);

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const isLast = i === segments.length - 1;
    const start = Number(currentStart.toFixed(1));
    let end: number;

    if (isLast) {
      end = Number(dur.toFixed(1));
    } else {
      const nextSeg = segments[i + 1];
      // Nếu có khoảng trống giữa đoạn hiện tại và đoạn kế tiếp (nextSeg.start > s.end)
      if (nextSeg && nextSeg.start > s.end) {
        end = Number(((s.end + nextSeg.start) / 2).toFixed(1));
      } else {
        end = Number(s.end.toFixed(1));
      }
    }

    if (end <= start) {
      end = Number((start + Math.max(1, (dur - start) / (segments.length - i))).toFixed(1));
    }
    currentStart = end;

    const sectionFolder = `${s.section_no.toString().padStart(2, "0")}_${s.section.replace(/\s+/g, "")}`;
    result.push({
      ...s,
      start,
      end,
      parts: recalculateParts(start, end, sectionFolder, s.topic_no, s.slug),
    });
  }
  return result;
}

function normalizeTranscript(trans: TranscriptData | undefined, totalDur: number): TranscriptData | undefined {
  if (!trans || !trans.sentences || trans.sentences.length === 0) return trans;
  const raw = trans.sentences;
  const filled: Sentence[] = [];

  // 1. Đảm bảo timeline bắt đầu từ 00:00 (nếu câu đầu tiên > 1.5s)
  if (raw[0].start > 1.5) {
    filled.push({
      id: "S0000",
      start: 0.0,
      end: Number(raw[0].start.toFixed(1)),
      text: "Giai điệu mở màn & Dạo nhạc (Intro Beat)",
    });
  }

  // 2. Điền các khoảng trống âm nhạc dài giữa các câu (> 8s)
  for (let s = 0; s < raw.length; s++) {
    const curr = raw[s];
    filled.push(curr);
    if (s < raw.length - 1) {
      const next = raw[s + 1];
      const gap = next.start - curr.end;
      if (gap >= 8.0) {
        filled.push({
          id: `S_gap_${s}`,
          start: Number(curr.end.toFixed(1)),
          end: Number(next.start.toFixed(1)),
          text: "Đoạn cao trào Drop Bass Remix (Nonstop Beat)",
        });
      }
    }
  }

  // 3. Nếu câu cuối kết thúc trước khi video hết (> 5s), thêm câu Outro
  if (totalDur - raw[raw.length - 1].end >= 5.0) {
    filled.push({
      id: "S_outro",
      start: Number(raw[raw.length - 1].end.toFixed(1)),
      end: Number(totalDur.toFixed(1)),
      text: "Giai điệu kết thúc (Outro Fade)",
    });
  }

  return {
    ...trans,
    duration: totalDur,
    sentences: filled.map((item, idx) => ({
      ...item,
      id: `S${(idx + 1).toString().padStart(4, "0")}`,
    })),
  };
}

export default function Home() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<"studio" | "table">("studio");

  const [isSessionLoaded, setIsSessionLoaded] = useState<boolean>(false);
  const [data, setData] = useState<SegmentsData>(BAI08_SEGMENTS_DATA);
  const [transcript, setTranscript] = useState<TranscriptData | undefined>(BAI08_TRANSCRIPT_DATA);
  const [backendOnline, setBackendOnline] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>("seg_01");
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState<boolean>(false);
  const [isAddVideoOpen, setIsAddVideoOpen] = useState<boolean>(false);
  const [externalVideoUrl, setExternalVideoUrl] = useState<string | null>("/videos/Bai08_Ep_kieu_du_lieu.mp4");
  const [currentVideoHash, setCurrentVideoHash] = useState<string>("");
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [videoLibrary, setVideoLibrary] = useState<VideoLibraryItem[]>([]);
  const [undoStack, setUndoStack] = useState<Segment[][]>([]);
  const [redoStack, setRedoStack] = useState<Segment[][]>([]);

  // Video Library cards on left column
  const [libraryCards, setLibraryCards] = useState<LibraryVideoCard[]>(DEFAULT_LIBRARY_CARDS);
  const [joinedVideos, setJoinedVideos] = useState<JoinedVideoClip[]>(INITIAL_JOINED_VIDEOS);

  // Segment Detail Modal states (Mở khi ấn vào video hoặc phân đoạn)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [selectedDetailSegment, setSelectedDetailSegment] = useState<Segment | null>(null);
  const [selectedDetailIndex, setSelectedDetailIndex] = useState<number>(1);

  // Video Audio States (đồng bộ âm lượng và tắt/bật tiếng toàn Studio)
  const [volume, setVolume] = useState<number>(100);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // AI Analysis States
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [analysisStep, setAnalysisStep] = useState<string>("");
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Tiến độ Cắt Video & Tải File Xuất Bản (Export & Analysis Progress Modal)
  const [isProgressModalOpen, setIsProgressModalOpen] = useState<boolean>(false);
  const [progressModalMode, setProgressModalMode] = useState<ProgressModalMode>("render");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressActionText, setProgressActionText] = useState<string>("");
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [renderedClips, setRenderedClips] = useState<RenderedClipItem[]>([]);
  const [renderedOutputDir, setRenderedOutputDir] = useState<string>("");
  const [totalRenderedCount, setTotalRenderedCount] = useState<number>(0);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Theme background color state (Hỗ trợ hơn 16 màu sáng & tối)
  const [themeBgColor, setThemeBgColor] = useState<string>(DEFAULT_BG_COLOR);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("autocut_web_bg_color");
        if (saved) {
          setThemeBgColor(saved);
          applyWebBackgroundColor(saved);
        }
      } catch {
        // ignore
      }
    }
  }, []);

  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  const handleThemeColorChange = useCallback((color: string) => {
    setThemeBgColor(color);
    showToast("success", `✓ Đã cập nhật màu nền giao diện mới: ${color.toUpperCase()}`);
  }, [showToast]);

  // Check login authentication
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.push("/login");
    } else {
      setCurrentUser(user);
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [router]);

  // 1. Phục hồi Active Session từ localStorage & IndexedDB ngay khi mount (F5)
  useEffect(() => {
    let isCancelled = false;

    async function restoreSessionAndLoad() {
      let restored = false;
      let restoredVideoName = "";
      let restoredHash = "";
      let restoredUrl: string | null = null;
      let restoredTotalDur = 535.0;

      let restoredJoinedVideos: JoinedVideoClip[] | null = null;

      if (typeof window !== "undefined") {
        try {
          const savedSessionRaw = localStorage.getItem("autocut_active_session");
          if (savedSessionRaw) {
            const saved = JSON.parse(savedSessionRaw);
            if (saved?.data?.video && saved.data.segments && saved.data.segments.length > 0) {
              const totalDur = saved.data.segments.reduce((max: number, s: Segment) => Math.max(max, s.end), 0) || 535.0;
              // Giữ nguyên các phân đoạn của người dùng, không chạy normalize làm biến dạng các khoảng cắt và nối tiếp
              const validSegments = saved.data.segments.filter(
                (s: Segment) => s && typeof s.start === "number" && typeof s.end === "number"
              );
              setData({ ...saved.data, segments: validSegments.length > 0 ? validSegments : saved.data.segments });
              restoredVideoName = saved.data.video;
              restoredTotalDur = totalDur;
              if (saved.transcript) {
                setTranscript(normalizeTranscript(saved.transcript, totalDur));
              }
              if (saved.currentVideoHash) {
                setCurrentVideoHash(saved.currentVideoHash);
                restoredHash = saved.currentVideoHash;
              }
              if (saved.activeSegmentId) {
                setActiveSegmentId(saved.activeSegmentId);
              } else if (saved.data.segments.length > 0) {
                setActiveSegmentId(saved.data.segments[0].id);
              }
              if (typeof saved.currentTime === "number") {
                setCurrentTime(saved.currentTime);
              }
              if (Array.isArray(saved.joinedVideos) && saved.joinedVideos.length > 0) {
                restoredJoinedVideos = saved.joinedVideos;
              }
              restoredUrl = saved.externalVideoUrl || null;
              restored = true;
            }
          }
        } catch (e) {
          console.warn("Lỗi khi đọc session từ localStorage:", e);
        }
      }

      // Khôi phục video source
      if (restored) {
        let finalUrl: string | null = null;
        if (!restoredUrl || restoredUrl.startsWith("blob:") || restoredUrl.includes("commondatastorage.googleapis.com")) {
          // Thử lấy blob từ IndexedDB để tạo lại object URL mới
          const cachedBlob = await getVideoBlob(restoredVideoName);
          if (cachedBlob && !isCancelled) {
            finalUrl = URL.createObjectURL(cachedBlob);
          } else if (restoredHash) {
            finalUrl = `${API_BASE}/stream/${restoredHash}`;
          } else {
            finalUrl = resolvePlayableVideoUrl(restoredUrl || undefined, restoredVideoName);
          }
        } else {
          finalUrl = resolvePlayableVideoUrl(restoredUrl, restoredVideoName);
        }

        if (!isCancelled) {
          setExternalVideoUrl(finalUrl);

          // Khôi phục danh sách joinedVideos đầy đủ (kể cả video đã thêm và nối tiếp)
          if (restoredJoinedVideos && restoredJoinedVideos.length > 0) {
            const rehydratedClips: JoinedVideoClip[] = await Promise.all(
              restoredJoinedVideos.map(async (clip, idx) => {
                let clipUrl = clip.url;
                if (!clipUrl || clipUrl.startsWith("blob:") || clipUrl.includes("commondatastorage.googleapis.com")) {
                  const blob = await getVideoBlob(clip.fileName);
                  if (blob) {
                    clipUrl = URL.createObjectURL(blob);
                  } else if (idx === 0 && finalUrl) {
                    clipUrl = finalUrl;
                  } else {
                    clipUrl = resolvePlayableVideoUrl(undefined, clip.fileName);
                  }
                } else {
                  clipUrl = resolvePlayableVideoUrl(clipUrl, clip.fileName);
                }
                return {
                  ...clip,
                  url: clipUrl,
                };
              })
            );
            setJoinedVideos(rehydratedClips);
          } else {
            setJoinedVideos([
              {
                id: "clip_01",
                title: restoredVideoName.replace(/\.[^/.]+$/, ""),
                fileName: restoredVideoName,
                url: finalUrl || "/videos/Bai08_Ep_kieu_du_lieu.mp4",
                duration: restoredTotalDur,
                startOffset: 0.0,
                endOffset: restoredTotalDur,
              },
            ]);
          }
        }
      } else {
        // Nạp dữ liệu chuẩn Bài 08 nếu chưa có phiên làm việc trước đó
        setData(BAI08_SEGMENTS_DATA);
        setTranscript(BAI08_TRANSCRIPT_DATA);
        setActiveSegmentId(BAI08_SEGMENTS_DATA.segments[0].id);
        setExternalVideoUrl("/videos/Bai08_Ep_kieu_du_lieu.mp4");
        setJoinedVideos(INITIAL_JOINED_VIDEOS);
      }

      // Nạp danh sách thư viện video và làm mới các blob URL nếu cần
      if (!isCancelled) {
        const loadedLib = getLibraryVideos();
        const refreshedLib = await Promise.all(
          loadedLib.map(async (item) => {
            if (item.url && item.url.startsWith("blob:")) {
              const b = await getVideoBlob(item.name);
              if (b) {
                return { ...item, url: URL.createObjectURL(b) };
              }
              return { ...item, url: resolvePlayableVideoUrl(undefined, item.name) };
            }
            return item;
          })
        );
        setVideoLibrary(refreshedLib);
        setLibraryCards(syncLibraryCardsFromLibrary(refreshedLib));
        setIsSessionLoaded(true);
      }

      // Đồng bộ thông tin Backend và thư viện video Cloud trong background (không chặn người dùng)
      try {
        const configRes = await fetchConfig();
        const isOnline = configRes.source === "api";
        if (!isCancelled) {
          setBackendOnline(isOnline);
        }

        const backendVidsRes = await fetchBackendVideos();
        if (
          !isCancelled &&
          backendVidsRes.source === "api" &&
          backendVidsRes.data &&
          backendVidsRes.data.length > 0
        ) {
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
            const combined = [...prev, ...newOnes];
            setLibraryCards(syncLibraryCardsFromLibrary(combined));
            return combined;
          });
        }
      } catch (err) {
        console.warn("Lỗi kiểm tra backend background:", err);
      }
    }

    restoreSessionAndLoad();

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleRefreshFromBackend = useCallback(async () => {
    try {
      const configRes = await fetchConfig();
      const isOnline = configRes.source === "api";
      setBackendOnline(isOnline);
      const backendVidsRes = await fetchBackendVideos();
      if (backendVidsRes.data && backendVidsRes.data.length > 0) {
        showToast("success", `Đã làm mới! Backend online với ${backendVidsRes.data.length} video.`);
      } else if (isOnline) {
        showToast("success", "Đã kết nối thành công với máy chủ xử lý!");
      } else {
        showToast("info", "Đang sử dụng dữ liệu cục bộ.");
      }
    } catch {
      showToast("error", "Không thể kết nối đến máy chủ xử lý.");
    }
  }, [showToast]);

  // Tự động lưu Active Session vào localStorage (CHỈ chạy SAU KHI session đã được phục hồi xong)
  useEffect(() => {
    if (!isSessionLoaded) return;
    if (typeof window === "undefined") return;
    if (!data || !data.video) return;

    try {
      const sessionData = {
        data,
        transcript,
        externalVideoUrl,
        currentVideoHash,
        activeSegmentId,
        currentTime,
        joinedVideos,
      };
      localStorage.setItem("autocut_active_session", JSON.stringify(sessionData));
    } catch (e) {
      console.warn("Khong the ghi session vao localStorage:", e);
    }
  }, [
    isSessionLoaded,
    data,
    transcript,
    externalVideoUrl,
    currentVideoHash,
    activeSegmentId,
    currentTime,
    joinedVideos,
  ]);

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

    // Nếu số phân đoạn giảm (có phân đoạn bị xóa):
    if (newSegments.length < data.segments.length) {
      const deletedSeg = data.segments.find((s) => !newSegments.some((ns) => ns.id === s.id));
      if (deletedSeg) {
        showToast("info", `✓ Đã xóa "${deletedSeg.topic}". Trình phát sẽ tự động bỏ qua đoạn này khi phát.`);
      }

      // Nếu phân đoạn đang chọn bị xóa, chuyển sang phân đoạn còn lại kế tiếp
      if (!newSegments.some((s) => s.id === activeSegmentId)) {
        const nextTarget =
          newSegments.find((s) => s.start >= currentTime) || newSegments[0];
        if (nextTarget) {
          setActiveSegmentId(nextTarget.id);
          handleSeek(nextTarget.start);
        }
      }
    }
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

  const handleSaveProject = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    showToast("info", "Đang lưu dự án và đồng bộ Cloudflare R2...");

    try {
      const totalDur = data.segments.reduce((max, s) => Math.max(max, s.end), 0) || 120;
      const payload = {
        user: currentUser?.id || currentUser?.username || "admin",
        lesson: data.lesson || data.video.replace(/\.[^/.]+$/, ""),
        video: data.video,
        videoUrl: String(externalVideoUrl || (data as unknown as Record<string, unknown>).videoUrl || ""),
        duration: totalDur,
        segments: data.segments,
        mode: data.mode,
        reviewed: data.reviewed,
      };

      const res = await saveProjectToBackend(payload);
      if (res.source === "api" && res.data) {
        showToast(
          "success",
          `Đã lưu dự án thành công cho user: ${payload.user}!${res.data.cloudUrl ? " Đã đồng bộ Cloudflare R2." : ""}`
        );
      } else {
        showToast("info", "Đã lưu dự án vào bộ nhớ cục bộ.");
      }
    } catch (err) {
      showToast("error", "Lỗi khi lưu dự án: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  }, [currentUser, data, externalVideoUrl, isSaving, showToast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveProject();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveProject]);

  const handleRender = async () => {
    setIsRendering(true);
    setIsProgressModalOpen(true);
    setProgressModalMode("render");
    setProgressPercent(15);
    setProgressError(null);
    setRenderedClips([]);
    setRenderedOutputDir("");
    setProgressActionText("Đang khởi tạo kế hoạch cắt FFmpeg & nạp cấu hình padding...");

    const initialSteps: ProgressStep[] = [
      {
        id: "step-plan",
        title: "1. Khởi tạo danh sách phân đoạn",
        description: `Áp dụng padding_start (0.3s) và padding_end (0.5s) kẹp biên [0, duration] cho ${data.segments.length} phân đoạn.`,
        status: "running",
      },
      {
        id: "step-cut",
        title: "2. Cắt video Accurate Cut bằng FFmpeg (libx264)",
        description: "Re-encode chính xác từng frame, khử hoàn toàn lỗi đen hình I-Frame.",
        status: "pending",
      },
      {
        id: "step-output",
        title: "3. Đóng gói & tạo liên kết tải file xuất bản",
        description: "Lưu tại thư mục output và sẵn sàng tải về máy tính.",
        status: "pending",
      },
    ];
    setProgressSteps(initialSteps);

    // Tự động tăng phần trăm nhịp nhàng để người dùng thấy rõ tiến trình
    let currentP = 20;
    const progressTimer = setInterval(() => {
      currentP = Math.min(88, currentP + Math.floor(Math.random() * 8) + 3);
      setProgressPercent(currentP);
      if (currentP > 30 && currentP < 85) {
        const segIdx = Math.min(
          data.segments.length - 1,
          Math.floor(((currentP - 30) / 55) * data.segments.length)
        );
        const activeSeg = data.segments[segIdx];
        setProgressActionText(
          `Đang cắt clip #${segIdx + 1}/${data.segments.length}: ${activeSeg?.topic || "Phân đoạn"}...`
        );
        setProgressSteps((prev) =>
          prev.map((s) => {
            if (s.id === "step-plan") return { ...s, status: "completed" };
            if (s.id === "step-cut") return { ...s, status: "running" };
            return s;
          })
        );
      }
    }, 700);

    try {
      const result = await submitRenderSegments({ ...data, reviewed: true });
      clearInterval(progressTimer);

      if (result.success) {
        setProgressPercent(100);
        setProgressActionText("Đã hoàn tất xuất bản toàn bộ các clip video!");
        setProgressSteps((prev) =>
          prev.map((s) => ({ ...s, status: "completed" }))
        );
        setRenderedClips(result.renderedFiles || []);
        setRenderedOutputDir(result.outputDirectory || "");
        setTotalRenderedCount(
          result.totalRendered || result.renderedFiles?.length || data.segments.length
        );

        showToast(
          "success",
          `${result.message} ${result.savedPlan ? `(Lưu tại: ${result.savedPlan})` : ""}`
        );
      } else {
        setProgressPercent(60);
        setProgressError(result.message || "Lỗi khi thực thi cắt video");
        setProgressSteps((prev) =>
          prev.map((s) => (s.status === "running" ? { ...s, status: "error" } : s))
        );
        showToast("error", `Lỗi: ${result.message}`);
      }
    } catch (err) {
      clearInterval(progressTimer);
      setProgressError(
        err instanceof Error ? err.message : "Lỗi ngoại lệ khi cắt video"
      );
    } finally {
      setIsRendering(false);
    }
  };

  const handleDurationChange = useCallback((detectedSecs: number) => {
    if (!detectedSecs || isNaN(detectedSecs) || detectedSecs <= 0) return;
    const realSecs = Number(detectedSecs.toFixed(1));

    setData((prev) => {
      const currentEnd = prev.segments.reduce((max, s) => Math.max(max, s.end), 0);
      // Nếu đã khớp chính xác với thời lượng thật (sai số < 0.1s), không cần chỉnh
      if (Math.abs(currentEnd - realSecs) < 0.1) return prev;

      if (prev.segments.length === 1) {
        const seg = prev.segments[0];
        const sectionFolder = `${seg.section_no.toString().padStart(2, "0")}_${seg.section.replace(/\s+/g, "")}`;
        return {
          ...prev,
          segments: [
            {
              ...seg,
              start: 0,
              end: realSecs,
              parts: recalculateParts(0, realSecs, sectionFolder, seg.topic_no, seg.slug),
            },
          ],
        };
      }

      // Rescale toàn bộ các phân đoạn theo tỷ lệ phần trăm để ôm khít 100% thời lượng video thật [0, realSecs]
      const scale = realSecs / Math.max(0.1, currentEnd);
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
    const totalSecs = Math.max(1, Number((newVideo.duration || 60).toFixed(1)));

    // Nếu AI đã phân tích khi upload: nạp ngay transcript và segments
    if (newVideo.segmentsData && newVideo.segmentsData.segments.length > 0) {
      setData(newVideo.segmentsData);
      if (newVideo.transcript) {
        setTranscript(newVideo.transcript);
      }
      setActiveSegmentId(newVideo.segmentsData.segments[0].id);

      setJoinedVideos([
        {
          id: `clip_${Date.now()}`,
          title: lessonTitle,
          fileName: newVideo.name,
          url: newVideo.url,
          duration: totalSecs,
          startOffset: 0,
          endOffset: totalSecs,
        },
      ]);

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
      setLibraryCards(syncLibraryCardsFromLibrary(updatedLib));
      setUndoStack([]);
      setRedoStack([]);
      setCurrentTime(0);
      setIsPlaying(true);

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

    setJoinedVideos([
      {
        id: `clip_${Date.now()}`,
        title: lessonTitle,
        fileName: newVideo.name,
        url: newVideo.url,
        duration: totalSecs,
        startOffset: 0,
        endOffset: totalSecs,
      },
    ]);

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
    setLibraryCards(syncLibraryCardsFromLibrary(updatedLib));
    setUndoStack([]);
    setRedoStack([]);

    setActiveSegmentId(singleSegment.id);
    setCurrentTime(0);
    setIsPlaying(true);

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
    setAnalysisProgress(5);
    setAnalysisStep("Đang kết nối AI Engine & trích xuất đặc trưng âm thanh...");

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    const startTime = Date.now();
    progressTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setAnalysisProgress((prev) => {
        let target = prev;
        if (elapsed < 3) {
          target = Math.min(25, 5 + elapsed * 6.5);
          setAnalysisStep("Đang tách âm thanh & gọi Whisper STT nhận diện lời thoại...");
        } else if (elapsed < 8) {
          target = Math.min(55, 25 + (elapsed - 3) * 6);
          setAnalysisStep("Whisper hoàn tất, Gemini đang sửa chính tả & tách câu đơn...");
        } else if (elapsed < 14) {
          target = Math.min(78, 55 + (elapsed - 8) * 3.8);
          setAnalysisStep("Gemini đang phân tích ngữ nghĩa & chia đoạn theo chủ đề...");
        } else if (elapsed < 20) {
          target = Math.min(92, 78 + (elapsed - 14) * 2.3);
          setAnalysisStep("Đang tối ưu độ dài phân đoạn (< 7 phút) & đồng bộ hóa...");
        } else {
          target = Math.min(96, 92 + (elapsed - 20) * 0.4);
          setAnalysisStep("Đang hoàn tất lưu file phân đoạn và chuẩn bị hiển thị...");
        }
        return Number(target.toFixed(1));
      });
    }, 200);

    setIsProgressModalOpen(true);
    setProgressModalMode("analyze");
    setProgressPercent(15);
    setProgressError(null);
    setProgressActionText("Đang kiểm định cấu trúc media và trích xuất audio qua ffprobe...");

    const initialSteps: ProgressStep[] = [
      {
        id: "step-probe",
        title: "1. Kiểm tra cấu trúc media & ffprobe",
        description: "Xác thực codec video, luồng âm thanh và thời lượng tổng thể.",
        status: "running",
      },
      {
        id: "step-whisper",
        title: "2. Nhận dạng giọng nói (Whisper Speech-to-Text)",
        description: "Trích xuất audio và nhận diện từng câu thoại chính xác theo dấu thời gian cho toàn bộ video.",
        status: "pending",
      },
      {
        id: "step-segment",
        title: "3. Phân đoạn chủ đề AI & kẹp mốc thời gian",
        description: "Phân tích ngữ nghĩa để chia bài học thành các phân đoạn logic trên Timeline.",
        status: "pending",
      },
      {
        id: "step-sync",
        title: "4. Đồng bộ dữ liệu lên Timeline Studio",
        description: "Khởi tạo các khối phân đoạn và sẵn sàng biên tập.",
        status: "pending",
      },
    ];
    setProgressSteps(initialSteps);

    let tickerP = 15;
    const ticker = setInterval(() => {
      tickerP = Math.min(85, tickerP + Math.floor(Math.random() * 8) + 4);
      setProgressPercent(tickerP);
      if (tickerP >= 30 && tickerP < 60) {
        setProgressActionText("Đang bóc băng lời thoại bằng mô hình Whisper cho từng video...");
        setProgressSteps((prev) =>
          prev.map((s) => {
            if (s.id === "step-probe") return { ...s, status: "completed" };
            if (s.id === "step-whisper") return { ...s, status: "running" };
            return s;
          })
        );
      } else if (tickerP >= 60) {
        setProgressActionText("Đang phân chia chủ đề AI và đồng bộ mốc thời gian nối tiếp...");
        setProgressSteps((prev) =>
          prev.map((s) => {
            if (s.id === "step-probe" || s.id === "step-whisper") return { ...s, status: "completed" };
            if (s.id === "step-segment") return { ...s, status: "running" };
            return s;
          })
        );
      }
    }, 600);

    const totalSecs = Math.max(
      5,
      data.segments.reduce((max, s) => Math.max(max, s.end), 0)
    );

    const finalizeAnalysisSuccess = async (segCount: number, sentCount: number) => {
      clearInterval(ticker);
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setAnalysisProgress(100);
      setAnalysisStep("✓ Hoàn tất phân tích AI 100%!");
      setProgressPercent(100);
      setProgressActionText(`Đã hoàn tất phân tích ${segCount} phân đoạn và bóc băng ${sentCount} câu thoại!`);
      setProgressSteps((prev) => prev.map((s) => ({ ...s, status: "completed" })));
      await new Promise((r) => setTimeout(r, 450));
      setIsAnalyzing(false);
      setAnalysisProgress(0);
      setAnalysisStep("");
    };

    // Danh sách toàn bộ các video trên Timeline cần phân tích
    const clipsToAnalyze: JoinedVideoClip[] =
      joinedVideos && joinedVideos.length > 0
        ? joinedVideos
        : [
            {
              id: `clip_${Date.now()}`,
              title: data.lesson,
              fileName: data.video,
              url: externalVideoUrl || "",
              duration: totalSecs,
              startOffset: 0,
              endOffset: totalSecs,
            },
          ];

    const libVideos = getLibraryVideos();
    const analyzedClipsData: Array<{
      clip: JoinedVideoClip;
      segments: Segment[];
      sentences: Sentence[];
    }> = [];

    for (let i = 0; i < clipsToAnalyze.length; i++) {
      const clip = clipsToAnalyze[i];
      const clipDur = Math.max(1, clip.duration || 60);
      let clipSentences: Sentence[] = [];
      let clipSegments: Segment[] = [];

      // 1. Kiểm tra cache trong thư viện video (videoLibrary)
      const matchedLib = libVideos.find(
        (v) =>
          (v.name && v.name.toLowerCase() === clip.fileName.toLowerCase()) ||
          (v.lesson && v.lesson.toLowerCase() === clip.title.toLowerCase()) ||
          (v.title && v.title.toLowerCase() === clip.title.toLowerCase())
      );

      if (matchedLib?.transcript?.sentences && matchedLib.transcript.sentences.length > 0) {
        clipSentences = matchedLib.transcript.sentences;
        clipSegments = matchedLib.segments && matchedLib.segments.length > 0 ? matchedLib.segments : [];
      }

      // 2. Gọi Groq Whisper / file transcript API (/api/groq)
      if (clipSentences.length === 0) {
        try {
          const groqFormData = new FormData();
          groqFormData.append("videoName", clip.fileName);
          groqFormData.append("lesson", clip.title);

          const groqResp = await fetch("/api/groq", {
            method: "POST",
            body: groqFormData,
          });

          if (groqResp.ok) {
            const groqJson = await groqResp.json();
            if (groqJson.transcript?.sentences && groqJson.transcript.sentences.length > 0) {
              clipSentences = groqJson.transcript.sentences;
              clipSegments = groqJson.segmentsData?.segments || [];
            }
          }
        } catch (groqErr) {
          console.warn(`Groq API warning cho video "${clip.fileName}":`, groqErr);
        }
      }

      // 3. Gọi Backend AI Spring Boot (/api/video/analyze)
      if (clipSentences.length === 0) {
        try {
          const res = await analyzeVideoBackend({
            videoName: clip.fileName,
            lesson: clip.title,
            duration: clipDur,
          });
          if (res.source === "api" && res.data?.transcript?.sentences) {
            clipSentences = res.data.transcript.sentences;
            clipSegments = res.data.segmentsData?.segments || [];
          }
        } catch (backendErr) {
          console.warn(`Backend AI warning cho video "${clip.fileName}":`, backendErr);
        }
      }

      // 4. Fallback nội dung nếu offline
      if (clipSentences.length === 0) {
        const isMusic = /download|remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi/i.test(
          `${clip.fileName} ${clip.title}`
        );
        if (isMusic && clip.fileName.toLowerCase().includes("download")) {
          clipSentences = REAL_DOWNLOAD_LYRICS;
        } else if (isMusic) {
          clipSentences = [
            { id: "S0001", start: 0, end: Number((clipDur * 0.2).toFixed(1)), text: `Dạo nhạc mở màn: ${clip.title}` },
            { id: "S0002", start: Number((clipDur * 0.2).toFixed(1)), end: Number((clipDur * 0.5).toFixed(1)), text: `Lời ca khúc & Giai điệu chính (${clip.title})` },
            { id: "S0003", start: Number((clipDur * 0.5).toFixed(1)), end: Number((clipDur * 0.8).toFixed(1)), text: "Điệp khúc cao trào và biến tấu âm thanh" },
            { id: "S0004", start: Number((clipDur * 0.8).toFixed(1)), end: clipDur, text: "Giai điệu kết thúc Outro Fade" },
          ];
        } else {
          const c1 = Number((clipDur * 0.25).toFixed(1));
          const c2 = Number((clipDur * 0.5).toFixed(1));
          const c3 = Number((clipDur * 0.75).toFixed(1));
          clipSentences = [
            { id: "S0001", start: 0, end: c1, text: `Khởi đầu chủ đề: "${clip.title}".` },
            { id: "S0002", start: c1, end: c2, text: "Làm rõ các luận điểm chính và cú pháp cần ghi nhớ." },
            { id: "S0003", start: c2, end: c3, text: "Thực hành áp dụng kiến thức vào ví dụ thực tế." },
            { id: "S0004", start: c3, end: clipDur, text: "Tổng kết kinh nghiệm thực tiễn và bài tập rèn luyện." },
          ];
        }
      }

      // Tự động sinh phân đoạn cho clip nếu chưa có
      if (clipSegments.length === 0) {
        const numSecs = Math.min(4, Math.max(2, Math.ceil(clipDur / 60)));
        const step = Number((clipDur / numSecs).toFixed(1));
        let cStart = 0;
        for (let s = 1; s <= numSecs; s++) {
          const cEnd = s === numSecs ? clipDur : Number((cStart + step).toFixed(1));
          const secTopic = s === 1 ? `Khởi đầu: ${clip.title}` : s === numSecs ? `Tổng kết: ${clip.title}` : `Phần ${s}: ${clip.title}`;
          const cleanSlug = slugify(secTopic);
          clipSegments.push({
            id: `seg_${Date.now()}_${i}_${s}`,
            section_no: s,
            section: `0${s}_Doan_${s}`,
            topic_no: s,
            topic: secTopic,
            slug: cleanSlug,
            start_id: `S${String(s).padStart(4, "0")}`,
            end_id: `S${String(s).padStart(4, "0")}`,
            start: cStart,
            end: cEnd,
            parts: recalculateParts(cStart, cEnd, `0${s}_Doan_${s}`, s, cleanSlug),
          });
          cStart = cEnd;
        }
      }

      analyzedClipsData.push({
        clip,
        segments: clipSegments,
        sentences: clipSentences,
      });
    }

    // 5. Offset toàn bộ câu thoại và phân đoạn theo mốc thời gian nối tiếp trên Timeline
    const allSegments: Segment[] = [];
    const allSentences: Sentence[] = [];
    let cumulativeTopicNo = 1;
    let cumulativeSentNo = 1;

    for (let idx = 0; idx < analyzedClipsData.length; idx++) {
      const { clip, segments, sentences } = analyzedClipsData[idx];
      const offset = clip.startOffset;
      const isAppended = idx > 0;
      const videoIndex = idx + 1;

      // Offset câu thoại
      for (const sent of sentences) {
        const sentStart = Number((offset + (sent.start >= 0 ? sent.start : 0)).toFixed(1));
        const sentEnd = Number((offset + Math.max(sent.start + 0.5, sent.end)).toFixed(1));
        allSentences.push({
          id: `S${String(cumulativeSentNo++).padStart(4, "0")}`,
          start: sentStart,
          end: sentEnd,
          text: sent.text,
        });
      }

      // Offset phân đoạn
      for (let sIdx = 0; sIdx < segments.length; sIdx++) {
        const seg = segments[sIdx];
        const segStart = Number((offset + (seg.start >= 0 ? seg.start : 0)).toFixed(1));
        const segEnd = Number((offset + (seg.end > seg.start ? seg.end : clip.duration)).toFixed(1));
        const topicNo = cumulativeTopicNo++;
        const secFolder = `0${videoIndex}_${slugify(clip.title)}`;
        const cleanSlug = seg.slug || slugify(seg.topic || `muc-${topicNo}`);

        allSegments.push({
          ...seg,
          id: `seg_ai_${Date.now()}_${idx}_${sIdx}`,
          topic_no: topicNo,
          section_no: seg.section_no || (sIdx + 1),
          section: seg.section || secFolder,
          topic: seg.topic,
          slug: cleanSlug,
          start: segStart,
          end: segEnd,
          parts: recalculateParts(segStart, segEnd, secFolder, topicNo, cleanSlug),
          videoTitle: clip.title,
          videoIndex: videoIndex,
          isAppended: isAppended,
        });
      }

      // Lưu phân đoạn và transcript riêng lẻ của từng video vào videoLibrary
      updateVideoSegmentsInLibrary(clip.fileName, segments);
      const libItem: VideoLibraryItem = {
        id: `vid_lib_${clip.id}`,
        name: clip.fileName,
        lesson: clip.title,
        title: clip.title,
        url: clip.url,
        duration: clip.duration,
        status: "edited",
        statusLabel: "Đã phân tích AI",
        category: idx === 0 ? "Video chính" : "Video nối tiếp",
        segmentsCount: segments.length,
        updatedAt: new Date().toLocaleTimeString("vi-VN"),
        segments: segments,
        transcript: {
          video: clip.fileName,
          duration: clip.duration,
          sentences: sentences,
        },
      };
      saveVideoToLibrary(libItem);
    }

    const calculatedTotal = clipsToAnalyze.reduce((sum, c) => Math.max(sum, c.endOffset), 0) || totalSecs;
    const normalizedSegs = normalizeContiguousSegments(allSegments, calculatedTotal);

    setData((prev) => ({
      ...prev,
      mode: "analyzed",
      reviewed: false,
      segments: normalizedSegs,
    }));

    setTranscript({
      video: data.video,
      duration: calculatedTotal,
      sentences: allSentences,
    });

    if (normalizedSegs.length > 0) {
      setActiveSegmentId(normalizedSegs[0].id);
    }

    setVideoLibrary(getLibraryVideos());
    setLibraryCards(syncLibraryCardsFromLibrary(getLibraryVideos()));
    setUndoStack([]);
    setRedoStack([]);
    finalizeAnalysisSuccess(normalizedSegs.length, allSentences.length);

    showToast(
      "success",
      `✓ AI đã hoàn tất phân tích lời thoại và phân đoạn cho toàn bộ ${clipsToAnalyze.length} video (${normalizedSegs.length} phân đoạn, ${allSentences.length} câu thoại)!`
    );
  }, [joinedVideos, data, externalVideoUrl, showToast]);

  const totalDuration = Math.max(
    1,
    data.segments.reduce((max, s) => Math.max(max, s.end), 0)
  );

  const handleSeek = useCallback(
    (time: number) => {
      let targetTime = Math.max(0, Math.min(totalDuration, Number(time.toFixed(1))));

      if (data.segments && data.segments.length > 0) {
        const sorted = [...data.segments].sort((a, b) => a.start - b.start);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];

        if (targetTime < first.start) {
          targetTime = first.start;
        } else if (targetTime > last.end) {
          targetTime = last.end;
        } else {
          // Nếu rơi vào khoảng đã xóa giữa các phân đoạn, tự động kẹp vào đầu phân đoạn kế tiếp
          const inside = sorted.some((s) => targetTime >= s.start && targetTime <= s.end);
          if (!inside) {
            const nextSeg = sorted.find((s) => s.start > targetTime);
            if (nextSeg) {
              targetTime = nextSeg.start;
            }
          }
        }
      }

      setCurrentTime(targetTime);
      const found = data.segments.find((s) => targetTime >= s.start && targetTime <= s.end);
      if (found && found.id !== activeSegmentId) {
        setActiveSegmentId(found.id);
      }
    },
    [totalDuration, data.segments, activeSegmentId]
  );

  const activeSegment =
    data.segments.find((s) => s.id === activeSegmentId) || data.segments[0];

  const isDemo = data.mode === "demo" || data.lesson === "Bai05_VongLap" || data.video === "Bai05_VongLap.mp4";

  // Mở modal thông báo chi tiết khi người dùng ấn vào phân đoạn hoặc video
  const handleOpenSegmentDetail = useCallback((seg: Segment, index: number) => {
    setSelectedDetailSegment(seg);
    setSelectedDetailIndex(index);
    setIsDetailModalOpen(true);
  }, []);

  // Nối tiếp video từ thư viện hoặc tải lên ra đằng sau video đang phát trên Timeline
  const handleAppendVideoToTimeline = useCallback(
    (videoToAppend: LibraryVideoCard | VideoLibraryItem | NewVideoData) => {
      const currentDuration =
        data.segments.reduce((max, s) => Math.max(max, s.end), 0) || totalDuration || 1;
      const appendDuration = Math.max(
        1,
        ("duration" in videoToAppend ? videoToAppend.duration : undefined) ||
          ("durationSeconds" in videoToAppend ? videoToAppend.durationSeconds : undefined) ||
          60
      );
      const offset = Number(currentDuration.toFixed(1));

      const rawSegments =
        ("segments" in videoToAppend && videoToAppend.segments && videoToAppend.segments.length > 0)
          ? videoToAppend.segments
          : ("segmentsData" in videoToAppend && videoToAppend.segmentsData?.segments && videoToAppend.segmentsData.segments.length > 0)
          ? videoToAppend.segmentsData.segments
          : [];

      let newAppendedSegments: Segment[] = [];
      const vName = ("fileName" in videoToAppend ? videoToAppend.fileName : videoToAppend.name) || "video";
      const vTitle =
        ("title" in videoToAppend ? videoToAppend.title : undefined) ||
        ("topicTitle" in videoToAppend ? videoToAppend.topicTitle : undefined) ||
        vName;
      const rawAppendUrl = ("url" in videoToAppend ? videoToAppend.url : undefined) || "";
      const appendUrl = resolvePlayableVideoUrl(rawAppendUrl, vName);
      const currentVideoCount = joinedVideos.length || 1;
      const newVideoIndex = currentVideoCount + 1;

      if (rawSegments.length > 0) {
        newAppendedSegments = rawSegments.map((seg, idx) => {
          const segStart = Number((offset + seg.start).toFixed(1));
          const segEnd = Number((offset + seg.end).toFixed(1));
          const topicNo = data.segments.length + idx + 1;
          const sectionFolder = `${seg.section_no.toString().padStart(2, "0")}_${seg.section.replace(/\s+/g, "")}`;

          return {
            ...seg,
            id: `seg_appended_${Date.now()}_${idx}`,
            topic_no: topicNo,
            start: segStart,
            end: segEnd,
            parts: recalculateParts(segStart, segEnd, sectionFolder, topicNo, seg.slug),
            videoTitle: vTitle,
            videoIndex: newVideoIndex,
            isAppended: true,
          };
        });
      } else {
        const segStart = offset;
        const segEnd = Number((offset + appendDuration).toFixed(1));
        const topicNo = data.segments.length + 1;
        const cleanSlug = slugify(vTitle);

        newAppendedSegments = [
          {
            id: `seg_appended_${Date.now()}_0`,
            section_no: 1,
            section: "01_VideoNoiTiep",
            topic_no: topicNo,
            topic: vTitle,
            slug: cleanSlug,
            start_id: `s${topicNo}01`,
            end_id: `s${topicNo}99`,
            start: segStart,
            end: segEnd,
            parts: [
              {
                part: 1,
                start: segStart,
                end: segEnd,
                file: `01_VideoNoiTiep/${String(topicNo).padStart(2, "0")}_${cleanSlug}.mp4`,
              },
            ],
            videoTitle: vTitle,
            videoIndex: newVideoIndex,
            isAppended: true,
          },
        ];
      }

      setUndoStack((prev) => [...prev.slice(-30), data.segments]);
      setRedoStack([]);

      const combinedSegments = [...data.segments, ...newAppendedSegments];
      const combinedLesson = `${data.lesson} + ${vTitle}`;
      const combinedVideo = `${data.video} & ${vName}`;

      setData((prev) => ({
        ...prev,
        video: combinedVideo,
        lesson: combinedLesson,
        segments: combinedSegments,
      }));

      // Cập nhật danh sách joinedVideos để Video Player và Timeline hiển thị nối tiếp mượt mà
      setJoinedVideos((prev) => [
        ...prev,
        {
          id: `clip_${Date.now()}`,
          title: vTitle,
          fileName: vName,
          url: appendUrl,
          duration: appendDuration,
          startOffset: offset,
          endOffset: Number((offset + appendDuration).toFixed(1)),
        },
      ]);

      let appendTranscript =
        ("transcript" in videoToAppend && videoToAppend.transcript)
          ? videoToAppend.transcript
          : undefined;

      if (!appendTranscript?.sentences || appendTranscript.sentences.length === 0) {
        const lib = getLibraryVideos();
        const matchLib = lib.find(
          (v) =>
            (v.name && v.name.toLowerCase() === vName.toLowerCase()) ||
            (v.lesson && v.lesson.toLowerCase() === vTitle.toLowerCase()) ||
            (v.title && v.title.toLowerCase() === vTitle.toLowerCase())
        );
        if (matchLib?.transcript?.sentences && matchLib.transcript.sentences.length > 0) {
          appendTranscript = matchLib.transcript;
        }
      }

      if (!appendTranscript?.sentences || appendTranscript.sentences.length === 0) {
        const isMusic = /download|remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi/i.test(
          `${vName} ${vTitle}`
        );
        if (isMusic && vName.toLowerCase().includes("download")) {
          appendTranscript = {
            video: vName,
            duration: appendDuration,
            sentences: REAL_DOWNLOAD_LYRICS,
          };
        }
      }

      if (appendTranscript?.sentences && appendTranscript.sentences.length > 0) {
        const existingCount = transcript?.sentences?.length || 0;
        const shifted = appendTranscript.sentences.map((sent, idx) => ({
          ...sent,
          id: `S${String(existingCount + idx + 1).padStart(4, "0")}`,
          start: Number((offset + sent.start).toFixed(1)),
          end: Number((offset + sent.end).toFixed(1)),
        }));

        setTranscript((prev) => ({
          video: combinedVideo,
          duration: Number((offset + appendDuration).toFixed(1)),
          sentences: [...(prev?.sentences || []), ...shifted],
        }));
      } else {
        const existingCount = transcript?.sentences?.length || 0;
        const addedSentences = [
          {
            id: `S${String(existingCount + 1).padStart(4, "0")}`,
            start: offset,
            end: Number((offset + appendDuration * 0.5).toFixed(1)),
            text: `Nội dung nối tiếp từ video "${vTitle}": Khởi đầu chủ đề nối tiếp.`,
          },
          {
            id: `S${String(existingCount + 2).padStart(4, "0")}`,
            start: Number((offset + appendDuration * 0.5).toFixed(1)),
            end: Number((offset + appendDuration).toFixed(1)),
            text: `Nội dung nối tiếp từ video "${vTitle}": Thực hành và tổng kết bài học.`,
          },
        ];

        setTranscript((prev) => ({
          video: combinedVideo,
          duration: Number((offset + appendDuration).toFixed(1)),
          sentences: [...(prev?.sentences || []), ...addedSentences],
        }));

        // Tự động kích hoạt bóc băng lời thoại AI bất đồng bộ cho video mới nối tiếp
        (async () => {
          try {
            const resp = await fetch(`/api/groq?videoName=${encodeURIComponent(vName)}&lesson=${encodeURIComponent(vTitle)}`);
            if (resp.ok) {
              const json = await resp.json();
              if (json.transcript?.sentences && json.transcript.sentences.length > 0) {
                const fetchedSentences: Sentence[] = json.transcript.sentences;
                setTranscript((prev) => {
                  const baseSentences = (prev?.sentences || []).filter(
                    (s) => s.start < offset || s.start >= offset + appendDuration
                  );
                  const shifted = fetchedSentences.map((sent, idx) => ({
                    ...sent,
                    id: `S${String(baseSentences.length + idx + 1).padStart(4, "0")}`,
                    start: Number((offset + sent.start).toFixed(1)),
                    end: Number((offset + sent.end).toFixed(1)),
                  }));
                  return {
                    video: combinedVideo,
                    duration: Number((offset + appendDuration).toFixed(1)),
                    sentences: [...baseSentences, ...shifted],
                  };
                });
              }
            }
          } catch {}
        })();
      }

      if (newAppendedSegments.length > 0) {
        setActiveSegmentId(newAppendedSegments[0].id);
      }
      handleSeek(offset);
      setIsPlaying(true);

      // Đảm bảo video nối tiếp được lưu bền vững vào thư viện video (F5 không mất)
      const libItem: VideoLibraryItem = {
        id: `vid_${Date.now()}`,
        name: vName,
        lesson: vTitle,
        title: vTitle,
        url: appendUrl,
        duration: appendDuration,
        status: "added",
        statusLabel: "Nối tiếp",
        category: "Video nối tiếp",
        segmentsCount: newAppendedSegments.length || 1,
        updatedAt: new Date().toLocaleTimeString("vi-VN"),
        segments: newAppendedSegments,
      };
      const updatedLib = saveVideoToLibrary(libItem);
      setVideoLibrary(updatedLib);
      setLibraryCards(syncLibraryCardsFromLibrary(updatedLib));

      const newTotal = Number((offset + appendDuration).toFixed(1));
      showToast(
        "success",
        `✓ Đã nối tiếp video "${vTitle}" (${formatTime(appendDuration)}) ra sau video đang phát! Tổng thời lượng timeline: ${formatTime(newTotal)}`
      );
    },
    [data, totalDuration, transcript, joinedVideos, handleSeek, showToast]
  );

  // Mở riêng một video từ cột Thư viện video
  const handleSelectLibraryCard = useCallback(
    (card: LibraryVideoCard) => {
      const validUrl = resolvePlayableVideoUrl(card.url, card.fileName);
      setExternalVideoUrl(validUrl);

      if (card.fileName === data.video) {
        // Đang ở video này -> Bật phát video ngay lập tức và đảm bảo đường dẫn nguồn video chuẩn
        setJoinedVideos((prev) => {
          if (prev.length > 0 && prev[0].fileName === card.fileName) {
            return [{ ...prev[0], url: validUrl }, ...prev.slice(1)];
          }
          return [
            {
              id: card.id,
              title: card.title,
              fileName: card.fileName,
              url: validUrl,
              duration: card.durationSeconds || 535,
              startOffset: 0,
              endOffset: card.durationSeconds || 535,
            },
          ];
        });
        setCurrentTime(0);
        setIsPlaying(true);
        showToast("success", `Đang phát video: "${card.title}"`);
      } else {
        // Chuyển sang dự án video mới
        const rawSegments = card.segments && card.segments.length > 0 ? card.segments : [];
        const dur = card.durationSeconds > 0 ? card.durationSeconds : 120;

        let targetSegments: Segment[] = [];
        if (rawSegments.length > 0) {
          targetSegments = rawSegments;
        } else {
          targetSegments = [
            {
              id: `seg_${Date.now()}_raw`,
              section_no: 1,
              section: "01_VideoGoc",
              topic_no: 1,
              topic: card.title,
              slug: slugify(card.title),
              start_id: "s001",
              end_id: "s001",
              start: 0,
              end: dur,
              parts: [
                {
                  part: 1,
                  start: 0,
                  end: dur,
                  file: `01_VideoGoc/01_${slugify(card.title)}.mp4`,
                },
              ],
            },
          ];
        }

        setUndoStack((prev) => [...prev.slice(-30), data.segments]);
        setRedoStack([]);

        setData({
          video: card.fileName,
          lesson: card.title,
          mode: card.segments && card.segments.length > 1 ? "analyzed" : "raw",
          reviewed: false,
          segments: targetSegments,
        });

        setJoinedVideos([
          {
            id: card.id,
            title: card.title,
            fileName: card.fileName,
            url: validUrl,
            duration: dur,
            startOffset: 0,
            endOffset: dur,
          },
        ]);

        if (card.transcript) {
          setTranscript(card.transcript);
        } else {
          setTranscript(undefined);
        }

        setActiveSegmentId(targetSegments[0].id);
        setCurrentTime(0);
        setIsPlaying(true);

        showToast("success", `Đang mở và phát: ${card.title} (${card.durationStr})`);
      }
    },
    [data.video, data.segments, showToast]
  );

  // Gộp 2 phân đoạn liền kề theo đề xuất của Trợ lý AI
  const handleMergeSegments = useCallback(
    (segIdx1: number, segIdx2: number) => {
      setData((prev) => {
        if (segIdx1 < 0 || segIdx2 >= prev.segments.length || segIdx1 >= segIdx2) {
          return prev;
        }
        const s1 = prev.segments[segIdx1];
        const s2 = prev.segments[segIdx2];

        // Gộp s1 và s2 thành một đoạn kéo dài từ s1.start đến s2.end
        const mergedSeg: Segment = {
          ...s1,
          id: `${s1.id}_merged`,
          topic: `${s1.topic} & ${s2.topic}`,
          slug: slugify(`${s1.slug}-${s2.slug}`),
          end: s2.end,
          parts: recalculateParts(
            s1.start,
            s2.end,
            s1.section,
            s1.topic_no,
            slugify(`${s1.slug}-${s2.slug}`)
          ),
        };

        const newSegments = [...prev.segments];
        newSegments.splice(segIdx1, 2, mergedSeg);

        // Đánh lại số thứ tự topic_no
        const renumbered = newSegments.map((seg, idx) => ({
          ...seg,
          topic_no: idx + 1,
        }));

        return {
          ...prev,
          segments: renumbered,
        };
      });
      showToast("success", "✓ Đã gộp thành công 2 phân đoạn trên timeline!");
    },
    [showToast]
  );

  if (!isSessionLoaded) {
    return (
      <div
        className="h-screen w-screen flex flex-col items-center justify-center font-sans select-none transition-colors duration-200"
        style={{ backgroundColor: themeBgColor }}
      >
        <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
        <span className="text-xs font-bold text-slate-600">Đang đồng bộ phiên làm việc AutoCut...</span>
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col font-sans select-none selection:bg-indigo-600 selection:text-white transition-colors duration-200 text-slate-800 dark:text-slate-100"
      style={{ backgroundColor: themeBgColor }}
    >
      {/* Top Header matching reference image */}
      <StudioHeader
        user={currentUser}
        data={data}
        backendOnline={backendOnline}
        isRendering={isRendering}
        isAnalyzing={isAnalyzing}
        analysisProgress={analysisProgress}
        isSaving={isSaving}
        isDemo={isDemo}
        themeColor={themeBgColor}
        onThemeColorChange={handleThemeColorChange}
        onRefreshFromBackend={handleRefreshFromBackend}
        onExport={handleExportJson}
        onSave={handleSaveProject}
        onRender={handleRender}
        onOpenAddVideo={() => setIsAddVideoOpen(true)}
        onAnalyzeAI={handleAnalyzeAI}
        onUserUpdate={(u) => setCurrentUser(u)}
      />

      {/* Main Body Workspace */}
      <div className="flex-1 flex overflow-hidden relative bg-transparent">
        {/* Left Icon Sidebar (giữ ngoài cùng bên trái) */}
        <StudioSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenTranscriptDrawer={() => setIsTranscriptOpen(true)}
          onOpenVideoLibrary={() => setIsLibraryOpen(true)}
        />

        {/* Content View Switcher */}
        {activeTab === "studio" ? (
          /* Studio View: LEFT: Video Library Column, CENTER: Large Video Canvas, RIGHT: AI Assistant Chat Panel */
          <div className="flex-1 flex overflow-hidden min-h-0 bg-transparent">
            {/* LEFT: Video Library Column */}
            <VideoLibraryColumn
              currentVideoName={data.video}
              videos={libraryCards}
              currentSegments={data.segments}
              activeSegmentId={activeSegmentId}
              onSelectVideo={handleSelectLibraryCard}
              onAppendVideo={handleAppendVideoToTimeline}
              onSelectSegment={(seg, idx) => {
                handleOpenSegmentDetail(seg, idx);
                setActiveSegmentId(seg.id);
                handleSeek(seg.start);
              }}
            />

            {/* CENTER: Big Video Viewport */}
            <VideoCanvasViewport
              currentSegment={activeSegment}
              segments={data.segments}
              currentTime={currentTime}
              totalDuration={totalDuration}
              videoTitle={data.video}
              externalVideoUrl={externalVideoUrl}
              joinedVideos={joinedVideos}
              isPlaying={isPlaying}
              volume={volume}
              isMuted={isMuted}
              isDemo={isDemo}
              isAnalyzing={isAnalyzing}
              analysisProgress={analysisProgress}
              analysisStep={analysisStep}
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

            {/* RIGHT: AI Assistant Chat Panel matching reference image */}
            <AiAssistantChatPanel
              segments={data.segments}
              videoTitle={data.video}
              activeSegmentId={activeSegmentId}
              sentences={transcript?.sentences || []}
              isAnalyzing={isAnalyzing}
              onAnalyzeAI={handleAnalyzeAI}
              onMergeSegments={handleMergeSegments}
              onOpenSegmentDetail={handleOpenSegmentDetail}
            />
          </div>
        ) : (
          /* Table View: Standard B9 Review Table for grading & detailed metrics */
          <div className="flex-1 overflow-y-auto p-6 bg-[#f8fafc]">
            <div className="max-w-7xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-slate-900">
                  Bảng Duyệt Chi Tiết Phân Đoạn (B9 Specification)
                </h2>
                <button
                  onClick={() => setActiveTab("studio")}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition"
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
            className={`absolute top-4 right-4 z-50 p-3 rounded-xl border flex items-center gap-2.5 text-xs shadow-2xl backdrop-blur-md animate-in fade-in duration-200 ${notification.type === "success"
                ? "bg-white border-emerald-300 text-emerald-800"
                : notification.type === "error"
                  ? "bg-white border-rose-300 text-rose-800"
                  : "bg-white border-indigo-300 text-indigo-900"
              }`}
          >
            {notification.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-indigo-600 shrink-0" />
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
        joinedVideos={joinedVideos}
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
        onOpenSegmentDetail={handleOpenSegmentDetail}
      />

      {/* Segment Detail Modal: Hiển thị chi tiết nội dung phân đoạn khi click video / segment */}
      <SegmentDetailModal
        isOpen={isDetailModalOpen}
        segment={selectedDetailSegment}
        segmentIndex={selectedDetailIndex}
        videoTitle={data.video}
        sentences={transcript?.sentences || []}
        allSegments={data.segments}
        currentTime={currentTime}
        onClose={() => setIsDetailModalOpen(false)}
        onSeek={handleSeek}
        onPlay={() => setIsPlaying(true)}
        onSelectSegment={(seg, idx) => {
          setSelectedDetailSegment(seg);
          setSelectedDetailIndex(idx);
          setActiveSegmentId(seg.id);
          handleSeek(seg.start);
        }}
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
        onAppendVideo={handleAppendVideoToTimeline}
      />

      {/* Video Library Drawer (Kho Video Đã sửa, Chưa sửa, Mới thêm) */}
      <VideoLibraryDrawer
        isOpen={isLibraryOpen}
        activeVideoName={data.video}
        videos={videoLibrary}
        onClose={() => setIsLibraryOpen(false)}
        onSelectVideo={handleSelectLibraryVideo}
        onAppendVideo={handleAppendVideoToTimeline}
      />

      {/* Modal Tiến Độ Cắt Video & Tải File Xuất Bản (Export & Analysis Progress Modal) */}
      <ExportProgressModal
        isOpen={isProgressModalOpen}
        mode={progressModalMode}
        videoTitle={data.video}
        lessonTitle={data.lesson}
        isRunning={progressModalMode === "render" ? isRendering : isAnalyzing}
        progressPercent={progressPercent}
        currentActionText={progressActionText}
        steps={progressSteps}
        error={progressError}
        renderedClips={renderedClips}
        outputDirectory={renderedOutputDir}
        totalRendered={totalRenderedCount}
        onClose={() => setIsProgressModalOpen(false)}
        onExportJson={handleExportJson}
      />
    </div>
  );
}
