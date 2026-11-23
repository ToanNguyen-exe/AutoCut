import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeVideoBackend, analyzeVideoWithAutoSync } from "../src/lib/api.ts";
import { resolveEnvKey, resolveGroqApiKey, resolveProjectRootDir } from "../src/lib/groqEnv.ts";

describe("analyzeVideoBackend", () => {
  it("sanitizes non-boolean force values (such as a circular React MouseEvent) instead of crashing JSON.stringify", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          mode: "analyzed",
          segmentsData: { video: "Download.mp4", lesson: "Download", mode: "analyzed", reviewed: false, segments: [] },
          transcript: { video: "Download.mp4", duration: 60, sentences: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    try {
      // Simulate React SyntheticBaseEvent circular reference accidentally passed as `force`
      const circularEvent = { type: "click" };
      circularEvent.self = circularEvent;

      const res = await analyzeVideoBackend({
        videoName: "Download.mp4",
        lesson: "Download",
        duration: 60,
        force: circularEvent,
      });

      assert.equal(res.source, "api", `Expected API call to succeed, got error: ${res.error}`);
      assert.match(capturedUrl, /\/api\/video\/analyze$/);
      const parsed = JSON.parse(capturedBody);
      assert.equal(parsed.videoName, "Download.mp4");
      assert.strictEqual(parsed.force, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("page.tsx does not pass handleAnalyzeAI directly as onAnalyzeAI click callback", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/page.tsx"),
      "utf-8"
    );
    assert.doesNotMatch(
      pageSrc,
      /onAnalyzeAI=\{handleAnalyzeAI\}/,
      "onAnalyzeAI must wrap handleAnalyzeAI(() => handleAnalyzeAI(false)) so React MouseEvent is not passed as forceRefresh"
    );
  });

  it("page.tsx does not hardcode TikTok Download.mp4 lyrics or inject fake Intro Beat text", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/page.tsx"),
      "utf-8"
    );
    assert.doesNotMatch(pageSrc, /REAL_DOWNLOAD_LYRICS/);
    assert.doesNotMatch(pageSrc, /Giai điệu mở màn & Dạo nhạc \(Intro Beat\)/);
  });

  it("/api/groq route does not mismatch ytsave videos to ep_kieu and reports missing API key clearly", () => {
    const routeSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/api/groq/route.ts"),
      "utf-8"
    );
    assert.doesNotMatch(routeSrc, /targetNorm\.includes\("ytsave"\)/);
    assert.match(routeSrc, /resolveGroqApiKey/);
  });

  it("resolveGroqApiKey reads GROQ_API_KEY, WHISPER_API_KEY, and root .env fallback", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autocut-groq-env-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, ".env"),
        '# comment\nWHISPER_API_KEY="gsk_from_root_dotenv"\n',
        "utf-8"
      );
      assert.equal(resolveGroqApiKey({ GROQ_API_KEY: "gsk_direct" }, tmpDir), "gsk_direct");
      assert.equal(resolveGroqApiKey({ WHISPER_API_KEY: "gsk_whisper" }, tmpDir), "gsk_whisper");
      assert.equal(resolveGroqApiKey({}, tmpDir), "gsk_from_root_dotenv");
      assert.equal(resolveGroqApiKey({}, path.join(tmpDir, "missing")), "");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("analyzeVideoBackend returns HTTP status on server error and undefined status on network failure", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: "EMPTY_TRANSCRIPT" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      const httpErr = await analyzeVideoBackend({
        videoName: "Lecture.mp4",
        lesson: "Lecture",
        duration: 120,
      });
      assert.equal(httpErr.source, "fallback");
      assert.equal(httpErr.status, 502);
      assert.match(httpErr.error ?? "", /EMPTY_TRANSCRIPT/);

      globalThis.fetch = async () => {
        throw new TypeError("Failed to fetch");
      };
      const netErr = await analyzeVideoBackend({
        videoName: "Lecture.mp4",
        lesson: "Lecture",
        duration: 120,
      });
      assert.equal(netErr.source, "fallback");
      assert.equal(netErr.status, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("analyzeVideoWithAutoSync uploads IndexedDB blob and retries backend analyze when backend reports EMPTY_TRANSCRIPT", async () => {
    const analyzeCalls = [];
    const uploadCalls = [];

    const result = await analyzeVideoWithAutoSync({
      videoName: "JS_Course.mp4",
      lesson: "JS Course",
      duration: 3427.6,
      url: "blob:http://localhost:3000/fake-local-blob",
      getLocalBlob: async () => new Blob(["fake-mp4-bytes"], { type: "video/mp4" }),
      analyzeFn: async (payload) => {
        analyzeCalls.push(payload);
        if (analyzeCalls.length === 1) {
          return {
            source: "fallback",
            status: 502,
            error: "AI pipeline thất bại: exit=2 | [AI] ERROR EMPTY_TRANSCRIPT: tệp không nằm trong uploads/",
          };
        }
        return {
          source: "api",
          data: {
            status: "SUCCESS",
            mode: "analyzed",
            segmentsData: {
              video: "JS_Course.mp4",
              lesson: "JS Course",
              mode: "analyzed",
              reviewed: false,
              segments: [
                {
                  id: "seg_ai_01",
                  section_no: 1,
                  section: "01_GioiThieu",
                  topic_no: 1,
                  topic: "Giới thiệu JavaScript",
                  slug: "gioi-thieu-javascript",
                  start_id: "S0001",
                  end_id: "S0020",
                  start: 0,
                  end: 120,
                  parts: [{ part: 1, start: 0, end: 120, file: "01_gioi-thieu.mp4" }],
                },
              ],
            },
            transcript: {
              video: "JS_Course.mp4",
              duration: 120,
              sentences: [{ id: "S0001", start: 0, end: 5, text: "Xin chào." }],
            },
          },
        };
      },
      uploadFn: async (file) => {
        uploadCalls.push(file.name);
        return {
          source: "api",
          data: {
            status: "SUCCESS",
            file_name: file.name,
            file_size: file.size,
            sha256: "a".repeat(64),
            cloud_url: `http://localhost:8080/api/video/stream/${"a".repeat(64)}`,
          },
        };
      },
    });

    assert.equal(analyzeCalls.length, 2);
    assert.equal(analyzeCalls[0].url, undefined, "blob: URLs must not be sent to Backend");
    assert.deepEqual(uploadCalls, ["JS_Course.mp4"]);
    assert.equal(analyzeCalls[1].hash, "a".repeat(64));
    assert.equal(result.response.source, "api");
    assert.equal(result.syncedHash, "a".repeat(64));
  });

  it("page.tsx uses analyzeVideoWithAutoSync and does not silently fall back to /api/groq on Backend HTTP error", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/page.tsx"),
      "utf-8"
    );
    assert.match(pageSrc, /analyzeVideoWithAutoSync/);
    assert.match(pageSrc, /backendHttpError/);
  });

  it("resolveEnvKey reads Gemini/OpenAI/Claude/Groq keys from shared root .env and chat route uses it without NEXT_PUBLIC_ secret fallbacks", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autocut-shared-env-"));
    const tmpFrontend = path.join(tmpRoot, "frontend");
    fs.mkdirSync(tmpFrontend, { recursive: true });
    try {
      fs.writeFileSync(
        path.join(tmpRoot, ".env"),
        [
          "GEMINI_API_KEY=AIza_root_gemini_key",
          "LLM_API_KEY=AIza_root_llm_key",
          "OPENAI_API_KEY=sk_root_openai",
          "ANTHROPIC_API_KEY=sk_ant_root_claude",
        ].join("\n"),
        "utf-8"
      );

      assert.equal(resolveProjectRootDir(tmpFrontend), tmpRoot);
      assert.equal(
        resolveEnvKey(["GEMINI_API_KEY", "LLM_API_KEY"], {}, tmpRoot),
        "AIza_root_gemini_key"
      );
      assert.equal(
        resolveEnvKey(["OPENAI_API_KEY", "LLM_API_KEY"], {}, tmpRoot),
        "sk_root_openai"
      );
      assert.equal(
        resolveEnvKey(["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"], {}, tmpRoot),
        "sk_ant_root_claude"
      );
      assert.equal(
        resolveEnvKey(["GEMINI_API_KEY"], { GEMINI_API_KEY: "AIza_override" }, tmpRoot),
        "AIza_override"
      );

      const chatSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/api/chat/route.ts"),
        "utf-8"
      );
      assert.match(chatSrc, /resolveEnvKey/);
      assert.doesNotMatch(chatSrc, /NEXT_PUBLIC_GEMINI_API_KEY|NEXT_PUBLIC_WHISPER_API_KEY/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
