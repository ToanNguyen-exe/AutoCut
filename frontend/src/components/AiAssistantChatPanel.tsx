"use client";

import React, { useState, useRef, useEffect } from "react";
import { Segment, Sentence } from "@/types";
import {
  Send,
  Sparkles,
  ChevronDown,
  Loader2,
  Bot,
  Zap,
} from "lucide-react";

export interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp?: string;
  provider?: string;
}

export type AiProvider = "groq" | "gemini" | "chatgpt" | "claude";

interface AiAssistantChatPanelProps {
  segments: Segment[];
  videoTitle: string;
  activeSegmentId?: string;
  sentences?: Sentence[];
  isAnalyzing?: boolean;
  onAnalyzeAI?: () => void;
  onMergeSegments?: (segIndex1: number, segIndex2: number) => void;
  onSplitSegment?: (segId: string) => void;
  onOpenSegmentDetail?: (segment: Segment, index: number) => void;
}

const AI_MODELS: { id: AiProvider; name: string; badge: string; iconBg: string }[] = [
  { id: "groq", name: "Groq Llama", badge: "Siêu tốc", iconBg: "bg-orange-500" },
  { id: "gemini", name: "Gemini", badge: "Google", iconBg: "bg-blue-500" },
  { id: "chatgpt", name: "ChatGPT", badge: "OpenAI", iconBg: "bg-emerald-600" },
  { id: "claude", name: "Claude AI", badge: "Anthropic", iconBg: "bg-purple-600" },
];

