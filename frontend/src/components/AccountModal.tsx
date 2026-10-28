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

  const initial = user.avatar || user.name.charAt(0).toUpperCase();

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!nameInput.trim()) {
      setFeedback({ type: "error", message: "Họ và tên không được để trống!" });
      return;
    }

    const res = updateProfile({ name: nameInput, email: emailInput });
    if (res.success && res.user) {
      onUserUpdate(res.user);
      setFeedback({ type: "success", message: res.message });
    } else {
      setFeedback({ type: "error", message: res.message });
    }
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!oldPassword) {
      setFeedback({ type: "error", message: "Vui lòng nhập mật khẩu hiện tại!" });
      return;
    }
    if (newPassword.length < 4) {
      setFeedback({ type: "error", message: "Mật khẩu mới phải có ít nhất 4 ký tự!" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", message: "Xác nhận mật khẩu mới không khớp!" });
      return;
    }

    const res = changePassword(oldPassword, newPassword);
    if (res.success) {
      setFeedback({ type: "success", message: res.message });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setFeedback({ type: "error", message: res.message });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#16171d] border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col text-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <UserIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Quản Lý Tài Khoản</h3>
              <p className="text-xs text-slate-400">Xem thông tin và thay đổi mật khẩu tài khoản</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex border-b border-slate-800 bg-[#121318]">
          <button
            onClick={() => {
              setTab("profile");
              setFeedback(null);
            }}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              tab === "profile"
                ? "border-purple-500 text-purple-300 bg-purple-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
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
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              tab === "password"
                ? "border-purple-500 text-purple-300 bg-purple-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
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
                  ? "bg-emerald-950/70 border-emerald-500/40 text-emerald-300"
                  : "bg-rose-950/70 border-rose-500/40 text-rose-300"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {tab === "profile" ? (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Profile Card Header */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-tr ${user.avatarColor || "from-purple-600 to-indigo-600"} flex items-center justify-center text-white text-xl font-bold shadow-lg`}
                >
                  {initial}
                </div>
                <div>
                  <div className="text-base font-bold text-white flex items-center gap-2">
                    {user.name}
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/20">
                      {user.role}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">{user.username}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{user.email}</div>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Tên đăng nhập
                  </label>
                  <input
                    type="text"
                    disabled
                    value={user.username}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-xs font-mono cursor-not-allowed"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Tên đăng nhập cố định không thể thay đổi.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Họ và tên
                  </label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Email liên hệ
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  </div>
                </div>

                {/* System Permissions Info */}
                <div className="pt-2">
                  <label className="block text-xs font-medium text-slate-400 mb-2">
                    Quyền hạn trong AutoCut AI
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800 flex items-center gap-1.5 text-slate-300">
                      <ShieldCheck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span>Duyệt phân đoạn video</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800 flex items-center gap-1.5 text-slate-300">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>Xuất video & Render B10</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25 transition"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Mật khẩu hiện tại
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Nhập mật khẩu đang dùng (ví dụ: admin123)..."
                  className="w-full px-3 py-2 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới (tối thiểu 4 ký tự)..."
                  className="w-full px-3 py-2 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới..."
                  className="w-full px-3 py-2 rounded-xl bg-[#0e0f12] border border-slate-700 focus:border-purple-500 text-white text-xs outline-none transition"
                />
              </div>

              <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 text-[11px] text-purple-300">
                Mật khẩu sau khi đổi sẽ được áp dụng ngay lập tức cho các lần đăng nhập tiếp theo.
              </div>

              {/* Actions */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25 transition"
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
