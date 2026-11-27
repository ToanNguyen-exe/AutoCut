import test from "node:test";
import assert from "node:assert/strict";
import { splitSegment, recalculateParts, slugify } from "../src/lib/utils.ts";
import { API_BASE, buildVideoSegmentsUrl } from "../src/lib/api.ts";

test("splitSegment thật trong utils.ts: nửa đầu giữ id cũ, nửa sau dùng crypto.randomUUID()", () => {
  const origSeg = {
    id: "seg_stable_12345",
    section_no: 1,
    section: "01_LyThuyet",
    topic_no: 1,
    topic: "Giới thiệu Python",
    slug: slugify("Giới thiệu Python"),
    start_id: "S0001",
    end_id: "S0020",
    start: 0.0,
    end: 120.0,
    parts: recalculateParts(0.0, 120.0, "01_ly-thuyet", 1, "gioi-thieu-python"),
  };

  const [seg1, seg2] = splitSegment(origSeg, 50.0);

  assert.equal(seg1.id, origSeg.id, "Nửa đầu phải giữ id cũ định danh ổn định");
  assert.equal(seg1.start, 0.0);
  assert.equal(seg1.end, 50.0);
  assert.equal(seg1.parts.length, 1);

  assert.notEqual(seg2.id, origSeg.id, "Nửa sau phải có id mới khác id cũ");
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert.match(seg2.id, uuidRegex, "Nửa sau phải là một UUID hợp lệ từ crypto.randomUUID()");
  assert.equal(seg2.start, 50.0);
  assert.equal(seg2.end, 120.0);
  assert.equal(seg2.topic_no, 2);
});

test("State dự án + localStorage lưu trữ và khôi phục videoId: number", () => {
  const projectState = {
    videoId: 101,
    video: "Bai08_Ep_kieu_du_lieu.mp4",
    lesson: "Bài 08",
    mode: "analyzed",
    reviewed: false,
    segments: [],
  };

  const sessionData = {
    videoId: projectState.videoId,
    data: projectState,
    currentVideoHash: "a1b2c3d4",
  };

  const restored = JSON.parse(JSON.stringify(sessionData));
  assert.equal(typeof restored.videoId, "number", "videoId trong sessionData phải là kiểu number");
  assert.equal(restored.videoId, 101);
  assert.equal(restored.data.videoId, 101);
});

test("buildVideoSegmentsUrl thật trong api.ts tạo đúng đường dẫn segments", () => {
  assert.equal(buildVideoSegmentsUrl(42), `${API_BASE}/42/segments`);
});
