import re
from pathlib import Path
import pytest

FRONTEND_PAGE_PATH = Path(__file__).resolve().parent.parent / "frontend" / "src" / "app" / "page.tsx"


def read_frontend_page_content() -> str:
    assert FRONTEND_PAGE_PATH.exists(), f"Không tìm thấy file: {FRONTEND_PAGE_PATH}"
    return FRONTEND_PAGE_PATH.read_text(encoding="utf-8")


class TestFrontendTimerLeakAttack:
    """Bộ test tấn công (Attack / Stress Tests) phát hiện lỗ hổng rò rỉ bộ nhớ (Memory Leak)

    do setInterval không được dọn dẹp (clear) đúng chuẩn trong page.tsx của SV4.
    """

    def test_attack_analyze_ai_must_have_try_finally_timer_cleanup(self):
        """[ATTACK 1] Tấn công ngoại lệ trong handleAnalyzeAI:

        Nếu API (/api/groq, /api/video/analyze) hoặc xử lý dữ liệu (normalizeContiguousSegments)
        ném ra lỗi (exception/500/timeout), setInterval tại progressTimerRef và ticker
        phải được đảm bảo clear 100% trong khối `finally`.
        Nếu không có `try ... finally`, timer sẽ chạy ngầm vĩnh viễn gây memory leak!
        """
        content = read_frontend_page_content()

        # Trích xuất toàn bộ thân hàm handleAnalyzeAI
        match = re.search(r"const\s+handleAnalyzeAI\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{(.*?)\n\s*\}\s*,\s*\[", content, re.DOTALL)
        assert match, "Không tìm thấy hàm handleAnalyzeAI trong page.tsx!"
        func_body = match.group(1)

        # Kiểm tra xem có khối try...finally bao bọc tiến trình phân tích AI không
        has_try = "try {" in func_body or "try{" in func_body
        has_finally = "finally {" in func_body or "finally{" in func_body

        # Khối finally phải chứa logic clearInterval cho các timer
        has_clear_in_finally = False
        if has_finally:
            finally_match = re.search(r"finally\s*\{(.*?)\}", func_body, re.DOTALL)
            if finally_match and "clearInterval" in finally_match.group(1):
                has_clear_in_finally = True

        assert has_try and has_finally and has_clear_in_finally, (
            "LỖ HỔNG RÒ RỈ BỘ NHỚ: handleAnalyzeAI khởi tạo setInterval nhưng KHÔNG có khối "
            "`try ... finally` đảm bảo clearInterval! Khi API gặp lỗi ngoại lệ, timer sẽ bị bỏ rơi "
            "và chạy ngầm vô tận trong V8 engine."
        )

    def test_attack_analyze_ai_secondary_ticker_must_be_tracked_in_ref(self):
        """[ATTACK 2] Tấn công bỏ rơi timer ticker phụ:

        Hàm handleAnalyzeAI khởi tạo một `ticker` (mỗi 600ms) để cập nhật tiến độ modal.
        Nếu ticker chỉ là biến cục bộ (const ticker), khi người dùng unmount hoặc hủy tiến trình,
        unmount cleanup KHÔNG THỂ chạm tới ticker để clear -> Gây leak closure.
        Yêu cầu: ticker phải được lưu vào ref (ví dụ: analyzeTickerRef hoặc tickerTimerRef).
        """
        content = read_frontend_page_content()

        match = re.search(r"const\s+handleAnalyzeAI\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{(.*?)\n\s*\}\s*,\s*\[", content, re.DOTALL)
        assert match, "Không tìm thấy hàm handleAnalyzeAI trong page.tsx!"
        func_body = match.group(1)

        # Kiểm tra xem ticker có bị gán trực tiếp vào biến cục bộ const ticker không
        has_dangling_local_ticker = bool(re.search(r"const\s+ticker\s*=\s*setInterval", func_body))
        has_ref_ticker = bool(re.search(r"(analyzeTickerRef|tickerTimerRef)\.current\s*=\s*setInterval", func_body))

        assert not has_dangling_local_ticker and has_ref_ticker, (
            "LỖ HỔNG RÒ RỈ BỘ NHỚ: ticker cập nhật modal phân tích đang dùng biến cục bộ "
            "`const ticker = setInterval(...)`. Biến cục bộ này không thể được dọn dẹp khi "
            "component unmount hoặc khi bị ngắt quãng giữa chừng! Phải dùng useRef."
        )

    def test_attack_render_export_must_have_finally_clear_interval(self):
        """[ATTACK 3] Tấn công tiến trình render xuất bản video dài:

        Tiến trình submitRenderSegments chạy setInterval (mỗi 700ms).
        Lệnh clearInterval phải nằm trong khối `finally` của handleRender để đảm bảo
        dù render thành công, thất bại, hay ném exception bất ngờ trong nhánh thành công
        thì timer luôn luôn được giải phóng.
        """
        content = read_frontend_page_content()

        match = re.search(r"const\s+handleRender\s*=\s*async\s*\(\)\s*=>\s*\{(.*?)\n\s*\}\s*;", content, re.DOTALL)
        assert match, "Không tìm thấy hàm handleRender trong page.tsx!"
        func_body = match.group(1)

        # Tìm khối finally trong handleRender
        finally_match = re.search(r"finally\s*\{(.*?)\}", func_body, re.DOTALL)
        assert finally_match, "handleRender thiếu khối `finally`!"
        finally_body = finally_match.group(1)

        assert "clearInterval" in finally_body, (
            "LỖ HỔNG RÒ RỈ BỘ NHỚ: Trong handleRender, clearInterval chỉ đặt rải rác ở try/catch "
            "mà KHÔNG nằm trong khối `finally`! Nếu có lỗi phát sinh sau submitRenderSegments, "
            "timer 700ms sẽ tiếp tục chạy ngầm và giữ closure của hàng ngàn segment."
        )

    def test_attack_render_timer_must_be_tracked_in_ref_for_unmount(self):
        """[ATTACK 4] Tấn công unmount trong khi đang render video dài:

        Khi đang cắt clip dài 2 giờ, người dùng đóng modal hoặc thoát trang (unmount).
        Nếu timer render không được lưu trong ref, unmount cleanup không thể hủy timer,
        dẫn đến timer tiếp tục gọi setProgressPercent / setProgressSteps trên component đã unmount.
        """
        content = read_frontend_page_content()

        # Kiểm tra khai báo renderTimerRef
        has_render_timer_ref = bool(re.search(r"const\s+renderTimerRef\s*=\s*useRef", content))

        # Kiểm tra xem unmount cleanup có clear renderTimerRef không
        unmount_cleanup_match = re.search(r"return\s*\(\)\s*=>\s*\{(.*?)\};\s*\}\s*,\s*\[router\]", content, re.DOTALL)
        has_render_cleanup = False
        if unmount_cleanup_match:
            has_render_cleanup = "renderTimerRef" in unmount_cleanup_match.group(1)

        assert has_render_timer_ref and has_render_cleanup, (
            "LỖ HỔNG RÒ RỈ BỘ NHỚ: Thiếu `renderTimerRef = useRef(...)` và cơ chế dọn dẹp "
            "trong unmount cleanup! Khi người dùng thoát trang lúc render, timer vẫn chạy ngầm."
        )

    def test_attack_rapid_click_prevention_on_render_and_analyze(self):
        """[ATTACK 5] Tấn công spam click (chạy liên tiếp nhiều lần):

        Cả handleAnalyzeAI và handleRender phải có cơ chế kiểm tra và xóa sạch
        timer cũ trước khi gán timer mới:
        `if (xxxRef.current) clearInterval(xxxRef.current);`
        để ngăn chặn việc spam click tạo ra hàng chục setInterval chạy song song.
        """
        content = read_frontend_page_content()

        # Kiểm tra trong handleRender
        match_render = re.search(r"const\s+handleRender\s*=\s*async\s*\(\)\s*=>\s*\{(.*?)\n\s*\}\s*;", content, re.DOTALL)
        assert match_render, "Không tìm thấy hàm handleRender!"
        func_render = match_render.group(1)

        has_render_pre_clear = bool(re.search(r"if\s*\(\s*renderTimerRef\.current\s*\)\s*clearInterval\s*\(\s*renderTimerRef\.current\s*\)", func_render))

        # Kiểm tra trong handleAnalyzeAI
        match_analyze = re.search(r"const\s+handleAnalyzeAI\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{(.*?)\n\s*\}\s*,\s*\[", content, re.DOTALL)
        assert match_analyze, "Không tìm thấy hàm handleAnalyzeAI!"
        func_analyze = match_analyze.group(1)

        has_analyze_pre_clear = bool(re.search(r"if\s*\(\s*progressTimerRef\.current\s*\)\s*clearInterval", func_analyze))
        has_ticker_pre_clear = bool(re.search(r"if\s*\(\s*analyzeTickerRef\.current\s*\)\s*clearInterval", func_analyze))

        assert has_render_pre_clear and has_analyze_pre_clear and has_ticker_pre_clear, (
            "LỖ HỔNG RÒ RỈ BỘ NHỚ: Khi người dùng spam click, hệ thống chưa dọn sạch timer cũ "
            "trước khi khởi tạo timer mới, dẫn đến nhiều setInterval chạy chồng chéo song song!"
        )
