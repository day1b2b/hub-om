"use client";

// 운영현황 교육상세 "계산서 발행 요청 현황" 구역. 강사 계약 현황 옆에 같은 크기로 놓인다.
// 기업위키 상세와 같은 API(/api/company-wiki/invoice-link)로 이 과정 하나의 폼 링크·요청 현황을 받는다 —
// 구글폼 URL은 서버에만 두고, 사업자등록증 정보도 서버에서 기업위키 값으로 채운다.
// 요청 현황은 서버가 갖고 있는 값(바닥줄 "○○ 기준")을 바로 보여 준다. 폼을 열고 이 탭으로 돌아오면
// 시트를 다시 읽어(13초쯤) 방금 낸 요청을 반영하고, ↻ 버튼으로도 다시 읽을 수 있다.
import { useCallback, useEffect, useRef, useState } from "react";
import { formatSheetDate, InvoiceRequestLink, InvoiceRequestStatusBadge, type InvoiceRequestStatusView } from "@/features/wiki/InvoiceRequest";
import { formatSyncedAt } from "./InstructorContractList";

interface CourseInvoiceRequestSectionProps {
  companyId?: string;
  companyName: string;
  courseId: string;
  courseIdLabel: string;
}

const COURSE_KEY = "course";
// 이보다 오래 갱신을 못 했으면(Apps Script 웹앱 고장 등) 기준 시각을 경고색으로 보인다.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// 폼을 열고 이만큼 지나도록 요청이 안 보이면(제출 안 함) 돌아올 때마다 다시 읽는 걸 멈춘다.
const WATCH_RETURN_MS = 30 * 60 * 1000;

type CourseInvoiceStatuses = {
  available: boolean;
  status: InvoiceRequestStatusView | null;
  /** 서버가 시트를 마지막으로 읽은 시각(ISO). */
  syncedAt: string | null;
  stale: boolean;
};

