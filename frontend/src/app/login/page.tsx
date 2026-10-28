"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { loginUser, getAllUsers } from "@/lib/auth";
import { Scissors, Lock, User as UserIcon, ArrowRight, ShieldCheck, Key } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mockUsers = getAllUsers();

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    setTimeout(() => {
      const res = loginUser(username, password);
      if (res.success) {
        router.push("/");
      } else {
        setError(res.message || "Đăng nhập thất bại");
        setLoading(false);
      }
    }, 400);
  };

  const fillQuickAccount = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#0d0e12] text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-purple-600 selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] bg-purple-600/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[250px] bg-indigo-600/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo and Studio Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 shadow-xl shadow-purple-600/30 text-white mb-4 border border-purple-400/30">
            <Scissors className="w-7 h-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
            AutoCut <span className="text-purple-400 font-mono">STUDIO</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1.5">
            Hệ thống phân đoạn &amp; dựng video bài giảng AI thông minh
          </p>
        </div>

        {/* Card Form */}
        <div className="bg-[#16171d]/90 border border-slate-800/90 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              <span>Đăng nhập hệ thống</span>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
              v1.0-prod
            </span>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Tài khoản (Username)
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Nhập tên đăng nhập (vd: admin, sv4...)"
                  className="w-full bg-[#0d0e12] border border-slate-800 focus:border-purple-500 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none transition shadow-inner"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Mật khẩu (Password)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu..."
                  className="w-full bg-[#0d0e12] border border-slate-800 focus:border-purple-500 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none transition shadow-inner"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition flex items-center justify-center gap-2 group disabled:opacity-50"
            >
              <span>{loading ? "Đang xác thực..." : "Đăng nhập Studio"}</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </form>

          {/* Quick Test Accounts Filler */}
          <div className="mt-6 pt-5 border-t border-slate-800/80">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2.5">
              <Key className="w-3.5 h-3.5 text-purple-400" />
              <span>Tài khoản mẫu để test (Nhấp để tự điền):</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {mockUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => fillQuickAccount(u.username, u.password || "")}
                  className="p-2 rounded-lg bg-slate-900 hover:bg-purple-950/40 border border-slate-800 hover:border-purple-500/40 text-left transition group"
                >
                  <div className="font-semibold text-slate-200 group-hover:text-purple-300 truncate">
                    {u.name}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {u.username} / {u.password}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-slate-500">
          Dự án AutoCut AI • Nhóm 4 sinh viên • Phân đoạn video bài giảng
        </div>
      </div>
    </div>
  );
}
