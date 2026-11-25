import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import cp from "child_process";
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { pipeline } from "stream/promises";
import { Sentence, TranscriptData, Segment, SegmentsData } from "@/types";
import { recalculateParts } from "@/lib/utils";
import { resolveGroqApiKey } from "@/lib/groqEnv";

export const dynamic = "force-dynamic";

function findExistingTranscript(projectRoot: string, videoName: string): TranscriptData | null {
  const clean = videoName.replace(/^[0-9a-fA-F]{64}_/, "");
  const stem = path.parse(clean).name.toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetNorm = norm(stem);

  const searchDirs = [
    path.join(projectRoot, "transcripts"),
    path.join(projectRoot, "backend", "transcripts"),
    path.join(projectRoot, "cache"),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);

    // 1. Khớp tên chính xác trước
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const fStem = f.replace(/_transcript\.json$/, "").replace(/\.json$/, "").toLowerCase();
      const fNorm = norm(fStem);
      if (fStem === stem || fNorm === targetNorm) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
          if (content && Array.isArray(content.sentences) && content.sentences.length > 0) {
            const first = content.sentences[0]?.text || "";
            if (first.includes("Nội dung bóc băng của video")) continue;
            return content as TranscriptData;
          }
        } catch {}
      }
    }

    // 2. Bí danh chuẩn cho video demo/bài giảng có sẵn
    if (targetNorm.includes("bai08") || targetNorm.includes("epkieu")) {
      const match = files.find((f) => f.toLowerCase().includes("ep_kieu") || f.toLowerCase().includes("ep-kieu"));
      if (match) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, match), "utf-8"));
          if (content && Array.isArray(content.sentences) && content.sentences.length > 0) {
            return content as TranscriptData;
          }
        } catch {}
      }
    }
    if (targetNorm.includes("bai07") || targetNorm.includes("bien")) {
      const match = files.find((f) => f.toLowerCase().includes("bai07") || f.toLowerCase().includes("bien"));
      if (match) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, match), "utf-8"));
          if (content && Array.isArray(content.sentences) && content.sentences.length > 0) {
            return content as TranscriptData;
          }
        } catch {}
      }
    }
  }

  return null;
}

function generateSegmentsFromSentences(
  sentences: Sentence[],
  totalDuration: number,
  videoName: string,
  lesson: string
): Segment[] {
  if (!sentences || sentences.length === 0) {
    return [
      {
        id: `seg_${Date.now()}_01`,
        section_no: 1,
        section: "01_NoiDung",
        topic_no: 1,
        topic: lesson || videoName,
        slug: "noi-dung",
        start_id: "S0001",
        end_id: "S0001",
        start: 0,
        end: totalDuration,
        parts: recalculateParts(0, totalDuration, "01_NoiDung", 1, "noi-dung"),
      },
    ];
  }

  const segments: Segment[] = [];
  const minByDur = Math.max(1, Math.ceil(totalDuration / 420));
  const numSections = Math.max(minByDur, Math.min(30, Math.max(2, Math.ceil(sentences.length / 10))));
  const sentencesPerSection = Math.max(1, Math.ceil(sentences.length / numSections));
  let currentStart = 0.0;

  for (let i = 0; i < numSections; i++) {
    const startIdx = i * sentencesPerSection;
    const endIdx = Math.min(sentences.length, (i + 1) * sentencesPerSection);
    if (startIdx >= sentences.length) break;

    const group = sentences.slice(startIdx, endIdx);
    const segStart = currentStart;
    let segEnd: number;

    if (i === numSections - 1 || endIdx >= sentences.length) {
      segEnd = totalDuration;
    } else {
      const nextGroupFirstSent = sentences[endIdx];
      segEnd = Number(((group[group.length - 1].end + nextGroupFirstSent.start) / 2).toFixed(1));
      if (segEnd <= segStart) {
        segEnd = group[group.length - 1].end;
      }
    }

    if (segEnd <= segStart + 5.0 && totalDuration > 15.0) {
      segEnd = Math.min(totalDuration, segStart + Math.max(5.0, (totalDuration - segStart) / (numSections - i)));
    }
    currentStart = segEnd;
    const secNo = i + 1;
    const secName = `0${secNo}_Doan_${secNo}`;

    const topicText = group[0]?.text
      ? group[0].text.length > 55
        ? `${group[0].text.slice(0, 52).trim()}...`
        : group[0].text.trim()
      : `Phân đoạn ${secNo}`;

    const slug = `doan-${secNo}`;

    segments.push({
      id: `seg_${Date.now()}_0${secNo}`,
      section_no: secNo,
      section: secName,
      topic_no: secNo,
      topic: topicText,
      slug: slug,
      start_id: group[0].id,
      end_id: group[group.length - 1].id,
      start: segStart,
      end: segEnd,
      parts: recalculateParts(segStart, segEnd, secName, secNo, slug),
    });
  }

  // Loại bỏ triệt để các phân đoạn ngắn < 5s
  const cleanSegs: Segment[] = [];
  for (const seg of segments) {
    if ((seg.end - seg.start) < 5.0 && cleanSegs.length > 0 && totalDuration > 15.0) {
      cleanSegs[cleanSegs.length - 1].end = seg.end;
      const prev = cleanSegs[cleanSegs.length - 1];
      prev.parts = recalculateParts(prev.start, prev.end, prev.section, prev.topic_no, prev.slug);
    } else {
      cleanSegs.push(seg);
    }
  }

  return cleanSegs.map((s, idx) => {
    const sNo = idx + 1;
    const sName = `0${sNo}_Doan_${sNo}`;
    return {
      ...s,
      section_no: sNo,
      section: sName,
      topic_no: sNo,
      parts: recalculateParts(s.start, s.end, sName, sNo, s.slug),
    };
  });
}

