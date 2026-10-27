"use client";

// 강사 계약요청 목록(클라이언트). 기본 상태에선 프리필 링크만 보이고(서버에서 만든 items),
// "계약 상태·이메일 불러오기"를 누르면 응답시트를 읽는 라우트로 (코스ID×강사) 상태를 가져와
// "요청됨" 뱃지와 이메일 자동채움을 덧입힌다. 운영현황 상세는 핫 페이지라 진입 때는 시트를 읽지
// 않고, 이 버튼을 눌렀을 때만 읽는다.
import { useState } from "react";
import { buildContractPrefillUrl } from "@/lib/instructors/instructorContractPrefill";
import type { ContractRequestItem } from "@/lib/instructors/instructorContractRequests";

interface StatusEntry {
  requested: boolean;
  email?: string;
}

type LoadPhase = "idle" | "loading" | "done" | "error";

function rowKey(item: { courseId: string; instructorName: string }): string {
  return `${item.courseId}\u0000${item.instructorName}`;
}

export function InstructorContractList({ items }: { items: ContractRequestItem[] }) {
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [error, setError] = useState("");
  const [statusByKey, setStatusByKey] = useState<Record<string, StatusEntry>>({});

  async function loadStatus() {
    setPhase("loading");
    setError("");
    try {
      const response = await fetch("/api/operations/instructor-contract-status", {
        body: JSON.stringify({
          pairs: items.map((item) => ({ courseId: item.courseId, instructorName: item.instructorName }))
        }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      // 세션이 만료되면 가드가 /sign-in으로 돌려보내 HTML(200)이 오거나 401/403이 온다.
      // 이를 거르지 않으면 "조용히 아무 일도 안 일어남"으로 끝나 OM이 원인을 모른다.
      if (response.redirected || response.status === 401 || response.status === 403) {
        throw new Error("로그인이 만료되었어요. 다시 로그인한 뒤 눌러 주세요.");
      }
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        items?: { courseId: string; instructorName: string; requested?: boolean; email?: string }[];
      };
      if (!response.ok) throw new Error(payload.error ?? "계약 상태를 불러오지 못했습니다.");
      const next: Record<string, StatusEntry> = {};
      for (const result of payload.items ?? []) {
        next[rowKey(result)] = { email: result.email || undefined, requested: Boolean(result.requested) };
      }
      setStatusByKey(next);
      setPhase("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "계약 상태를 불러오지 못했습니다.");
      setPhase("error");
    }
  }

  return (
    <div className="instructor-contract-body">
      <div className="instructor-contract-actions">
        <button
          className="instructor-contract-status-load"
          disabled={phase === "loading"}
          onClick={loadStatus}
          type="button"
        >
          {phase === "loading" ? "불러오는 중…" : "계약 상태·이메일 불러오기"}
        </button>
        {phase === "error" ? (
          <span className="instructor-contract-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <ul className="instructor-contract-list">
        {items.map((item) => {
          const status = statusByKey[rowKey(item)];
          const email = status?.email ?? item.email;
          return (
            <li className="instructor-contract-item" key={rowKey(item)}>
              <div className="instructor-contract-meta">
                <span className="instructor-contract-name">
                  {item.instructorName}
                  {status?.requested ? <span className="instructor-contract-badge">요청됨</span> : null}
                </span>
                {item.schedule ? <span className="instructor-contract-schedule">{item.schedule}</span> : null}
                {status && !email ? (
                  <span className="instructor-contract-note">이메일 없음 · 폼에서 입력</span>
                ) : null}
              </div>
              <a
                className="instructor-contract-open"
                href={buildContractPrefillUrl({
                  courseId: item.courseId,
                  courseName: item.courseName,
                  email,
                  instructorName: item.instructorName,
                  manager: item.manager,
                  schedule: item.schedule
                })}
                rel="noopener noreferrer"
                target="_blank"
              >
                계약폼 열기 ↗
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
