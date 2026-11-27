import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanVideoStem,
  isExactDownloadMusicVideo,
} from "../src/lib/videoMatching.ts";
import {
  findExistingTranscriptMatch,
  resolveStreamFile,
} from "../src/lib/videoFs.ts";

test("cleanVideoStem thật phân biệt rạch ròi Download (1)..(4) và Download", () => {
  assert.equal(cleanVideoStem("Download (1)"), "download1");
  assert.equal(cleanVideoStem("Download (1).mp4"), "download1");
  assert.equal(cleanVideoStem("Download (2)"), "download2");
  assert.equal(cleanVideoStem("Download (3)"), "download3");
  assert.equal(cleanVideoStem("Download (4)"), "download4");
  assert.equal(cleanVideoStem("download_4.mp4"), "download4");
  assert.equal(cleanVideoStem("Download.mp4"), "download");
  assert.equal(cleanVideoStem("Download"), "download");

  const stems = new Set([
    cleanVideoStem("Download (1)"),
    cleanVideoStem("Download (2)"),
    cleanVideoStem("Download (3)"),
    cleanVideoStem("Download (4)"),
    cleanVideoStem("Download"),
  ]);
  assert.equal(stems.size, 5, "Mỗi video phải có stem phân biệt độc lập");
});

test("isExactDownloadMusicVideo thật chỉ khớp đúng Download.mp4 và KHÔNG khớp Download (1..4)", () => {
  assert.equal(isExactDownloadMusicVideo("Download.mp4", "Download"), true);
  assert.equal(isExactDownloadMusicVideo("Download", "Download"), true);

  assert.equal(isExactDownloadMusicVideo("Download (1)", "Download (1)"), false);
  assert.equal(isExactDownloadMusicVideo("Download (2).mp4", "Download (2)"), false);
  assert.equal(isExactDownloadMusicVideo("Download (3)", "Download (3)"), false);
  assert.equal(isExactDownloadMusicVideo("download_4.mp4", "Download (4)"), false);
});

test("findExistingTranscript & resolveStreamFile thật phân giải đúng trên thư mục fixture cô lập", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autocut-video-match-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const transDir = path.join(tmpRoot, "transcripts");
  const uploadDir = path.join(tmpRoot, "uploads");
  fs.mkdirSync(transDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  for (const [idx, fname] of [
    [1, "Download (1)_transcript.json"],
    [2, "Download (2)_transcript.json"],
    [3, "Download (3)_transcript.json"],
    [4, "download_4_transcript.json"],
  ]) {
    fs.writeFileSync(
      path.join(transDir, fname),
      JSON.stringify({ sentences: [{ id: "S0001", text: `Nội dung video ${idx}` }] })
    );
  }

  for (const fname of [
    "aaaa_Download (1).mp4",
    "bbbb_Download (2).mp4",
    "cccc_Download (3).mp4",
    "dddd_download_4.mp4",
  ]) {
    fs.writeFileSync(path.join(uploadDir, fname), "stub-mp4");
  }

  const t1 = findExistingTranscriptMatch(tmpRoot, "Download (1)");
  const t2 = findExistingTranscriptMatch(tmpRoot, "Download (2)");
  const t3 = findExistingTranscriptMatch(tmpRoot, "Download (3)");
  const t4 = findExistingTranscriptMatch(tmpRoot, "Download (4)");

  assert.equal(t1?.file, "Download (1)_transcript.json");
  assert.equal(t2?.file, "Download (2)_transcript.json");
  assert.equal(t3?.file, "Download (3)_transcript.json");
  assert.equal(t4?.file, "download_4_transcript.json");
  assert.notEqual(t1?.content.sentences[0].text, t4?.content.sentences[0].text);

  const v1 = resolveStreamFile(tmpRoot, "Download (1)");
  const v2 = resolveStreamFile(tmpRoot, "Download (2)");
  const v3 = resolveStreamFile(tmpRoot, "Download (3)");
  const v4 = resolveStreamFile(tmpRoot, "Download (4).mp4");

  assert.ok(v1 && v1.endsWith("aaaa_Download (1).mp4"));
  assert.ok(v2 && v2.endsWith("bbbb_Download (2).mp4"));
  assert.ok(v3 && v3.endsWith("cccc_Download (3).mp4"));
  assert.ok(v4 && v4.endsWith("dddd_download_4.mp4"));
  assert.equal(new Set([v1, v2, v3, v4]).size, 4);
});
