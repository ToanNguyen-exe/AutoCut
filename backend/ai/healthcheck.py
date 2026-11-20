"""Script kiểm tra sức khỏe (Healthcheck) cho Docker container AutoCut (SV2 / Backend).

Hai chế độ hoạt động:
1. Liveness mặc định (`python -m backend.ai.healthcheck`):
   - Kiểm tra nhanh (< 100ms): HTTP GET tới Backend (mặc định http://127.0.0.1:8080/) trả mã 2xx.
   - Kiểm tra nhanh quyền thực thi Python hiện tại và binary FFmpeg (không import thư viện ML nặng mỗi 30s).
2. Kiểm tra môi trường phụ thuộc (`--check-deps`, dùng 1 lần lúc build Docker image hoặc startup):
   - Import thực tế các gói cốt lõi (faster_whisper, google.genai, pydantic, yaml, dotenv).
   - Chạy `ffmpeg -version` để xác thực bộ xử lý media hoạt động trên Linux/container.
"""

import argparse
import importlib
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Optional, Tuple

REQUIRED_MODULES = (
    "faster_whisper",
    "google.genai",
    "pydantic",
    "yaml",
    "dotenv",
)


def _resolve_ffmpeg_binary() -> str:
    return os.getenv("FFMPEG_PATH", "").strip() or "ffmpeg"


def _find_executable(binary: str) -> Optional[str]:
    """Tìm binary theo PATH hoặc đường dẫn tuyệt đối có quyền thực thi."""
    return shutil.which(binary) or (
        binary if os.path.isfile(binary) and os.access(binary, os.X_OK) else None
    )


def check_dependencies(run_ffmpeg_version: bool = True) -> Tuple[bool, str]:
    """Kiểm tra đầy đủ các thư viện Python AI và FFmpeg đã cài đặt đúng trong container."""
    for mod_name in REQUIRED_MODULES:
        try:
            importlib.import_module(mod_name)
        except Exception as exc:
            return False, f"Thieu hoac loi module '{mod_name}': {exc}"

    ffmpeg_bin = _resolve_ffmpeg_binary()
    resolved = _find_executable(ffmpeg_bin)
    if not resolved:
        return False, f"Khong tim thay cong cu ffmpeg ({ffmpeg_bin}) trong PATH"

    if run_ffmpeg_version:
        try:
            proc = subprocess.run(
                [resolved, "-version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5,
                check=False,
            )
            if proc.returncode != 0:
                return False, f"ffmpeg tra ve ma loi {proc.returncode}"
        except Exception as exc:
            return False, f"Khong the chay ffmpeg -version: {exc}"

    return True, "OK: Tat ca thu vien AI (faster_whisper, google.genai) va ffmpeg san sang"


def check_runtime_tools() -> Tuple[bool, str]:
    """Kiểm tra nhanh quyền thực thi Python & FFmpeg mà không nạp module nặng vào RAM."""
    if not sys.executable or not os.access(sys.executable, os.X_OK):
        return False, f"Python executable khong hop le hoac thieu quyen thuc thi: {sys.executable}"

    ffmpeg_bin = _resolve_ffmpeg_binary()
    if not _find_executable(ffmpeg_bin):
        return False, f"Khong tim thay ffmpeg ({ffmpeg_bin})"

    return True, "OK"


def check_http_endpoint(url: str, timeout: float = 3.0) -> Tuple[bool, str]:
    """Gọi HTTP GET tới endpoint ứng dụng để xác nhận máy chủ đang sống."""
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if 200 <= resp.status < 300:
                return True, f"HTTP {resp.status}"
            return False, f"HTTP status khong hop le: {resp.status}"
    except urllib.error.HTTPError as http_err:
        return False, f"HTTP {http_err.code}: {http_err.reason}"
    except Exception as exc:
        return False, f"Khong the ket noi {url}: {exc}"


def run_healthcheck(
    url: str = "http://127.0.0.1:8080/",
    timeout: float = 3.0,
    check_deps: bool = False,
    skip_http: bool = False,
) -> int:
    """Thực thi kiểm tra sức khỏe container, trả 0 nếu khỏe hoặc 1 nếu gặp sự cố."""
    if check_deps:
        ok, msg = check_dependencies(run_ffmpeg_version=True)
    else:
        ok, msg = check_runtime_tools()

    if not ok:
        print(f"[HEALTHCHECK FAIL] {msg}", file=sys.stderr, flush=True)
        return 1

    if not skip_http:
        http_ok, http_msg = check_http_endpoint(url=url, timeout=timeout)
        if not http_ok:
            print(f"[HEALTHCHECK FAIL] {http_msg}", file=sys.stderr, flush=True)
            return 1

    print(f"[HEALTHCHECK OK] {msg}", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Docker healthcheck script for AutoCut Backend + AI")
    parser.add_argument(
        "--url",
        default=os.getenv("HEALTHCHECK_URL", "http://127.0.0.1:8080/"),
        help="Endpoint HTTP kiểm tra ứng dụng còn sống",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("HEALTHCHECK_TIMEOUT", "3.0")),
        help="Thời gian chờ tối đa (giây)",
    )
    parser.add_argument(
        "--check-deps",
        action="store_true",
        help="Kiểm tra import đầy đủ faster_whisper, google.genai và ffmpeg (dùng lúc build/startup)",
    )
    parser.add_argument(
        "--skip-http",
        action="store_true",
        help="Chỉ kiểm tra môi trường Python/FFmpeg, bỏ qua gọi HTTP",
    )
    args = parser.parse_args()
    return run_healthcheck(
        url=args.url,
        timeout=args.timeout,
        check_deps=args.check_deps,
        skip_http=args.skip_http,
    )


if __name__ == "__main__":
    sys.exit(main())
