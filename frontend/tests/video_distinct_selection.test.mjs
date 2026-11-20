import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 1. Kiểm tra cleanStem và isExactDownloadMusicVideo
const cleanStem = (s) =>
  (s || "").toLowerCase().trim().replace(/\.[^/.]+$/, "").replace(/[\s_\(\)\-]+/g, "");

const isExactDownloadMusicVideo = (name, title) => {
  if (!name && !title) return false;
  const sName = cleanStem(name || "");
  const sTitle = cleanStem(title || "");
  return sName === "download" || sTitle === "download";
};

test("cleanStem distinguishes Download (1), (2), (3), (4), and Download", () => {
  assert.equal(cleanStem("Download (1)"), "download1");
  assert.equal(cleanStem("Download (1).mp4"), "download1");
  assert.equal(cleanStem("Download (2)"), "download2");
  assert.equal(cleanStem("Download (2).mp4"), "download2");
  assert.equal(cleanStem("Download (3)"), "download3");
  assert.equal(cleanStem("Download (3).mp4"), "download3");
  assert.equal(cleanStem("Download (4)"), "download4");
  assert.equal(cleanStem("download_4.mp4"), "download4");
  assert.equal(cleanStem("Download.mp4"), "download");
  assert.equal(cleanStem("Download"), "download");

  // Đảm bảo không trùng nhau
  const stems = new Set([
    cleanStem("Download (1)"),
    cleanStem("Download (2)"),
    cleanStem("Download (3)"),
    cleanStem("Download (4)"),
    cleanStem("Download"),
  ]);
  assert.equal(stems.size, 5, "Mỗi video phải có stem phân biệt độc lập");
});

test("isExactDownloadMusicVideo only matches download.mp4 and NOT Download (1..4)", () => {
  assert.equal(isExactDownloadMusicVideo("Download.mp4", "Download"), true);
  assert.equal(isExactDownloadMusicVideo("Download", "Download"), true);

  assert.equal(isExactDownloadMusicVideo("Download (1)", "Download (1)"), false);
  assert.equal(isExactDownloadMusicVideo("Download (1).mp4", "Download (1)"), false);
  assert.equal(isExactDownloadMusicVideo("Download (2)", "Download (2)"), false);
  assert.equal(isExactDownloadMusicVideo("Download (3)", "Download (3)"), false);
  assert.equal(isExactDownloadMusicVideo("Download (4)", "Download (4)"), false);
  assert.equal(isExactDownloadMusicVideo("download_4.mp4", "Download (4)"), false);
});

// 2. Kiểm tra bộ giải quyết Transcript tìm đúng file riêng cho từng video
function findExistingTranscript(projectRoot, videoName) {
  const clean = videoName.replace(/^[0-9a-fA-F]{64}_/, "");
  const stem = path.parse(clean).name.toLowerCase();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetNorm = norm(stem);

  const searchDirs = [
    path.join(projectRoot, "transcripts"),
    path.join(projectRoot, "backend", "transcripts"),
    path.join(projectRoot, "cache"),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);

    // 1. Khớp tên chính xác
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const fStem = f.replace(/_transcript\.json$/, "").replace(/\.json$/, "").toLowerCase();
      const fNorm = norm(fStem);
      if (fStem === stem || fNorm === targetNorm) {
        const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        return { file: f, content };
      }
    }

    // 3. Khớp tương đối có bảo vệ số đuôi
    const targetDigits = (targetNorm.match(/\d+$/) || [""])[0];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const fStem = f.replace(/_transcript\.json$/, "").replace(/\.json$/, "").toLowerCase();
      const fNorm = norm(fStem);
      const fDigits = (fNorm.match(/\d+$/) || [""])[0];

      if (targetDigits && fDigits && targetDigits !== fDigits) continue;
      if (!targetDigits && fDigits && fNorm.startsWith(targetNorm)) continue;

      if (fNorm.includes(targetNorm) || targetNorm.includes(fNorm)) {
        const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        return { file: f, content };
      }
    }
  }
  return null;
}

