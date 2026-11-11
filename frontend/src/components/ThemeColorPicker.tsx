"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Palette, Check, RotateCcw, X, Sparkles, Sun, Moon, Pipette, AlertCircle } from "lucide-react";

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
 * Chuẩn hóa mọi định dạng màu đầu vào:
 * - Hex 3 ký tự (fff), Hex 6 ký tự (f4f6f8 hoặc #f4f6f8)
 * - Tên màu chuẩn CSS: red, blue, black, navy, pink, salmon, teal...
 * - rgb(), rgba(), hsl()...
 */
export function normalizeColor(input: string): string | null {
  if (!input) return null;
  let trimmed = input.trim();

  // Nếu người dùng gõ mã hex 3 hoặc 6 ký tự mà quên gõ dấu '#' (vd: '0f172a' hoặc 'fff')
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed) || /^[0-9A-Fa-f]{3}$/.test(trimmed)) {
    trimmed = `#${trimmed}`;
  }

  // Nếu là mã Hex hợp lệ (#123, #123456, #12345678)
  if (/^#[0-9A-Fa-f]{3,8}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // Kiểm tra tên màu CSS hoặc rgb/hsl bằng thuộc tính style của browser
  if (typeof window !== "undefined") {
    const testDiv = document.createElement("div");
    testDiv.style.color = "";
    testDiv.style.color = trimmed;
    if (testDiv.style.color !== "") {
      return trimmed.toLowerCase();
    }
  }

  return null;
}

/**
 * Tính toán độ sáng tương đối (perceived luminance) để tự động nhận diện màu sáng hay tối
 */
export function isColorDark(color: string): boolean {
  if (!color) return false;

  // Dùng 2D canvas context để tính toán chuẩn xác cho mọi định dạng (Hex, Tên màu, rgb)
  if (typeof window !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const imgData = ctx.getImageData(0, 0, 1, 1).data;
        const r = imgData[0];
        const g = imgData[1];
        const b = imgData[2];
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        return luminance < 140;
      }
    } catch {
      // fallback
    }
  }

  // Fallback hex
  let clean = color.trim().replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    return 0.299 * r + 0.587 * g + 0.114 * b < 140;
  }
  return false;
}

/**
 * Áp dụng màu nền vào hệ thống: CSS variables, body background và class .dark
 */
