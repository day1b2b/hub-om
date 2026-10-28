"use client";

// 개인정보 마스킹→클릭 열람 공용 컴포넌트. 기본은 "클릭해 열람" 버튼만 보이고(서버가 평문을 안 내려줌),
// 누르면 /api/pii/reveal로 그 필드 1개를 복호화해 가져와 보여준다(열람은 서버에서 감사 로그로 남는다).
// 다시 "가리기"로 숨길 수 있다.
import { useState } from "react";

type RevealState = "masked" | "loading" | "revealed" | "error";

interface MaskedFieldProps {
  entity: string;
  id: string;
  field: string;
  label: string;
}

export function MaskedField({ entity, field, id, label }: MaskedFieldProps) {
  const [state, setState] = useState<RevealState>("masked");
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function reveal() {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/pii/reveal", {
        body: JSON.stringify({ entity, field, id }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (response.redirected || response.status === 401 || response.status === 403) {
        throw new Error("로그인이 만료되었어요. 다시 로그인한 뒤 눌러 주세요.");
      }
      const payload = (await response.json().catch(() => ({}))) as { error?: string; value?: string | null };
      if (!response.ok) throw new Error(payload.error ?? "열람하지 못했어요.");
      setValue(payload.value ?? null);
      setState("revealed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "열람하지 못했어요.");
      setState("error");
    }
  }

  return (
    <div className="coach-origin-info-item masked-field">
      <span>{label}</span>
      {state === "revealed" ? (
        <strong className="masked-field-revealed">
          {value || "등록된 값이 없어요"}
          <button className="masked-field-toggle" onClick={() => setState("masked")} type="button">
            가리기
          </button>
        </strong>
      ) : (
        <button className="masked-field-reveal" disabled={state === "loading"} onClick={reveal} type="button">
          {state === "loading" ? "여는 중…" : "•••• 클릭해 열람"}
        </button>
      )}
      {state === "error" ? (
        <span className="masked-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
