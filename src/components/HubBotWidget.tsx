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
        <div className="hub-bot-panel" ref={panelRef} role="dialog" aria-label="업무 챗봇">
          <div className="hub-bot-panel-header">
            <span>hub-bot</span>
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
        aria-label="업무 챗봇 열기"
      >
        <CatFaceIcon />
      </button>
    </div>
  );
}

function CatFaceIcon() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      {/* 코리안숏헤어 고등어 무늬 참고: 귀/정수리에만 회색 고등어 무늬, 얼굴은 흰색 */}
      <path d="M7.5 6.5L13 13.5 6.8 13.2Z" fill="#9a9a90" stroke="#84847a" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M24.5 6.5L19 13.5 25.2 13.2Z" fill="#9a9a90" stroke="#84847a" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M9.3 9.2L10.6 12M22.7 9.2L21.4 12" stroke="#6f6f65" strokeWidth="0.7" strokeLinecap="round" />

      <circle cx="16" cy="18" r="10" fill="#ffffff" stroke="#d8d8d1" strokeWidth="1.2" />
      <path
        d="M8.3 11.5C8 13.5 8.6 16 10.3 17.5M23.7 11.5C24 13.5 23.4 16 21.7 17.5"
        fill="#9a9a90"
        stroke="none"
      />

      <ellipse cx="12.4" cy="18" rx="1.5" ry="1.9" fill="#6f8f5f" />
      <ellipse cx="19.6" cy="18" rx="1.5" ry="1.9" fill="#6f8f5f" />
      <circle cx="12.8" cy="17.4" r="0.45" fill="#ffffff" />
      <circle cx="20" cy="17.4" r="0.45" fill="#ffffff" />

      <path d="M15.2 20.4h1.6l-0.8 0.9Z" fill="#e3a9ac" />
      <path d="M16 21.3v0.9M13.6 23.2c1.1.9 3.7.9 4.8 0" stroke="#84847a" strokeWidth="1.1" strokeLinecap="round" fill="none" />

      <path
        d="M8.2 20.2l-3.4.2M8.2 21.6l-3.6 1.4M23.8 20.2l3.4.2M23.8 21.6l3.6 1.4"
        stroke="#84847a"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
