# Deploy frontend lên Cloudflare Workers

Mục đích: đưa phần **Next.js (frontend/)** lên Cloudflare Workers bằng adapter OpenNext, để dùng được nút "Deploy" trong Cloudflare Workers Builds.

> Đọc mục **Giới hạn** trước khi deploy: backend Java và các route đọc đĩa **không chạy được** trên Workers.

## 1. Cấu hình trên Cloudflare (Workers → tạo Worker từ GitHub)

| Trường | Giá trị |
|---|---|
| Repository | `ToanNguyen-exe/AutoCut` |
| Branch | `feature/f14/cloudflare_worker_deploy` (hoặc `main` sau khi merge) |
| Root directory | để trống (gốc repo) |
| Build command | `npm run build:worker` |
| Deploy command | `npx wrangler deploy` |
| Node version | đặt biến `NODE_VERSION=20` (adapter OpenNext chưa hỗ trợ Node 26) |

`npm run build:worker` ở gốc repo sẽ: `npm ci` trong `frontend/` → `opennextjs-cloudflare build --config ../wrangler.jsonc`.

## 2. Biến môi trường cho Worker

Vào Worker → Settings → Variables and Secrets:

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Có | URL công khai của backend Java, ví dụ `https://api.example.com/api/video`. Mặc định trong code là `http://localhost:8080/api/video`, sẽ chết trên Worker. |
| `GROQ_API_KEY` | Nếu dùng trang bóc băng | Key Groq cho `/api/groq` (route này vẫn cần ffmpeg + file video cục bộ, xem Giới hạn). |

`NEXT_PUBLIC_*` được nhúng lúc **build**, nên phải set trong Cloudflare trước khi bấm Deploy lại.

## 3. File đã thêm/sửa trong nhánh này

| File | Tác dụng |
|---|---|
| `wrangler.jsonc` (gốc) | Tên Worker, `main` = `frontend/.open-next/worker.js`, assets = `frontend/.open-next/assets`, bật `nodejs_compat`. |
| `frontend/open-next.config.ts` | Cấu hình adapter OpenNext mặc định. |
| `frontend/package.json` | Thêm `@opennextjs/cloudflare@~1.15.1` (bản cuối còn hỗ trợ Next 14.2.35), `wrangler`, các script `build:worker` / `preview:worker` / `deploy:worker`. |
| `package.json` (gốc) | `build:worker`, `deploy:worker`, `preview:worker` để Cloudflare gọi từ gốc repo. |
| `frontend/.node-version` | Ghim Node 20 cho môi trường build. |
| `.gitignore` | Bỏ qua `.open-next/`, `.wrangler/`, `frontend/.dev.vars`. |

Đã kiểm chứng tại máy: `npm run build:worker` → `Worker saved in .open-next/worker.js`; `wrangler deploy --dry-run` đọc 48 file assets, tổng 3,8 MB (gzip 846 KB).

## 4. Giới hạn — đọc kỹ

Worker **không** chạy được phần lõi của AutoCut:

1. **Backend Java (Spring Boot + PostgreSQL + ffmpeg + Whisper)** không thể chạy trên Workers. Phải host riêng (VPS/Docker theo spec F14) rồi trỏ `NEXT_PUBLIC_API_URL` vào đó.
2. **`/api/groq`** dùng `fs` + `ffmpeg` để cắt audio từ video trên đĩa → trên Worker sẽ lỗi khi gọi.
3. **`/api/stream`** đọc file video từ `uploads/` → trên Worker sẽ lỗi khi gọi.
4. **`/api/chat`** chỉ gọi API ngoài nên chạy được trên Worker.

Nghĩa là: deploy lên Worker thì **giao diện + chat chạy**, còn **bóc băng / phát video / cắt clip phải quay về backend Java**. Nếu muốn cả app chạy qua một tên miền Cloudflare, dùng **Cloudflare Tunnel** (`cloudflared`) trỏ vào máy chủ Docker — không cần Worker, không cần sửa code.

## 5. Lệnh chạy tại máy

```bash
# build ra Worker (trong frontend/)
cd frontend && npm run build:worker

# chạy thử Worker ở máy, không upload
cd frontend && npm run preview:worker

# deploy thật (cần đăng nhập: npx wrangler login)
cd frontend && npm run deploy:worker
```