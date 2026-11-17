"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EGG_PART_LABEL } from "@/lib/data/eggs/eggTypes";
import type { EggGuideContent, EggPart } from "@/lib/data/eggs/eggTypes";

interface EggGuidePanelProps {
  part: EggPart;
  guide: EggGuideContent | null;
  /** 관리자만 수정 버튼을 본다. 저장 API도 관리자만 허용한다. */
  isAdmin: boolean;
}

/**
 * 파트별 주의사항(요금제, 데이터 잔량 확인 방법, 충전 규칙, 고장 시 연락처).
 * 파트 안 모든 에그에 공통으로 적용되는 내용만 둔다. 기기마다 다른 점은 기기 카드에 표시한다.
 * 발급 담당자 이름과 연락처가 들어가므로 코드에 두지 않고 DB에 저장한다.
 */
export function EggGuidePanel({ part, guide, isAdmin }: EggGuidePanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(guide?.content ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasContent = Boolean(guide?.content.trim());

  function startEdit() {
    setDraft(guide?.content ?? "");
    setError(null);
    setOpen(true);
    setEditing(true);
  }

  async function save() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/eggs/guide", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ part, content: draft })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "주의사항 저장에 실패했습니다.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("저장 요청을 보내지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="dashboard-panel egg-guide">
      <div className="section-title">
        <button type="button" className="egg-guide-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="egg-guide-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <h2>{EGG_PART_LABEL[part]} 에그 주의사항</h2>
          {!open ? <span className="egg-guide-hint">사용 전에 펼쳐서 꼭 확인해주세요</span> : null}
        </button>
        {isAdmin && !editing ? (
          <button type="button" className="assign-cancel-btn egg-guide-edit-btn" onClick={startEdit}>
            수정
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="egg-guide-body">
          {error ? <p className="egg-feedback egg-feedback-error">{error}</p> : null}
          <textarea
            className="egg-guide-input"
            rows={14}
            value={draft}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={"[요금제]\n월 20GB, 매월 1일 초기화\n\n[충전]\n충전할 때는 전원을 끈 뒤 충전합니다."}
          />
          <p className="egg-guide-edit-hint">「[제목]」 줄은 굵게, 주소는 링크로 보입니다. 줄바꿈은 그대로 유지됩니다.</p>
          <div className="egg-guide-actions">
            <button
              type="button"
              className="assign-cancel-btn"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              취소
            </button>
            <button type="button" className="assign-save-btn" disabled={pending} onClick={() => void save()}>
              {pending ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      ) : open ? (
        <div className="egg-guide-body">
          {hasContent ? (
            <EggGuideText content={guide!.content} />
          ) : (
            <div className="dashboard-empty-note">아직 등록된 주의사항이 없습니다.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/;

/** 주의사항 본문. 「[제목]」 줄은 굵게, 주소는 새 탭 링크로 보여준다. 예약 폼에서도 같이 쓴다. */
export function EggGuideText({ content }: { content: string }) {
  return (
    <div className="egg-guide-text">
      {content.split("\n").map((line, index) =>
        /^\[.+\]$/.test(line.trim()) ? (
          <strong key={index}>{line.trim().slice(1, -1)}</strong>
        ) : (
          <p key={index}>
            {line
              ? line.split(URL_PATTERN).map((piece, pieceIndex) =>
                  pieceIndex % 2 === 1 ? (
                    <a key={pieceIndex} href={piece} target="_blank" rel="noreferrer">
                      {piece}
                    </a>
                  ) : (
                    piece
                  )
                )
              : "\u00a0"}
          </p>
        )
      )}
    </div>
  );
}