async function processTranscription(
  rawVideoName: string,
  lesson: string,
  file: File | null,
  force: boolean = false,
  videoUrl?: string
) {
  const cleanName = rawVideoName.replace(/^[0-9a-fA-F]{64}_/, "");
  const videoStem = cleanName.replace(/\.[^/.]+$/, "") || "video";

  // Tìm thư mục gốc dự án (AutoCut)
  let projectRoot = process.cwd();
  if (!fs.existsSync(path.join(projectRoot, "transcripts"))) {
    projectRoot = path.resolve(process.cwd(), "..");
  }

  const cacheDir = path.join(projectRoot, "cache");
  const transcriptsDir = path.join(projectRoot, "transcripts");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true });

  // 1. Kiểm tra trước nếu đã có file transcript sẵn trong transcripts/ hoặc cache/ (nếu không force)
  if (!force) {
    const existing = findExistingTranscript(projectRoot, cleanName);
    if (existing && existing.sentences && existing.sentences.length > 0) {
      const dur = existing.duration && existing.duration > 0
        ? existing.duration
        : existing.sentences[existing.sentences.length - 1].end || 180.0;

      const segments = generateSegmentsFromSentences(existing.sentences, dur, cleanName, lesson);
      return {
        status: "SUCCESS",
        source: "cached_transcript",
        transcript: {
          video: cleanName,
          duration: dur,
          sentences: existing.sentences,
        },
        segmentsData: {
          video: cleanName,
          lesson: lesson,
          mode: "analyzed",
          reviewed: false,
          segments: segments,
        },
      };
    }
  }

  // 2. Chuẩn bị file âm thanh (MP3 64k mono < 25MB) nếu có file upload hoặc file trong uploads/
  let audioBuffer: Buffer | null = null;
  let tempAudioPath: string | null = null;

  // Helper: Tính bitrate động để file audio luôn < 20MB (an toàn trong giới hạn 25MB của Groq)
  const getDynamicBitrate = (targetVid: string): string => {
    try {
      const probe = cp.execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${targetVid}"`,
        { encoding: "utf-8", timeout: 10000 }
      );
      const dur = parseFloat(probe.trim());
      if (dur > 0) {
        const calc = Math.floor((20 * 1024 * 8) / dur);
        return `${Math.max(16, Math.min(64, calc))}k`;
      }
    } catch {}
    return "32k";
  };

  if (file && file.size > 0) {
    const tempVideo = path.join(cacheDir, `upload_${Date.now()}_${cleanName}`);
    try {
      // Stream trực tiếp sang file đĩa, tránh nạp mảng byte lớn vào V8 RAM
      const nodeReadable = Readable.fromWeb(file.stream() as unknown as WebReadableStream);
      await pipeline(nodeReadable, fs.createWriteStream(tempVideo));
    } catch {
      const arrayBuf = await file.arrayBuffer();
      fs.writeFileSync(tempVideo, Buffer.from(arrayBuf));
    }

    tempAudioPath = path.join(cacheDir, `audio_${Date.now()}_${videoStem}.mp3`);
    try {
      const bitrate = getDynamicBitrate(tempVideo);
      cp.execSync(`ffmpeg -y -i "${tempVideo}" -vn -ar 16000 -ac 1 -b:a ${bitrate} "${tempAudioPath}"`);
      if (fs.existsSync(tempAudioPath)) {
        audioBuffer = fs.readFileSync(tempAudioPath);
      }
    } catch (err) {
      console.warn("FFmpeg extract warning for uploaded file:", err);
    } finally {
      try {
        if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo);
      } catch {}
    }
  }

  // Quét tìm video trong thư mục uploads
  if (!audioBuffer) {
    const searchDirs = [
      path.join(projectRoot, "uploads"),
      path.join(projectRoot, "backend", "uploads"),
    ];

    let foundVideoPath: string | null = null;
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      const dirFiles = fs.readdirSync(dir);
      const match = dirFiles.find(
        (f) =>
          f.toLowerCase() === rawVideoName.toLowerCase() ||
          f.toLowerCase() === cleanName.toLowerCase() ||
          f.toLowerCase().endsWith(`_${cleanName.toLowerCase()}`) ||
          f.toLowerCase().includes(videoStem.toLowerCase())
      );
      if (match) {
        foundVideoPath = path.join(dir, match);
        break;
      }
    }

    if (foundVideoPath && fs.existsSync(foundVideoPath)) {
      tempAudioPath = path.join(cacheDir, `audio_${Date.now()}_${videoStem}.mp3`);
      try {
        const bitrate = getDynamicBitrate(foundVideoPath);
        cp.execSync(`ffmpeg -y -i "${foundVideoPath}" -vn -ar 16000 -ac 1 -b:a ${bitrate} "${tempAudioPath}"`);
        if (fs.existsSync(tempAudioPath)) {
          audioBuffer = fs.readFileSync(tempAudioPath);
        }
      } catch (err) {
        console.warn("FFmpeg extract warning for existing file:", err);
      }
    }
  }

  // Nếu chưa có audioBuffer nhưng có videoUrl (R2, direct URL): stream audio trực tiếp bằng ffmpeg
  if (!audioBuffer && videoUrl && (videoUrl.startsWith("http://") || videoUrl.startsWith("https://"))) {
    tempAudioPath = path.join(cacheDir, `audio_url_${Date.now()}_${videoStem}.mp3`);
    try {
      const bitrate = getDynamicBitrate(videoUrl);
      cp.execSync(`ffmpeg -y -i "${videoUrl}" -vn -ar 16000 -ac 1 -b:a ${bitrate} "${tempAudioPath}"`);
      if (fs.existsSync(tempAudioPath)) {
        audioBuffer = fs.readFileSync(tempAudioPath);
      }
    } catch (err) {
      console.warn("FFmpeg extract warning for videoUrl:", err);
    }
  }

  const apiKey = resolveGroqApiKey(process.env, projectRoot);
  if (!apiKey || !apiKey.startsWith("gsk_")) {
    if (tempAudioPath && fs.existsSync(tempAudioPath)) {
      try {
        fs.unlinkSync(tempAudioPath);
      } catch (unlinkErr) {
        console.warn("Không thể xóa tệp audio tạm:", unlinkErr);
      }
    }
    throw new Error(
      "Chưa cấu hình hoặc sai định dạng GROQ_API_KEY / WHISPER_API_KEY (bắt đầu bằng gsk_ trong .env hoặc frontend/.env.local)."
    );
  }

  let rawSegments: Array<{ id: number; start: number; end: number; text: string; no_speech_prob?: number }> = [];
  let totalDuration = 180.0;
  let groqErrorDetail: string | null = null;

  // 3. Gọi Groq Whisper API nếu có âm thanh
  if (audioBuffer && audioBuffer.length > 0) {
    const groqFormData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" });
    groqFormData.append("file", blob, `${videoStem}.mp3`);
    groqFormData.append("model", "whisper-large-v3");
    groqFormData.append("response_format", "verbose_json");
    groqFormData.append("language", "vi");

    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: groqFormData,
      });

      if (groqRes.ok) {
        const groqData = await groqRes.json();
        if (groqData.duration && groqData.duration > 0) {
          totalDuration = Number(groqData.duration.toFixed(1));
        }
        if (Array.isArray(groqData.segments)) {
          rawSegments = groqData.segments;
        }
      } else {
        const errText = await groqRes.text();
        groqErrorDetail = `Groq API trả về HTTP ${groqRes.status}: ${errText.slice(0, 200)}`;
        console.error(`Groq API returned ${groqRes.status}:`, errText);
      }
    } catch (err) {
      groqErrorDetail = err instanceof Error ? err.message : String(err);
      console.error("Groq Whisper API fetch error:", err);
    } finally {
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (unlinkErr) {
          console.warn("Không thể xóa tệp audio tạm:", unlinkErr);
        }
      }
    }
  } else {
    groqErrorDetail = "Không tìm thấy luồng âm thanh hoặc tệp video vật lý để trích xuất audio.";
  }

  // 4. Trích xuất câu THỰC TẾ từ Groq và chuẩn hóa Timeline
  const rawSentences: Sentence[] = [];
  let sIdx = 1;

  for (const seg of rawSegments) {
    const text = seg.text?.trim() || "";
    if (!text || text.length < 2) continue;
    if (/subscribe|ghiền mì gõ|hãy like|đăng ký kênh/i.test(text) && (seg.no_speech_prob ?? 0) > 0.25) {
      continue;
    }

    rawSentences.push({
      id: `S${sIdx.toString().padStart(4, "0")}`,
      start: Number(seg.start.toFixed(1)),
      end: Number(seg.end.toFixed(1)),
      text: text,
    });
    sIdx++;
  }

  if (rawSentences.length === 0) {
    throw new Error(
      groqErrorDetail
        ? `Groq STT thất bại: ${groqErrorDetail}`
        : "Không thể bóc băng lời thoại từ âm thanh video. Vui lòng kiểm tra lại mic/audio nguồn!"
    );
  }

  const filledSentences: Sentence[] = rawSentences;

  // Đánh số lại thứ tự S0001, S0002... chuẩn xác
  const sentences: Sentence[] = filledSentences.map((item, idx) => ({
    ...item,
    id: `S${(idx + 1).toString().padStart(4, "0")}`,
  }));

  const transcriptData: TranscriptData = {
    video: cleanName,
    duration: totalDuration,
    sentences: sentences,
  };

  const segments = generateSegmentsFromSentences(sentences, totalDuration, cleanName, lesson);

  const segmentsData: SegmentsData = {
    video: cleanName,
    lesson: lesson,
    mode: "analyzed",
    reviewed: false,
    segments: segments,
  };

  // 5. Lưu ra file để lần sau dùng lại ngay lập tức
  try {
    const dedicatedFile = path.join(transcriptsDir, `${videoStem}_transcript.json`);
    fs.writeFileSync(dedicatedFile, JSON.stringify(transcriptData, null, 2), "utf-8");
  } catch (saveErr) {
    console.warn("Lỗi khi lưu file transcript:", saveErr);
  }

  return {
    status: "SUCCESS",
    source: "whisper_api",
    transcript: transcriptData,
    segmentsData: segmentsData,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const videoName = searchParams.get("videoName") || "video.mp4";
    const lesson = searchParams.get("lesson") || videoName.replace(/\.[^/.]+$/, "");

    const result = await processTranscription(videoName, lesson, null);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Groq GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawVideoName = (formData.get("videoName") as string) || (file?.name ?? "video.mp4");
    const lesson = (formData.get("lesson") as string) || rawVideoName.replace(/\.[^/.]+$/, "");

    const force = formData.get("force") === "true";
    const videoUrl = (formData.get("url") as string) || undefined;
    const result = await processTranscription(rawVideoName, lesson, file, force, videoUrl);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Groq POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
