import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildRenderSegmentsPayload } from "../src/lib/mergeSelection.ts";
import {
  API_BASE,
  submitRenderSegments,
  getDownloadSelectedZipUrl,
} from "../src/lib/api.ts";
import { setAccessToken } from "../src/lib/http.ts";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "..");

test("buildRenderSegmentsPayload converts timeline offsets into local video offsets and attaches per-clip sources", () => {
  const joinedVideos = [
    {
      id: "c1",
      title: "Bài 08",
      fileName: "Bai08_Ep_kieu_du_lieu.mp4",
      url: "/videos/Bai08_Ep_kieu_du_lieu.mp4",
      duration: 535,
      startOffset: 0,
      endOffset: 535,
    },
    {
      id: "c2",
      title: "Clip 2",
      fileName: "clip2.mp4",
      url: "/api/video/stream/1809023fa1af6117a14ebaf58d56f8166d4d4e2f8466ce99a1c1f3230ddf282f",
      duration: 120,
      startOffset: 535,
      endOffset: 655,
    },
  ];

  const selectedSegments = [
    {
      id: "seg_2",
      section_no: 2,
      section: "02_Clip2",
      topic_no: 2,
      topic: "Đoạn video 2",
      slug: "doan-video-2",
      start_id: "S3",
      end_id: "S4",
      start: 545,
      end: 605,
      parts: [
        {
          part: 1,
          start: 545,
          end: 605,
          file: "02_Clip2/02_doan-video-2.mp4",
        },
      ],
    },
  ];

  const payloadSegs = buildRenderSegmentsPayload(selectedSegments, joinedVideos, {
    videoName: "Bai08_Ep_kieu_du_lieu.mp4 & clip2.mp4",
    videoHash: "cafd6ea8e7e70e2cc9fee826eacbb4f1443e13032676d104ef4a8bdf4236d7f2",
  });

  assert.equal(payloadSegs.length, 1);
  assert.equal(payloadSegs[0].start, 10);
  assert.equal(payloadSegs[0].end, 70);
  assert.equal(payloadSegs[0].parts[0].start, 10);
  assert.equal(payloadSegs[0].parts[0].end, 70);
  assert.equal(payloadSegs[0].videoName, "clip2.mp4");
  assert.equal(
    payloadSegs[0].videoHash,
    "1809023fa1af6117a14ebaf58d56f8166d4d4e2f8466ce99a1c1f3230ddf282f"
  );
});

test("submitRenderSegments extracts structured error.message and passes videoHash/autoConcat", async (t) => {
  const prevFetch = globalThis.fetch;
  setAccessToken("jwt-render-test");
  t.after(() => {
    setAccessToken(null);
    globalThis.fetch = prevFetch;
  });

  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    if (String(url) === `${API_BASE}/render`) {
      capturedBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          error: { code: "TOKEN_EXPIRED", message: "Phiên đăng nhập đã hết hạn." },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("{}", { status: 404 });
  };

  const res = await submitRenderSegments({
    video: "demo.mp4",
    videoHash: "a".repeat(64),
    videoUrl: "/api/video/stream/" + "a".repeat(64),
    lesson: "Demo",
    mode: "analyzed",
    reviewed: true,
    autoConcat: false,
    segments: [],
  });

  assert.equal(res.success, false);
  assert.equal(res.message, "Phiên đăng nhập đã hết hạn.");
  assert.equal(capturedBody.videoHash, "a".repeat(64));
  assert.equal(capturedBody.autoConcat, false);
});

test("getDownloadSelectedZipUrl includes selected paths and ticket", () => {
  const url = getDownloadSelectedZipUrl(
    "Bài 08",
    ["Bài 08/clip_1.mp4", "Bài 08/clip_2.mp4"],
    "admin",
    "tk_123"
  );
  assert.ok(url.includes("/download-zip?lesson="));
  assert.ok(url.includes("paths="));
  assert.ok(url.includes("ticket=tk_123"));
});

test("Cách 2: StudioHeader & page.tsx & ExportProgressModal hỗ trợ xuất đúng các đoạn đã chọn", () => {
  const pageSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/app/page.tsx"), "utf-8");
  const headerSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/components/StudioHeader.tsx"), "utf-8");
  const modalSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/components/ExportProgressModal.tsx"), "utf-8");

  assert.ok(
    headerSource.includes("selectedExportCount"),
    "StudioHeader phải hiển thị số đoạn đang chọn để Export theo Cách 2"
  );
  assert.ok(
    pageSource.includes("buildRenderSegmentsPayload("),
    "page.tsx phải ánh xạ đúng nguồn & offset cho các đoạn được chọn khi Export"
  );
  assert.ok(
    modalSource.includes("onStartSelectedExport"),
    "ExportProgressModal phải hỗ trợ bước chọn đoạn khi người dùng chưa tick trên Timeline"
  );
});

test("buildRenderSegmentsPayload gộp nhiều parts (_Phan1/_Phan2) của 1 segment thành 1 file duy nhất khi Export", () => {
  const mergedSegWithSplitParts = {
    id: "seg_04",
    section_no: 2,
    section: "02_ly-thuyet",
    topic_no: 4,
    topic: "Kết nối backend database & Google apps",
    slug: "ket-noi-backend-database-va-google-apps",
    start_id: "S1",
    end_id: "S10",
    start: 100,
    end: 658,
    parts: [
      { part: 1, start: 100, end: 394, file: "02_ly-thuyet/04_ket-noi-backend-database-va-google-apps_Phan1.mp4" },
      { part: 2, start: 394, end: 658, file: "02_ly-thuyet/04_ket-noi-backend-database-va-google-apps_Phan2.mp4" },
    ],
  };

  const payload = buildRenderSegmentsPayload([mergedSegWithSplitParts], [], {
    videoName: "lecture.mp4",
  });

  assert.equal(payload.length, 1);
  assert.equal(payload[0].parts.length, 1, "1 phân đoạn trên timeline khi xuất phải ra 1 file MP4 duy nhất");
  assert.equal(payload[0].parts[0].start, 100);
  assert.equal(payload[0].parts[0].end, 658);
  assert.equal(
    payload[0].parts[0].file,
    "02_ly-thuyet/04_ket-noi-backend-database-va-google-apps.mp4"
  );
});
