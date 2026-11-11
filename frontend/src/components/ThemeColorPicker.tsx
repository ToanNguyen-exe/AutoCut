"use client";

import React, { useState, useEffect, useRef } from "react";
import { Palette, Check, RotateCcw, X, Sparkles, Sun, Moon, Pipette } from "lucide-react";

export interface ThemeColorOption {
  id: string;
  name: string;
  hex: string;
  type: "light" | "dark";
  border: string;
  description: string;
}

export const THEME_COLOR_PRESETS: ThemeColorOption[] = [
  // --- NHÓM MÀU SÁNG (8 màu) ---
  {
    id: "clean-white",
    name: "Trắng Tinh Khôi",
    hex: "#ffffff",
    type: "light",
    border: "#e2e8f0",
    description: "Sáng sủa, thanh lịch chuẩn phòng thu",
  },
  {
    id: "studio-slate",
    name: "Xám Studio Chuẩn",
    hex: "#f4f6f8",
    type: "light",
    border: "#cbd5e1",
    description: "Cân bằng, dịu mắt (Mặc định)",
  },
  {
    id: "minimal-gray",
    name: "Xám Bạc Minimal",
    hex: "#e2e8f0",
    type: "light",
    border: "#94a3b8",
    description: "Tối giản, trang nhã, hiện đại",
  },
  {
    id: "warm-cream",
    name: "Vàng Kem Ấm Áp",
    hex: "#fef9c3",
    type: "light",
    border: "#fde047",
    description: "Tone ấm cúng, thư giãn thị giác",
  },
  {
    id: "mint-breeze",
    name: "Bạc Hà Dịu Mắt",
    hex: "#ecfdf5",
    type: "light",
    border: "#6ee7b7",
    description: "Mát mẻ, giảm mỏi mắt khi dựng lâu",
  },
  {
    id: "sky-soft",
    name: "Lam Nhạt Dịu Êm",
    hex: "#e0f2fe",
    type: "light",
    border: "#7dd3fc",
    description: "Thanh thoát, tươi mới, tràn cảm hứng",
  },
  {
    id: "lavender-mist",
    name: "Oải Hương Lavender",
    hex: "#f3e8ff",
    type: "light",
    border: "#d8b4fe",
    description: "Nhẹ nhàng, tinh tế và mộng mơ",
  },
  {
    id: "rose-blush",
    name: "Hồng Phấn Tươi Trẻ",
    hex: "#ffe4e6",
    type: "light",
    border: "#fecdd3",
    description: "Nổi bật, năng động và độc đáo",
  },

  // --- NHÓM MÀU TỐI & ĐIỆN ẢNH (8 màu) ---
  {
    id: "pure-black",
    name: "Đen OLED Tuyệt Đối",
    hex: "#000000",
    type: "dark",
    border: "#27272a",
    description: "Đen tuyền rạp phim, tối đa pin OLED",
  },
  {
    id: "midnight-navy",
    name: "Xanh Đêm Hải Quân",
    hex: "#030712",
    type: "dark",
    border: "#1f2937",
    description: "Huyền bí, tập trung cao độ khi edit",
  },
  {
    id: "charcoal-dark",
    name: "Xám Đen Carbon",
    hex: "#0f172a",
    type: "dark",
    border: "#334155",
    description: "Đẳng cấp, độ tương phản sắc nét",
  },
  {
    id: "dark-slate",
    name: "Xám Kim Loại Đậm",
    hex: "#1e293b",
    type: "dark",
    border: "#475569",
    description: "Chuyên nghiệp như phần mềm NLE Studio",
  },
  {
    id: "forest-deep",
    name: "Xanh Rêu Đêm",
    hex: "#064e3b",
    type: "dark",
    border: "#047857",
    description: "Trầm ấm, thư thái với sắc xanh đại ngàn",
  },
  {
    id: "cyber-violet",
    name: "Tím Cyberpunk",
    hex: "#1e1b4b",
    type: "dark",
    border: "#4338ca",
    description: "Đậm chất tương lai và công nghệ số",
  },
  {
    id: "espresso-dark",
    name: "Cà Phê Espresso",
    hex: "#1c1917",
    type: "dark",
    border: "#44403c",
    description: "Cổ điển, ấm áp tựa tách cà phê đậm",
  },
  {
    id: "deep-wine",
    name: "Đỏ Mận Rượu Vang",
    hex: "#4c0519",
    type: "dark",
    border: "#881337",
    description: "Sang trọng, quyền quý và phá cách",
  },
];

export const DEFAULT_BG_COLOR = "#f4f6f8";
export const THEME_STORAGE_KEY = "autocut_web_bg_color";

/**
 * Tính toán độ sáng tương đối (perceived luminance) để tự động nhận diện màu sáng hay tối
 */
export function isColorDark(hex: string): boolean {
  if (!hex) return false;
  let clean = hex.trim().replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6) return false;

  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;

  // Công thức chuẩn ITU-R BT.709
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 140;
}

