"""CLI công cụ dành riêng cho SV2 chạy thử nghiệm và kiểm tra module AI.

Hỗ trợ:
1. Whisper STT nâng cao: Beam Search, VAD lọc nhạc intro, chống lặp từ, chống ký tự ngoại ngữ rác.
2. Gemini API STT: Chạy cloud tốc độ cao.
3. Chế độ --clean-file: Tự động sửa lỗi sai, dọn rác và chuẩn hóa thuật ngữ chuyên ngành trên file transcript có sẵn.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .config_loader import default_ai_config
from .gemini_transcriber import GeminiTranscriber
from .post_processor import post_process_sentence, post_process_transcript
from .models import TranscriptOutput


def clean_existing_transcript_file(file_path: str, output_path: str = None):
    """Làm sạch và nâng cấp chất lượng một file transcript.json có sẵn."""
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

    cleaned_transcript = post_process_transcript(transcript)

    with open(out_p, "w", encoding="utf-8") as f:
        f.write(cleaned_transcript.model_dump_json(indent=2, exclude_none=True))

    print(f"[+] Đã làm sạch thành công {total_before} câu!")
    print(f"[+] Đã loại bỏ hiện tượng lặp từ, ký tự ngoại ngữ rác (Hàn/Trung), và chuẩn hóa thuật ngữ chuyên ngành.")
    print(f"[+] File xuất kết quả: {out_p}")


def main():
    parser = argparse.ArgumentParser(description="AutoCut AI - SV2 Speech-to-Text Pipeline Nâng Cấp")
    parser.add_argument("--input", "-i", default=None, help="Đường dẫn tệp video hoặc audio đầu vào")
    parser.add_argument("--clean-file", default=None, help="Làm sạch và sửa lỗi trực tiếp trên tệp transcript.json có sẵn")
    parser.add_argument("--outline", "-o", default=None, help="Văn bản đề cương bài giảng (dùng tạo initial_prompt)")
    parser.add_argument("--outline-file", default=None, help="Đường dẫn tệp văn bản chứa đề cương")
    parser.add_argument("--output", default="transcript.json", help="Đường dẫn lưu tệp transcript.json (mặc định: transcript.json)")
    parser.add_argument("--engine", choices=["whisper", "gemini"], default="whisper", help="Công nghệ STT sử dụng (mặc định: whisper)")
    parser.add_argument("--model-size", default=None, help="Kích thước model Whisper (base, small, medium, large-v3)")
    parser.add_argument("--force", action="store_true", help="Bắt buộc bóc băng lại, bỏ qua cache SHA-256")
    parser.add_argument("--clear-cache", action="store_true", help="Xóa sạch toàn bộ tệp bộ nhớ đệm cache")

    args = parser.parse_args()

    # Chế độ xóa cache
    if args.clear_cache:
        from .whisper_service import clear_all_cache
        n = clear_all_cache()
        print(f"[+] Đã dọn dẹp và xóa sạch {n} tệp cache thành công!")
        return

    # Chế độ làm sạch file transcript có sẵn
    if args.clean_file:
        clean_existing_transcript_file(args.clean_file, args.output)
        return

    if not args.input:
        parser.print_help()
        print("\n[!] Lỗi: Bạn cần cung cấp --input <tệp_video> hoặc dùng --clean-file <transcript.json>")
        return

    outline_text = args.outline
    if args.outline_file and Path(args.outline_file).exists():
        with open(args.outline_file, "r", encoding="utf-8") as f:
            outline_text = f.read()

    print(f"[*] Bắt đầu xử lý file: {args.input}")
    print(f"[*] STT Engine: {args.engine.upper()}")
    if outline_text:
        print(f"[*] Đề cương cung cấp:\n{outline_text.strip()}\n")

    if args.engine == "whisper":
        from .whisper_service import WhisperTranscriber
        transcriber = WhisperTranscriber(model_size=args.model_size)
    else:
        transcriber = GeminiTranscriber()

    res = transcriber.transcribe(
        media_path=args.input,
        outline_text=outline_text,
        force_recompute=args.force,
        output_file=args.output
    )

    print("\n" + "=" * 50)
    print(f"[+] Bóc băng hoàn tất!")
    print(f"[+] Tên file: {res.video}")
    print(f"[+] Tổng thời lượng: {res.duration:.2f} giây")
    print(f"[+] Tổng số câu phân đoạn: {len(res.sentences)} câu")
    if res.sentences:
        print(f"[+] Câu đầu tiên ({res.sentences[0].id}): [{res.sentences[0].start}s -> {res.sentences[0].end}s] {res.sentences[0].text}")
        print(f"[+] Câu cuối cùng ({res.sentences[-1].id}): [{res.sentences[-1].start}s -> {res.sentences[-1].end}s] {res.sentences[-1].text}")
    print(f"[+] Tệp kết quả: {args.output}")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    main()