export const AiAssistantChatPanel: React.FC<AiAssistantChatPanelProps> = ({
  segments,
  videoTitle,
  sentences = [],
  isAnalyzing = false,
  onAnalyzeAI,
  onMergeSegments,
}) => {
  const [selectedModel, setSelectedModel] = useState<AiProvider>("groq");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_1",
      sender: "bot",
      text: `Xin chào! Mình là Trợ lý AI AutoCut. Mình đã phân tích video "${videoTitle || "hiện tại"}" và chia thành ${segments.length} phân đoạn. Bạn muốn chỉnh sửa, tóm tắt hay gộp phân đoạn nào?`,
      provider: "Groq Llama",
    },
  ]);

  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Xác nhận gộp phân đoạn 2 và 3
  const handleConfirmMerge = () => {
    if (onMergeSegments) {
      onMergeSegments(1, 2);
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `user_${Date.now()}`,
        sender: "user",
        text: "Xác nhận gộp phân đoạn 2 và 3",
      },
      {
        id: `bot_${Date.now()}`,
        sender: "bot",
        text: "✓ Đã gộp thành công phân đoạn #2 và #3 thành một clip trên timeline!",
        provider: AI_MODELS.find((m) => m.id === selectedModel)?.name,
      },
    ]);
  };

  // Tách thêm phân đoạn
  const handleSplitMore = () => {
    setMessages((prev) => [
      ...prev,
      {
        id: `user_${Date.now()}`,
        sender: "user",
        text: "Tách thêm phân đoạn",
      },
      {
        id: `bot_${Date.now()}`,
        sender: "bot",
        text: "Bạn hãy kéo con trỏ Playhead đỏ trên thanh timeline đến vị trí mong muốn, sau đó bấm nút 'Cắt' ✂ trên thanh công cụ nhé!",
        provider: AI_MODELS.find((m) => m.id === selectedModel)?.name,
      },
    ]);
  };

  // Tóm tắt video
  const handleSummarizeVideo = () => {
    sendPromptToAi("Tóm tắt các phân đoạn chính và nội dung quan trọng của video này giúp tôi.");
  };

  // Gửi tin nhắn thực tế qua API /api/chat
  const sendPromptToAi = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: "user",
      text: trimmed,
    };

    const currentHistory = [...messages, userMsg];
    setMessages(currentHistory);
    setInputText("");
    setIsLoading(true);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: currentHistory.map((m) => ({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.text,
          })),
          model: selectedModel,
          videoContext: {
            videoTitle,
            segments: segments.map((s) => ({
              id: s.id,
              topic: s.topic,
              start: s.start,
              end: s.end,
            })),
            transcript: sentences.map((s) => ({
              id: s.id,
              text: s.text,
              start: s.start,
              end: s.end,
            })),
          },
        }),
      });

      if (!resp.ok) {
        throw new Error(`Mã lỗi HTTP: ${resp.status}`);
      }

      const data = await resp.json();
      const botReply = data.reply || "Xin lỗi, hiện tại mình chưa nhận được phản hồi từ mô hình AI.";

      setMessages((prev) => [
        ...prev,
        {
          id: `bot_${Date.now()}`,
          sender: "bot",
          text: botReply,
          provider: data.provider || AI_MODELS.find((m) => m.id === selectedModel)?.name,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot_${Date.now()}`,
          sender: "bot",
          text: `⚠️ Không thể kết nối tới mô hình ${
            AI_MODELS.find((m) => m.id === selectedModel)?.name
          }. Bạn vui lòng kiểm tra lại kết nối mạng hoặc đổi sang mô hình AI khác ở góc trên nhé!`,
          provider: "Hệ thống",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    sendPromptToAi(inputText);
  };

  const currentModelObj = AI_MODELS.find((m) => m.id === selectedModel) || AI_MODELS[0];

  return (
    <aside className="w-80 lg:w-96 bg-white border-l border-slate-200/90 flex flex-col shrink-0 select-none z-10 text-slate-800 shadow-[-1px_0_3px_rgba(0,0,0,0.02)]">
      {/* Header: Trợ lý AI & Model Selector Dropdown */}
      <div className="h-12 border-b border-slate-200/90 px-3.5 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-2xs">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-sm text-slate-900 tracking-tight">
            Trợ lý AI
          </span>
        </div>

        {/* Góc trên: Model Selector Dropdown cho người dùng chọn AI */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200/70 border border-slate-200 text-xs font-semibold text-slate-700 transition"
            title="Chọn mô hình AI (ChatGPT, Gemini, Claude, Groq)"
          >
            <span className={`w-2 h-2 rounded-full ${currentModelObj.iconBg}`} />
            <span className="text-[11px] font-bold text-slate-800">{currentModelObj.name}</span>
            <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
          </button>

          {isModelDropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Chọn mô hình AI
              </div>
              {AI_MODELS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedModel(item.id);
                    setIsModelDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                    selectedModel === item.id
                      ? "bg-indigo-50 text-indigo-700 font-bold"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${item.iconBg}`} />
                    <span>{item.name}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-normal">
                    {item.badge}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Re-analyze banner if video not analyzed or quick trigger */}
      {onAnalyzeAI && (
        <div className="px-3.5 py-2 bg-gradient-to-r from-indigo-50/60 to-purple-50/60 border-b border-indigo-100/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-900">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Phân tích giọng nói & bóc băng AI</span>
          </div>
          <button
            onClick={onAnalyzeAI}
            disabled={isAnalyzing}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition flex items-center gap-1 disabled:opacity-50"
            title="Chạy Whisper AI để phân tích video và bóc băng toàn bộ câu thoại"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Đang chạy...</span>
              </>
            ) : (
              <>
                <Zap className="w-3 h-3" />
                <span>Chạy AI</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Chat Messages Body */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-slate-50/40 min-h-0">
        {messages.map((msg) => {
          const isUser = msg.sender === "user";
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <div
                className={`text-xs leading-relaxed max-w-[88%] rounded-2xl p-3 shadow-2xs ${
                  isUser
                    ? "bg-indigo-600 text-white rounded-tr-xs font-medium"
                    : "bg-white text-slate-800 border border-slate-200/90 rounded-tl-xs shadow-xs"
                }`}
              >
                {!isUser && msg.provider && (
                  <div className="text-[10px] font-bold text-indigo-600 mb-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    <span>{msg.provider}</span>
                  </div>
                )}
                <div className="whitespace-pre-wrap">{msg.text}</div>
              </div>
            </div>
          );
        })}

        {/* Loading Bubble */}
        {isLoading && (
          <div className="flex flex-col items-start animate-in fade-in duration-150">
            <div className="bg-white text-slate-700 border border-slate-200 rounded-2xl rounded-tl-xs p-3 shadow-xs flex items-center gap-2 text-xs">
              <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
              <span className="text-[11px] text-slate-500 italic">
                {currentModelObj.name} đang suy nghĩ...
              </span>
            </div>
          </div>
        )}

        {/* Quick Action Suggestion Chips */}
        <div className="pt-2 flex flex-wrap gap-1.5">
          <button
            onClick={handleConfirmMerge}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs hover:border-indigo-400 hover:text-indigo-600 transition"
          >
            Xác nhận gộp #2 & #3
          </button>
          <button
            onClick={handleSplitMore}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs hover:border-indigo-400 hover:text-indigo-600 transition"
          >
            Tách thêm phân đoạn
          </button>
          <button
            onClick={handleSummarizeVideo}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs hover:border-indigo-400 hover:text-indigo-600 transition"
          >
            Tóm tắt video
          </button>
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form at Bottom */}
      <div className="p-3 border-t border-slate-200/90 bg-white shrink-0">
        <form
          onSubmit={handleSendMessage}
          className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isLoading}
            placeholder={`Hỏi ${currentModelObj.name} về video...`}
            className="flex-1 text-xs bg-transparent outline-none text-slate-800 placeholder:text-slate-400 py-1 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition disabled:opacity-40 disabled:cursor-not-allowed shadow-xs shrink-0"
            title="Gửi yêu cầu (Enter)"
          >
            <Send className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </form>
      </div>
    </aside>
  );
};
