import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  USER_STORAGE_KEY,
  AUTH_API_BASE,
  getAccessToken,
  setAccessToken,
} from "../src/lib/http.ts";
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  changePassword,
  updateProfile,
  ensureAuthenticated,
} from "../src/lib/auth.ts";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "..");

function installBrowserEnv() {
  const store = new Map();
  const prevWindow = globalThis.window;
  const prevStorage = globalThis.localStorage;
  const prevFetch = globalThis.fetch;

  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };

  setAccessToken(null);

  return {
    store,
    restore() {
      setAccessToken(null);
      globalThis.window = prevWindow;
      globalThis.localStorage = prevStorage;
      globalThis.fetch = prevFetch;
    },
  };
}

test("auth.ts and login/page.tsx contain zero mock credentials or users.json references", () => {
  const authSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/lib/auth.ts"), "utf-8");
  const loginSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/app/login/page.tsx"), "utf-8");
  const modalSource = fs.readFileSync(path.join(FRONTEND_ROOT, "src/components/AccountModal.tsx"), "utf-8");

  assert.ok(!authSource.includes("mock-data/users.json"), "auth.ts không được tham chiếu users.json");
  assert.ok(!authSource.includes("getAllUsers"), "auth.ts không được có getAllUsers giả lập");
  assert.ok(!loginSource.includes("fillQuickAccount"), "login/page.tsx không được có nút fillQuickAccount");
  assert.ok(!loginSource.includes("Tài khoản mẫu để test"), "login/page.tsx không được chứa tài khoản mẫu");
  assert.ok(!loginSource.includes("admin123"), "login/page.tsx không được lộ mật khẩu mẫu admin123");
  assert.ok(!modalSource.includes("admin123"), "AccountModal.tsx không được lộ mật khẩu mẫu admin123");
});

test("getCurrentUser returns null when unauthenticated and strips legacy password fields", (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  assert.equal(getCurrentUser(), null, "Chưa đăng nhập thì getCurrentUser phải trả về null");

  env.store.set(
    USER_STORAGE_KEY,
    JSON.stringify({
      id: "1",
      email: "gv@truong.edu.vn",
      username: "gv@truong.edu.vn",
      name: "Giảng Viên",
      role: "INSTRUCTOR",
      password: "leaky-plaintext-password",
    })
  );

  const sanitized = getCurrentUser();
  assert.equal(sanitized.email, "gv@truong.edu.vn");
  assert.equal("password" in sanitized, false, "Phải xóa bỏ field password nếu tồn tại dữ liệu cũ");
  assert.ok(!env.store.get(USER_STORAGE_KEY).includes("leaky-plaintext-password"));
});

test("loginUser stores JWT in memory only, calls /api/v1/auth/login, never saves password", async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const seenRequests = [];
  globalThis.fetch = async (url, init) => {
    seenRequests.push({ url, init });
    if (String(url).startsWith(`${AUTH_API_BASE}/login`)) {
      return new Response(
        JSON.stringify({
          access_token: "jwt-in-memory-token",
          token_type: "Bearer",
          expires_in: 900,
          user: {
            id: 7,
            email: "gv@truong.edu.vn",
            full_name: "Giảng Viên",
            role: "INSTRUCTOR",
            must_change_password: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("{}", { status: 404 });
  };

  const res = await loginUser("gv@truong.edu.vn", "SecretPass1");
  assert.equal(res.success, true);
  assert.equal(seenRequests.length, 1);
  assert.equal(seenRequests[0].init.credentials, "include");
  assert.equal(getAccessToken(), "jwt-in-memory-token");

  const stored = env.store.get(USER_STORAGE_KEY) || "";
  assert.ok(!stored.includes("SecretPass1"), "Không bao giờ được lưu mật khẩu vào localStorage");
  assert.ok(!stored.includes("jwt-in-memory-token"), "Access token không được lưu trong localStorage");
});

test("changePassword & updateProfile call backend APIs and never persist passwords locally", async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  setAccessToken("jwt-session-1");
  env.store.set(
    USER_STORAGE_KEY,
    JSON.stringify({ id: "7", email: "gv@truong.edu.vn", name: "Old Name", role: "INSTRUCTOR" })
  );

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, auth: new Headers(init?.headers).get("Authorization") });
    if (String(url).endsWith("/me")) {
      return new Response(
        JSON.stringify({ id: 7, email: "gv@truong.edu.vn", full_name: "New Name", role: "INSTRUCTOR" }),
        { status: 200 }
      );
    }
    if (String(url).endsWith("/change-password")) {
      return new Response(
        JSON.stringify({ status: "SUCCESS", message: "Đổi mật khẩu thành công.", relogin_required: true }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 404 });
  };

  const prof = await updateProfile({ name: "New Name" });
  assert.equal(prof.success, true);
  assert.equal(prof.user?.name, "New Name");

  const chg = await changePassword("OldPass123", "NewStrong9");
  assert.equal(chg.success, true);
  assert.equal(chg.reloginRequired, true);
  assert.equal(getAccessToken(), null, "Đổi mật khẩu phải dọn phiên cục bộ để đăng nhập lại");
  assert.equal(env.store.has(USER_STORAGE_KEY), false);
  assert.equal(calls.every((c) => c.auth === "Bearer jwt-session-1"), true);
});

test("ensureAuthenticated and logoutUser handle refresh lifecycle cleanly", async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/refresh")) {
      return new Response(
        JSON.stringify({
          access_token: "refreshed-jwt",
          expires_in: 900,
          user: { id: 9, email: "gv2@truong.edu.vn", full_name: "GV 2", role: "INSTRUCTOR" },
        }),
        { status: 200 }
      );
    }
    if (String(url).endsWith("/logout")) {
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 401 });
  };

  const user = await ensureAuthenticated();
  assert.equal(user?.email, "gv2@truong.edu.vn");
  assert.equal(getAccessToken(), "refreshed-jwt");

  await logoutUser();
  assert.equal(getAccessToken(), null);
  assert.equal(getCurrentUser(), null);
});
