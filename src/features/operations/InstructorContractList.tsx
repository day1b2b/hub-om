"use client";

// 강사 계약 현황 목록(클라이언트). 기본 상태에선 프리필 링크만 보이고(서버에서 만든 items),
// "계약 상태·이메일 불러오기"를 누르면 응답시트를 읽는 라우트로 (코스ID×강사) 상태를 가져와
// "요청됨" 뱃지와 이메일 자동채움을 덧입힌다. 운영현황 상세는 핫 페이지라 진입 때는 시트를 읽지
// 않고, 이 버튼을 눌렀을 때만 읽는다.
// 화면을 열 때는 08:00·12:00 예약 동기화 스냅샷(initialProgress)으로 단계·모두싸인 서명 진행을 먼저 보여주고
// (시트에 없는 강사는 "미요청"), 버튼은 "지금 새로고침"(시트 + 이 강사들의 모두싸인 문서)이다.
// 교육 시작일이 2026-09-01 전인 과정(signingTracked=false)은 모두싸인을 보지 않고 전부 "서명 완료"로 둔다
// (2026-11-04 결정 "그 전에꺼는 일단 완료로") — 바닥줄에 그렇게 표시한다고 밝힌다.
import { useState } from "react";
import { buildContractPrefillUrl } from "@/lib/instructors/instructorContractPrefill";
import type { ContractRequestItem } from "@/lib/instructors/instructorContractRequests";
import { describeSigning, type SigningSummary } from "@/lib/instructors/instructorContractSigning";
import type { ContractFeeHint } from "@/lib/instructors/instructorContractEmail";

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
        `${formatSyncedAt(new Date().toISOString())} 기준${
          signingTracked && !payload.modusignSynced ? (modusignOn ? " · 서명 진행은 모두싸인을 못 읽어 이전 값" : " · 모두싸인 미연결") : ""
        }`
      );
      setPhase("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "계약 상태를 불러오지 못했습니다.");
      setPhase("error");
    }
  }

  return (
    <div className="instructor-contract-body">
      {/* 강사 한 명 = 한 줄: 이름·일정 | 상태 한 칸(+짧은 설명) | 계약폼 열기. 조회 시점·새로고침은 바닥줄. */}
      <ul className="instructor-contract-list">
        {items.map((item) => {
          const stored = statusByKey[rowKey(item)];
          const status: StatusEntry | undefined = signingTracked
            ? stored
            : { email: stored?.email, requested: true, sent: true, signing: { phase: "completed", steps: [] } };
          const email = status?.email ?? item.email;
          const view = status ? describeStatus(status, { modusignOn, signingTracked }) : null;
          const notes = [view?.detail, phase === "done" && status && !email ? "이메일 없음 · 폼에서 입력" : ""].filter(Boolean);
          return (
            <li className="instructor-contract-item" key={rowKey(item)}>
              <div className="instructor-contract-meta">
                <span className="instructor-contract-name">{item.instructorName}</span>
                {item.schedule ? <span className="instructor-contract-schedule">{item.schedule}</span> : null}
              </div>
              <div className="instructor-contract-state">
                {view ? <span className={`contract-state-pill is-${view.tone}`}>{view.label}</span> : null}
                {notes.length > 0 ? <span className="instructor-contract-note">{notes.join(" · ")}</span> : null}
              </div>
              <ContractFormOpenButton
                knownEmail={email ?? ""}
                values={{
                  courseId: item.courseId,
                  courseName: item.courseName,
                  instructorName: item.instructorName,
                  schedule: item.formSchedule || item.schedule,
                  manager: item.manager,
                  department: item.department ?? ""
                }}
              />
            </li>
          );
        })}
      </ul>
      <div className="instructor-contract-foot">
        {phase === "error" ? (
          <span className="instructor-contract-error" role="alert">
            {error}
          </span>
        ) : syncedLabel && phase !== "loading" ? (
          <span className="instructor-contract-synced">{syncedLabel}</span>
        ) : null}
        {!signingTracked ? <span className="instructor-contract-synced">9/1 이전 과정은 완료로 표시</span> : null}
        <button
          className="instructor-contract-status-load"
          disabled={phase === "loading"}
          onClick={loadStatus}
          title="계약 응답시트·모두싸인에서 상태와 이메일을 다시 읽어요"
          type="button"
        >
          {phase === "loading" ? "불러오는 중…" : "↻ 새로고침"}
        </button>
      </div>
    </div>
  );
}

type StatusTone = "idle" | "progress" | "done" | "warn";

/** 한 강사의 계약 상태를 상태 한 칸(label·tone)과 짧은 설명(detail)으로 줄인다. */
function describeStatus(
  status: StatusEntry,
  { modusignOn, signingTracked }: { modusignOn: boolean; signingTracked: boolean }
): { label: string; tone: StatusTone; detail: string } {
  const signing = signingTracked ? status.signing : undefined;
  if (signing?.phase === "aborted" || signing?.phase === "ambiguous") {
    return { detail: "", label: describeSigning(signing), tone: "warn" };
  }
  const step = contractStep(status);
  const label = CONTRACT_STEPS[step];
  if (step === 4) return { detail: "", label, tone: "done" };
  if (step === 0) return { detail: "", label, tone: "idle" };
  let detail = "";
  if (signing?.phase === "signing" || signing?.phase === "preparing") detail = describeSigning(signing);
  else if (status.sent && !signing && modusignOn && signingTracked) detail = "모두싸인 문서를 못 찾았어요";
  return { detail, label, tone: "progress" };
}

