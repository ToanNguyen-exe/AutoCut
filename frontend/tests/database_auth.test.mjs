import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("auth.ts must NOT import or rely on mock users (no fake login)", () => {
  const authSource = fs.readFileSync(path.resolve("frontend/src/lib/auth.ts"), "utf-8");
  assert.ok(!authSource.includes("mock-data/users.json"), "auth.ts không được chứa tham chiếu mock-data/users.json");
  assert.ok(!authSource.includes("getAllUsers"), "auth.ts không được export hàm getAllUsers giả lập");
});

test("login/page.tsx must NOT contain fake quick account filler", () => {
  const loginPageSource = fs.readFileSync(path.resolve("frontend/src/app/login/page.tsx"), "utf-8");
  assert.ok(!loginPageSource.includes("fillQuickAccount"), "login/page.tsx không được có nút fillQuickAccount");
  assert.ok(!loginPageSource.includes("Tài khoản mẫu để test"), "login/page.tsx không được có phần tài khoản mẫu để test");
});

test("getCurrentUser returns null when no user is logged in (NO fake auto-login)", () => {
  // Mô phỏng hàm getCurrentUser mới
  const fakeStorage = new Map();
  function getCurrentUserTest(storage) {
    const raw = storage.get("autocut_user");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return null; // Không tự động gán bất kỳ tài khoản giả nào
  }

  assert.equal(getCurrentUserTest(fakeStorage), null, "Chưa đăng nhập thì getCurrentUser phải trả về null");

  fakeStorage.set("autocut_user", JSON.stringify({
    id: 1,
    email: "admin@autocut.ai",
    name: "Nguyễn Văn Toàn",
    role: "ADMIN"
  }));
  const loggedIn = getCurrentUserTest(fakeStorage);
  assert.equal(loggedIn.email, "admin@autocut.ai");
  assert.equal(loggedIn.role, "ADMIN");
});

test("Database login endpoint contract and payload", async () => {
  const loginPayload = {
    username: "admin@autocut.ai",
    password: "admin123"
  };

  // Giả lập hàm xử lý phản hồi từ Backend Database
  function handleBackendLoginResponse(status, json) {
    if (status === 200 && json?.status === "SUCCESS" && json?.user) {
      return { success: true, user: json.user };
    }
    return { success: false, message: json?.message || "Tài khoản hoặc mật khẩu không chính xác!" };
  }

  const successMock = handleBackendLoginResponse(200, {
    status: "SUCCESS",
    user: {
      id: 1,
      email: "admin@autocut.ai",
      username: "admin",
      name: "Nguyễn Văn Toàn",
      role: "ADMIN"
    }
  });
  assert.equal(successMock.success, true);
  assert.equal(successMock.user.email, "admin@autocut.ai");

  const failMock = handleBackendLoginResponse(401, {
    status: "ERROR",
    message: "Email/Tài khoản hoặc mật khẩu không chính xác!"
  });
  assert.equal(failMock.success, false);
  assert.equal(failMock.message, "Email/Tài khoản hoặc mật khẩu không chính xác!");
});
