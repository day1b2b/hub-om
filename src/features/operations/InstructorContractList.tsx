"use client";

// 강사 계약요청 목록(클라이언트). 기본 상태에선 프리필 링크만 보이고(서버에서 만든 items),
// "계약 상태·이메일 불러오기"를 누르면 응답시트를 읽는 라우트로 (코스ID×강사) 상태를 가져와
// "요청됨" 뱃지와 이메일 자동채움을 덧입힌다. 운영현황 상세는 핫 페이지라 진입 때는 시트를 읽지
// 않고, 이 버튼을 눌렀을 때만 읽는다.
// 화면을 열 때는 08:00·12:00 예약 동기화 스냅샷(initialProgress)으로 단계·모두싸인 서명 진행을 먼저 보여주고,
// 버튼은 "지금 새로고침"(시트 + 이 강사들의 모두싸인 문서)이다.
import { useState } from "react";
import { buildContractPrefillUrl } from "@/lib/instructors/instructorContractPrefill";
import type { ContractRequestItem } from "@/lib/instructors/instructorContractRequests";
import { describeSigning, type SigningSummary } from "@/lib/instructors/instructorContractSigning";

interface StatusEntry {
  requested: boolean;
  /** 시트 C열(계약 발송·모두싸인) 체크. 서명 완료는 아니다. */
  sent: boolean;
  email?: string;
  /** 모두싸인 서명 진행(문서를 찾았을 때만). */
  signing?: SigningSummary;
}

export interface InitialContractProgress {
  syncedAt: string;
  modusignSynced: boolean;
  /** rowKey → 스냅샷 항목(이메일 없음). */
  byKey: Record<string, { requested: boolean; sent: boolean; signing?: SigningSummary }>;
}

const CONTRACT_STEPS = ["미요청", "요청됨", "발송됨", "서명 중", "서명 완료"] as const;

function contractStep(status: StatusEntry): number {
  if (status.signing?.phase === "completed") return 4;
  if (status.signing?.phase === "signing") return 3;
  return status.sent ? 2 : status.requested ? 1 : 0;
}

/** "11/03 12:00" (KST) */
function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

function SigningLine({ signing }: { signing: SigningSummary }) {
  const tone = signing.phase === "aborted" || signing.phase === "ambiguous" ? " is-warn" : signing.phase === "completed" ? " is-done" : "";
  return (
    <span className={`contract-signing${tone}`}>
      <span className="contract-signing-text">{describeSigning(signing)}</span>
      {signing.phase === "signing" && signing.steps.length > 0 ? (
        <span className="contract-signing-roles">
          {signing.steps.map((step, index) => (
            <span
              className={step.signed ? "done" : step.role === signing.currentRole ? "now" : ""}
              key={`${step.role}-${index}`}
            >
              {step.role}
              {step.signed ? " ✓" : step.role === signing.currentRole ? " 대기" : ""}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

type LoadPhase = "idle" | "loading" | "done" | "error";

function rowKey(item: { courseId: string; instructorName: string }): string {
  return `${item.courseId}\u0000${item.instructorName}`;
}

export function InstructorContractList({
  initialProgress,
  items
}: {
  initialProgress: InitialContractProgress | null;
  items: ContractRequestItem[];
}) {
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [error, setError] = useState("");
  const [statusByKey, setStatusByKey] = useState<Record<string, StatusEntry>>(() => {
    const initial: Record<string, StatusEntry> = {};
    for (const [key, entry] of Object.entries(initialProgress?.byKey ?? {})) initial[key] = { ...entry };
    return initial;
  });
  // 모두싸인 서명 진행을 읽은 적이 있는지 — 없으면 "문서 못 찾음"을 띄우지 않는다.
  const [modusignOn, setModusignOn] = useState(Boolean(initialProgress?.modusignSynced));
  const [syncedLabel, setSyncedLabel] = useState(() =>
    initialProgress
      ? initialProgress.modusignSynced
        ? `모두싸인 ${formatSyncedAt(initialProgress.syncedAt)} 기준`
        : `시트 ${formatSyncedAt(initialProgress.syncedAt)} 기준 · 모두싸인 미연결`
      : ""
  );

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
        modusignSynced?: boolean;
        items?: {
          courseId: string;
          instructorName: string;
          requested?: boolean;
          sent?: boolean;
          email?: string;
          signing?: SigningSummary;
        }[];
      };
      if (!response.ok) throw new Error(payload.error ?? "계약 상태를 불러오지 못했습니다.");
      const next: Record<string, StatusEntry> = {};
      for (const result of payload.items ?? []) {
        next[rowKey(result)] = {
          email: result.email || undefined,
          requested: Boolean(result.requested),
          sent: Boolean(result.sent),
          // 모두싸인을 못 읽었으면(키 미설정·오류) 스냅샷의 서명 진행을 유지한다.
          signing: payload.modusignSynced ? result.signing : statusByKey[rowKey(result)]?.signing
        };
      }
      setStatusByKey(next);
      if (payload.modusignSynced) {
        setModusignOn(true);
        setSyncedLabel(`모두싸인 ${formatSyncedAt(new Date().toISOString())} 기준`);
      }
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
          {phase === "loading" ? "불러오는 중…" : "지금 새로고침 (상태·이메일)"}
        </button>
        {syncedLabel ? <span className="instructor-contract-synced">{syncedLabel}</span> : null}
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
                  {status && status.requested ? <span className="instructor-contract-badge">{CONTRACT_STEPS[contractStep(status)]}</span> : null}
                </span>
                {item.schedule ? <span className="instructor-contract-schedule">{item.schedule}</span> : null}
                {status ? (
                  <span className="contract-steps" aria-label={`계약 진행: ${CONTRACT_STEPS[contractStep(status)]}`}>
                    {CONTRACT_STEPS.map((step, stepIndex) => (
                      <span className={stepIndex < contractStep(status) ? "done" : stepIndex === contractStep(status) ? "now" : ""} key={step}>
                        {step}
                      </span>
                    ))}
                  </span>
                ) : null}
                {status?.signing ? <SigningLine signing={status.signing} /> : null}
                {status && status.sent && !status.signing && modusignOn ? (
                  <span className="instructor-contract-note">모두싸인 문서를 못 찾았어요</span>
                ) : null}
                {phase === "done" && status && !email ? (
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
