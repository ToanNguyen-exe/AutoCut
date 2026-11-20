import test from "node:test";
import assert from "node:assert/strict";

// Giả lập logic URL từ frontend/src/lib/api.ts
function buildDownloadClipUrl(apiBase, filePath, lesson) {
  if (!filePath) return "";
  let clean = filePath.replace(/\\/g, "/");
  const outputIdx = clean.toLowerCase().indexOf("/output/");
  if (outputIdx !== -1) {
    clean = clean.substring(outputIdx + "/output/".length);
  } else if (clean.toLowerCase().startsWith("output/")) {
    clean = clean.substring("output/".length);
  } else if (lesson && !clean.includes("/") && !clean.startsWith(lesson)) {
    clean = `${lesson}/${clean}`;
  }
  return `${apiBase}/download-clip?path=${encodeURIComponent(clean)}`;
}

function buildDownloadZipUrl(apiBase, lesson, user) {
  const cleanLesson = (lesson || "clips").trim();
  const userParam = user ? `&user=${encodeURIComponent(user)}` : "";
  return `${apiBase}/download-zip?lesson=${encodeURIComponent(cleanLesson)}${userParam}`;
}

test("Download Link Tests", async (t) => {
  await t.test("getDownloadClipUrl handles Windows absolute path with backslashes", () => {
    const rawPath = "C:\\Users\\Admin\\Desktop\\modun6\\output\\Bai08\\01_intro.mp4";
    const url = buildDownloadClipUrl("/api/video", rawPath, "Bai08");
    assert.equal(url, "/api/video/download-clip?path=Bai08%2F01_intro.mp4");
  });

  await t.test("getDownloadClipUrl handles Linux Docker relative output path", () => {
    const rawPath = "output/Bai08/01_intro.mp4";
    const url = buildDownloadClipUrl("/api/video", rawPath, "Bai08");
    assert.equal(url, "/api/video/download-clip?path=Bai08%2F01_intro.mp4");
  });

  await t.test("getDownloadClipUrl attaches lesson name if bare filename provided", () => {
    const rawPath = "01_intro.mp4";
    const url = buildDownloadClipUrl("/api/video", rawPath, "Bai08");
    assert.equal(url, "/api/video/download-clip?path=Bai08%2F01_intro.mp4");
  });

  await t.test("getDownloadZipUrl handles special characters and spaces safely", () => {
    const url = buildDownloadZipUrl("/api/video", "Bài 08 - Ép Kiểu");
    assert.equal(url, "/api/video/download-zip?lesson=B%C3%A0i%2008%20-%20%C3%89p%20Ki%E1%BB%83u");
  });

  await t.test("getDownloadZipUrl attaches user query param if provided", () => {
    const url = buildDownloadZipUrl("/api/video", "Bai08", "admin@autocut");
    assert.equal(url, "/api/video/download-zip?lesson=Bai08&user=admin%40autocut");
  });
});
