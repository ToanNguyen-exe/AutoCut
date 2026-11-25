const rawBase =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? "/api/video" : "http://localhost:8080/api/video");

export const API_BASE = rawBase.endsWith("/api/video")
  ? rawBase.replace(/\/+$/, "")
  : `${rawBase.replace(/\/+$/, "")}/api/video`;

export const BACKEND_ORIGIN = API_BASE.replace(/\/api\/video$/, "");
export const AUTH_API_BASE = `${BACKEND_ORIGIN}/api/v1/auth`;
export const USER_STORAGE_KEY = "autocut_user";

export interface BackendUserDto {
  id: number | string;
  email: string;
  full_name?: string;
  role?: string;
  storage_used_bytes?: number;
  storage_limit_bytes?: number;
  must_change_password?: boolean;
}

export interface AuthSessionPayload {
  accessToken: string;
  expiresIn: number;
  user: BackendUserDto;
}

// Chỉ lưu Access Token JWT trong RAM (tuyệt đối không ghi localStorage/sessionStorage).
let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<AuthSessionPayload | null> | null = null;

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token && token.trim() ? token.trim() : null;
}

export function clearClientAuthState(): void {
  inMemoryAccessToken = null;
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // Bỏ qua lỗi quota / sandbox
    }
  }
}

function isAuthLifecycleUrl(url: string): boolean {
  return (
    url.includes("/api/v1/auth/login") ||
    url.includes("/api/v1/auth/refresh") ||
    url.includes("/api/v1/auth/logout")
  );
}

/**
 * Làm mới Access Token bằng HttpOnly refresh cookie với khóa single-flight.
 */
export async function refreshSession(): Promise<AuthSessionPayload | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${AUTH_API_BASE}/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        clearClientAuthState();
        return null;
      }

      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        user?: BackendUserDto;
      };

      if (!json.access_token || !json.user) {
        clearClientAuthState();
        return null;
      }

      setAccessToken(json.access_token);
      return {
        accessToken: json.access_token,
        expiresIn: typeof json.expires_in === "number" ? json.expires_in : 900,
        user: json.user,
      };
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Wrapper fetch có Bearer token trong bộ nhớ, credentials cookie và tự động refresh 1 lần khi 401.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const buildHeaders = (token: string | null): Headers => {
    const headers = new Headers(init.headers);
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  };

  let res = await fetch(input, {
    ...init,
    credentials: init.credentials ?? "include",
    headers: buildHeaders(getAccessToken()),
  });

  if (res.status === 401 && !isAuthLifecycleUrl(input)) {
    const refreshed = await refreshSession();
    if (refreshed?.accessToken) {
      res = await fetch(input, {
        ...init,
        credentials: init.credentials ?? "include",
        headers: buildHeaders(refreshed.accessToken),
      });
    } else {
      clearClientAuthState();
    }
  }

  return res;
}

export async function requestAuthTicket(
  purpose: "STREAM" | "DOWNLOAD" | "SSE",
  resourceId: string
): Promise<string | null> {
  if (!resourceId || !resourceId.trim()) {
    return null;
  }
  try {
    const res = await apiFetch(`${AUTH_API_BASE}/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose,
        resource_id: resourceId.trim(),
      }),
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as { ticket?: string };
    return json.ticket || null;
  } catch {
    return null;
  }
}
