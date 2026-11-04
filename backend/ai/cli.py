"""CLI công cụ dành riêng cho SV2 chạy thử nghiệm và kiểm tra module AI.

Hỗ trợ:
1. Whisper STT nâng cao + Gemini Refiner (mặc định): Whisper bóc băng lấy mốc thời gian chuẩn ➔ Gemini sửa lỗi chính tả, chuẩn hóa thuật ngữ và tách thành từng câu đơn được đánh mã số S0001, S0002...
2. Bộ đo tiến độ & thời gian thực (Real-time Progress Bar, Tốc độ x-realtime, Thời gian đã chạy Elapsed & Dự kiến hoàn thành ETA).
3. Chế độ --clean-file: Tự động tách câu, sửa lỗi sai, dọn rác và chuẩn hóa thuật ngữ chuyên ngành trên file transcript có sẵn.
"""

import argparse
import json
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .gemini_transcriber import GeminiTranscriber
from .post_processor import post_process_transcript
from .models import TranscriptOutput
from .config_loader import default_ai_config
from .whisper_service import format_duration


def clean_existing_transcript_file(
    file_path: str,
    output_path: str = None,
    refine_with_gemini: bool = False,
    outline_text: str = None,
    start_from_id: str = None
):
    """Làm sạch, tách câu đơn và nâng cấp chất lượng một file transcript.json có sẵn."""
    t0 = time.perf_counter()
    p = Path(file_path)
    if not p.exists():
        print(f"[!] Không tìm thấy tệp: {file_path}")
        return

    out_p = Path(output_path or file_path)
    print(f"[*] Đang đọc dữ liệu từ: {p.name}...")
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)

    transcript = TranscriptOutput.model_validate(data)
    total_before = len(transcript.sentences)

    if refine_with_gemini and default_ai_config.gemini_api_key:
        from .transcript_refiner import TranscriptRefiner
        print(f"[*] Đang kích hoạt Gemini LLM để hiệu đính chính tả & tách câu cho {total_before} phân đoạn...")
        try:
            refiner = TranscriptRefiner()
            cleaned_transcript = refiner.refine_transcript(
                transcript,
                outline_text=outline_text,
                start_from_id=start_from_id
            )
        except Exception as e:
            print(f"[!] Lỗi khi chạy Gemini Refiner ({e}), chuyển sang tách câu cục bộ...")
            cleaned_transcript = post_process_transcript(transcript)
    else:
        cleaned_transcript = post_process_transcript(transcript)

    with open(out_p, "w", encoding="utf-8") as f:
        f.write(cleaned_transcript.model_dump_json(indent=2, exclude_none=True))

    total_elapsed = time.perf_counter() - t0
    print(f"[+] Đã làm sạch và tách câu: từ {total_before} phân đoạn ➔ tách thành {len(cleaned_transcript.sentences)} câu đơn hoàn chỉnh!")
    print(f"[+] Thời gian hoàn thành: {format_duration(total_elapsed)} ({total_elapsed:.2f} giây)")
    print(f"[+] File xuất kết quả: {out_p}")


