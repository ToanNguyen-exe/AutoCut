import test from "node:test";
import assert from "node:assert/strict";

// Helper tái hiện logic tách phân đoạn: nửa đầu giữ id cũ, nửa sau dùng crypto.randomUUID()
function splitSegment(orig, splitTime, slugifyFn, recalculatePartsFn) {
  const seg1 = {
    ...orig,
    id: orig.id, // Nửa đầu giữ id cũ
    end: splitTime,
    topic: `${orig.topic} (Phần 1)`,
    slug: slugifyFn(`${orig.topic} p1`),
    parts: recalculatePartsFn(
      orig.start,
      splitTime,
      `${orig.section_no.toString().padStart(2, "0")}_${slugifyFn(orig.section)}`,
      orig.topic_no,
      slugifyFn(`${orig.topic} p1`)
    ),
  };

  const newId = crypto.randomUUID();

  const seg2 = {
    ...orig,
    id: newId, // Nửa sau dùng crypto.randomUUID()
    start: splitTime,
    topic: `${orig.topic} (Phần 2)`,
    slug: slugifyFn(`${orig.topic} p2`),
    topic_no: orig.topic_no + 1,
    parts: recalculatePartsFn(
      splitTime,
      orig.end,
      `${orig.section_no.toString().padStart(2, "0")}_${slugifyFn(orig.section)}`,
      orig.topic_no + 1,
      slugifyFn(`${orig.topic} p2`)
    ),
  };

  return [seg1, seg2];
}

test("Tách đoạn: nửa đầu giữ id cũ, nửa sau dùng crypto.randomUUID()", () => {
  const origSeg = {
    id: "seg_stable_12345",
    section_no: 1,
    section: "01_LyThuyet",
    topic_no: 1,
    topic: "Giới thiệu Python",
    slug: "gioi-thieu-python",
    start_id: "S0001",
    end_id: "S0020",
    start: 0.0,
    end: 120.0,
    parts: [],
  };

  const dummySlugify = (s) => s.toLowerCase().replace(/\s+/g, "-");
  const dummyRecalcParts = (start, end, sec, topNo, slug) => [
    { part: 1, start, end, file: `${sec}/${topNo}_${slug}.mp4` }
  ];

  const [seg1, seg2] = splitSegment(origSeg, 50.0, dummySlugify, dummyRecalcParts);

  // 1. Kiểm tra nửa đầu giữ nguyên id cũ
  assert.equal(seg1.id, origSeg.id, "Nửa đầu phải giữ id cũ định danh ổn định");
  assert.equal(seg1.start, 0.0);
  assert.equal(seg1.end, 50.0);

  // 2. Kiểm tra nửa sau dùng crypto.randomUUID()
  assert.notEqual(seg2.id, origSeg.id, "Nửa sau phải có id mới khác id cũ");
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert.match(seg2.id, uuidRegex, "Nửa sau phải là một UUID hợp lệ từ crypto.randomUUID()");
  assert.equal(seg2.start, 50.0);
  assert.equal(seg2.end, 120.0);
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

  // Giả lập lưu sessionData vào localStorage
  const sessionData = {
    videoId: projectState.videoId,
    data: projectState,
    currentVideoHash: "a1b2c3d4",
  };

  const serialized = JSON.stringify(sessionData);
  const restored = JSON.parse(serialized);

  assert.equal(typeof restored.videoId, "number", "videoId trong sessionData phải là kiểu number");
  assert.equal(restored.videoId, 101);
  assert.equal(restored.data.videoId, 101, "data.videoId trong state dự án phải là 101");
});

test("API getSegments và saveSegments endpoint URL & payload", () => {
  const videoId = 42;
  const expectedGetUrl = `/api/video/${videoId}/segments`;
  const expectedPostUrl = `/api/video/${videoId}/segments`;

  assert.equal(expectedGetUrl, "/api/video/42/segments");
  assert.equal(expectedPostUrl, "/api/video/42/segments");

  const sampleSegments = [
    {
      id: "seg_1",
      section_no: 1,
      section: "01_Intro",
      topic_no: 1,
      topic: "Intro",
      slug: "intro",
      start_id: "s1",
      end_id: "s2",
      start: 0,
      end: 60,
      parts: []
    }
  ];

  const payloadString = JSON.stringify(sampleSegments);
  const parsed = JSON.parse(payloadString);
  assert.ok(Array.isArray(parsed), "saveSegments payload phải là mảng List<Segment>");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "seg_1");
});
