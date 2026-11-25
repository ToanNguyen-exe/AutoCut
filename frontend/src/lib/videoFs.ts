import fs from "node:fs";
import path from "node:path";
import type { TranscriptData } from "@/types";
import {
  matchCandidateStreamFile,
  normalizeVideoKey,
} from "./videoMatching.ts";

export interface MatchedTranscript {
  file: string;
  content: TranscriptData;
}

/**
 * Tìm transcript (kèm tên file đã khớp) tương ứng với tên video, bảo vệ số đuôi (Download (1)..(4)).
 */
export function findExistingTranscriptMatch(
  projectRoot: string,
  videoName: string
): MatchedTranscript | null {
  const clean = videoName.replace(/^[0-9a-fA-F]{64}_/, "");
  const stem = path.parse(clean).name.toLowerCase();
  const targetNorm = normalizeVideoKey(stem);

  const searchDirs = [
    path.join(projectRoot, "transcripts"),
    path.join(projectRoot, "backend", "transcripts"),
    path.join(projectRoot, "cache"),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);

    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const fStem = f.replace(/_transcript\.json$/, "").replace(/\.json$/, "").toLowerCase();
      const fNorm = normalizeVideoKey(fStem);
      if (fStem === stem || fNorm === targetNorm) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as TranscriptData;
          if (content && Array.isArray(content.sentences) && content.sentences.length > 0) {
            const first = content.sentences[0]?.text || "";
            if (first.includes("Nội dung bóc băng của video")) continue;
            return { file: f, content };
          }
        } catch {
          // Bỏ qua file JSON lỗi
        }
      }
    }

    if (targetNorm.includes("bai08") || targetNorm.includes("epkieu")) {
      const match = files.find(
        (f) => f.toLowerCase().includes("ep_kieu") || f.toLowerCase().includes("ep-kieu")
      );
      if (match) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, match), "utf-8")) as TranscriptData;
          if (content && Array.isArray(content.sentences) && content.sentences.length > 0) {
            return { file: match, content };
          }
        } catch {}
      }
    }

    if (targetNorm.includes("bai07") || targetNorm.includes("bien")) {
      const match = files.find(
        (f) => f.toLowerCase().includes("bai07") || f.toLowerCase().includes("bien")
      );
      if (match) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, match), "utf-8")) as TranscriptData;
          if (content && Array.isArray(content.sentences) && content.sentences.length > 0) {
            return { file: match, content };
          }
        } catch {}
      }
    }

    const targetDigits = (targetNorm.match(/\d+$/) || [""])[0];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const fStem = f.replace(/_transcript\.json$/, "").replace(/\.json$/, "").toLowerCase();
      const fNorm = normalizeVideoKey(fStem);
      const fDigits = (fNorm.match(/\d+$/) || [""])[0];

      if (targetDigits && fDigits && targetDigits !== fDigits) continue;
      if (!targetDigits && fDigits && fNorm.startsWith(targetNorm)) continue;

      if (fNorm && (fNorm.includes(targetNorm) || targetNorm.includes(fNorm))) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as TranscriptData;
          if (content && Array.isArray(content.sentences) && content.sentences.length > 0) {
            return { file: f, content };
          }
        } catch {}
      }
    }
  }

  return null;
}

export function findExistingTranscript(
  projectRoot: string,
  videoName: string
): TranscriptData | null {
  return findExistingTranscriptMatch(projectRoot, videoName)?.content ?? null;
}

export function resolveStreamFile(
  projectRoot: string,
  fileParam: string,
  hashParam = ""
): string | null {
  const candidateDirs = [
    path.join(projectRoot, "public", "videos"),
    path.join(projectRoot, "frontend", "public", "videos"),
    path.join(projectRoot, "uploads"),
    path.join(projectRoot, "..", "uploads"),
    path.join(projectRoot, "backend", "uploads"),
    path.join(projectRoot, "..", "backend", "uploads"),
  ];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      if (hashParam) {
        const byHash = files.find((f) => f.toLowerCase().startsWith(hashParam.toLowerCase()));
        if (byHash) return path.join(dir, byHash);
      }

      if (fileParam) {
        const matched = matchCandidateStreamFile(files, fileParam);
        if (matched) return path.join(dir, matched);

        const cleanFile = fileParam.trim().toLowerCase();
        if (cleanFile.includes("bai08") || cleanFile.includes("ep_kieu")) {
          const found08 = files.find((f) => /bai08|ep[-_]kieu|ytsave/i.test(f));
          if (found08) return path.join(dir, found08);
        } else if (cleanFile.includes("bai07") || cleanFile.includes("bien")) {
          const found07 = files.find((f) => /bai07|bien/i.test(f));
          if (found07) return path.join(dir, found07);
        } else if (cleanFile.includes("bai09") || cleanFile.includes("chuoi")) {
          const found09 = files.find((f) => /bai09|chuoi/i.test(f));
          if (found09) return path.join(dir, found09);
        }
      }
    } catch {
      // Thử thư mục tiếp theo
    }
  }

  return null;
}
