import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  toggleSelectedSegmentId,
  reconcileSelectedSegmentIds,
  getCheckedSegmentsInOrder,
  canMergeSelectedSegments,
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
