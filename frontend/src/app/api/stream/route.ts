import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Next.js API Route phát / stream video hỗ trợ HTTP Range requests (206 Partial Content)
 * Cho phép xem video mượt mà, tua (scrub) tức thì ngay cả khi Backend Java chưa chạy.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileParam = searchParams.get("file") || "";
  const hashParam = searchParams.get("hash") || "";

  // Danh sách các thư mục kiểm tra để tìm file
  const projectRoot = process.cwd(); // Thư mục modun6 hoặc modun6/frontend
  const candidateDirs = [
    path.join(projectRoot, "public", "videos"),
    path.join(projectRoot, "frontend", "public", "videos"),
    path.join(projectRoot, "uploads"),
    path.join(projectRoot, "..", "uploads"),
    path.join(projectRoot, "backend", "uploads"),
    path.join(projectRoot, "..", "backend", "uploads"),
  ];

  let resolvedPath: string | null = null;

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    try {
      const files = fs.readdirSync(dir);
      const norm = (s: string) =>
        s.toLowerCase().replace(/[\s_\(\)\-\.]/g, "").replace(/mp4$/g, "");

      // 1. Khớp theo hash
      if (hashParam) {
        const found = files.find((f) => f.toLowerCase().startsWith(hashParam.toLowerCase()));
        if (found) {
          resolvedPath = path.join(dir, found);
          break;
        }
      }

      // 2. Khớp theo tên file
      if (fileParam) {
        const cleanFile = fileParam.trim().toLowerCase();

        // 2a. Khớp chính xác tên file
        const foundExact = files.find((f) => f.toLowerCase() === cleanFile);
        if (foundExact) {
          resolvedPath = path.join(dir, foundExact);
          break;
        }

        // 2b. Khớp normalized đối với file upload có tiền tố hash: <sha256>_<tên file>
        const targetNorm = norm(cleanFile);
        if (targetNorm) {
          const foundNorm = files.find((f) => norm(f).endsWith(targetNorm));
          if (foundNorm) {
            resolvedPath = path.join(dir, foundNorm);
            break;
          }
        }

        // 3. Khớp tương đối theo tên bài học
        if (cleanFile.includes("bai08") || cleanFile.includes("ep_kieu")) {
          const found08 = files.find((f) => /bai08|ep[-_]kieu|ytsave/i.test(f));
          if (found08) {
            resolvedPath = path.join(dir, found08);
            break;
          }
        } else if (cleanFile.includes("bai07") || cleanFile.includes("bien")) {
          const found07 = files.find((f) => /bai07|bien/i.test(f));
          if (found07) {
            resolvedPath = path.join(dir, found07);
            break;
          }
        } else if (cleanFile.includes("bai09") || cleanFile.includes("chuoi")) {
          const found09 = files.find((f) => /bai09|chuoi/i.test(f));
          if (found09) {
            resolvedPath = path.join(dir, found09);
            break;
          }
        }
      }
    } catch {
      // Tiếp tục tìm ở thư mục tiếp theo
    }
  }

  // Nếu tìm thấy file cục bộ, stream với HTTP 206 Range Request
  if (resolvedPath && fs.existsSync(resolvedPath)) {
    try {
      const stat = fs.statSync(resolvedPath);
      const fileSize = stat.size;
      const range = request.headers.get("range");

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        const fileStream = fs.createReadStream(resolvedPath, { start, end });
        const webStream = new ReadableStream({
          start(controller) {
            fileStream.on("data", (chunk) => controller.enqueue(chunk));
            fileStream.on("end", () => controller.close());
            fileStream.on("error", (err) => controller.error(err));
          },
          cancel() {
            fileStream.destroy();
          },
        });

        return new NextResponse(webStream, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize.toString(),
            "Content-Type": "video/mp4",
          },
        });
      } else {
        const fileStream = fs.createReadStream(resolvedPath);
        const webStream = new ReadableStream({
          start(controller) {
            fileStream.on("data", (chunk) => controller.enqueue(chunk));
            fileStream.on("end", () => controller.close());
            fileStream.on("error", (err) => controller.error(err));
          },
          cancel() {
            fileStream.destroy();
          },
        });

        return new NextResponse(webStream, {
          status: 200,
          headers: {
            "Content-Length": fileSize.toString(),
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
          },
        });
      }
    } catch (streamErr) {
      console.warn("Lỗi đọc stream video:", streamErr);
    }
  }

  // Fallback: Chuyển hướng sang Cloudflare R2
  const r2Fallback = "https://pub-603b1f9629e046de80cf86f3f046ca84.r2.dev/autocut/sample_videos/vibe_short.mp4";
  return NextResponse.redirect(r2Fallback, { status: 302 });
}