def main():
    parser = argparse.ArgumentParser(description="AutoCut AI - SV2 Speech-to-Text Pipeline Nâng Cấp")
    parser.add_argument("--input", "-i", default=None, help="Đường dẫn tệp video hoặc audio đầu vào")
    parser.add_argument("--clean-file", default=None, help="Làm sạch và tách câu trực tiếp trên tệp transcript.json có sẵn")
    parser.add_argument("--refine", action="store_true", default=True, help="Bật Gemini LLM để hiệu đính chính tả, chuẩn hóa thuật ngữ và tách câu sau khi Whisper bóc băng (Mặc định: Bật)")
    parser.add_argument("--no-refine", action="store_true", help="Tắt bước Gemini LLM hiệu đính, chỉ dùng bộ tách câu cục bộ")
    parser.add_argument("--start-from-id", default=None, help="Chỉ định mã câu bắt đầu gửi Gemini hiệu đính (ví dụ: S0041)")
    parser.add_argument("--outline", "-o", default=None, help="Văn bản đề cương bài giảng (dùng tạo initial_prompt và đối chiếu thuật ngữ)")
    parser.add_argument("--outline-file", default=None, help="Đường dẫn tệp văn bản chứa đề cương")
    parser.add_argument("--output", default="transcript.json", help="Đường dẫn lưu tệp transcript.json (mặc định: transcript.json)")
    parser.add_argument("--engine", choices=["whisper", "gemini"], default="whisper", help="Công nghệ STT sử dụng (mặc định: whisper)")
    parser.add_argument("--model-size", default=None, help="Kích thước model Whisper (base, small, medium, large-v3)")
    parser.add_argument("--force", action="store_true", help="Bắt buộc bóc băng lại, bỏ qua cache SHA-256")
    parser.add_argument("--clear-cache", action="store_true", help="Xóa sạch toàn bộ tệp bộ nhớ đệm cache")

    args = parser.parse_args()
    use_gemini_refine = args.refine and not args.no_refine

    # Chế độ xóa cache
    if args.clear_cache:
        from .whisper_service import clear_all_cache
        n = clear_all_cache()
        print(f"[+] Đã dọn dẹp và xóa sạch {n} tệp cache thành công!")
        return

    outline_text = args.outline
    if args.outline_file and Path(args.outline_file).exists():
        with open(args.outline_file, "r", encoding="utf-8") as f:
            outline_text = f.read()

    # Chế độ làm sạch file transcript có sẵn
    if args.clean_file:
        clean_existing_transcript_file(
            file_path=args.clean_file,
            output_path=args.output,
            refine_with_gemini=use_gemini_refine,
            outline_text=outline_text,
            start_from_id=args.start_from_id
        )
        return

    if not args.input:
        parser.print_help()
        print("\n[!] Lỗi: Bạn cần cung cấp --input <tệp_video> hoặc dùng --clean-file <transcript.json>")
        return

    pipeline_start = time.perf_counter()
    print(f"[*] Bắt đầu xử lý file: {args.input}")
    print(f"[*] STT Engine: {args.engine.upper()}")
    if use_gemini_refine and args.engine == "whisper":
        print("[*] Gemini Refiner & Sentence Splitter: BẬT (Whisper lấy text ➔ Gemini sửa chính tả & tách câu đánh mã số)")
    if outline_text:
        print(f"[*] Đề cương cung cấp:\n{outline_text.strip()}\n")

    if args.engine == "whisper":
        from .whisper_service import WhisperTranscriber
        transcriber = WhisperTranscriber(model_size=args.model_size)
    else:
        transcriber = GeminiTranscriber()

    stt_t0 = time.perf_counter()
    res = transcriber.transcribe(
        media_path=args.input,
        outline_text=outline_text,
        force_recompute=args.force,
        output_file=args.output
    )
    stt_elapsed = time.perf_counter() - stt_t0

    refine_elapsed = 0.0
    # Dùng Gemini LLM để hiệu đính chính tả, chuẩn hóa thuật ngữ và tách thành từng câu đơn S0001, S0002...
    if use_gemini_refine and args.engine == "whisper" and default_ai_config.gemini_api_key:
        from .transcript_refiner import TranscriptRefiner
        print("\n[*] Đang gửi kết quả sang Gemini LLM để sửa chính tả, chuẩn hóa thuật ngữ & tách thành các câu được đánh mã số...")
        refine_t0 = time.perf_counter()
        try:
            refiner = TranscriptRefiner()
            res = refiner.refine_transcript(
                res,
                outline_text=outline_text,
                start_from_id=args.start_from_id
            )
            if args.output:
                with open(args.output, "w", encoding="utf-8") as f:
                    f.write(res.model_dump_json(indent=2, exclude_none=True))
            refine_elapsed = time.perf_counter() - refine_t0
            print(f"[+] Đã hoàn tất tách câu & hiệu đính bằng Gemini và lưu vào: {args.output}")
        except Exception as e:
            refine_elapsed = time.perf_counter() - refine_t0
            print(f"[!] Lỗi khi chạy Gemini Refiner: {e}")

    total_elapsed = time.perf_counter() - pipeline_start
    overall_speed_x = (res.duration / total_elapsed) if total_elapsed > 0 and res.duration > 0 else 0.0

    print("\n" + "=" * 60)
    print(f"[+] QUY TRÌNH XUẤT TRANSCRIPT HOÀN TẤT!")
    print(f"[+] Tên file video     : {res.video}")
    print(f"[+] Thời lượng video   : {format_duration(res.duration)} ({res.duration:.2f} giây)")
    print(f"[+] Tổng số câu        : {len(res.sentences)} câu đơn ({res.sentences[0].id} -> {res.sentences[-1].id})" if res.sentences else "[+] Tổng số câu: 0")
    print("-" * 60)
    print(f"[*] Thời gian bóc băng ({args.engine.upper()}) : {format_duration(stt_elapsed)} ({stt_elapsed:.2f} giây)")
    if refine_elapsed > 0:
        print(f"[*] Thời gian Gemini tách câu      : {format_duration(refine_elapsed)} ({refine_elapsed:.2f} giây)")
    print(f"[*] TỔNG THỜI GIAN HOÀN THÀNH      : {format_duration(total_elapsed)} ({total_elapsed:.2f} giây) — Tốc độ: {overall_speed_x:.1f}x realtime")
    print(f"[+] Tệp kết quả        : {args.output}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
