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
        <CatFaceIcon />
      </button>
    </div>
  );
}

function CatFaceIcon() {
  return (
    <svg viewBox="0 0 40 40" width="46" height="46" aria-hidden="true">
      <defs>
        <filter id="hubBotCatShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1" floodColor="#000000" floodOpacity="0.2" />
        </filter>
      </defs>
      <g filter="url(#hubBotCatShadow)">
        {/* 귀: 스티커 느낌의 굵은 외곽선 */}
        <path d="M8.5 6L18.5 15.5 6.5 14Z" fill="#9a9a90" stroke="#3a3a35" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M31.5 6L21.5 15.5 33.5 14Z" fill="#9a9a90" stroke="#3a3a35" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M11 9.8L15.2 13.7 9.9 12.9Z" fill="#f6cdd0" />
        <path d="M29 9.8L24.8 13.7 30.1 12.9Z" fill="#f6cdd0" />

        {/* 얼굴 */}
        <circle cx="20" cy="21.5" r="15" fill="#ffffff" stroke="#3a3a35" strokeWidth="1.8" />

        {/* 볼터치 */}
        <ellipse cx="8.7" cy="27" rx="3.2" ry="2" fill="#f6cdd0" opacity="0.8" />
        <ellipse cx="31.3" cy="27" rx="3.2" ry="2" fill="#f6cdd0" opacity="0.8" />

        {/* 눈 (스티커 느낌의 굵은 외곽선 + 하이라이트) */}
        <circle cx="13.6" cy="21.5" r="3.4" fill="#5f8a55" stroke="#3a3a35" strokeWidth="1.2" />
        <circle cx="26.4" cy="21.5" r="3.4" fill="#5f8a55" stroke="#3a3a35" strokeWidth="1.2" />
        <circle cx="12.4" cy="20" r="1.2" fill="#ffffff" />
        <circle cx="25.2" cy="20" r="1.2" fill="#ffffff" />

        {/* 코 + 입 */}
        <path d="M18.3 26h3.4l-1.7 1.7Z" fill="#e79aa0" stroke="#3a3a35" strokeWidth="0.8" strokeLinejoin="round" />
        <path
          d="M20 27.7v1.2M16.2 30.6c1.1 1.5 2.7 1.5 3.8.3c1.1 1.2 2.7 1.2 3.8-.3"
          stroke="#3a3a35"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* 수염 */}
        <path d="M9 25.5l-4.5.5M31 25.5l4.5.5" stroke="#3a3a35" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
      </g>
    </svg>
  );
}
