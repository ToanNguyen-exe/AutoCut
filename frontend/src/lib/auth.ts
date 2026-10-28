import { User } from "@/types";
import mockUsers from "@/mock-data/users.json";

const STORAGE_KEY = "autocut_user";

export function getAllUsers(): User[] {
  return mockUsers as User[];
}

export function getCurrentUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function loginUser(username: string, password: string): { success: boolean; user?: User; message?: string } {
  const users = getAllUsers();
  const matched = users.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password.trim()
  );

  if (matched) {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(matched));
    }
    return { success: true, user: matched };
  }

  return { success: false, message: "Tên đăng nhập hoặc mật khẩu không chính xác!" };
}

export function logoutUser(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function changePassword(
  oldPass: string,
  newPass: string
): { success: boolean; message: string } {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return { success: false, message: "Bạn chưa đăng nhập!" };
  }
  if (currentUser.password && currentUser.password !== oldPass) {
    return { success: false, message: "Mật khẩu hiện tại không chính xác!" };
  }
  if (!newPass || newPass.trim().length < 4) {
    return { success: false, message: "Mật khẩu mới phải có tối thiểu 4 ký tự!" };
  }

  currentUser.password = newPass.trim();
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
  }
  return { success: true, message: "Đổi mật khẩu thành công!" };
}

export function updateProfile(
  updates: Partial<Pick<User, "name" | "email">>
): { success: boolean; user?: User; message: string } {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return { success: false, message: "Bạn chưa đăng nhập!" };
  }
  if (updates.name) currentUser.name = updates.name.trim();
  if (updates.email) currentUser.email = updates.email.trim();

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
  }
  return { success: true, user: currentUser, message: "Cập nhật thông tin thành công!" };
}
