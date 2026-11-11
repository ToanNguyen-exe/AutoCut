"use client";

import React, { useState, useRef, useEffect } from "react";
import { User, SegmentsData } from "@/types";
import { logoutUser } from "@/lib/auth";
import { useRouter } from "next/navigation";
import {
  Scissors,
  Download,
  Save,
  RefreshCw,
  LogOut,
  User as UserIcon,
  KeyRound,
  ChevronDown,
  Sparkles,
  Loader2,
  Plus,
} from "lucide-react";
import { AccountModal } from "@/components/AccountModal";
import { ThemeColorPicker } from "@/components/ThemeColorPicker";

interface StudioHeaderProps {
  user: User | null;
  data: SegmentsData;
  backendOnline?: boolean;
  isRendering: boolean;
  isAnalyzing?: boolean;
  isSaving?: boolean;
  isDemo?: boolean;
  themeColor?: string;
  onThemeColorChange?: (color: string, isDark: boolean) => void;
  onRefreshFromBackend?: () => void;
  onExport?: () => void;
  onSave?: () => void;
  onRender: () => void;
  onOpenAddVideo: () => void;
  onAnalyzeAI?: () => void;
  onUserUpdate?: (user: User) => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  user,
  data,
  isRendering,
  isAnalyzing = false,
  isSaving = false,
  themeColor,
  onThemeColorChange,
  onOpenAddVideo,
  onExport,
  onSave,
  onRender,
  onAnalyzeAI,
  onUserUpdate,
}) => {
  const router = useRouter();
  const [showDropdown, setShowDropdown] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountModalTab, setAccountModalTab] = useState<"profile" | "password">("profile");

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logoutUser();
    router.push("/login");
  };

  const initial = user?.avatar || (user?.name ? user.name.charAt(0).toUpperCase() : "A");

  const openAccountModal = (tab: "profile" | "password") => {
    setAccountModalTab(tab);
    setAccountModalOpen(true);
    setShowDropdown(false);
  };

  return (
    <>
      <header className="h-14 bg-white/75 dark:bg-black/60 backdrop-blur-md border-b border-slate-200/80 dark:border-white/10 flex items-center justify-between px-4 lg:px-6 select-none shrink-0 z-40 text-slate-800 dark:text-slate-100 shadow-[0_1px_2px_rgba(0,0,0,0.03)] relative transition-colors duration-200">
        {/* Left: LOGO & Badge matching reference image */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Scissors className="w-4 h-4" />
            </div>
            <span className="font-black tracking-wider text-sm text-slate-900 dark:text-white uppercase font-sans">
              AUTOCUT
            </span>

            {/* Trạng thái dữ liệu */}
            {data.mode === "raw" ? (
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-700/60 flex items-center gap-1.5 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Chưa phân tích AI
              </span>
            ) : (
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-700/60 flex items-center gap-1.5 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Đã phân tích bởi AI
              </span>
            )}
          </div>
        </div>

        {/* Center: Video Title */}
        <div className="hidden md:flex items-center justify-center absolute left-1/2 -translate-x-1/2 text-xs font-mono text-slate-600 dark:text-slate-300 font-medium">
          {data.video || "Bai08_Ep_kieu_du_lieu.mp4"}
        </div>

        {/* Right: Actions & User Account */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Nút Phân Tích AI / Chạy Lại AI */}
          {onAnalyzeAI && (
            <button
              onClick={onAnalyzeAI}
              disabled={isAnalyzing}
              title="Phân tích nội dung video, trích xuất âm thanh và bóc băng lời thoại bằng AI"
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition shadow-2xs cursor-pointer ${
                data.mode === "raw"
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 shadow-indigo-200"
                  : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang phân tích AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500 fill-indigo-200" />
                  <span>{data.mode === "raw" ? "Phân tích AI" : "Chạy lại AI"}</span>
                </>
              )}
            </button>
          )}

          {/* Nút Thêm Video trên Taskbar */}
          <button
            onClick={onOpenAddVideo}
            title="Thêm video từ liên kết URL hoặc tệp máy tính"
            className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition hover:scale-102 active:scale-98"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm Video</span>
          </button>

          {/* Nút Lưu Dự Án (Ctrl+S) */}
          {onSave && (
            <button
              onClick={onSave}
              disabled={isSaving}
              title="Lưu trạng thái dự án phân lập User và đồng bộ Cloudflare R2 (Ctrl + S)"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs transition disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                  <span className="hidden sm:inline">Đang lưu...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden sm:inline">Lưu (Ctrl+S)</span>
                </>
              )}
            </button>
          )}

          {/* Nút Xuất JSON */}
          {onExport && (
            <button
              onClick={onExport}
              title="Tải tệp segments.json về máy tính"
              className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs transition"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Xuất JSON</span>
            </button>
          )}

          {/* Export Button (Render video segments) */}
          <button
            onClick={onRender}
            disabled={isRendering}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
          >
            {isRendering ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Rendering...</span>
              </>
            ) : (
              <span>Export</span>
            )}
          </button>

          {/* Ô Thay Đổi Màu Nền Trang Web (Hơn 16 màu sáng & tối + Tự chọn) */}
          <ThemeColorPicker
            currentColor={themeColor}
            onColorChange={onThemeColorChange}
          />

          {/* User Account Dropdown with Avatar */}
          {user && (
            <div className="relative pl-2 border-l border-slate-200/80 dark:border-white/10" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-full hover:bg-slate-100/80 dark:hover:bg-white/10 transition border border-transparent hover:border-slate-200/80 dark:hover:border-white/10"
              >
                {/* Avatar Circle */}
                <div
                  className={`w-7 h-7 rounded-full bg-gradient-to-tr ${
                    user.avatarColor || "from-indigo-600 to-blue-600"
                  } flex items-center justify-center text-white text-xs font-bold shadow-xs ring-1 ring-white/40`}
                >
                  {initial}
                </div>

                {/* Account Name */}
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 hidden sm:inline max-w-[120px] truncate">
                  {user.name}
                </span>

                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {/* Dropdown Menu */}
              {showDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-white/10 rounded-2xl shadow-xl p-2 z-50 text-xs animate-in fade-in duration-150 text-slate-800 dark:text-slate-100">
                  {/* User Profile Header in dropdown */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-white/10 mb-1.5 flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${
                        user.avatarColor || "from-indigo-600 to-blue-600"
                      } flex items-center justify-center text-white text-sm font-bold shadow-xs shrink-0`}
                    >
                      {initial}
                    </div>
                    <div className="overflow-hidden">
                      <div className="font-bold text-slate-900 dark:text-white truncate text-xs">{user.name}</div>
                      <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold truncate">{user.role}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{user.email}</div>
                    </div>
                  </div>

                  {/* Menu Options */}
                  <div className="space-y-0.5">
                    <button
                      onClick={() => openAccountModal("profile")}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-slate-700 dark:text-slate-200 hover:text-indigo-700 dark:hover:text-indigo-400 hover:bg-slate-100/80 dark:hover:bg-white/10 transition font-medium"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                      <span>Thông tin tài khoản</span>
                    </button>

                    <button
                      onClick={() => openAccountModal("password")}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-slate-700 dark:text-slate-200 hover:text-indigo-700 dark:hover:text-indigo-400 hover:bg-slate-100/80 dark:hover:bg-white/10 transition font-medium"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                      <span>Đổi mật khẩu</span>
                    </button>

                    <div className="my-1 border-t border-slate-100 dark:border-white/10" />

                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition font-medium"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Đăng xuất</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Account Management Modal */}
      {user && (
        <AccountModal
          isOpen={accountModalOpen}
          initialTab={accountModalTab}
          user={user}
          onClose={() => setAccountModalOpen(false)}
          onUserUpdate={(updatedUser) => {
            if (onUserUpdate) onUserUpdate(updatedUser);
          }}
        />
      )}
    </>
  );
};
