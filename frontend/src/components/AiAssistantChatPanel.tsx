"use client";

import React, { useState, useRef, useEffect } from "react";
import { Segment } from "@/types";
import { Send } from "lucide-react";

export interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp?: string;
  actionChips?: {
    id: string;
    label: string;
    action: () => void;
  }[];
}

interface AiAssistantChatPanelProps {
  segments: Segment[];
  videoTitle: string;
  activeSegmentId?: string;
  onMergeSegments?: (segIndex1: number, segIndex2: number) => void;
  onSplitSegment?: (segId: string) => void;
  onOpenSegmentDetail?: (segment: Segment, index: number) => void;
}

export const AiAssistantChatPanel: React.FC<AiAssistantChatPanelProps> = ({
  segments,
  videoTitle,
  onMergeSegments,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_1",
      sender: "bot",
      text: "Mình đã phân tích video và chia thành 5 phân đoạn. Bạn muốn chỉnh phân đoạn nào?",
    },
    {
      id: "msg_2",
      sender: "user",
      text: "Gộp phân đoạn 2 và 3 thành một",
    },
    {
      id: "msg_3",
      sender: "bot",
      text: "Đã đề xuất gộp #2 và #3 thành một clip dài 04:06. Bạn xác nhận để áp dụng lên timeline nhé?",
    },
  ]);

  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Hành động xác nhận gộp phân đoạn 2 và 3
  const handleConfirmMerge = () => {
    if (onMergeSegments) {
      onMergeSegments(1, 2); // 0-based index: đoạn 2 (index 1) và đoạn 3 (index 2)
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `user_${Date.now()}`,
        sender: "user",
        text: "Xác nhận gộp",
      },
      {
        id: `bot_${Date.now()}`,
        sender: "bot",
        text: "✓ Đã gộp thành công phân đoạn #2 và #3 thành một clip dài 04:06 trên timeline!",
      },
    ]);
  };

  // Hành động tách thêm phân đoạn
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
        text: "Mình nhận thấy phân đoạn #2 đang có độ dài hơn 3 phút. Bạn có thể kéo con trỏ timeline đến vị trí mong muốn và bấm nút 'Cắt' ✂ trên thanh công cụ nhé!",
      },
    ]);
  };

  // Hành động tóm tắt video
  const handleSummarizeVideo = () => {
    setMessages((prev) => [
      ...prev,
      {
        id: `user_${Date.now()}`,
        sender: "user",
        text: "Tóm tắt video",
      },
      {
        id: `bot_${Date.now()}`,
        sender: "bot",
        text: `Bài giảng "${videoTitle}" bao gồm ${segments.length} phân đoạn chính: từ mở đầu giới thiệu khái niệm ép kiểu, ví dụ chuyển đổi biến số nguyên sang số thực, xử lý các ngoại lệ thường gặp đến lưu ý tối ưu code.`,
      },
    ]);
  };

  // Gửi tin nhắn từ người dùng
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: "user",
      text: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    // Phản hồi tự động thông minh từ AI
    setTimeout(() => {
      let botResponse = "Mình đã ghi nhận yêu cầu. Bạn có thể chọn các nút thao tác nhanh bên dưới để áp dụng trực tiếp lên timeline.";
      const lower = trimmed.toLowerCase();

      if (lower.includes("gộp") || lower.includes("merge")) {
        botResponse = "Đã tìm thấy các phân đoạn liền kề. Bạn có muốn gộp phân đoạn được chọn vào phân đoạn tiếp theo không?";
      } else if (lower.includes("tách") || lower.includes("cắt") || lower.includes("split")) {
        botResponse = "Bạn hãy đặt con trỏ Playhead đỏ tại giây cần tách trên timeline rồi bấm nút '✂ Cắt' nhé!";
      } else if (lower.includes("tóm tắt") || lower.includes("nội dung")) {
        botResponse = `Video gồm ${segments.length} phân đoạn: ${segments.map((s, idx) => `#${idx + 1} ${s.topic}`).join("; ")}.`;
      } else if (lower.includes("xin chào") || lower.includes("hello")) {
        botResponse = "Xin chào bạn! Mình là Trợ lý AI AutoCut. Mình có thể giúp bạn gộp, tách và tối ưu phân đoạn video tự động.";
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `bot_${Date.now()}`,
          sender: "bot",
          text: botResponse,
        },
      ]);
    }, 600);
  };

  return (
    <aside className="w-80 lg:w-96 bg-white border-l border-slate-200/90 flex flex-col shrink-0 select-none z-10 text-slate-800 shadow-[ -1px_0_3px_rgba(0,0,0,0.02) ]">
      {/* Header: Trợ lý AI & Trạng thái Sẵn sàng */}
      <div className="h-12 border-b border-slate-200/90 px-4 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-slate-900 tracking-tight">
            Trợ lý AI
          </span>
        </div>

        {/* Status: Sẵn sàng */}
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Sẵn sàng</span>
        </div>
      </div>

      {/* Chat Messages Body */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-50/50 min-h-0">
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
                {msg.text}
              </div>
            </div>
          );
        })}

        {/* Quick Action Suggestion Chips matching reference image */}
        <div className="pt-2 flex flex-wrap gap-2">
          <button
            onClick={handleConfirmMerge}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs hover:border-indigo-400 hover:text-indigo-600 transition hover:scale-102 active:scale-98"
          >
            Xác nhận gộp
          </button>
          <button
            onClick={handleSplitMore}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs hover:border-indigo-400 hover:text-indigo-600 transition hover:scale-102 active:scale-98"
          >
            Tách thêm phân đoạn
          </button>
          <button
            onClick={handleSummarizeVideo}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs hover:border-indigo-400 hover:text-indigo-600 transition hover:scale-102 active:scale-98"
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
            placeholder="Nhập yêu cầu cho AI..."
            className="flex-1 text-xs bg-transparent outline-none text-slate-800 placeholder:text-slate-400 py-1"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
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
