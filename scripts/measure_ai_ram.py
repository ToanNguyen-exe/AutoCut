"""Đo RAM đỉnh của Whisper cục bộ khi bóc băng thật (không qua Groq).

Đo trong chính tiến trình này bằng GetProcessMemoryInfo, lấy mẫu 50ms ở một
luồng nền để bắt đúng đỉnh lúc model được nạp.
"""
import ctypes
import gc
import json
import os
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)


class PMC(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
    ]

k32.GetCurrentProcess.restype = wintypes.HANDLE
psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
psapi.GetProcessMemoryInfo.restype = wintypes.BOOL


def rss_mb() -> float:
    c = PMC()
    c.cb = ctypes.sizeof(PMC)
    psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    return c.WorkingSetSize / 1024 / 1024


class Sampler:
    """Lấy mẫu RSS ở luồng nền để bắt đỉnh trong lúc model đang nạp."""

    def __init__(self, interval=0.05):
        self.interval = interval
        self.peak = 0.0
        self.samples = []
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.is_set():
            m = rss_mb()
            self.peak = max(self.peak, m)
            self.samples.append(m)
            time.sleep(self.interval)

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._t.join(timeout=1)


def run(label: str, media: Path, beam: int):
    from backend.ai import whisper_service, config_loader, groq_service

    # config_loader nạp .env vào os.environ, nên phải xoá key SAU khi import,
    # đồng thời vô hiệu hoá hẳn hàm Groq để chắc chắn chạy Whisper cục bộ.
    os.environ.pop("WHISPER_API_KEY", None)
    os.environ.pop("GROQ_API_KEY", None)

    def _groq_disabled(*a, **k):
        raise RuntimeError("Groq tắt để đo RAM Whisper cục bộ")

    groq_service.transcribe_with_groq = _groq_disabled

    cfg = config_loader.AIConfig()
    cfg.whisper_api_key = ""
    cfg.whisper_beam_size = beam
    whisper_service.default_ai_config = cfg

    from backend.ai.whisper_service import WhisperTranscriber

    gc.collect()
    base = rss_mb()
    t0 = time.perf_counter()
    with Sampler() as s:
        tr = WhisperTranscriber(model_size="small", cache_dir=str(ROOT / "cache"))
        out = tr.transcribe(str(media), force_recompute=True, release_after_use=True)
    elapsed = time.perf_counter() - t0
    after = rss_mb()

    print(f"{label}")
    print(f"  beam_size        : {beam}")
    print(f"  model giải phóng : {tr._model is None}")
    print(f"  thời gian        : {elapsed:5.1f} s")
    print(f"  số câu           : {len(out.sentences)}")
    print(f"  RAM nền          : {base:6.0f} MB")
    print(f"  RAM đỉnh         : {s.peak:6.0f} MB   (tăng {s.peak - base:.0f} MB)")
    print(f"  RAM sau khi xong : {after:6.0f} MB   (đã nhả {s.peak - after:.0f} MB)")
    step = max(1, len(s.samples) // 8)
    print("  diễn biến (MB)   : " + " → ".join(f"{s.samples[i]:.0f}" for i in range(0, len(s.samples), step)))
    print()
    return {"beam": beam, "peak": round(s.peak), "after_release": round(after),
            "seconds": round(elapsed, 1), "sentences": len(out.sentences),
            "model_released": tr._model is None}


if __name__ == "__main__":
    media = Path(sys.argv[1]) if len(sys.argv) > 1 else (ROOT / "input" / "vibe_short.mp4")
    print(f"file test: {media.name} ({media.stat().st_size/1024/1024:.0f} MB)\n")
    results = [
        run("A. Lần chạy đầu — còn thử nạp CUDA (thiếu cublas)", media, 5),
        run("B. Lần chạy sau — đã nhớ CUDA hỏng, vào thẳng CPU int8", media, 5),
    ]
    print("TÓM TẮT")
    print(json.dumps(results, ensure_ascii=False, indent=2))
