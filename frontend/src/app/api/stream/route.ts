import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { resolveStreamFile } from "@/lib/videoFs";

/**
 * Next.js API Route phát / stream video hỗ trợ HTTP Range requests (206 Partial Content)
 * Cho phép xem video mượt mà, tua (scrub) tức thì ngay cả khi Backend Java chưa chạy.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileParam = searchParams.get("file") || "";
  const hashParam = searchParams.get("hash") || "";

  const resolvedPath = resolveStreamFile(process.cwd(), fileParam, hashParam);

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
