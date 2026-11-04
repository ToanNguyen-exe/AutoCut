"use client";

import React, { useState } from "react";
import { User } from "@/types";
import { changePassword, updateProfile } from "@/lib/auth";
import {
  User as UserIcon,
  KeyRound,
  ShieldCheck,
  Mail,
  X,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";

interface AccountModalProps {
  isOpen: boolean;
  initialTab?: "profile" | "password";
  user: User | null;
  onClose: () => void;
  onUserUpdate: (updatedUser: User) => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  initialTab = "profile",
  user,
  onClose,
  onUserUpdate,
}) => {
  const [tab, setTab] = useState<"profile" | "password">(initialTab);

  // Form profile
  const [nameInput, setNameInput] = useState(user?.name || "");
  const [emailInput, setEmailInput] = useState(user?.email || "");

  // Form password
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Sync initial tab when modal opens
  React.useEffect(() => {
    setTab(initialTab);
    setFeedback(null);
    if (user) {
      setNameInput(user.name);
      setEmailInput(user.email);
    }
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }, [initialTab, isOpen, user]);

  if (!isOpen || !user) return null;

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!nameInput.trim()) {
      setFeedback({ type: "error", message: "Họ và tên không được để trống!" });
      return;
    }

    const res = updateProfile({
      name: nameInput.trim(),
      email: emailInput.trim(),
    });

    if (res.success && res.user) {
      onUserUpdate(res.user);
      setFeedback({
        type: "success",
        message: res.message || "Cập nhật thông tin tài khoản thành công!",
      });
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback({ type: "error", message: res.message || "Không thể lưu thông tin. Vui lòng thử lại!" });
    }
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!oldPassword) {
      setFeedback({ type: "error", message: "Vui lòng nhập mật khẩu hiện tại!" });
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      setFeedback({
        type: "error",
        message: "Mật khẩu mới phải có ít nhất 4 ký tự!",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({
        type: "error",
        message: "Xác nhận mật khẩu mới không khớp!",
      });
      return;
    }

    const res = changePassword(oldPassword, newPassword);
    if (res.success) {
      setFeedback({ type: "success", message: res.message });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setFeedback(null);
        onClose();
      }, 1500);
    } else {
      setFeedback({ type: "error", message: res.message });
    }
  };

  const initial = user.name ? user.name.charAt(0).toUpperCase() : "U";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col text-slate-800">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-2xs">
              <UserIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Quản Lý Tài Khoản</h3>
              <p className="text-xs text-slate-500">Xem thông tin và thay đổi mật khẩu tài khoản</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex border-b border-slate-200 bg-slate-100/60 p-1">
          <button
            onClick={() => {
              setTab("profile");
              setFeedback(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition ${
              tab === "profile"
                ? "bg-white text-indigo-700 shadow-xs border border-slate-200/80 font-bold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Thông Tin Tài Khoản</span>
          </button>
          <button
            onClick={() => {
              setTab("password");
              setFeedback(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition ${
              tab === "password"
                ? "bg-white text-indigo-700 shadow-xs border border-slate-200/80 font-bold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Đổi Mật Khẩu</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {/* Feedback banner */}
          {feedback && (
            <div
              className={`mb-4 p-3 rounded-xl border flex items-center gap-2.5 text-xs ${
                feedback.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {tab === "profile" ? (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Profile Card Header */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-tr ${user.avatarColor || "from-indigo-600 to-blue-600"} flex items-center justify-center text-white text-xl font-bold shadow-sm`}
                >
                  {initial}
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900 flex items-center gap-2">
                    {user.name}
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {user.role}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">{user.username}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{user.email}</div>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên đăng nhập
                  </label>
                  <input
                    type="text"
                    disabled
                    value={user.username}
                    className="w-full px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-500 text-xs font-mono cursor-not-allowed"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Tên đăng nhập cố định không thể thay đổi.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Họ và tên
                  </label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email liên hệ
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  </div>
                </div>

                {/* System Permissions Info */}
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-2">
                    Quyền hạn trong AutoCut AI
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-1.5 text-slate-700 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span>Duyệt phân đoạn video</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-1.5 text-slate-700 font-medium">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span>Xuất video & Render B10</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-slate-300 transition"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu hiện tại
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Nhập mật khẩu đang dùng (ví dụ: admin123)..."
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới (tối thiểu 4 ký tự)..."
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới..."
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 text-xs outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-900">
                Mật khẩu sau khi đổi sẽ được áp dụng ngay lập tức cho các lần đăng nhập tiếp theo.
              </div>

              {/* Actions */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-slate-300 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition"
                >
                  Xác nhận đổi mật khẩu
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