test("findExistingTranscript resolves each video to its own unique transcript", () => {
  const root = path.resolve(".");
  const t1 = findExistingTranscript(root, "Download (1)");
  const t2 = findExistingTranscript(root, "Download (2)");
  const t3 = findExistingTranscript(root, "Download (3)");
  const t4 = findExistingTranscript(root, "Download (4)");

  assert.ok(t1, "Transcript Download (1) phải tồn tại");
  assert.ok(t2, "Transcript Download (2) phải tồn tại");
  assert.ok(t3, "Transcript Download (3) phải tồn tại");
  assert.ok(t4, "Transcript Download (4) phải tồn tại");

  assert.equal(t1.file, "Download (1)_transcript.json");
  assert.equal(t2.file, "Download (2)_transcript.json");
  assert.equal(t3.file, "Download (3)_transcript.json");
  assert.equal(t4.file, "download_4_transcript.json");

  // Kiểm tra nội dung câu thoại đầu tiên khác biệt hoàn toàn
  const s1Text = t1.content.sentences[0].text;
  const s2Text = t2.content.sentences[0].text;
  const s3Text = t3.content.sentences[0].text;
  const s4Text = t4.content.sentences[0].text;

  assert.notEqual(s1Text, s4Text, "Download (1) không được dùng câu thoại của Download (4)");
  assert.notEqual(s2Text, s4Text, "Download (2) không được dùng câu thoại của Download (4)");
  assert.notEqual(s3Text, s4Text, "Download (3) không được dùng câu thoại của Download (4)");
});

// 3. Kiểm tra bộ phân giải Stream Video (/api/stream)
function resolveStreamFile(projectRoot, fileParam) {
  const candidateDirs = [
    path.join(projectRoot, "public", "videos"),
    path.join(projectRoot, "frontend", "public", "videos"),
    path.join(projectRoot, "uploads"),
    path.join(projectRoot, "backend", "uploads"),
  ];

  const norm = (s) =>
    s.toLowerCase().replace(/[\s_\(\)\-\.]/g, "").replace(/mp4$/g, "");

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    const cleanFile = fileParam.trim().toLowerCase();

    const foundExact = files.find((f) => f.toLowerCase() === cleanFile);
    if (foundExact) return foundExact;

    const targetNorm = norm(cleanFile);
    if (targetNorm) {
      const targetDigits = (targetNorm.match(/\d+$/) || [""])[0];
      const foundNorm = files.find((f) => {
        const fNorm = norm(f);
        const fDigits = (fNorm.match(/\d+$/) || [""])[0];
        if (targetDigits && fDigits && targetDigits !== fDigits) return false;
        if (!targetDigits && fDigits && fNorm.endsWith(targetNorm + fDigits)) return false;
        return fNorm.endsWith(targetNorm);
      });
      if (foundNorm) return foundNorm;
    }
  }
  return null;
}

test("resolveStreamFile streams distinct video files for Download (1), (2), (3), (4)", () => {
  const root = path.resolve(".");
  const v1 = resolveStreamFile(root, "Download (1)");
  const v2 = resolveStreamFile(root, "Download (2)");
  const v3 = resolveStreamFile(root, "Download (3)");
  const v4 = resolveStreamFile(root, "Download (4)");
  const v4_mp4 = resolveStreamFile(root, "Download (4).mp4");

  assert.ok(v1 && v1.includes("Download (1)"), `v1 must match Download (1), got ${v1}`);
  assert.ok(v2 && v2.includes("Download (2)"), `v2 must match Download (2), got ${v2}`);
  assert.ok(v3 && v3.includes("Download (3)"), `v3 must match Download (3), got ${v3}`);
  assert.ok(v4 && v4.includes("download_4"), `v4 must match download_4, got ${v4}`);
  assert.ok(v4_mp4 && v4_mp4.includes("download_4"), `v4_mp4 must match download_4, got ${v4_mp4}`);

  // Tất cả 4 video file phải khác nhau
  const filesSet = new Set([v1, v2, v3, v4]);
  assert.equal(filesSet.size, 4, "Tất cả 4 video stream phải là các tệp độc lập");
});
