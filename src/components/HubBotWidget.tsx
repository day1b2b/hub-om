"use client";

import { useRef, useState } from "react";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const EXAMPLE_QUESTIONS = ["운영 프로세스가 어떻게 되나요?", "매뉴얼에서 이 부분은 어떻게 하나요?"];

export function HubBotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  async function sendMessage(text: string) {
    const question = text.trim();
    if (!question || isLoading) return;

    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/hubbot/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, history })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; reply?: string; error?: string };

      if (!response.ok || !payload.ok) {
        setError(payload.error || "답변을 가져오지 못했습니다. 다시 시도해 주세요.");
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: payload.reply ?? "" }]);
    } catch {
      setError("네트워크 오류로 답변을 가져오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="hub-bot">
      {isOpen && (
        <div className="hub-bot-panel" ref={panelRef} role="dialog" aria-label="미로 업무 챗봇">
          <div className="hub-bot-panel-header">
            <span>미로</span>
            <button type="button" onClick={() => setIsOpen(false)} aria-label="챗봇 닫기">
              ×
            </button>
          </div>

          <div className="hub-bot-panel-body">
            {messages.length === 0 && (
              <div className="hub-bot-empty">
                <p>전체 운영 프로세스와 매뉴얼 내용을 물어보세요.</p>
                <div className="hub-bot-examples">
                  {EXAMPLE_QUESTIONS.map((question) => (
                    <button key={question} type="button" onClick={() => sendMessage(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((turn, index) => (
              <div key={index} className={`hub-bot-message ${turn.role}`}>
                {turn.content}
              </div>
            ))}

            {isLoading && <div className="hub-bot-message assistant hub-bot-loading">답변 준비 중...</div>}
            {error && <div className="hub-bot-error">{error}</div>}
          </div>

          <form
            className="hub-bot-panel-input"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="질문을 입력하세요"
              disabled={isLoading}
            />
            <button type="submit" disabled={isLoading || !input.trim()}>
              보내기
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="hub-bot-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="미로 업무 챗봇 열기"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/miro-cat.png" alt="" className="hub-bot-toggle-image" />
      </button>
    </div>
  );
}
