"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { holidayName } from "./holidays";
import { missingArchiveItems } from "@/lib/data/operationCalculations";
import { createRequestMatcher } from "./requestDedup";
import { requestHref } from "./requestHref";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";
import type { OperationSession, OperationStatus } from "@/lib/data/operationTypes";
import { getSeoulToday } from "@/lib/seoulDate";

interface MyDashboardProps {
  // 로그인 계정이 명단(team-users.json)에 없으면 null.
  omName: null | string;
  // 이미 내 담당으로 필터된 운영 목록.
  operations: OperationSession[];
  // 나에게 배정된 OM 운영 요청.
  assignedRequests: OmRequest[];
}

export function MyDashboard({ assignedRequests, omName, operations }: MyDashboardProps) {
  const today = useMemo(() => getSeoulToday(), []);
  const [monthView, setMonthView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  const [openStage, setOpenStage] = useState<null | string>(null);
  // 담당 과정 표 접기/펼치기. 과정이 많으면 화면이 길어져 아래 패널이 멀어진다.
  const [coursesOpen, setCoursesOpen] = useState(true);

  if (!omName) {
    return (
      <main className="dashboard-shell">
        <AppSidebar label="My" teamScope="both" />
        <section className="content dashboard-page">
          <header className="page-header">
            <div>
              <p className="eyebrow">내 대시보드</p>
              <h1>내 대시보드</h1>
              <p className="lede">로그인한 계정이 OM 명단에 등록되어 있지 않습니다.</p>
            </div>
          </header>
          <section className="dashboard-panel">
            <div className="empty-state">
              <strong>명단에 등록된 계정이 아닙니다.</strong>
              <span>관리자에게 OM 명단 등록을 요청하세요. (관리자 전용 → 사용자 관리)</span>
            </div>
          </section>
        </section>
      </main>
    );
  }

  // 요약·분석은 선택한 달 기준(맨 위 화살표로 전월/차월 이동).
  function moveMonth(delta: number) {
    setMonthView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }
  const scopedOperations = operations.filter((operation) => {
    const start = parseDate(operation.startDate);
    return start ? start.getFullYear() === monthView.year && start.getMonth() === monthView.month : false;
  });
  // 나의 담당 과정도 선택한 달에 진행되는 것만(세션 기간이 그 달과 겹치는 요청).
  const monthStartTime = stripTime(new Date(monthView.year, monthView.month, 1)).getTime();
  const monthEndTime = stripTime(new Date(monthView.year, monthView.month + 1, 0)).getTime();
  const monthAssignedRequests = assignedRequests.filter((request) => {
    const range = scheduleRange(request);
    const start = parseDate(range.start);
    const end = parseDate(range.end) ?? start;
    if (!start || !end) return false;
    return stripTime(start).getTime() <= monthEndTime && stripTime(end).getTime() >= monthStartTime;
  });
  // 담당 과정 표는 전체를 시작일 순으로 다 보여주고, 선택한 달에 진행되는 건만 강조한다.
  const sortedAssignedRequests = [...assignedRequests].sort((a, b) =>
    scheduleRange(a).start.localeCompare(scheduleRange(b).start)
  );
  const focusRequestIds = new Set(monthAssignedRequests.map((request) => request.id));
  const active = scopedOperations.filter((operation) => operation.operationStatus === "진행중").length;
  const upcoming = scopedOperations.filter((operation) => isUpcoming(operation, today)).length;
  const done = scopedOperations.filter(isDone).length;

  // 밀린 작업 집계는 각 단계의 항목에서 직접 센다(아래 stages 참고).
  // 기간 필터는 걸지 않는다 — 지난달 미완 항목이 숨으면 안 된다.

  // 담당 과정(요청)과 운영은 같은 과정을 양쪽에서 들고 있다. 요청 쪽 표현(차수/세팅 정보)이
  // 더 풍부하므로 요청이 대표하고, 짝이 되는 운영은 제거한다(캘린더·사전세팅에 두 번 뜨지 않게).
  // 짝짓기는 operationId 우선 → courseId. 코스ID를 안 적고 접수한 과정도 자동 생성된 운영의
  // operationId를 갖고 있어서, 코스ID 없이도 대시보드에 정상으로 뜬다. 자세한 규칙은 requestDedup.ts.
  const isRepresentedByRequest = createRequestMatcher(assignedRequests);
  // 캘린더는 운영 + 나의 담당 과정을 모두 반영한다(담당 과정에 새 과정이 추가되면 캘린더에도 자동 표시).
  const calendarEvents: CalendarEvent[] = [
    ...operations.flatMap((operation) => {
      if (isRepresentedByRequest(operation)) return []; // 담당 과정의 차수 이벤트로 대체
      const start = parseDate(operation.startDate);
      const end = parseDate(operation.endDate) ?? start;
      if (!start || !end) return [];
      const onsite = operation.onsiteRequired === "Y";
      return [{
        id: `op-${operation.operationId}`,
        // 현장운영지원은 이름에 붙여 캘린더에서 바로 알아보게 한다.
        label: onsite ? `${operation.companyName}_현장운영지원` : operation.companyName,
        company: operation.companyName,
        course: operation.courseName,
        start: stripTime(start),
        end: stripTime(end),
        href: `/operations/${operation.operationId}`,
        onsite
      }];
    }),
    ...assignedRequests.flatMap((request) => {
      // 교육 일정 차수(세션)를 각 날짜에 개별 표시한다. 세션에 dateEnd가 있으면 그 기간만큼 막대로.
      const multiSession = request.sessions.length > 1;
      const onsite = request.onSiteOperation === "Y";
      // 기업명 뒤에 바로 붙여, 막대가 좁아 잘려도 앞부분이 먼저 보이게 한다.
      const baseLabel = onsite ? `${request.company}_현장운영지원` : request.company;
      return request.sessions.flatMap((session, index) => {
        const start = parseDate(session.date);
        const end = parseDate(session.dateEnd ?? session.date) ?? start;
        if (!start || !end) return [];
        return [{
          id: `req-${request.id}-${index}`,
          label: multiSession ? `${baseLabel} ${index + 1}차` : baseLabel,
          company: request.company,
          course: request.courseName,
          start: stripTime(start),
          end: stripTime(end),
          href: `/om-request/manage/${request.id}`,
          onsite
        }];
      });
    })
  ];

  // 파이프라인: 각 단계에 속한 기업·과정과 해야 할 업무(클릭 시 펼침)를 담는다.
  const phaseOperations = (phase: PipelinePhase) => operations.filter((operation) => operationPhase(operation.operationStatus) === phase);
  const daysToStart = (dateText: string): number | null => {
    const date = parseDate(dateText);
    return date ? daysBetween(today, date) : null;
  };
  // 클릭 시 운영 현황 상세로 보내기 위한 courseId → 운영 id 매핑.
  // 빈 코스ID는 키로 넣지 않는다. ""가 키가 되면 코스ID 없는 운영끼리 서로 덮어써
  // 무관한 운영으로 연결된다.
  const operationIdByCourse = new Map(
    operations
      .filter((operation) => (operation.courseId ?? "").trim() !== "")
      .map((operation) => [(operation.courseId ?? "").trim(), operation.operationId])
  );
  // 사전세팅 = 강의 시작 전 단계 전체(아직 시작하지 않은 과정). 이전에는 D-7~D-2 창만 봤는데,
  // 그러면 그 창에 든 과정이 없을 때 단계가 비어 보여 실제 준비 상황과 어긋났다.
  // 임박한 순으로 정렬해 위쪽이 먼저 챙길 것이 되게 한다.
  const preRequests = assignedRequests
    .map((request) => ({ request, days: daysToStart(scheduleRange(request).start) }))
    .filter((entry): entry is { request: OmRequest; days: number } => entry.days !== null && entry.days >= 0);
  const preOperations = operations
    // 담당 과정(요청) 항목이 대표 → 짝이 되는 운영은 중복 제거.
    .filter((operation) => !isRepresentedByRequest(operation))
    .map((operation) => ({ operation, days: daysToStart(operation.startDate) }))
    .filter((entry): entry is { operation: OperationSession; days: number } => entry.days !== null && entry.days >= 0);

  const preItems: StageItem[] = [
    ...preRequests.map(({ request, days }) => {
      return {
        id: `r-${request.id}`,
        company: request.company,
        course: request.courseName,
        task: `D-${days} · ${requiredSetupText(request)}`,
        days,
        href: requestHref(request, operationIdByCourse)
      };
    }),
    ...preOperations.map(({ operation, days }) => ({
      id: `o-${operation.operationId}`,
      company: operation.companyName,
      course: operation.courseName,
      task: `D-${days} · 운영 세팅 준비`,
      days,
      href: `/operations/${operation.operationId}`
    }))
  ].sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  // 사전세팅 요약 칩. 예전에는 tasks가 빈 배열이라 과정이 있어도 "챙길 항목 없음"으로만 보였다.
  // 항목마다 이미 세팅 종류를 갖고 있으니 그걸 종류별로 세어 접힌 상태에서도 보이게 한다.
  const countSetup = (predicate: (request: OmRequest) => boolean) =>
    preRequests.filter(({ request }) => predicate(request)).length;
  const hasNamedSetup = (request: OmRequest) =>
    request.skillfloSetup === "Y" ||
    request.skillmatchSetup === "Y" ||
    request.onSiteOperation === "Y" ||
    request.coachRequest === "Y";
  const preSetupTasks = [
    { name: "스킬플로", value: countSetup((request) => request.skillfloSetup === "Y") },
    { name: "스킬매치", value: countSetup((request) => request.skillmatchSetup === "Y") },
    { name: "현장운영", value: countSetup((request) => request.onSiteOperation === "Y") },
    { name: "코치", value: countSetup((request) => request.coachRequest === "Y") },
    // 세팅 종류가 하나도 Y가 아닌 요청. 그래도 기본 준비는 해야 하므로 세어 준다.
    // 이걸 빼면 그런 과정만 있을 때 "1건 · 챙길 항목 없음"이 된다.
    { name: "기본 준비", value: countSetup((request) => !hasNamedSetup(request)) },
    // 요청 없이 운영만 있는 건은 세팅 종류를 알 수 없어 따로 센다.
    { name: "세팅 확인", value: preOperations.length }
  ];
  const fieldItems: StageItem[] = phaseOperations("현장 운영").map((operation) => ({
    id: `o-${operation.operationId}`,
    company: operation.companyName,
    course: operation.courseName,
    task: operation.operationIssue.trim() ? `이슈: ${operation.operationIssue}` : "현장 운영 진행 중",
    href: `/operations/${operation.operationId}`
  }));
  // 결과 단계 = 진행상태가 완료·회고완료·아카이빙필요인 운영 + 아카이빙이 남은 운영.
  // 아카이빙필요는 진행상태와 별개 칼럼(archiveStatus)이라, 진행상태가 아직 배정예정인데
  // 아카이빙만 필요한 건이 생긴다. 그런 건이 결과 항목에 없으면 "아카이빙필요 12건"인데
  // 펼치면 "해당 단계의 과정이 없습니다"가 뜬다. 마감 업무가 남은 건이니 결과에 포함한다.
  const resultOperations = (() => {
    const picked = new Map<string, OperationSession>();
    for (const operation of phaseOperations("결과")) picked.set(operation.operationId, operation);
    for (const operation of operations) {
      if (needsArchiveWork(operation)) picked.set(operation.operationId, operation);
    }
    return [...picked.values()];
  })();
  const resultItems: StageItem[] = resultOperations.map((operation) => ({
    id: `o-${operation.operationId}`,
    company: operation.companyName,
    course: operation.courseName,
    task: resultTaskText(operation),
    href: `/operations/${operation.operationId}`
  }));

  // 칩은 그 단계에 실제로 담긴 운영에서만 센다. 전체에서 세면 항목 수와 어긋나
  // "N건인데 해당 단계의 과정이 없음" 같은 표시가 나온다.
  const fieldOperations = phaseOperations("현장 운영");
  const stages = [
    { label: "사전세팅", items: preItems, tasks: preSetupTasks },
    {
      label: "현장 운영",
      items: fieldItems,
      tasks: [
        { name: "운영이슈", value: fieldOperations.filter((operation) => operation.operationIssue.trim() !== "").length }
      ]
    },
    {
      label: "결과",
      items: resultItems,
      tasks: [
        {
          name: "회고 대기",
          value: resultOperations.filter((operation) => operation.operationStatus === "완료").length
        },
        { name: "아카이빙필요", value: resultOperations.filter(needsArchiveWork).length },
        {
          name: "만족도 미확인",
          value: resultOperations.filter((operation) => isDone(operation) && operation.avgSatisfaction.trim() === "").length
        },
        {
          name: "결과보고서 미확인",
          value: resultOperations.filter((operation) => isDone(operation) && operation.hasResultReport === "확인필요").length
        }
      ]
    }
  ];
  // 다음 과정 D-day: 운영 + 담당 과정을 모두 고려해 가장 임박한 것을 찾는다.
  const nextEvent = findNextEvent(calendarEvents, today);
  const nextEventDday = nextEvent ? daysBetween(today, nextEvent.start) : null;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="My" teamScope="both" />

      <section className="content dashboard-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">{formatToday(today)} 기준</p>
            <h1>내 대시보드</h1>
            <p className="lede">{omName}님이 담당한 운영 현황과 지금 챙겨야 할 일을 모아 봅니다.</p>
          </div>
        </header>

        <section className="metrics" aria-label="내 운영 요약">
          <Metric label="전체" value={scopedOperations.length} />
          <Metric label="진행중" value={active} />
          <Metric label="예정" value={upcoming} />
          <Metric label="완료" value={done} />
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>
              <button
                aria-expanded={coursesOpen}
                className="panel-toggle"
                onClick={() => setCoursesOpen((open) => !open)}
                type="button"
              >
                나의 담당 과정
                {/* ▲(U+25B2)와 ▼(U+25BC)는 같은 계열이라 크기가 맞는다.
                    ▾(U+25BE)는 "작은 삼각형"이라 아래쪽만 작아 보인다. */}
                <span aria-hidden="true" className="panel-toggle-caret">{coursesOpen ? "▲" : "▼"}</span>
              </button>
            </h2>
            <div className="dashboard-table-meta">
              <span>전체 {sortedAssignedRequests.length}건 · {monthView.month + 1}월 {focusRequestIds.size}건</span>
              {/* 월 이동은 표의 강조 대상을 바꾸는 것이라 접혀 있을 때는 숨긴다. */}
              {coursesOpen ? (
                <div className="me-cal-nav" aria-label="월 이동">
                  <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
                  <strong>{monthView.year}년 {monthView.month + 1}월</strong>
                  <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
                </div>
              ) : null}
            </div>
          </div>
          {coursesOpen ? (
          <div className="table-wrap">
            {/* 컬럼 순서·라벨은 운영현황(OperationDashboard) 표를 따른다. 다만 표가 너무 길어져
                교육형태·싱크업·코스ID는 뺐다. OM은 내 대시보드라 항상 본인이어서 뺐고,
                실습코치·만족도·매출은 운영 집계값이라 요청에 없어 제외한다. */}
            <table className="me-course-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>기업</th>
                  <th>과정명</th>
                  <th>총 회차</th>
                  <th>LD</th>
                  <th>시작일</th>
                  <th>종료일</th>
                  <th>강사</th>
                </tr>
              </thead>
              <tbody>
                {sortedAssignedRequests.length > 0 ? (
                  sortedAssignedRequests.map((request, index) => {
                    const schedule = scheduleRange(request);
                    return (
                      <tr className={focusRequestIds.has(request.id) ? "me-focus-row" : ""} key={request.id}>
                        <td>{index + 1}</td>
                        <td><strong>{request.company}</strong></td>
                        <td>
                          <Link className="course-link" href={requestHref(request, operationIdByCourse)}>
                            <strong>{request.courseName}</strong>
                          </Link>
                        </td>
                        <td>{request.totalSessions}</td>
                        <td>{request.ld || "미정"}</td>
                        <td>{schedule.start}</td>
                        <td>{schedule.end}</td>
                        <td>{request.instructorName || "-"}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={8}>
                      <strong>배정된 담당 과정이 없습니다.</strong>
                      <span>업무 요청 후 담당으로 배정되면 여기에 표시됩니다.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          ) : null}
        </section>

        <section className="dashboard-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <section className="dashboard-panel">
            <div className="section-title">
              <h2>내 운영 파이프라인</h2>
              <span>단계 클릭 시 기업·업무</span>
            </div>
            <div className="stage-list">
              {stages.map((stage) => {
                const openTasks = stage.tasks.filter((task) => task.value > 0);
                const isOpen = openStage === stage.label;
                return (
                  <div className="stage-group" key={stage.label}>
                    <button
                      aria-expanded={isOpen}
                      className="stage-row"
                      onClick={() => setOpenStage(isOpen ? null : stage.label)}
                      type="button"
                    >
                      <div className="stage-head">
                        <strong>{stage.label}</strong>
                        <span className="stage-count">{stage.items.length}건</span>
                        <span className="stage-toggle">{isOpen ? "▲" : "▼"}</span>
                      </div>
                      <div className="stage-tasks">
                        {openTasks.length > 0 ? (
                          openTasks.map((task) => (
                            <span className="stage-task" key={task.name}>{task.name} {task.value}</span>
                          ))
                        ) : (
                          <span className="stage-task-none">챙길 항목 없음</span>
                        )}
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="stage-items">
                        {stage.items.length > 0 ? (
                          stage.items.map((item) => (
                            <a className="stage-item" href={item.href} key={item.id}>
                              <span className="stage-item-course">
                                <strong>{item.company}</strong>
                                <span>{item.course}</span>
                              </span>
                              <span className="stage-item-task">{item.task}</span>
                            </a>
                          ))
                        ) : (
                          <div className="stage-item-empty">해당 단계의 과정이 없습니다.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>다음 과정 D-day</h2>
              <span>가장 임박한 예정 과정</span>
            </div>
            {nextEvent ? (
              <div className="dday-card">
                <strong className="dday-badge">{nextEventDday === 0 ? "D-DAY" : `D-${nextEventDday}`}</strong>
                <Link className="course-link" href={nextEvent.href}>
                  <strong>{nextEvent.label}</strong>
                  <span>{nextEvent.course}</span>
                </Link>
                <span className="dday-date">{formatDateText(nextEvent.start)} 시작</span>
              </div>
            ) : (
              <PanelEmpty label="예정된 과정이 없습니다" />
            )}
          </section>
        </section>

        <MonthlyCalendar events={calendarEvents} today={today} />
      </section>
    </main>
  );
}

type PipelinePhase = "사전세팅" | "현장 운영" | "결과";

// 진행중 = 현장 운영, 완료·회고완료·아카이빙필요 = 결과.
// 그 외(배정필요·배정예정 등 현장에 나가기 전 단계)는 모두 사전세팅으로 묶는다.
function operationPhase(status: OperationStatus): PipelinePhase {
  if (status === "진행중") return "현장 운영";
  if (status === "완료" || status === "회고완료" || status === "아카이빙필요") return "결과";
  return "사전세팅";
}

interface StageItem {
  id: string;
  company: string;
  course: string;
  task: string;
  href: string;
  /** 시작까지 남은 일수. 사전세팅 정렬용이라 그 단계에만 있다. */
  days?: number;
}

// 사전세팅 단계에서 배정 요청이 준비해야 할 업무(Y로 표시된 세팅). 없으면 기본 준비 문구.
function requiredSetupText(request: OmRequest): string {
  const setups: string[] = [];
  if (request.skillfloSetup === "Y") setups.push("스킬플로");
  if (request.skillmatchSetup === "Y") setups.push("스킬매치");
  if (request.onSiteOperation === "Y") setups.push("현장운영");
  if (request.coachRequest === "Y") setups.push("코치");
  return setups.length > 0 ? `세팅: ${setups.join("·")}` : "사전 세팅 준비";
}

/** 아카이빙이 남았는지. 진행상태와 archiveStatus 두 곳에 나타날 수 있다. */
function needsArchiveWork(operation: OperationSession): boolean {
  return operation.archiveStatus === "아카이빙필요" || operation.operationStatus === "아카이빙필요";
}

// 결과 단계에서 남은 마감 업무.
function resultTaskText(operation: OperationSession): string {
  const tasks: string[] = [];
  if (operation.operationStatus === "완료") tasks.push("회고");
  if (needsArchiveWork(operation)) {
    // "아카이빙"이라고만 쓰면 무엇을 채워야 하는지 몰라 운영 상세를 열어봐야 한다.
    // 판정과 같은 기준(isArchiveComplete)에서 빠진 항목 이름을 뽑아 붙인다.
    const missing = missingArchiveItems({
      courseId: operation.courseId,
      lectureManagementNote: operation.lectureManagementNote,
      avgSatisfaction: operation.avgSatisfaction,
      hasSatisfactionSurvey: operation.hasSatisfactionSurvey,
      hasResultReport: operation.hasResultReport,
      resultReportLink: operation.resultReportLink
    });
    tasks.push(missing.length > 0 ? `아카이빙(${missing.join("·")})` : "아카이빙");
  }
  if (isDone(operation) && operation.avgSatisfaction.trim() === "") tasks.push("만족도");
  if (isDone(operation) && operation.hasResultReport === "확인필요") tasks.push("결과보고서");
  return tasks.length > 0 ? `할 일: ${tasks.join("·")}` : "마감 완료";
}

function PanelEmpty({ label = "표시할 데이터가 없습니다" }: { label?: string }) {
  return (
    <div className="empty-state">
      <strong>{label}</strong>
    </div>
  );
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface CalendarEvent {
  id: string;
  label: string;
  company: string;
  course: string;
  start: Date;
  end: Date;
  href: string;
  /** 현장운영지원 과정. label에 "_현장운영지원"이 붙고, 막대에 테두리도 준다. */
  onsite: boolean;
}

// 기업별로 캘린더 막대 색을 다르게. 같은 기업은 항상 같은 색(이름 해시 기반).
const CALENDAR_COLORS = ["#75976b", "#2d66a6", "#8f5b55", "#655c7c", "#6f5b2b", "#3f8a8f", "#a2734a", "#7a7d34", "#8a5a86", "#5b7fb0"];

function colorForCompany(company: string): string {
  let sum = 0;
  for (let index = 0; index < company.length; index += 1) sum += company.charCodeAt(index);
  return CALENDAR_COLORS[sum % CALENDAR_COLORS.length];
}

// 내 과정이 언제 진행되는지 월별 달력으로 보여준다. 운영과 담당 과정을 모두 반영한다.
// 여러 날에 걸치는 과정은 시작일~종료일까지 칸을 가로지르는 하나의 막대(bar)로 쭉 이어서 표시한다.
function MonthlyCalendar({ events, today }: { events: CalendarEvent[]; today: Date }) {
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

  const monthStart = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;
  const todayKey = dateKey(stripTime(today));

  const cells = Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingBlanks + 1;
    const date = new Date(view.year, view.month, dayNumber);
    return { date, dayNumber, inMonth: dayNumber >= 1 && dayNumber <= daysInMonth };
  });
  const weeks = Array.from({ length: totalCells / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  function moveMonth(delta: number) {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <section className="dashboard-panel">
      <div className="section-title">
        <h2>내 과정 일정</h2>
        <div className="me-cal-nav">
          <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
          <strong>{view.year}년 {view.month + 1}월</strong>
          <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
        </div>
      </div>
      <div className="me-calendar">
        <div className="me-cal-weekdays">
          <div className="me-cal-weeklabel-col" aria-hidden="true" />
          <div className="me-cal-weekday-grid">
            {WEEKDAYS.map((label, index) => (
              <div
                className={["me-cal-weekday", index === 0 ? "is-sun" : "", index === 6 ? "is-sat" : ""].filter(Boolean).join(" ")}
                key={label}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
        {weeks.map((week, weekIndex) => {
          const { bars, laneCount } = buildWeekBars(week, events);
          // 주차 라벨 = 대한민국(ISO 8601) 표준: 그 주의 목요일이 속한 달·주차. (6째주 없음)
          const labelThursday = week[4].date;
          const labelMonth = labelThursday.getMonth() + 1;
          const labelWeek = Math.ceil(labelThursday.getDate() / 7);
          return (
            <div className="me-cal-week" key={weekIndex} style={{ height: Math.max(116, 34 + laneCount * 23) }}>
              <div className="me-cal-weeklabel-col">
                <span>{labelMonth}월</span>
                <span>{labelWeek}째주</span>
              </div>
              <div className="me-cal-week-body">
              <div className="me-cal-week-cells">
                {week.map((cell, cellIndex) => {
                  const dow = cell.date.getDay();
                  const holiday = cell.inMonth ? holidayName(cell.date) : null;
                  const isSun = dow === 0 || Boolean(holiday);
                  const isSat = dow === 6 && !isSun;
                  return (
                    <div
                      className={[
                        "me-cal-day",
                        cell.inMonth ? "" : "is-other-month",
                        cell.inMonth && dateKey(cell.date) === todayKey ? "is-today" : ""
                      ].filter(Boolean).join(" ")}
                      key={cellIndex}
                    >
                      {cell.inMonth ? (
                        <span className="me-cal-daytop">
                          <span
                            className={["me-cal-daynum", isSun ? "is-sun" : "", isSat ? "is-sat" : ""].filter(Boolean).join(" ")}
                          >
                            {cell.dayNumber}
                          </span>
                          {holiday ? <span className="me-cal-holiday" title={holiday}>{holiday}</span> : null}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="me-cal-week-bars">
                {bars.map((bar) => (
                  <a
                    className={[
                      "me-cal-bar",
                      bar.isStart ? "is-start" : "",
                      bar.isEnd ? "is-end" : "",
                      bar.event.onsite ? "is-onsite" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    href={bar.event.href}
                    key={bar.event.id}
                    style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 1, background: colorForCompany(bar.event.company) }}
                    title={`${bar.event.label} · ${bar.event.course}`}
                  >
                    {/* 현장운영지원 표기는 label에 들어있다. 막대가 좁아 글자가 잘릴 때를 위해
                        is-onsite 클래스로 테두리도 함께 준다. */}
                    {bar.event.label}
                  </a>
                ))}
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// 한 주에서 각 과정이 차지하는 열(시작~끝)과 겹침 방지 레인을 계산한다.
function buildWeekBars(
  week: Array<{ date: Date; dayNumber: number; inMonth: boolean }>,
  events: CalendarEvent[]
) {
  // 보이는 달(inMonth) 셀 범위로만 클리핑 → 앞뒤 달 날짜 칸에는 일정을 표시하지 않는다.
  const monthCells = week.filter((cell) => cell.inMonth);
  if (monthCells.length === 0) return { bars: [], laneCount: 1 };
  const rangeStart = stripTime(monthCells[0].date).getTime();
  const rangeEnd = stripTime(monthCells[monthCells.length - 1].date).getTime();

  const segments = events
    .filter((event) => event.start.getTime() <= rangeEnd && event.end.getTime() >= rangeStart)
    .map((event) => {
      const segStart = Math.max(event.start.getTime(), rangeStart);
      const segEnd = Math.min(event.end.getTime(), rangeEnd);
      return {
        event,
        startCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segStart),
        endCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segEnd),
        isStart: event.start.getTime() >= rangeStart,
        isEnd: event.end.getTime() <= rangeEnd
      };
    })
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));

  const laneEnds: number[] = [];
  const bars = segments.map((segment) => {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= segment.startCol) lane += 1;
    laneEnds[lane] = segment.endCol;
    return { ...segment, lane };
  });

  return { bars, laneCount: Math.max(1, laneEnds.length) };
}

// 배정 요청 세션들에서 처음 시작일과 마지막 종료일을 뽑는다. (날짜가 YYYY-MM-DD라 사전순=시간순)
function scheduleRange(request: OmRequest): { start: string; end: string } {
  const dates = request.sessions.map((session) => session.date).filter(Boolean).sort();
  if (dates.length === 0) return { start: "-", end: "-" };

  return { start: dates[0], end: dates[dates.length - 1] };
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isUpcoming(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getTime() > stripTime(today).getTime() : false;
}

function isDone(operation: OperationSession) {
  return operation.operationStatus === "완료" || operation.operationStatus === "회고완료";
}

function parseDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function stripTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

// 오늘 이후 시작하는 과정(운영 + 담당 과정) 중 가장 임박한 것을 찾는다.
function findNextEvent(events: CalendarEvent[], today: Date): CalendarEvent | null {
  const todayTime = stripTime(today).getTime();
  let best: CalendarEvent | null = null;

  for (const event of events) {
    const time = event.start.getTime();
    if (time >= todayTime && (!best || time < best.start.getTime())) {
      best = event;
    }
  }

  return best;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((stripTime(to).getTime() - stripTime(from).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateText(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatToday(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}