// 확인 창 [구글 설문폼에 자동으로 기입되는 내용] 표 — buildContractPrefillUrl()이 채우는 항목과 맞춰 둔다.
// [hub-om 항목, 구글 설문폼 항목, 덧붙임 설명]
// [hub-om 항목, 구글 설문폼 항목, 기입될 값(values 키)]
type ContractFormValues = Record<"courseId" | "courseName" | "instructorName" | "schedule" | "manager" | "department" | "email", string>;
const CONTRACT_REQUEST_FIELD_GROUPS: { label: string; detail?: string; rows: [string, string, keyof ContractFormValues][] }[] = [
  {
    label: "운영 현황",
    rows: [
      ["코스 ID", "코스 ID", "courseId"],
      ["과정명", "과정명", "courseName"],
      ["강사명", "강사명", "instructorName"],
      ["강의 일정", "일정", "schedule"],
      ["담당 OM", "담당자", "manager"],
      ["담당 OM 파트", "소속 및 부서장", "department"]
    ]
  },
  {
    label: "강사 정보",
    rows: [["이메일", "이메일", "email"]]
  }
];

/** "강사료 참고: 직전 계약 250,000원 (2026.10) · 노션 기본 220,000원". 둘 다 없으면 "". */
function describeFeeHint(hint: ContractFeeHint): string {
  const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
  const parts = [
    hint.lastContract ? `직전 계약 ${won(hint.lastContract.amount)} (${hint.lastContract.month})` : "",
    typeof hint.notionBase === "number" ? `노션 기본 ${won(hint.notionBase)}` : ""
  ].filter(Boolean);
  return parts.length > 0 ? `강사료 참고: ${parts.join(" · ")}` : "";
}

// 계약폼은 자동 기입된 채로 열린다. 계약서인 만큼, 넘어가기 전에 무엇이 채워지는지 알려 주고 최종 확인을 받는다.
// 기업위키 "계산서 발행 요청" 확인 창(InvoiceRequestLink)과 같은 결. 항목마다 실제로 들어갈 값을 같이 보여 준다.
// 이메일: 새로고침(시트) 등으로 이미 알고 있으면(knownEmail) 그대로 쓰고, 없으면 창을 열 때 그 강사 1명만
// 노션 강사 정보에서 읽는다(감사 기록 context=contract_request). 한 번 읽은 결과는 다시 읽지 않는다.
// 읽는 중엔 "불러오는 중…", 못 찾거나 실패하면 "비어 있음 · 폼에서 입력" — 어느 경우든 폼 열기는 막지 않는다.
// 강사료는 과정마다 협의라 폼에 넣지 않고, 같은 요청에서 받은 참고값(직전 계약·노션 기본)만 창에 한 줄로 보여 준다.
function ContractFormOpenButton({ knownEmail, values }: { knownEmail: string; values: Omit<ContractFormValues, "email"> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "done"; email: string; feeHint: ContractFeeHint }>({
    email: "",
    feeHint: {},
    state: "idle"
  });
  const email = knownEmail || lookup.email;
  const emailLoading = !knownEmail && lookup.state === "loading";
  const href = buildContractPrefillUrl({ ...values, email });
  const shown: ContractFormValues = { ...values, email };
  const feeHintText = describeFeeHint(lookup.feeHint);

  async function open() {
    setIsOpen(true);
    if (lookup.state !== "idle") return;
    setLookup({ email: "", feeHint: {}, state: "loading" });
    let found = "";
    let feeHint: ContractFeeHint = {};
    try {
      const response = await fetch("/api/operations/instructor-contract-email", {
        // 이메일을 이미 알면 열람하지 않는다(감사 기록 없음) — 강사료 참고값만 받는다.
        body: JSON.stringify({ instructorName: values.instructorName, skipEmail: Boolean(knownEmail) }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (response.ok && !response.redirected) {
        const payload = (await response.json().catch(() => ({}))) as { email?: unknown; feeHint?: ContractFeeHint };
        if (typeof payload.email === "string") found = payload.email.trim();
        if (payload.feeHint && typeof payload.feeHint === "object") feeHint = payload.feeHint;
      }
    } catch {
      // 실패해도 폼은 열 수 있다(이메일·강사료는 폼에서 입력).
    }
    setLookup({ email: found, feeHint, state: "done" });
  }

  return (
    <>
      <button className="instructor-contract-open" onClick={open} type="button">
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
                    <th scope="col">기입될 값</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACT_REQUEST_FIELD_GROUPS.map((group) =>
                    group.rows.map(([source, target, valueKey], index) => (
                      <tr key={`${group.label}-${source}`}>
                        {index === 0 ? (
                          <th rowSpan={group.rows.length} scope="rowgroup">
                            {group.label}
                            {group.detail ? <span>({group.detail})</span> : null}
                          </th>
                        ) : null}
                        <td>{source}</td>
                        <td>{target}</td>
                        {valueKey === "email" && emailLoading ? (
                          <td className="contract-request-confirm-value">불러오는 중…</td>
                        ) : (
                          <td className={shown[valueKey].trim() ? "contract-request-confirm-value" : "contract-request-confirm-value is-empty"}>
                            {shown[valueKey].trim() || "비어 있음 · 폼에서 입력"}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <p className="contract-request-confirm-note">강사료·계약유형 등 나머지 항목은 폼에서 직접 확인·입력하세요.</p>
              {lookup.state === "loading" ? (
                <p className="contract-request-confirm-note">강사료 참고 불러오는 중…</p>
              ) : feeHintText ? (
                <p className="contract-request-confirm-note">{feeHintText}</p>
              ) : null}
              <p className="contract-request-confirm-note">폼에서 &apos;현재 초안을 계속 사용하시겠습니까?&apos; 창이 뜨면 [계속]을 눌러 주세요.</p>
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
