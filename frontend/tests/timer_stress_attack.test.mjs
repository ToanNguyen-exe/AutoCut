import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  clearTimerRef,
  replaceTimerRef,
  clearAllTimerRefs,
} from "../src/lib/timerManager.ts";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "..");

test("page.tsx imports and uses real timerManager cleanup utilities", () => {
  const pageSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/app/page.tsx"), "utf-8");
  assert.ok(pageSource.includes("@/lib/timerManager"), "page.tsx phải dùng timerManager thật");
  assert.ok(pageSource.includes("clearAllTimerRefs("), "page.tsx phải gọi clearAllTimerRefs khi unmount");
});

test("Real timerManager prevents leaks across rapid spam calls and 100% failure exceptions", async () => {
  const progressTimerRef = { current: null };
  const renderTimerRef = { current: null };
  const analyzeTickerRef = { current: null };
  const activeIntervals = new Set();

  let timerIdCounter = 1;
  const mockSetInterval = () => {
    const id = timerIdCounter++;
    activeIntervals.add(id);
    return id;
  };
  const mockClearInterval = (id) => {
    activeIntervals.delete(id);
  };

  // 1. Spam replaceTimerRef 50 lan lien tiep tren cung ref -> toi da chi giu 1 timer
  for (let i = 0; i < 50; i++) {
    replaceTimerRef(progressTimerRef, () => {}, 200, mockSetInterval, mockClearInterval);
    assert.equal(activeIntervals.size, 1, "replaceTimerRef phải clear timer cũ trước khi tạo timer mới");
  }

  clearTimerRef(progressTimerRef, mockClearInterval);
  assert.equal(activeIntervals.size, 0, "clearTimerRef phải giải phóng hết timer đang chạy");
  assert.equal(progressTimerRef.current, null);

  // 2. Gia lap exception 20 lan voi try...finally goi clearAllTimerRefs -> ZERO timer ro ri
  for (let i = 0; i < 20; i++) {
    replaceTimerRef(progressTimerRef, () => {}, 200, mockSetInterval, mockClearInterval);
    replaceTimerRef(analyzeTickerRef, () => {}, 600, mockSetInterval, mockClearInterval);
    replaceTimerRef(renderTimerRef, () => {}, 700, mockSetInterval, mockClearInterval);
    try {
      throw new Error("Simulated API failure");
    } catch {
      // ignore error in test
    } finally {
      clearAllTimerRefs([progressTimerRef, renderTimerRef, analyzeTickerRef], mockClearInterval);
    }
    assert.equal(activeIntervals.size, 0, "Không được rò rỉ interval khi tác vụ ném lỗi");
  }
});
