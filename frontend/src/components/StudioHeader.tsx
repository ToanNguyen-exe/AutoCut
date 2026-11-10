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
  analysisProgress?: number;
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
  analysisProgress = 0,
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
      <header className="h-14 bg-slate-100 border-b border-slate-300 flex items-center justify-between px-4 lg:px-6 select-none shrink-0 z-40 text-slate-800">
        {/* Left: LOGO & Project Name */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Scissors className="w-4 h-4" />
            </div>
            <span className="font-extrabold tracking-widest text-sm text-slate-900 uppercase font-sans">
              YOUR LOGO
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 text-indigo-700 border border-slate-300 ml-2 hidden sm:inline-block font-semibold">
              AutoCut AI
            </span>

            {/* Trạng thái dữ liệu: Demo vs Đang phân tích vs Chưa phân tích vs Đã phân tích */}
            {isDemo ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Demo Mẫu
              </span>
            ) : isAnalyzing ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-300 animate-pulse flex items-center gap-1 shadow-2xs">
                <RefreshCw className="w-2.5 h-2.5 animate-spin text-indigo-600" />
                Đang phân tích AI...
              </span>
            ) : data.mode === "raw" ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-300 flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Chưa phân tích (1 đoạn)
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                ✓ AI Đã phân tích
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions & User Account */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Nút Phân Tích AI nổi bật khi video ở trạng thái thô (chưa phân tích) hoặc đang phân tích */}
          {((data.mode === "raw" && onAnalyzeAI) || isAnalyzing) && (
            <button
              onClick={onAnalyzeAI}
              disabled={isAnalyzing}
              title="Khởi chạy Whisper & AI để phân tích video và phân đoạn thông minh"
              className="flex items-center gap-2 text-xs font-bold px-3.5 py-1.5 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border border-indigo-300 shadow-2xs transition"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-700" />
                  <span>Đang phân tích AI: {Math.round(analysisProgress)}%</span>
                  <div className="w-12 bg-indigo-200 rounded-full h-1.5 overflow-hidden ml-1">
                    <div
                      className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(5, analysisProgress))}%` }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Phân Tích AI</span>
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

          {/* Nút Xuất JSON */}
          {onExport && (
            <button
              onClick={onExport}
              title="Tải tệp segments.json về máy tính"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-200/80 hover:bg-slate-300 text-slate-800 border border-slate-300 shadow-2xs transition"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Xuất JSON</span>
            </button>
          )}

          {/* Export Button (Render video segments) */}
          <button
            onClick={onRender}
            disabled={isRendering}
            className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-4 py-1.5 rounded-lg shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
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
            <div className="relative pl-2 border-l border-slate-300" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-full hover:bg-slate-200 transition border border-transparent hover:border-slate-300"
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
                <span className="text-xs font-bold text-slate-800 hidden sm:inline max-w-[120px] truncate">
                  {user.name}
                </span>

                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {/* Dropdown Menu */}
              {showDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-50 border border-slate-300 rounded-2xl shadow-xl p-2 z-50 text-xs animate-in fade-in duration-150 backdrop-blur-xl">
                  {/* User Profile Header in dropdown */}
                  <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 mb-1.5 flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${
                        user.avatarColor || "from-indigo-600 to-blue-600"
                      } flex items-center justify-center text-white text-sm font-bold shadow-xs shrink-0`}
                    >
                      {initial}
                    </div>
                    <div className="overflow-hidden">
                      <div className="font-bold text-slate-900 truncate text-xs">{user.name}</div>
                      <div className="text-[10px] text-indigo-700 font-semibold truncate">{user.role}</div>
                      <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
                    </div>
                  </div>

                  {/* Menu Options */}
                  <div className="space-y-0.5">
                    <button
                      onClick={() => openAccountModal("profile")}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-slate-700 hover:text-indigo-700 hover:bg-slate-200/70 transition font-medium"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                      <span>Thông tin tài khoản</span>
                    </button>

                    <button
                      onClick={() => openAccountModal("password")}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-slate-700 hover:text-indigo-700 hover:bg-slate-200/70 transition font-medium"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                      <span>Đổi mật khẩu</span>
                    </button>

                    <div className="my-1 border-t border-slate-200" />

                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-rose-600 hover:bg-rose-50 transition font-medium"
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
