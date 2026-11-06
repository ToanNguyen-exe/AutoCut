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
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-center items-center p-4 selection:bg-indigo-600 selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] bg-indigo-100 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[250px] bg-blue-100 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo and Studio Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 shadow-md text-white mb-4">
            <Scissors className="w-7 h-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center justify-center gap-2">
            AutoCut <span className="text-indigo-600 font-mono">STUDIO</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1.5 font-medium">
            Hệ thống phân đoạn &amp; dựng video bài giảng AI thông minh
          </p>
        </div>

        {/* Card Form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              <span>Đăng nhập hệ thống</span>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono font-bold">
              v1.0-prod
            </span>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tài khoản (Username)
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Nhập tên đăng nhập (vd: admin, sv4...)"
                  className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Mật khẩu (Password)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu..."
                  className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none transition shadow-2xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-2 group disabled:opacity-50"
            >
              <span>{loading ? "Đang xác thực..." : "Đăng nhập Studio"}</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </form>

          {/* Quick Test Accounts Filler */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2.5">
              <Key className="w-3.5 h-3.5 text-indigo-600" />
              <span>Tài khoản mẫu để test (Nhấp để tự điền):</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {mockUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => fillQuickAccount(u.username, u.password || "")}
                  className="p-2.5 rounded-xl bg-slate-50 hover:bg-indigo-50/60 border border-slate-200 hover:border-indigo-300 text-left transition group shadow-2xs"
                >
                  <div className="font-bold text-slate-800 group-hover:text-indigo-700 truncate">
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
        <div className="text-center mt-6 text-xs text-slate-500 font-medium">
          Dự án AutoCut AI • Nhóm 4 sinh viên • Phân đoạn video bài giảng
        </div>
      </div>
    </div>
  );
}
