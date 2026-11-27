import type { User } from "@/types";
import {
  AUTH_API_BASE,
  USER_STORAGE_KEY,
  apiFetch,
  clearClientAuthState,
  getAccessToken,
  refreshSession,
  setAccessToken,
  type BackendUserDto,
} from "./http.ts";

export function mapBackendUser(dto: BackendUserDto): User {
  const displayName = dto.full_name || dto.email || "Người dùng";
  const initial = displayName.trim().charAt(0).toUpperCase() || "U";
  return {
    id: String(dto.id),
    username: dto.email,
    name: displayName,
    fullName: dto.full_name,
    role: dto.role || "INSTRUCTOR",
    email: dto.email,
    avatar: initial,
    avatarColor: dto.role === "ADMIN" ? "from-indigo-600 to-blue-600" : "from-emerald-600 to-teal-600",
    mustChangePassword: Boolean(dto.must_change_password),
    storageUsedBytes: dto.storage_used_bytes,
    storageLimitBytes: dto.storage_limit_bytes,
  };
}

function saveUserMetadata(user: User): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  const safeCopy: User = {
    id: user.id,
    username: user.username,
    name: user.name,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    avatar: user.avatar,
    avatarColor: user.avatarColor,
    mustChangePassword: user.mustChangePassword,
    storageUsedBytes: user.storageUsedBytes,
    storageLimitBytes: user.storageLimitBytes,
  };
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(safeCopy));
}

export function getCurrentUser(): User | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as User & { password?: unknown };
    if (!parsed || !parsed.email) {
      return null;
    }
    if ("password" in parsed) {
      delete parsed.password;
      saveUserMetadata(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Khôi phục phiên đăng nhập từ refresh cookie (HttpOnly) khi tải lại trang.
 */
export async function ensureAuthenticated(): Promise<User | null> {
  if (getAccessToken()) {
    try {
      const meRes = await apiFetch(`${AUTH_API_BASE}/me`, { method: "GET" });
      if (meRes.ok) {
        const dto = (await meRes.json()) as BackendUserDto;
        const mapped = mapBackendUser(dto);
        saveUserMetadata(mapped);
        return mapped;
      }
    } catch {
      // Thử refresh bên dưới
    }
  }

  const refreshed = await refreshSession();
  if (!refreshed) {
    return null;
  }
  const mapped = mapBackendUser(refreshed.user);
  saveUserMetadata(mapped);
  return mapped;
}

export async function loginUser(
  usernameOrEmail: string,
  password: string
): Promise<{ success: boolean; user?: User; message?: string }> {
  if (!usernameOrEmail.trim() || !password) {
    return { success: false, message: "Vui lòng nhập đầy đủ email và mật khẩu!" };
  }

  try {
    const res = await fetch(`${AUTH_API_BASE}/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: usernameOrEmail.trim(),
        password,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      user?: BackendUserDto;
      error?: { code?: string; message?: string };
      message?: string;
    };

    if (res.ok && json.access_token && json.user) {
      setAccessToken(json.access_token);
      const userObj = mapBackendUser(json.user);
      saveUserMetadata(userObj);
      return { success: true, user: userObj };
    }

    clearClientAuthState();
    return {
      success: false,
      message: json.error?.message || json.message || "Email hoặc mật khẩu không đúng.",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Không thể kết nối máy chủ";
    return {
      success: false,
      message: `Lỗi kết nối backend: ${detail}`,
    };
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(`${AUTH_API_BASE}/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Vẫn dọn dẹp trạng thái cục bộ dù mất mạng
  } finally {
    clearClientAuthState();
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; message: string; reloginRequired?: boolean }> {
  try {
    const res = await apiFetch(`${AUTH_API_BASE}/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
      relogin_required?: boolean;
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        success: false,
        message: json.error?.message || json.message || `Đổi mật khẩu thất bại (${res.status}).`,
      };
    }

    clearClientAuthState();
    return {
      success: true,
      message: json.message || "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
      reloginRequired: json.relogin_required ?? true,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Lỗi kết nối khi đổi mật khẩu.",
    };
  }
}

export async function updateProfile(
  data: Partial<User>
): Promise<{ success: boolean; user?: User; message?: string }> {
  const fullName = (data.name || data.fullName || "").trim();
  if (!fullName) {
    return { success: false, message: "Họ và tên không được để trống!" };
  }

  try {
    const res = await apiFetch(`${AUTH_API_BASE}/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName }),
    });

    const json = (await res.json().catch(() => ({}))) as BackendUserDto & {
      error?: { message?: string };
      message?: string;
    };

    if (!res.ok) {
      return {
        success: false,
        message: json.error?.message || json.message || "Không thể cập nhật thông tin tài khoản.",
      };
    }

    const updated = mapBackendUser(json);
    saveUserMetadata(updated);
    return {
      success: true,
      user: updated,
      message: "Đã lưu thông tin tài khoản vào hệ thống!",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Lỗi kết nối máy chủ.",
    };
  }
}
