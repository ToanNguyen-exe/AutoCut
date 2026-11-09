import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  model?: "groq" | "gemini" | "chatgpt" | "claude";
  apiKey?: string;
  videoContext?: {
    videoTitle?: string;
    lesson?: string;
    totalDuration?: number;
    segments?: Array<{ id: string; topic: string; start: number; end: number }>;
    transcript?: Array<{ id: string; text: string; start: number; end: number }>;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const { messages, model = "groq", apiKey: customKey, videoContext } = body;

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "Tin nhắn không được để trống" },
        { status: 400 }
      );
    }

    // Xây dựng System Prompt kèm Video Context
    let systemPrompt = `Bạn là Trợ lý AI AutoCut - trợ lý biên tập video, bóc băng giọng nói và quản lý timeline chuyên nghiệp.
Nhiệm vụ của bạn:
1. Giải đáp thắc mắc về nội dung video, hỗ trợ tóm tắt ý chính của từng phân đoạn.
2. Hỗ trợ người dùng thao tác phân đoạn: đề xuất gộp các phân đoạn ngắn, gợi ý vị trí tách (cắt) phân đoạn hợp lý.
3. Luôn trả lời bằng tiếng Việt thân thiện, rõ ràng, gãy gọn, tập trung vào video đang chỉnh sửa.`;

    if (videoContext) {
      systemPrompt += `\n\n[DỮ LIỆU VIDEO HIỆN TẠI]:
- Tên video: ${videoContext.videoTitle || "Chưa đặt tên"}
- Bài học: ${videoContext.lesson || "Mặc định"}
- Tổng thời lượng: ${videoContext.totalDuration ? `${videoContext.totalDuration.toFixed(1)}s` : "Chưa xác định"}`;

      if (videoContext.segments && videoContext.segments.length > 0) {
        systemPrompt += `\n- Danh sách ${videoContext.segments.length} phân đoạn hiện tại trên Timeline:`;
        videoContext.segments.forEach((seg, idx) => {
          systemPrompt += `\n  #${idx + 1} [${seg.start}s -> ${seg.end}s]: "${seg.topic}"`;
        });
      }

      if (videoContext.transcript && videoContext.transcript.length > 0) {
        systemPrompt += `\n- Bóc băng transcript (${videoContext.transcript.length} câu thoại tiêu biểu):`;
        videoContext.transcript.slice(0, 15).forEach((sent) => {
          systemPrompt += `\n  [${sent.start}s - ${sent.end}s] ${sent.text}`;
        });
        if (videoContext.transcript.length > 15) {
          systemPrompt += `\n  ... và ${videoContext.transcript.length - 15} câu thoại khác.`;
        }
      }
    }

    // 1. GROQ (Meta Llama / OSS 120B / Qwen)
    if (model === "groq") {
      const groqKey =
        customKey ||
        process.env.GROQ_API_KEY ||
        process.env.WHISPER_API_KEY ||
        process.env.NEXT_PUBLIC_WHISPER_API_KEY;

      if (!groqKey) {
        return NextResponse.json({
          reply:
            "⚠️ Chưa tìm thấy GROQ_API_KEY trong file .env hoặc cấu hình. Bạn hãy bổ sung GROQ_API_KEY vào .env để kích hoạt nhé!",
          missingKey: true,
          provider: "Groq",
        });
      }

      const candidateModels = [
        "openai/gpt-oss-120b",
        "qwen/qwen3.8-27b",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
      ];

      for (const groqModel of candidateModels) {
        try {
          const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${groqKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: groqModel,
              messages: [
                { role: "system", content: systemPrompt },
                ...messages.map((m) => ({ role: m.role, content: m.content })),
              ],
              temperature: 0.7,
              max_tokens: 800,
            }),
          });

          if (resp.ok) {
            const data = await resp.json();
            const reply = data.choices?.[0]?.message?.content?.trim();
            if (reply) {
              return NextResponse.json({
                reply,
                model: groqModel,
                provider: "Groq",
              });
            }
          }
        } catch {
          // Thử model tiếp theo
        }
      }

      return NextResponse.json({
        reply:
          "Hệ thống Groq tạm thời bận. Bạn có thể chọn mô hình khác như Gemini hoặc ChatGPT phía trên nhé!",
        provider: "Groq",
      });
    }

    // 2. GEMINI (Google Gemini)
    if (model === "gemini") {
      const geminiKey =
        customKey ||
        process.env.GEMINI_API_KEY ||
        process.env.LLM_API_KEY ||
        process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!geminiKey) {
        return NextResponse.json({
          reply:
            "⚠️ Chưa tìm thấy GEMINI_API_KEY trong file .env. Bạn hãy bổ sung GEMINI_API_KEY vào file .env nhé! Tạm thời bạn có thể chuyển qua mô hình Groq để tiếp tục trò chuyện.",
          missingKey: true,
          provider: "Gemini",
        });
      }

      const geminiModels = [
        "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-3.8-flash",
        "gemini-1.5-flash",
      ];

      // Gộp conversation messages thành dạng prompt phù hợp với Gemini REST API
      const contents = [
        {
          role: "user",
          parts: [{ text: `${systemPrompt}\n\n[Hãy bắt đầu hội thoại với thông tin trên]` }],
        },
        {
          role: "model",
          parts: [{ text: "Tôi đã hiểu thông tin video và sẵn sàng hỗ trợ bạn biên tập video AutoCut!" }],
        },
        ...messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      ];

      for (const gModel of geminiModels) {
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents,
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 800,
                },
              }),
            }
          );

          if (resp.ok) {
            const data = await resp.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (reply) {
              return NextResponse.json({
                reply,
                model: gModel,
                provider: "Google Gemini",
              });
            }
          }
        } catch {
          // Thử tiếp
        }
      }

      return NextResponse.json({
        reply:
          "Gemini API không phản hồi hoặc key không hợp lệ. Bạn hãy kiểm tra lại GEMINI_API_KEY trong file .env nhé!",
        provider: "Gemini",
      });
    }

    // 3. CHATGPT (OpenAI)
    if (model === "chatgpt") {
      const openAiKey =
        customKey ||
        process.env.OPENAI_API_KEY ||
        process.env.LLM_API_KEY;

      if (!openAiKey || openAiKey === "your_llm_api_key_here") {
        return NextResponse.json({
          reply:
            "⚠️ Chưa cấu hình OPENAI_API_KEY cho ChatGPT trong file .env. Bạn hãy thêm OPENAI_API_KEY=sk-... vào .env hoặc chọn mô hình Groq / Gemini đã sẵn sàng key nhé!",
          missingKey: true,
          provider: "ChatGPT (OpenAI)",
        });
      }

      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              ...messages.map((m) => ({ role: m.role, content: m.content })),
            ],
            temperature: 0.7,
            max_tokens: 800,
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          const reply = data.choices?.[0]?.message?.content?.trim();
          if (reply) {
            return NextResponse.json({
              reply,
              model: "gpt-4o-mini",
              provider: "OpenAI ChatGPT",
            });
          }
        } else {
          const errData = await resp.json().catch(() => ({}));
          return NextResponse.json({
            reply: `Lỗi kết nối OpenAI: ${errData.error?.message || "Kiểm tra lại key"}`,
            provider: "ChatGPT",
          });
        }
      } catch (err: unknown) {
        return NextResponse.json({
          reply: `Không thể kết nối máy chủ OpenAI: ${err instanceof Error ? err.message : "Network error"}`,
          provider: "ChatGPT",
        });
      }
    }

    // 4. CLAUDE AI (Anthropic)
    if (model === "claude") {
      const claudeKey =
        customKey ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_API_KEY;

      if (!claudeKey) {
        return NextResponse.json({
          reply:
            "⚠️ Chưa cấu hình ANTHROPIC_API_KEY cho Claude AI trong file .env. Bạn có thể bổ sung ANTHROPIC_API_KEY=sk-ant-... vào .env sau nhé! Tạm thời bạn có thể chuyển qua Groq để chat ngay.",
          missingKey: true,
          provider: "Claude AI",
        });
      }

      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": claudeKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            system: systemPrompt,
            messages: messages.map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            })),
            max_tokens: 800,
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          const reply = data.content?.[0]?.text?.trim();
          if (reply) {
            return NextResponse.json({
              reply,
              model: "claude-3-5-sonnet",
              provider: "Anthropic Claude AI",
            });
          }
        }
      } catch (err: unknown) {
        return NextResponse.json({
          reply: `Không thể kết nối Anthropic Claude: ${err instanceof Error ? err.message : "Network error"}`,
          provider: "Claude AI",
        });
      }
    }

    return NextResponse.json({
      reply: "Mô hình AI được chọn chưa được hỗ trợ.",
      provider: model,
    });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Đã có lỗi xảy ra trong quá trình gọi AI" },
      { status: 500 }
    );
  }
}
