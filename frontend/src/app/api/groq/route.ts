import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import cp from "child_process";
import { Sentence, TranscriptData, Segment, SegmentsData } from "@/types";
import { recalculateParts } from "@/lib/utils";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawVideoName = (formData.get("videoName") as string) || (file?.name ?? "video.mp4");
    const lesson = (formData.get("lesson") as string) || rawVideoName.replace(/\.[^/.]+$/, "");

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Chưa cấu hình GROQ_API_KEY" },
        { status: 400 }
      );
    }

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

    let audioBuffer: Buffer | null = null;
    let tempAudioPath: string | null = null;

    // 1. Chuẩn bị file âm thanh (MP3 64k mono < 25MB)
    if (file && file.size > 0) {
      const tempVideo = path.join(cacheDir, `upload_${Date.now()}_${cleanName}`);
      const arrayBuf = await file.arrayBuffer();
      fs.writeFileSync(tempVideo, Buffer.from(arrayBuf));

      tempAudioPath = path.join(cacheDir, `audio_${Date.now()}_${videoStem}.mp3`);
      try {
        cp.execSync(`ffmpeg -y -i "${tempVideo}" -vn -ar 16000 -ac 1 -b:a 64k "${tempAudioPath}"`);
        audioBuffer = fs.readFileSync(tempAudioPath);
      } catch (err) {
        console.warn("FFmpeg extract warning for uploaded file:", err);
      } finally {
        try { if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo); } catch { }
      }
    }

    // Nếu không có file tải lên trong form, quét tìm video trong thư mục uploads
    if (!audioBuffer) {
      const searchDirs = [
        path.join(projectRoot, "uploads"),
        path.join(projectRoot, "backend", "uploads"),
      ];

      let foundVideoPath: string | null = null;
      for (const dir of searchDirs) {
        if (!fs.existsSync(dir)) continue;
        const dirFiles = fs.readdirSync(dir);
        // Tìm file khớp chính xác hoặc khớp phần đuôi tên video
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
          cp.execSync(`ffmpeg -y -i "${foundVideoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${tempAudioPath}"`);
          audioBuffer = fs.readFileSync(tempAudioPath);
        } catch (err) {
          console.warn("FFmpeg extract warning for existing file:", err);
        }
      }
    }

    let rawSegments: Array<{ id: number; start: number; end: number; text: string; no_speech_prob?: number }> = [];
    let totalDuration = 180.0;

    // 2. Gọi Groq Whisper API nếu có âm thanh
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
          console.error(`Groq API returned ${groqRes.status}:`, errText);
        }
      } catch (err) {
        console.error("Groq Whisper API fetch error:", err);
      } finally {
        if (tempAudioPath && fs.existsSync(tempAudioPath)) {
          try { fs.unlinkSync(tempAudioPath); } catch { }
        }
      }
    }

    // 3. Trích xuất câu THỰC TẾ từ Groq (không dùng dữ liệu cố định)
    const sentences: Sentence[] = [];
    let sIdx = 1;

    for (const seg of rawSegments) {
      const text = seg.text?.trim() || "";
      if (!text || text.length < 2) continue;
      // Lọc bỏ câu watermark ảo giác Whisper (nếu no_speech_prob cao)
      if (/subscribe|ghiền mì gõ|hãy like|đăng ký kênh/i.test(text) && (seg.no_speech_prob ?? 0) > 0.25) {
        continue;
      }

      sentences.push({
        id: `S${sIdx.toString().padStart(4, "0")}`,
        start: Number(seg.start.toFixed(1)),
        end: Number(seg.end.toFixed(1)),
        text: text,
      });
      sIdx++;
    }

    // Nếu là video nhạc hoàn toàn không có lời thoại
    if (sentences.length === 0) {
      sentences.push({
        id: "S0001",
        start: 0.0,
        end: totalDuration,
        text: `Âm thanh nhạc nền / Giọng điệu (Video ${cleanName})`,
      });
    }

    const transcriptData: TranscriptData = {
      video: cleanName,
      duration: totalDuration,
      sentences: sentences,
    };

    // 4. Chia phân đoạn thông minh linh hoạt theo lời thoại thực tế
    const segments: Segment[] = [];
    const numSections = Math.min(5, Math.max(3, Math.ceil(sentences.length / 3)));
    const sentencesPerSection = Math.ceil(sentences.length / numSections);

    for (let i = 0; i < numSections; i++) {
      const startIdx = i * sentencesPerSection;
      const endIdx = Math.min(sentences.length, (i + 1) * sentencesPerSection);
      if (startIdx >= sentences.length) break;

      const group = sentences.slice(startIdx, endIdx);
      const segStart = i === 0 ? 0 : group[0].start;
      const segEnd = i === numSections - 1 ? totalDuration : group[group.length - 1].end;
      const secNo = i + 1;
      const secName = `0${secNo}_Doan_${secNo}`;

      // Lấy câu đầu tiên làm chủ đề phân đoạn
      const topicText = group[0]?.text
        ? group[0].text.slice(0, 50).trim()
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

    const segmentsData: SegmentsData = {
      video: cleanName,
      lesson: lesson,
      mode: "analyzed",
      reviewed: false,
      segments: segments,
    };

    // 5. Lưu ra các file đồng bộ
    try {
      const dedicatedFile = path.join(transcriptsDir, `${videoStem}_transcript.json`);
      fs.writeFileSync(dedicatedFile, JSON.stringify(transcriptData, null, 2), "utf-8");

      const rootFile = path.join(projectRoot, "transcript.json");
      fs.writeFileSync(rootFile, JSON.stringify(transcriptData, null, 2), "utf-8");
    } catch (saveErr) {
      console.warn("Lỗi khi lưu file transcript:", saveErr);
    }

    return NextResponse.json({
      status: "SUCCESS",
      transcript: transcriptData,
      segmentsData: segmentsData,
    });
  } catch (error) {
    console.error("Groq API route internal error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