/**
 * Áp dụng màu nền vào hệ thống: CSS variables, body background và class .dark
 */
export function applyWebBackgroundColor(color: string): boolean {
  if (typeof window === "undefined") return false;

  const isDark = isColorDark(color);
  const root = document.documentElement;

  root.style.setProperty("--background", color);
  root.style.setProperty("--app-bg", color);

  if (isDark) {
    root.classList.add("dark");
    root.style.setProperty("--foreground", "#f8fafc");
  } else {
    root.classList.remove("dark");
    root.style.setProperty("--foreground", "#0f172a");
  }

  document.body.style.backgroundColor = color;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, color);
  } catch (e) {
    console.warn("Không thể lưu theme vào localStorage:", e);
  }

  return isDark;
}

interface ThemeColorPickerProps {
  currentColor?: string;
  onColorChange?: (color: string, isDark: boolean) => void;
  className?: string;
}

export const ThemeColorPicker: React.FC<ThemeColorPickerProps> = ({
  currentColor,
  onColorChange,
  className = "",
}) => {
  const [selectedColor, setSelectedColor] = useState<string>(currentColor || DEFAULT_BG_COLOR);
  const [isOpen, setIsOpen] = useState(false);
  const [customHex, setCustomHex] = useState(currentColor || DEFAULT_BG_COLOR);
  const [colorFilter, setColorFilter] = useState<"all" | "light" | "dark">("all");

  const popoverRef = useRef<HTMLDivElement>(null);

  // Đọc màu đã lưu từ localStorage khi mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (saved) {
          setSelectedColor(saved);
          setCustomHex(saved);
          const isDark = applyWebBackgroundColor(saved);
          onColorChange?.(saved, isDark);
        } else {
          applyWebBackgroundColor(DEFAULT_BG_COLOR);
        }
      } catch {
        // ignore
      }
    }
  }, [onColorChange]);

  // Đóng popover khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSelectColor = (color: string) => {
    setSelectedColor(color);
    setCustomHex(color);
    const isDark = applyWebBackgroundColor(color);
    onColorChange?.(color, isDark);
  };

  const handleResetDefault = () => {
    handleSelectColor(DEFAULT_BG_COLOR);
  };

  const handleCustomHexSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let clean = customHex.trim();
    if (!clean.startsWith("#")) {
      clean = `#${clean}`;
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(clean) || /^#[0-9A-Fa-f]{3}$/.test(clean)) {
      handleSelectColor(clean);
    }
  };

  const isCurrentDark = isColorDark(selectedColor);
  const lightPresets = THEME_COLOR_PRESETS.filter((c) => c.type === "light");
  const darkPresets = THEME_COLOR_PRESETS.filter((c) => c.type === "dark");

  const activePreset = THEME_COLOR_PRESETS.find(
    (p) => p.hex.toLowerCase() === selectedColor.toLowerCase()
  );

  return (
    <div className={`relative ${className}`} ref={popoverRef}>
      {/* Nút Kích Hoạt Ô Đổi Màu Nền (Trigger Button) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Đổi màu nền giao diện website (Hơn 16 màu sáng & tối)"
        className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition-all shadow-2xs cursor-pointer select-none ${
          isOpen
            ? "bg-indigo-50 border-indigo-400 text-indigo-700 ring-2 ring-indigo-200"
            : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300"
        }`}
      >
        <Palette className="w-4 h-4 text-indigo-600" />

        {/* Ô màu tròn hiển thị màu nền hiện tại */}
        <span
          className="w-4 h-4 rounded-full border border-black/20 shadow-2xs shrink-0 transition-transform group-hover:scale-110"
          style={{ backgroundColor: selectedColor }}
        />

        <span className="hidden xl:inline text-xs font-bold text-slate-800">
          Màu nền
        </span>
      </button>

      {/* Popover Bảng Màu Chi Tiết */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-[340px] sm:w-[400px] bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 text-slate-800">
          {/* Header Bảng Màu */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-2xs">
                <Palette className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-900 leading-tight">
                  Màu Nền Trang Web
                </h4>
                <p className="text-[11px] text-slate-500 font-medium">
                  {THEME_COLOR_PRESETS.length} màu sáng & tối phong phú
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              title="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Bộ lọc hiển thị (Tất cả / Sáng / Tối) */}
          <div className="flex items-center gap-1 my-3 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setColorFilter("all")}
              className={`flex-1 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1 ${
                colorFilter === "all"
                  ? "bg-white text-indigo-700 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Sparkles className="w-3 h-3 text-indigo-500" />
              <span>Tất cả ({THEME_COLOR_PRESETS.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setColorFilter("light")}
              className={`flex-1 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1 ${
                colorFilter === "light"
                  ? "bg-white text-amber-700 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Sun className="w-3 h-3 text-amber-500" />
              <span>Sáng ({lightPresets.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setColorFilter("dark")}
              className={`flex-1 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1 ${
                colorFilter === "dark"
                  ? "bg-white text-indigo-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Moon className="w-3 h-3 text-indigo-700" />
              <span>Tối ({darkPresets.length})</span>
            </button>
          </div>

          {/* Vùng Danh Sách Màu Có Cuộn Mượt */}
          <div className="space-y-4 max-h-[290px] overflow-y-auto pr-1">
            {/* 1. Nhóm Màu Sáng */}
            {(colorFilter === "all" || colorFilter === "light") && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-slate-700 font-bold text-[11px]">
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  <span>Màu Sáng ({lightPresets.length} màu)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {lightPresets.map((preset) => {
                    const isSelected = selectedColor.toLowerCase() === preset.hex.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectColor(preset.hex)}
                        title={`${preset.name}: ${preset.description}`}
                        className={`group relative p-2 rounded-xl border text-left transition-all duration-150 flex flex-col gap-1.5 cursor-pointer hover:scale-102 active:scale-98 ${
                          isSelected
                            ? "border-2 border-indigo-600 bg-indigo-50/50 shadow-sm ring-1 ring-indigo-200"
                            : "border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 shadow-2xs"
                        }`}
                      >
                        {/* Khối màu hiển thị */}
                        <div
                          className="w-full h-8 rounded-lg relative border flex items-center justify-center shadow-inner"
                          style={{
                            backgroundColor: preset.hex,
                            borderColor: preset.border,
                          }}
                        >
                          {isSelected && (
                            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        {/* Tên màu */}
                        <span className="text-[11px] font-bold text-slate-800 line-clamp-1">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. Nhóm Màu Tối & Rạp Phim */}
            {(colorFilter === "all" || colorFilter === "dark") && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-slate-700 font-bold text-[11px]">
                  <Moon className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Màu Tối & Rạp Phim ({darkPresets.length} màu)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {darkPresets.map((preset) => {
                    const isSelected = selectedColor.toLowerCase() === preset.hex.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectColor(preset.hex)}
                        title={`${preset.name}: ${preset.description}`}
                        className={`group relative p-2 rounded-xl border text-left transition-all duration-150 flex flex-col gap-1.5 cursor-pointer hover:scale-102 active:scale-98 ${
                          isSelected
                            ? "border-2 border-indigo-600 bg-indigo-50/50 shadow-sm ring-1 ring-indigo-200"
                            : "border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 shadow-2xs"
                        }`}
                      >
                        {/* Khối màu hiển thị */}
                        <div
                          className="w-full h-8 rounded-lg relative border flex items-center justify-center shadow-inner"
                          style={{
                            backgroundColor: preset.hex,
                            borderColor: preset.border,
                          }}
                        >
                          {isSelected && (
                            <span className="w-5 h-5 rounded-full bg-white text-indigo-700 flex items-center justify-center shadow-xs">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        {/* Tên màu */}
                        <span className="text-[11px] font-bold text-slate-800 line-clamp-1">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 3. Tùy Chọn Tự Nhập Mã Màu (Custom Color Picker) */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 mb-2">
              <span className="flex items-center gap-1.5">
                <Pipette className="w-3.5 h-3.5 text-indigo-600" />
                <span>Hoặc tự chọn màu bất kỳ:</span>
              </span>
              <span className="font-mono text-slate-500 uppercase font-semibold">
                {selectedColor}
              </span>
            </div>

            <form onSubmit={handleCustomHexSubmit} className="flex items-center gap-2">
              {/* Native Color Picker Dropper */}
              <div className="relative w-9 h-8 rounded-xl overflow-hidden border border-slate-300 shrink-0 shadow-2xs cursor-pointer hover:border-indigo-400">
                <input
                  type="color"
                  value={selectedColor.startsWith("#") ? selectedColor : "#ffffff"}
                  onChange={(e) => handleSelectColor(e.target.value)}
                  className="absolute -inset-2 w-14 h-14 cursor-pointer opacity-100"
                  title="Mở bảng pha màu tùy ý"
                />
              </div>

              {/* Hex Text Input */}
              <input
                type="text"
                value={customHex}
                onChange={(e) => setCustomHex(e.target.value)}
                placeholder="#123456"
                className="flex-1 px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs font-mono uppercase text-slate-800 outline-none focus:border-indigo-500 shadow-2xs focus:ring-1 focus:ring-indigo-500"
              />

              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-2xs transition cursor-pointer"
              >
                Áp dụng
              </button>
            </form>
          </div>

          {/* Footer: Thông tin & Nút Đặt Lại Mặc Định */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-500">
              <span>Đang dùng:</span>
              <span className="font-bold text-slate-800">
                {activePreset ? activePreset.name : isCurrentDark ? "Màu tối tùy chỉnh" : "Màu sáng tùy chỉnh"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleResetDefault}
              className="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 hover:underline cursor-pointer"
              title="Đặt lại màu xám Studio mặc định (#f4f6f8)"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Mặc định</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
