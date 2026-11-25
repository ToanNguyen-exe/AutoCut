/**
 * Hàm khớp tên video và stem an toàn (dùng chung cho UI thư viện video và route server/tests).
 */

export function cleanVideoStem(input: string): string {
  return (input || "")
    .toLowerCase()
    .trim()
    .replace(/\.[^/.]+$/, "")
    .replace(/[\s_()-]+/g, "");
}

export function normalizeVideoKey(input: string): string {
  return (input || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeStreamFileKey(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[\s_().-]/g, "")
    .replace(/mp4$/g, "");
}

/**
 * Chỉ khớp đúng video ca nhạc `Download.mp4`, không khớp nhầm `Download (1)..(4)`.
 */
export function isExactDownloadMusicVideo(name?: string | null, title?: string | null): boolean {
  if (!name && !title) return false;
  const sName = cleanVideoStem(name || "");
  const sTitle = cleanVideoStem(title || "");
  return sName === "download" || sTitle === "download";
}

export function matchCandidateStreamFile(files: string[], fileParam: string): string | null {
  const cleanFile = fileParam.trim().toLowerCase();
  if (!cleanFile) return null;

  const foundExact = files.find((f) => f.toLowerCase() === cleanFile);
  if (foundExact) return foundExact;

  const targetNorm = normalizeStreamFileKey(cleanFile);
  if (!targetNorm) return null;

  const targetDigits = (targetNorm.match(/\d+$/) || [""])[0];
  const foundNorm = files.find((f) => {
    const fNorm = normalizeStreamFileKey(f);
    const fDigits = (fNorm.match(/\d+$/) || [""])[0];
    if (targetDigits && fDigits && targetDigits !== fDigits) return false;
    if (!targetDigits && fDigits && fNorm.endsWith(targetNorm + fDigits)) return false;
    return fNorm.endsWith(targetNorm);
  });
  return foundNorm || null;
}
