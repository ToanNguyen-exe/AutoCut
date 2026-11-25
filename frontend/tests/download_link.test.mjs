import test from "node:test";
import assert from "node:assert/strict";
import {
  API_BASE,
  getDownloadClipUrl,
  getDownloadZipUrl,
} from "../src/lib/api.ts";

test("Download Link Tests (real api.ts)", async (t) => {
  await t.test("getDownloadClipUrl handles Windows absolute path with backslashes", () => {
    const rawPath = "C:\\Users\\Admin\\Desktop\\modun6\\output\\Bai08\\01_intro.mp4";
    const url = getDownloadClipUrl(rawPath, "Bai08");
    assert.equal(url, `${API_BASE}/download-clip?path=Bai08%2F01_intro.mp4`);
  });

  await t.test("getDownloadClipUrl handles Linux Docker relative output path", () => {
    const rawPath = "output/Bai08/01_intro.mp4";
    const url = getDownloadClipUrl(rawPath, "Bai08");
    assert.equal(url, `${API_BASE}/download-clip?path=Bai08%2F01_intro.mp4`);
  });

  await t.test("getDownloadClipUrl attaches lesson name and optional short-lived ticket", () => {
    const rawPath = "01_intro.mp4";
    const url = getDownloadClipUrl(rawPath, "Bai08", "ticket_abc");
    assert.equal(url, `${API_BASE}/download-clip?path=Bai08%2F01_intro.mp4&ticket=ticket_abc`);
  });

  await t.test("getDownloadZipUrl handles special characters and spaces safely", () => {
    const url = getDownloadZipUrl("Bài 08 - Ép Kiểu");
    assert.equal(url, `${API_BASE}/download-zip?lesson=B%C3%A0i%2008%20-%20%C3%89p%20Ki%E1%BB%83u`);
  });

  await t.test("getDownloadZipUrl attaches user query param and optional ticket", () => {
    const url = getDownloadZipUrl("Bai08", "gv@truong.edu.vn", "t_zip");
    assert.equal(url, `${API_BASE}/download-zip?lesson=Bai08&user=gv%40truong.edu.vn&ticket=t_zip`);
  });
});
