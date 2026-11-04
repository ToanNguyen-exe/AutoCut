"use client";

import React, { useState, useRef, useEffect } from "react";
import { User, SegmentsData } from "@/types";
import { logoutUser } from "@/lib/auth";
import { useRouter } from "next/navigation";
import {
  Scissors,
  Download,
  RefreshCw,
  LogOut,
  Plus,
  User as UserIcon,
  KeyRound,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { AccountModal } from "@/components/AccountModal";

interface StudioHeaderProps {
  user: User | null;
  data: SegmentsData;
  backendOnline?: boolean;
  isRendering: boolean;
  isAnalyzing?: boolean;
  isDemo?: boolean;
  onRefreshFromBackend?: () => void;
  onExport?: () => void;
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
  isDemo = false,
  onExport,
  onRender,
  onOpenAddVideo,
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
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 select-none shrink-0 z-40">
        {/* Left: LOGO & Project Name */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-purple-600/20">
              <Scissors className="w-4 h-4" />
            </div>
            <span className="font-extrabold tracking-widest text-sm text-slate-900 uppercase font-sans">
              YOUR LOGO
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 ml-2 hidden sm:inline-block">
              AutoCut AI
            </span>

            {/* Trạng thái dữ liệu: Demo vs Đang phân tích vs Chưa phân tích vs Đã phân tích */}
            {isDemo ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Demo Mẫu
              </span>
            ) : isAnalyzing ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse flex items-center gap-1 shadow-2xs">
                <RefreshCw className="w-2.5 h-2.5 animate-spin text-indigo-600" />
                Đang phân tích AI...
              </span>
            ) : data.mode === "raw" ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Chưa phân tích (1 đoạn)
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                ✓ AI Đã phân tích
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions & User Account */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Nút Phân Tích AI nổi bật khi video ở trạng thái thô (chưa phân tích) */}
          {data.mode === "raw" && onAnalyzeAI && (
            <button
              onClick={onAnalyzeAI}
              disabled={isAnalyzing}
              title="Khởi chạy Whisper & AI để phân tích video và phân đoạn thông minh"
              className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-2xs transition hover:scale-102 active:scale-98"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Phân Tích AI</span>
            </button>
          )}

          {/* Nút Thêm Video trên Taskbar */}
          <button
            onClick={onOpenAddVideo}
            title="Thêm video từ liên kết URL hoặc tệp máy tính"
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition hover:scale-102 active:scale-98"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm Video</span>
          </button>

          {/* Nút Xuất JSON */}
          {onExport && (
            <button
              onClick={onExport}
              title="Tải tệp segments.json về máy tính"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 shadow-2xs transition"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Xuất JSON</span>
            </button>
          )}

          {/* Export Button (Render video segments) */}
          <button
            onClick={onRender}
            disabled={isRendering}
            className="bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs px-4 py-1.5 rounded-lg shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
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

          {/* User Account Dropdown with Avatar */}
          {user && (
            <div className="relative pl-2 border-l border-slate-200" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-full hover:bg-slate-100 transition border border-transparent hover:border-slate-200"
              >
                {/* Avatar Circle */}
                <div
                  className={`w-7 h-7 rounded-full bg-gradient-to-tr ${
                    user.avatarColor || "from-purple-600 to-indigo-600"
                  } flex items-center justify-center text-white text-xs font-bold shadow-md ring-1 ring-white/10`}
                >
                  {initial}
                </div>

                {/* Account Name */}
                <span className="text-xs font-semibold text-slate-800 hidden sm:inline max-w-[120px] truncate">
                  {user.name}
                </span>

                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {/* Dropdown Menu */}
              {showDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 z-50 text-xs animate-in fade-in duration-150 backdrop-blur-xl">
                  {/* User Profile Header in dropdown */}
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 mb-1.5 flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${
                        user.avatarColor || "from-purple-600 to-indigo-600"
                      } flex items-center justify-center text-white text-sm font-bold shadow-md shrink-0`}
                    >
                      {initial}
                    </div>
                    <div className="overflow-hidden">
                      <div className="font-bold text-slate-900 truncate text-xs">{user.name}</div>
                      <div className="text-[10px] text-indigo-600 truncate">{user.role}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{user.email}</div>
                    </div>
                  </div>

                  {/* Action Items */}
                  <div className="space-y-0.5">
                    <button
                      onClick={() => openAccountModal("profile")}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition text-left"
                    >
                      <UserIcon className="w-4 h-4 text-indigo-600" />
                      <span>Thông tin tài khoản</span>
                    </button>

                    <button
                      onClick={() => openAccountModal("password")}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition text-left"
                    >
                      <KeyRound className="w-4 h-4 text-amber-400" />
                      <span>Đổi mật khẩu</span>
                    </button>

                    {onExport && (
                      <button
                        onClick={() => {
                          onExport();
                          setShowDropdown(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition text-left"
                      >
                        <Download className="w-4 h-4 text-indigo-400" />
                        <span>Xuất segments.json</span>
                      </button>
                    )}
                  </div>

                  <div className="h-[1px] bg-slate-800/80 my-1" />

                  {/* Logout Button */}
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition text-left font-medium"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Đăng xuất tài khoản</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Account Settings / Change Password Modal */}
      <AccountModal
        isOpen={accountModalOpen}
        initialTab={accountModalTab}
        user={user}
        onClose={() => setAccountModalOpen(false)}
        onUserUpdate={(updatedUser) => {
          if (onUserUpdate) onUserUpdate(updatedUser);
        }}
      />
    </>
  );
};
