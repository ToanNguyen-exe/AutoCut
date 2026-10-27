# AutoCut AI

Hệ thống tự động phân đoạn và cắt video bài giảng theo chủ đề nội dung (Spring Boot 3 + React / Next.js 14).

## 1. Cấu trúc dự án
```text
AutoCut/
├── backend/                  # Mã nguồn Spring Boot 3 (Java 21)
├── frontend/                 # Mã nguồn React (Next.js 14 + TailwindCSS)
├── mock-data/                # Dữ liệu JSON mẫu (segments_sample.json, transcript_sample.json)
├── docs/                     # Tài liệu thiết kế hệ thống (.docx, spec)
├── config.yaml               # Cấu hình ngưỡng thuật toán & preset
├── .env.example              # Mẫu biến môi trường API Key
└── README.md
```

## 2. Công nghệ sử dụng
- **Backend:** Java 21, Spring Boot 3, FFmpeg (`ProcessBuilder`), Jackson Databind, SnakeYAML.
- **Frontend:** Next.js 14, React, TailwindCSS, Lucide Icons.
- **AI Services:** Groq Whisper API / OpenAI API (STT), Google Gemini / OpenAI (LLM Semantic Segmentation).

## 3. Khế ước dữ liệu tuần 1
- `mock-data/segments_sample.json`: Mẫu phân đoạn để Frontend nạp bảng duyệt và Backend cắt thử video.
- `mock-data/transcript_sample.json`: Mẫu transcript bóc băng từ Whisper có gắn mã câu `S0001`, `S0002`...