export function applyWebBackgroundColor(color: string): boolean {
  if (typeof window === "undefined") return false;

  const validColor = normalizeColor(color) || DEFAULT_BG_COLOR;
  const isDark = isColorDark(validColor);
  const root = document.documentElement;

  root.style.setProperty("--background", validColor);
  root.style.setProperty("--app-bg", validColor);

  if (isDark) {
    root.classList.add("dark");
    root.style.setProperty("--foreground", "#f8fafc");
  } else {
    root.classList.remove("dark");
    root.style.setProperty("--foreground", "#0f172a");
  }

  document.body.style.backgroundColor = validColor;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, validColor);
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAppliedSuccess, setShowAppliedSuccess] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);

  // Đọc màu đã lưu từ localStorage khi mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (saved) {
          const norm = normalizeColor(saved) || DEFAULT_BG_COLOR;
          setSelectedColor(norm);
          setCustomHex(norm);
          const isDark = applyWebBackgroundColor(norm);
          onColorChange?.(norm, isDark);
        } else {
          applyWebBackgroundColor(DEFAULT_BG_COLOR);
        }
      } catch {
        // ignore
      }
    }
  }, [onColorChange]);

  // Cập nhật selectedColor khi prop currentColor thay đổi từ bên ngoài
  useEffect(() => {
    if (currentColor && currentColor !== selectedColor) {
      setSelectedColor(currentColor);
      setCustomHex(currentColor);
    }
  }, [currentColor, selectedColor]);

  // Đóng popover khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setErrorMsg(null);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Hàm chọn màu xem trước tức thì (Live Preview)
  const handlePreviewColor = useCallback(
    (color: string) => {
      const norm = normalizeColor(color);
      if (!norm) return;
      setErrorMsg(null);
      setSelectedColor(norm);
      setCustomHex(norm);
      const isDark = applyWebBackgroundColor(norm);
      onColorChange?.(norm, isDark);
    },
    [onColorChange]
  );

  // Hàm "Áp dụng" chính: Xác nhận màu, lưu bền vững và đóng bảng màu
  const handleApplyColor = (colorToApply?: string) => {
    const rawTarget = colorToApply || customHex || selectedColor;
    const normalized = normalizeColor(rawTarget);

    if (!normalized) {
      setErrorMsg("Mã màu không hợp lệ! Vui lòng nhập mã HEX (vd: #0f172a, #ffffff) hoặc tên màu tiếng Anh (vd: navy, pink).");
      return;
    }

    setErrorMsg(null);
    setSelectedColor(normalized);
    setCustomHex(normalized);
    const isDark = applyWebBackgroundColor(normalized);
    onColorChange?.(normalized, isDark);

    // Hiển thị thông báo thành công và đóng popover
    setShowAppliedSuccess(true);
    setTimeout(() => {
      setShowAppliedSuccess(false);
      setIsOpen(false);
    }, 450);
  };

  const handleCustomFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleApplyColor(customHex);
  };

  const handleResetDefault = () => {
    setErrorMsg(null);
    handleApplyColor(DEFAULT_BG_COLOR);
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
        onClick={() => {
          setIsOpen(!isOpen);
          setErrorMsg(null);
        }}
        title="Đổi màu nền giao diện website (Hơn 16 màu sáng & tối + Tùy chọn tự do)"
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
        <div className="absolute right-0 mt-2 w-[340px] sm:w-[410px] bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 text-slate-800 select-none">
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
                  {THEME_COLOR_PRESETS.length} màu sáng & tối phong phú (Nhấp để chọn & áp dụng)
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setIsOpen(false);
                setErrorMsg(null);
              }}
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
          <div className="space-y-4 max-h-[250px] overflow-y-auto pr-1">
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
                        onClick={() => handlePreviewColor(preset.hex)}
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
                        onClick={() => handlePreviewColor(preset.hex)}
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

            <form onSubmit={handleCustomFormSubmit} className="flex items-center gap-2">
              {/* Native Color Picker Dropper */}
              <div
                className="relative w-9 h-8 rounded-xl overflow-hidden border border-slate-300 shrink-0 shadow-2xs cursor-pointer hover:border-indigo-400"
                title="Mở bảng pha màu trực quan"
              >
                <input
                  type="color"
                  value={selectedColor.startsWith("#") && selectedColor.length === 7 ? selectedColor : "#ffffff"}
                  onChange={(e) => handlePreviewColor(e.target.value)}
                  className="absolute -inset-2 w-14 h-14 cursor-pointer opacity-100"
                />
              </div>

              {/* Hex / Color Text Input */}
              <input
                type="text"
                value={customHex}
                onChange={(e) => {
                  setCustomHex(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="#0f172a hoặc tên màu"
                className="flex-1 px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500 shadow-2xs focus:ring-1 focus:ring-indigo-500"
              />

              {/* Nút Áp dụng ô nhập */}
              <button
                type="button"
                onClick={() => handleApplyColor(customHex)}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-2xs transition hover:scale-102 active:scale-98 cursor-pointer shrink-0"
                title="Áp dụng mã màu vừa nhập và đóng bảng màu"
              >
                Áp dụng
              </button>
            </form>

            {/* Thông báo lỗi nếu mã màu sai định dạng */}
            {errorMsg && (
              <div className="mt-2 p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-center gap-1.5 animate-in fade-in duration-150">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* 4. Nút Hành Động Xác Nhận Cuối Bảng Màu */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => handleApplyColor(selectedColor)}
              className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs shadow-xs transition hover:scale-101 active:scale-98 flex items-center justify-center gap-1.5 cursor-pointer"
              title="Xác nhận áp dụng màu nền này cho toàn trang web và đóng bảng chọn"
            >
              {showAppliedSuccess ? (
                <>
                  <Check className="w-4 h-4 stroke-[3] text-emerald-300 animate-bounce" />
                  <span>✓ Đã áp dụng thành công!</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Áp Dụng Màu Này & Đóng</span>
                </>
              )}
            </button>

            {/* Dòng trạng thái & Nút Mặc định */}
            <div className="flex items-center justify-between text-[11px] px-0.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <span>Đang chọn:</span>
                <span className="font-bold text-slate-800">
                  {activePreset
                    ? activePreset.name
                    : isCurrentDark
                    ? "Màu tối tùy chỉnh"
                    : "Màu sáng tùy chỉnh"}
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
        </div>
      )}
    </div>
  );
};
