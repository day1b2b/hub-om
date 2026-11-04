"use client";

// 강사 계약요청 목록(클라이언트). 기본 상태에선 프리필 링크만 보이고(서버에서 만든 items),
// "계약 상태·이메일 불러오기"를 누르면 응답시트를 읽는 라우트로 (코스ID×강사) 상태를 가져와
// "요청됨" 뱃지와 이메일 자동채움을 덧입힌다. 운영현황 상세는 핫 페이지라 진입 때는 시트를 읽지
// 않고, 이 버튼을 눌렀을 때만 읽는다.
// 화면을 열 때는 08:00·12:00 예약 동기화 스냅샷(initialProgress)으로 단계·모두싸인 서명 진행을 먼저 보여주고
// (시트에 없는 강사는 "미요청"), 버튼은 "지금 새로고침"(시트 + 이 강사들의 모두싸인 문서)이다.
// 교육 시작일이 2026-09-01 전인 과정(signingTracked=false)은 서명 진행 없이 시트 단계만 보인다.
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

/** "2026.11.03 12:00" (KST) */
function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
    year: "numeric"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
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
  items,
  signingTracked
}: {
  initialProgress: InitialContractProgress | null;
  items: ContractRequestItem[];
  /** 교육 시작일 기준 모두싸인 서명 진행 표시 대상인지(isSigningTracked). */
  signingTracked: boolean;
}) {
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [error, setError] = useState("");
  const [statusByKey, setStatusByKey] = useState<Record<string, StatusEntry>>(() => {
    const initial: Record<string, StatusEntry> = {};
    for (const [key, entry] of Object.entries(initialProgress?.byKey ?? {})) initial[key] = { ...entry };
    // 스냅샷은 시트에 있는 (코스ID×강사)만 담는다. 없는 강사 = 아직 계약요청 전이라 "미요청"을 기본으로 보여준다.
    // 대상 과정만 — 이전 과정은 폼 밖에서 계약했을 수 있어 미요청으로 단정하지 않는다.
    if (initialProgress && signingTracked) {
      for (const item of items) initial[rowKey(item)] ??= { requested: false, sent: false };
    }
    return initial;
  });
  // 모두싸인 서명 진행을 읽은 적이 있는지 — 없으면 "문서 못 찾음"을 띄우지 않는다.
  const [modusignOn, setModusignOn] = useState(Boolean(initialProgress?.modusignSynced));
  const [syncedLabel, setSyncedLabel] = useState(() =>
    initialProgress
      ? `${formatSyncedAt(initialProgress.syncedAt)} 기준${signingTracked && !initialProgress.modusignSynced ? " · 모두싸인 미연결" : ""}`
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
      if (payload.modusignSynced) setModusignOn(true);
      setSyncedLabel(
        `${formatSyncedAt(new Date().toISOString())} 기준${signingTracked && !payload.modusignSynced && !modusignOn ? " · 모두싸인 미연결" : ""}`
      );
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
          const stored = statusByKey[rowKey(item)];
          const status = stored && !signingTracked ? { ...stored, signing: undefined } : stored;
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
                {status && status.sent && !status.signing && modusignOn && signingTracked ? (
                  <span className="instructor-contract-note">모두싸인 문서를 못 찾았어요</span>
                ) : null}
                {phase === "done" && status && !email ? (
                  <span className="instructor-contract-note">이메일 없음 · 폼에서 입력</span>
                ) : null}
              </div>
              <ContractFormOpenButton
                href={buildContractPrefillUrl({
                  courseId: item.courseId,
                  courseName: item.courseName,
                  email,
                  instructorName: item.instructorName,
                  manager: item.manager,
                  schedule: item.schedule
                })}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// 확인 창 [구글 설문폼에 자동으로 기입되는 내용] 표 — buildContractPrefillUrl()이 채우는 항목과 맞춰 둔다.
// [hub-om 항목, 구글 설문폼 항목, 덧붙임 설명]
const CONTRACT_REQUEST_FIELD_GROUPS: { label: string; detail?: string; rows: [string, string, string?][] }[] = [
  {
    label: "운영 현황",
    rows: [
      ["코스 ID", "코스 ID"],
      ["과정명", "과정명"],
      ["강사명", "강사명"],
      ["강의 일정", "일정"],
      ["담당 OM", "담당자"]
    ]
  },
  {
    label: "강사 정보",
    rows: [["이메일", "이메일", "자동으로 못 채우면 폼에서 입력"]]
  }
];

// 계약폼은 자동 기입된 채로 열린다. 계약서인 만큼, 넘어가기 전에 무엇이 채워지는지 알려 주고 최종 확인을 받는다.
// 기업위키 "계산서 발행 요청" 확인 창(InvoiceRequestLink)과 같은 결.
function ContractFormOpenButton({ href }: { href: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button className="instructor-contract-open" onClick={() => setIsOpen(true)} type="button">
        계약폼 열기 ↗
      </button>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setIsOpen(false)} />
          <section aria-labelledby="contract-request-confirm-title" className="drive-review-dialog contract-request-confirm-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="contract-request-confirm-title">강사 계약요청</h2>
              </div>
              <button aria-label="강사 계약요청 닫기" onClick={() => setIsOpen(false)} type="button">
                닫기
              </button>
            </div>

            <div className="lecture-note-body contract-request-confirm-body">
              <p className="contract-request-confirm-intro">
                운영 현황·강사 정보에 등록된 값으로 강사 계약서(구글폼)가 자동 기입됩니다.
              </p>
              <p className="contract-request-confirm-warning">※ 계약서인 만큼, 열기 전 내용이 맞는지 꼭 최종 확인해주세요!</p>
              <strong>[구글 설문폼에 자동으로 기입되는 내용]</strong>
              <table className="contract-request-confirm-table">
                <thead>
                  <tr>
                    <th colSpan={2} scope="colgroup">운영 허브(Hub-OM) 내용</th>
                    <th scope="col">구글 설문폼 항목</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACT_REQUEST_FIELD_GROUPS.map((group) =>
                    group.rows.map(([source, target, note], index) => (
                      <tr key={`${group.label}-${source}`}>
                        {index === 0 ? (
                          <th rowSpan={group.rows.length} scope="rowgroup">
                            {group.label}
                            {group.detail ? <span>({group.detail})</span> : null}
                          </th>
                        ) : null}
                        <td>{source}</td>
                        <td>
                          {target}
                          {note ? <span>{note}</span> : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <p className="contract-request-confirm-note">강사료·계약유형 등 나머지 항목은 폼에서 직접 확인·입력하세요.</p>
            </div>

            <div className="lecture-note-footer">
              <div className="lecture-note-actions">
                <button onClick={() => setIsOpen(false)} type="button">
                  취소
                </button>
                <a
                  className="contract-request-confirm-open"
                  href={href}
                  onClick={() => setIsOpen(false)}
                  rel="noreferrer"
                  target="_blank"
                >
                  확인
                </a>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
