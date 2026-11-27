import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  toggleSelectedSegmentId,
  reconcileSelectedSegmentIds,
  getCheckedSegmentsInOrder,
  canMergeSelectedSegments,
  buildMergeClipItems,
  getTimelineMergeValidation,
  mergeTimelineSegments,
} from "../src/lib/mergeSelection.ts";
import { API_BASE, mergeSelectedClipsBackend } from "../src/lib/api.ts";
import { setAccessToken } from "../src/lib/http.ts";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "..");

const sampleSegments = [
  { id: "seg_1", section_no: 1, section: "01", topic_no: 1, topic: "Mở đầu", slug: "mo-dau", start_id: "S1", end_id: "S2", start: 0, end: 20, parts: [] },
  { id: "seg_2", section_no: 1, section: "01", topic_no: 2, topic: "Khái niệm", slug: "khai-niem", start_id: "S3", end_id: "S4", start: 20, end: 50, parts: [] },
  { id: "seg_3", section_no: 1, section: "01", topic_no: 3, topic: "Ví dụ", slug: "vi-du", start_id: "S5", end_id: "S6", start: 50, end: 90, parts: [] },
  { id: "seg_4", section_no: 1, section: "01", topic_no: 4, topic: "Tổng kết", slug: "tong-ket", start_id: "S7", end_id: "S8", start: 90, end: 120, parts: [] },
];

test("mergeSelection helpers toggle, require >= 2 segments, preserve timeline order, and drop deleted IDs", () => {
  let checked = [];
  assert.equal(canMergeSelectedSegments(checked), false);

  checked = toggleSelectedSegmentId(checked, "seg_4");
  assert.deepEqual(checked, ["seg_4"]);
  assert.equal(canMergeSelectedSegments(checked), false, "Chỉ tích 1 đoạn chưa đủ để gộp");

  // Tích thêm đoạn không liền kề (seg_4 và seg_1)
  checked = toggleSelectedSegmentId(checked, "seg_1");
  assert.equal(canMergeSelectedSegments(checked), true);
  assert.deepEqual(
    getCheckedSegmentsInOrder(sampleSegments, checked).map((s) => s.id),
    ["seg_1", "seg_4"],
    "Phải giữ đúng thứ tự thời gian trên timeline dù tích ngược"
  );

  // Tích lại seg_4 để bỏ chọn
  checked = toggleSelectedSegmentId(checked, "seg_4");
  assert.deepEqual(checked, ["seg_1"]);
  assert.equal(canMergeSelectedSegments(checked), false);

  // Khi seg_1 bị xóa khỏi segments -> reconcile tự loại ID đã xóa
  const remaining = sampleSegments.filter((s) => s.id !== "seg_1");
  assert.deepEqual(reconcileSelectedSegmentIds(["seg_1", "seg_3"], remaining), ["seg_3"]);
});