export function CourseInvoiceRequestSection({ companyId, companyName, courseId, courseIdLabel }: CourseInvoiceRequestSectionProps) {
  const trimmedCourseId = courseId.trim();
  // undefined면 아직 불러오는 중, null이면 링크를 못 만들었음(화면은 둘 다 "-").
  const [href, setHref] = useState<string | null | undefined>(undefined);
  const [statuses, setStatuses] = useState<CourseInvoiceStatuses | null>(null);
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  // 폼을 연 시각과 그때의 요청 건수 — 돌아왔을 때 건수가 늘었으면(요청 반영) 지켜보기를 끝낸다.
  const watchRef = useRef<{ openedAt: number; requestCount: number } | null>(null);
  const statusesRef = useRef<CourseInvoiceStatuses | null>(null);

  const fetchInvoice = useCallback(
    async (fresh: boolean): Promise<{ href: string | null; statuses: CourseInvoiceStatuses }> => {
      try {
        const res = await fetch("/api/company-wiki/invoice-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: companyId || null,
            companyName,
            courses: [{ key: COURSE_KEY, courseId: trimmedCourseId, courseIdLabel: courseIdLabel.trim() }],
            fresh
          })
        });
        const data = res.ok ? await res.json() : null;
        const syncedAt = typeof data?.statusSyncedAt === "string" ? data.statusSyncedAt : null;
        return {
          href: data?.links?.[COURSE_KEY] ?? null,
          statuses: {
            available: data?.statusAvailable === true,
            status: data?.statuses?.[COURSE_KEY] ?? null,
            syncedAt,
            stale: syncedAt ? Date.now() - new Date(syncedAt).getTime() > STALE_AFTER_MS : false
          }
        };
      } catch {
        return { href: null, statuses: { available: false, status: null, syncedAt: null, stale: false } };
      }
    },
    [companyId, companyName, courseIdLabel, trimmedCourseId]
  );

  const applyStatuses = useCallback((next: CourseInvoiceStatuses) => {
    statusesRef.current = next;
    setStatuses(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchInvoice(false).then((result) => {
      if (cancelled) return;
      setHref(result.href);
      applyStatuses(result.statuses);
    });
    return () => { cancelled = true; };
  }, [applyStatuses, fetchInvoice]);

  const refresh = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    const result = await fetchInvoice(true);
    checkingRef.current = false;
    setChecking(false);
    // 다시 읽기에 실패하면 지금 보이는 값을 그대로 둔다.
    if (!result.statuses.available && statusesRef.current?.available) return;
    applyStatuses(result.statuses);
    const watch = watchRef.current;
    if (watch && (result.statuses.status?.requestCount ?? 0) > watch.requestCount) watchRef.current = null;
  }, [applyStatuses, fetchInvoice]);

  // 폼 탭에서 이 탭으로 돌아오면 다시 읽는다(focus·visibilitychange가 같이 와도 한 번만 돈다).
  useEffect(() => {
    function handleReturn() {
      const watch = watchRef.current;
      if (!watch || document.visibilityState !== "visible") return;
      if (Date.now() - watch.openedAt > WATCH_RETURN_MS) {
        watchRef.current = null;
        return;
      }
      void refresh();
    }
    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);
    return () => {
      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);
    };
  }, [refresh]);

  function handleFormOpen() {
    if (!trimmedCourseId) return;
    watchRef.current = { openedAt: Date.now(), requestCount: statusesRef.current?.status?.requestCount ?? 0 };
  }

  const syncedAt = statuses?.syncedAt ?? null;
  const syncedStale = statuses?.stale ?? false;

  return (
    <section className="detail-section course-invoice-section">
      <div className="section-title">
        <h2>계산서 발행 요청 현황</h2>
      </div>
      <dl className="course-invoice-rows">
        <div>
          <dt>코스ID</dt>
          <dd>{trimmedCourseId || "검토필요"}</dd>
        </div>
        <div>
          <dt>계산서 발행 요청</dt>
          <dd>
            <InvoiceRequestLink href={href} onOpen={handleFormOpen} />
            {checking ? (
              <span className="muted-inline">확인 중…</span>
            ) : (
              <InvoiceRequestState hasCourseId={Boolean(trimmedCourseId)} statuses={statuses} />
            )}
          </dd>
        </div>
        <div>
          <dt>발급여부</dt>
          <dd>
            {statuses?.available && statuses.status ? (
              <InvoiceRequestStatusBadge hasCourseId state={statuses} status={statuses.status} />
            ) : (
              <span className="muted-inline">-</span>
            )}
          </dd>
        </div>
        <div>
          <dt>발급일자</dt>
          <dd>{formatSheetDate(statuses?.status?.issuedAt) || <span className="muted-inline">-</span>}</dd>
        </div>
        <div>
          <dt>실제입금일자</dt>
          <dd>{formatSheetDate(statuses?.status?.paidAt) || <span className="muted-inline">-</span>}</dd>
        </div>
      </dl>
      <p className="course-invoice-hint">사업자등록증 정보는 기업위키에 등록된 값으로 자동 기입됩니다.</p>
      {statuses && trimmedCourseId ? (
        <div className="instructor-contract-foot">
          {syncedAt ? (
            <span
              className={`instructor-contract-synced${syncedStale ? " course-invoice-synced--stale" : ""}`}
              title={syncedStale ? "하루 넘게 계산서 발급 신청 시트를 다시 읽지 못했습니다." : undefined}
            >
              {formatSyncedAt(syncedAt)} 기준
            </span>
          ) : null}
          <button
            className="instructor-contract-status-load"
            disabled={checking}
            onClick={() => void refresh()}
            title="계산서 발급 신청 시트를 다시 읽어요(10초 남짓 걸려요)"
            type="button"
          >
            {checking ? "확인 중…" : "↻ 새로고침"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

// 응답 시트에 이 코스ID 행이 있으면 "요청완료" + 요청일(최근 요청 타임스탬프의 날짜), 없으면 "미요청".
// 시트를 못 읽었으면 "미요청"으로 오해하지 않게 "확인 불가", 코스ID가 없으면 맞춰 볼 수 없어 아무것도 안 붙인다.
function InvoiceRequestState({
  hasCourseId,
  statuses
}: {
  hasCourseId: boolean;
  statuses: { available: boolean; status: InvoiceRequestStatusView | null } | null;
}) {
  if (!statuses) return <span className="muted-inline">불러오는 중…</span>;
  if (!hasCourseId) return null;
  if (!statuses.available) return <span className="muted-inline" title="계산서 발급 신청 시트를 읽지 못했습니다.">확인 불가</span>;
  if (!statuses.status) return <span className="invoice-status invoice-status--pending">미요청</span>;

  const { lastRequestedAt, requestCount } = statuses.status;
  return (
    <>
      <span className="invoice-status invoice-status--done">요청완료{requestCount > 1 ? ` (${requestCount}건)` : ""}</span>
      {lastRequestedAt ? <span className="course-invoice-last" title={lastRequestedAt}>요청일 {formatSheetDate(lastRequestedAt)}</span> : null}
    </>
  );
}