test("mergeSelectedClipsBackend calls POST /merge-clips with Bearer JWT and fetches protected download ticket", async (t) => {
  const prevFetch = globalThis.fetch;
  setAccessToken("jwt-merge-token");
  t.after(() => {
    setAccessToken(null);
    globalThis.fetch = prevFetch;
  });

  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({
      url: String(url),
      method: init?.method,
      auth: new Headers(init?.headers).get("Authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });

    if (String(url) === `${API_BASE}/merge-clips`) {
      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          message: "Đã gộp thành công 2 đoạn thành 1 clip!",
          file: "merged_123.mp4",
          outputFile: "combined/merged_123.mp4",
          downloadUrl: "/api/video/download-clip?path=combined/merged_123.mp4",
          outputSizeBytes: 4096,
          executionTimeMs: 180,
          mergedCount: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (String(url).endsWith("/api/v1/auth/tickets")) {
      return new Response(JSON.stringify({ ticket: "dl_ticket_999" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("{}", { status: 404 });
  };

  // Không cho gửi nếu dưới 2 phân đoạn
  const invalidRes = await mergeSelectedClipsBackend({
    videoName: "Bai08.mp4",
    lesson: "Bài 08",
    segments: [{ start: 0, end: 20, topic: "Mở đầu" }],
  });
  assert.equal(invalidRes.source, "fallback");
  assert.equal(requests.length, 0);

  // Gửi >= 2 phân đoạn (cách quãng) -> gọi merge-clips + xin ticket tải file
  const okRes = await mergeSelectedClipsBackend({
    videoName: "Bai08.mp4",
    lesson: "Bài 08 - Ép kiểu",
    segments: [
      { start: 0, end: 20, topic: "Mở đầu" },
      { start: 50, end: 90, topic: "Ví dụ" },
    ],
  });

  assert.equal(okRes.source, "api");
  assert.equal(okRes.data?.outputFile, "combined/merged_123.mp4");
  assert.ok(okRes.data?.protectedDownloadUrl?.includes("ticket=dl_ticket_999"));
  assert.equal(requests[0].auth, "Bearer jwt-merge-token");
  assert.equal(requests[1].body.purpose, "DOWNLOAD");
  assert.equal(requests[1].body.resource_id, "combined/merged_123.mp4");
});

test("StudioTimeline.tsx renders segment checkboxes and a Gộp button on the timeline toolbar", () => {
  const timelineSource = fs.readFileSync(
    path.join(FRONTEND_ROOT, "src/components/StudioTimeline.tsx"),
    "utf-8"
  );
  assert.ok(timelineSource.includes('role="checkbox"'), "Mỗi đoạn trên timeline phải có checkbox tích chọn");
  assert.ok(timelineSource.includes("onMergeSelectedClips"), "StudioTimeline phải có prop onMergeSelectedClips");
  assert.ok(timelineSource.includes("Gộp"), "Toolbar timeline phải có nút Gộp ngay phía trên");
});

test("buildMergeClipItems maps timeline offsets to each joinedVideo source and ignores stale hash across clips", () => {
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
      title: "Download 1",
      fileName: "Download (1).mp4",
      url: "/api/video/stream/1809023fa1af6117a14ebaf58d56f8166d4d4e2f8466ce99a1c1f3230ddf282f?ticket=old",
      duration: 227,
      startOffset: 535,
      endOffset: 762,
    },
  ];

  const chosen = [
    { ...sampleSegments[0], start: 10, end: 50, topic: "Đoạn video 1" },
    { ...sampleSegments[3], start: 545, end: 600, topic: "Đoạn video 2" },
  ];

  const mapped = buildMergeClipItems(chosen, joinedVideos, {
    videoName: "Bai08_Ep_kieu_du_lieu.mp4 & Download 1",
    videoHash: "cafd6ea8e7e70e2cc9fee826eacbb4f1443e13032676d104ef4a8bdf4236d7f2",
  });

  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].videoName, "Bai08_Ep_kieu_du_lieu.mp4");
  assert.equal(mapped[0].videoHash, undefined, "Không gắn nhầm hash cũ vào video không khớp");
  assert.equal(mapped[0].start, 10);
  assert.equal(mapped[0].end, 50);

  assert.equal(mapped[1].videoName, "Download (1).mp4");
  assert.equal(mapped[1].videoHash, "1809023fa1af6117a14ebaf58d56f8166d4d4e2f8466ce99a1c1f3230ddf282f");
  assert.equal(mapped[1].start, 10);
  assert.equal(mapped[1].end, 65);
});

test("page.tsx resets currentVideoHash inside handleSelectLibraryCard when switching videos", () => {
  const pageSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/app/page.tsx"), "utf-8");
  const idx = pageSource.indexOf("const handleSelectLibraryCard = useCallback");
  assert.ok(idx !== -1);
  const snippet = pageSource.slice(idx, idx + 1500);
  assert.ok(
    snippet.includes("setCurrentVideoHash("),
    "handleSelectLibraryCard phải cập nhật/xóa currentVideoHash khi đổi video"
  );
});

test("mergeTimelineSegments gộp các đoạn liền kề trên timeline, giữ id đầu, cập nhật mốc/parts và không mutate đầu vào", () => {
  const originalSnapshot = JSON.parse(JSON.stringify(sampleSegments));

  // Chọn ngược thứ tự seg_3 rồi seg_2 -> vẫn gộp đúng theo thứ tự timeline [20..90]
  const res = mergeTimelineSegments(sampleSegments, ["seg_3", "seg_2"]);
  assert.equal(res.ok, true);
  assert.equal(res.segments.length, 3);

  const merged = res.segments[1];
  assert.equal(merged.id, "seg_2", "Phải giữ id của đoạn đầu tiên theo chuẩn F00");
  assert.equal(merged.start, 20);
  assert.equal(merged.end, 90);
  assert.equal(merged.start_id, "S3");
  assert.equal(merged.end_id, "S6");
  assert.equal(merged.topic, "Khái niệm & Ví dụ");
  assert.equal(merged.parts[0].start, 20);
  assert.equal(merged.parts[merged.parts.length - 1].end, 90);

  // Đánh lại topic_no tuần tự 1..3
  assert.deepEqual(
    res.segments.map((s) => s.topic_no),
    [1, 2, 3]
  );

  // Không mutate mảng input ban đầu
  assert.deepEqual(sampleSegments, originalSnapshot);
});

test("mergeTimelineSegments gộp được 3 đoạn liền kề dài > 420s thành 1 clip duy nhất (không tự tách lại thành _Phan1/_Phan2)", () => {
  const longSegments = [
    { id: "s1", section_no: 1, section: "01_GioiThieu", topic_no: 1, topic: "Đoạn 1", slug: "doan-1", start_id: "S1", end_id: "S2", start: 0, end: 294, parts: [] },
    { id: "s2", section_no: 1, section: "01_GioiThieu", topic_no: 2, topic: "Đoạn 2", slug: "doan-2", start_id: "S3", end_id: "S4", start: 294, end: 558, parts: [] },
    { id: "s3", section_no: 1, section: "01_GioiThieu", topic_no: 3, topic: "Đoạn 3", slug: "doan-3", start_id: "S5", end_id: "S6", start: 558, end: 650, parts: [] },
  ];

  const res = mergeTimelineSegments(longSegments, ["s1", "s2", "s3"]);
  assert.equal(res.ok, true);
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].start, 0);
  assert.equal(res.segments[0].end, 650);
  // Yêu cầu từ người dùng: clip đã gộp phải giữ nguyên 1 file duy nhất khi xuất, không bị cắt lại thành 2 file _Phan1/_Phan2
  assert.equal(res.segments[0].parts.length, 1, "Clip đã gộp phải giữ đúng 1 part duy nhất để xuất thành 1 file");
  assert.equal(res.segments[0].parts[0].start, 0);
  assert.equal(res.segments[0].parts[0].end, 650);
  assert.ok(!res.segments[0].parts[0].file.includes("_Phan"), "Tên file không được có hậu tố _Phan1/_Phan2");
  assert.ok(
    !res.segments[0].parts[0].file.startsWith("01_01_"),
    "Không lặp tiền tố 01_01_ nếu section đã có tiền tố số"
  );
});

test("getTimelineMergeValidation từ chối gộp khi chưa đủ 2 đoạn, không liền kề, có khoảng đã xóa hoặc khác video", () => {
  assert.equal(getTimelineMergeValidation(sampleSegments, ["seg_1"]).ok, false);

  // Không liền kề (seg_1 và seg_3 bỏ qua seg_2)
  const nonContiguous = getTimelineMergeValidation(sampleSegments, ["seg_1", "seg_3"]);
  assert.equal(nonContiguous.ok, false);

  // Liền kề trong mảng nhưng có khoảng trống đã xóa ở giữa (> 0.4s)
  const withDeletedGap = [sampleSegments[0], sampleSegments[2]];
  const gapRes = getTimelineMergeValidation(withDeletedGap, ["seg_1", "seg_3"]);
  assert.equal(gapRes.ok, false);

  // Khác video nguồn trong joinedVideos
  const joinedVideos = [
    { id: "v1", title: "V1", fileName: "v1.mp4", url: "/videos/v1.mp4", duration: 50, startOffset: 0, endOffset: 50 },
    { id: "v2", title: "V2", fileName: "v2.mp4", url: "/videos/v2.mp4", duration: 70, startOffset: 50, endOffset: 120 },
  ];
  const crossVideo = getTimelineMergeValidation(sampleSegments, ["seg_2", "seg_3"], joinedVideos);
  assert.equal(crossVideo.ok, false);
});

test("page.tsx gộp đoạn trực tiếp trên timeline thay vì mở popup ExportProgressModal / mergeSelectedClipsBackend", () => {
  const pageSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/app/page.tsx"), "utf-8");
  const idx = pageSource.indexOf("const handleMergeSelectedClips =");
  assert.ok(idx !== -1, "Phải có handleMergeSelectedClips trong page.tsx");
  const endIdx = pageSource.indexOf("const handleDurationChange =", idx);
  assert.ok(endIdx !== -1);
  const snippet = pageSource.slice(idx, endIdx);

  assert.ok(
    snippet.includes("mergeTimelineSegments("),
    "handleMergeSelectedClips phải gọi mergeTimelineSegments để gộp trực tiếp các phân đoạn trên timeline"
  );
  assert.ok(
    snippet.includes('action: "merge"'),
    "handleMergeSelectedClips phải báo action: 'merge' để tránh toast xóa nhầm"
  );
  assert.ok(
    !snippet.includes("setIsProgressModalOpen(true)"),
    "handleMergeSelectedClips KHÔNG được mở popup ExportProgressModal"
  );
  assert.ok(
    !snippet.includes("mergeSelectedClipsBackend"),
    "handleMergeSelectedClips KHÔNG được gọi API xuất file MP4 tải về"
  );

  const timelineSource = fs.readFileSync(
    path.join(FRONTEND_ROOT, "src/components/StudioTimeline.tsx"),
    "utf-8"
  );
  assert.ok(
    !timelineSource.includes("thành 1 video MP4"),
    "Nút Gộp trên timeline không được mô tả là xuất/tải 1 video MP4"
  );
});
