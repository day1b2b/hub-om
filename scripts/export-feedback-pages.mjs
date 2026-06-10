import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const localDir = path.resolve(process.cwd(), ".local");
const outputDir = path.resolve(localDir, "feedback");
const dataPath = resolveLocalPath(process.env.OPERATION_DATA_FILE ?? "operations.json");
const rosterPath = resolveLocalPath("team-members.json");

const raw = await readFile(dataPath, "utf8");
const parsed = JSON.parse(raw);
const operations = Array.isArray(parsed) ? parsed : parsed.operations ?? [];
const roster = await readRoster();
const now = new Date();

await mkdir(outputDir, { recursive: true });

await Promise.all([
  writeFeedbackFile("dashboard.html", renderDashboardPage(operations)),
  writeFeedbackFile("operations.html", renderOperationsPage(operations)),
  writeFeedbackFile("resources.html", renderResourcesPage(operations, roster)),
  writeFeedbackFile("course-detail.html", renderDetailPage(operations[0]))
]);

console.log(`Exported feedback pages to ${outputDir}`);

function resolveLocalPath(fileName) {
  const localFileName = path.normalize(fileName.replace(/^\.local[\/\\]/, ""));
  const absolutePath = path.resolve(localDir, localFileName);

  if (!absolutePath.startsWith(`${localDir}${path.sep}`)) {
    throw new Error("Local feedback source files must resolve inside .local.");
  }

  return absolutePath;
}

async function readRoster() {
  try {
    const rawRoster = await readFile(rosterPath, "utf8");
    return JSON.parse(rawRoster).members ?? [];
  } catch {
    return [];
  }
}

async function writeFeedbackFile(fileName, body) {
  await writeFile(
    path.join(outputDir, fileName),
    `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>hub-om feedback - ${fileName}</title>
  <style>${styles()}</style>
</head>
<body>${body}</body>
</html>`
  );
}

function renderShell(active, title, body) {
  return `<main class="shell">
    <aside class="side">
      <div class="brand"><span>OD</span><strong>hub-om</strong></div>
      <nav>
        ${navItem("대시보드", active === "dashboard")}
        ${navItem("운영 현황", active === "operations")}
        ${navItem("리소스", active === "resources")}
      </nav>
    </aside>
    <section class="content">
      <header class="page-head"><h1>${escapeHtml(title)}</h1><span>${formatDate(now)} 기준</span></header>
      ${body}
    </section>
  </main>`;
}

function navItem(label, active) {
  return `<span class="${active ? "active" : ""}">${escapeHtml(label)}</span>`;
}

function renderDashboardPage(allOperations) {
  const scoped = allOperations.filter((operation) => isSameMonth(operation.startDate, now));
  const upcoming = scoped.filter((operation) => !isEnded(operation)).slice(0, 10);
  const metrics = [
    ["진행중", scoped.filter((operation) => operation.operationStatus === "진행중").length],
    ["예정", scoped.filter((operation) => isUpcoming(operation.startDate)).length],
    ["완료", scoped.filter((operation) => isDone(operation)).length],
    ["총 매출", moneyShort(sum(scoped.map((operation) => operation.revenue)))],
    ["참여 기업", new Set(scoped.map((operation) => operation.companyName)).size],
    ["전체 과정", scoped.length]
  ];

  const body = `${renderMetrics(metrics)}
    <section class="panel-grid">
      ${renderCountPanel("기업별 과정 수", topCounts(scoped.map((operation) => operation.companyName), 5))}
      ${renderCountPanel("OM별 현황", topCounts(scoped.flatMap((operation) => splitPeople(operation.om)), 5))}
      ${renderCountPanel("운영 유형", topCounts(scoped.map((operation) => operation.operationType), 5))}
      ${renderCountPanel("교육형태 분포", topCounts(scoped.map((operation) => operation.educationFormat), 5))}
    </section>
    <section class="panel">
      <div class="section-title"><h2>예정 / 진행 운영</h2><span>${upcoming.length}건</span></div>
      ${renderCompactTable(upcoming)}
    </section>
    <section class="panel">
      <div class="section-title"><h2>월별 과정 현황</h2><span>연간 추이</span></div>
      ${renderMonthlyTrend(allOperations)}
    </section>`;

  return renderShell("dashboard", "메인 대시보드", body);
}

function renderOperationsPage(allOperations) {
  const rows = allOperations.slice(0, 80);
  const metrics = [
    ["진행중", allOperations.filter((operation) => operation.operationStatus === "진행중").length],
    ["예정", allOperations.filter((operation) => isUpcoming(operation.startDate)).length],
    ["완료", allOperations.filter((operation) => isDone(operation)).length],
    ["전체 과정", allOperations.length],
    ["평균 만족도", average(allOperations.map((operation) => Number(operation.avgSatisfaction)).filter(Number.isFinite)) ?? "-"],
    ["총 매출", moneyShort(sum(allOperations.map((operation) => operation.revenue)))]
  ];

  const body = `<section class="filterbar">
      <span>전체 기업</span><span>전체 교육형태</span><span>전체 OM</span><span class="search">과정명, 기업명, 강사, 코스ID</span>
      <span>아카이빙 미완료</span><strong>총 ${allOperations.length}건</strong>
    </section>
    ${renderMetrics(metrics)}
    <section class="panel">
      <div class="section-title"><h2>운영 목록</h2><span>운영 차수 기준</span></div>
      <div class="wide-table">
        <table>
          <thead>
            <tr>${[
              "#",
              "상태",
              "교육형태",
              "운영유형",
              "코스ID",
              "기업",
              "과정명",
              "싱크업",
              "OM",
              "LD",
              "시작일",
              "종료일",
              "강사",
              "실습코치",
              "만족도(전체)",
              "만족도(강사)",
              "매출",
              "강사비",
              "실습코치비"
            ].map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows.map((operation, index) => `<tr>
              <td>${index + 1}</td>
              <td>${badge(operation.operationStatus)}</td>
              <td>${escapeHtml(operation.educationFormat)}</td>
              <td>${escapeHtml(operation.operationType)}</td>
              <td>${escapeHtml(operation.courseId || "검토필요")}</td>
              <td><strong>${escapeHtml(operation.companyName)}</strong></td>
              <td class="truncate">${escapeHtml(operation.courseName)}</td>
              <td>${operation.operationDetail ? "↗" : "-"}</td>
              <td>${escapeHtml(operation.om || "배정필요")}</td>
              <td>${escapeHtml(operation.ld || "미정")}</td>
              <td>${escapeHtml(operation.startDate)}</td>
              <td>${escapeHtml(operation.endDate)}</td>
              <td>${escapeHtml(operation.instructors || "-")}</td>
              <td>${escapeHtml(operation.coach || "-")}</td>
              <td>${escapeHtml(operation.avgSatisfaction || "-")}</td>
              <td>${escapeHtml(operation.instructorSatisfaction || "-")}</td>
              <td>${money(operation.revenue)}</td>
              <td>${money(operation.instructorCost)}</td>
              <td>${money(operation.operationCost)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;

  return renderShell("operations", "운영 현황", body);
}

function renderResourcesPage(allOperations, members) {
  const monthOperations = allOperations.filter((operation) => overlapsMonth(operation, now));
  const rosterOwners = unique(members.map((member) => member.name).filter(Boolean));
  const hasUnassigned = monthOperations.some((operation) => operationOwnersFromRoster(operation, rosterOwners).length === 0);
  const owners = hasUnassigned ? [...rosterOwners, "배정필요"] : rosterOwners;
  const boardOwners = owners.slice(0, 10);
  const grouped = boardOwners.map((owner) => ({
    owner,
    operations: monthOperations.filter((operation) => {
      const operationOwners = operationOwnersFromRoster(operation, rosterOwners);
      return owner === "배정필요" ? operationOwners.length === 0 : operationOwners.includes(owner);
    })
  }));

  const body = `<section class="panel">
      <div class="section-title"><h2>${now.getFullYear()}년 ${now.getMonth() + 1}월 달력</h2><span>월간 운영 일정</span></div>
      ${renderMonthCalendar(monthOperations)}
    </section>
    <section class="panel">
      <div class="section-title"><h2>운영 현황 보드</h2><span>담당자 검색 가능</span></div>
      <div class="resource-board">
        ${grouped.map(({ owner, operations: ownerOperations }) => `<section class="owner-col">
          <header><strong>${escapeHtml(owner)}</strong><span>${ownerOperations.length}건</span></header>
          ${["시작 전", "진행 중", "완료"].map((label) => {
            const items = ownerOperations.filter((operation) => statusGroup(label).includes(operation.operationStatus)).slice(0, 4);
            return `<div class="owner-group"><div class="group-title">${label}<b>${items.length}</b></div>
              ${items.length ? items.map(renderResourceCard).join("") : `<span class="empty">비어 있음</span>`}
            </div>`;
          }).join("")}
        </section>`).join("")}
      </div>
    </section>`;

  return renderShell("resources", "리소스", body);
}

function renderDetailPage(operation) {
  if (!operation) return renderShell("operations", "과정 상세", "<section class=\"panel empty\">표시할 과정이 없습니다.</section>");

  const body = `<section class="detail-hero">
      ${badge(operation.operationStatus)}
      <h2>${escapeHtml(operation.courseName)}</h2>
      <p>${escapeHtml(operation.companyName)} · ${escapeHtml(operation.startDate)} ~ ${escapeHtml(operation.endDate)}</p>
    </section>
    <section class="detail-grid">
      ${renderInfoPanel("기본 정보", [
        ["코스ID", operation.courseId],
        ["교육형태", operation.educationFormat],
        ["운영유형", operation.operationType],
        ["OM", operation.om],
        ["LD", operation.ld],
        ["강사", operation.instructors]
      ])}
      ${renderInfoPanel("자료 링크", [
        ["드라이브", operation.driveLink ? "등록" : "미등록"],
        ["강의관리", operation.lectureManagementLink ? "등록" : "미등록"],
        ["패들렛", operation.padletLink ? "등록" : "미등록"],
        ["운영상세", operation.operationDetail ? "등록" : "미등록"]
      ])}
      ${renderInfoPanel("운영/회고", [
        ["특이사항", operation.specialNotes || "-"],
        ["운영 이슈", operation.operationIssue || "-"],
        ["만족도", operation.avgSatisfaction || "-"],
        ["결과보고서", operation.hasResultReport || "-"]
      ])}
    </section>`;

  return renderShell("operations", "과정 상세", body);
}

function renderMetrics(metrics) {
  return `<section class="metrics">${metrics.map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("")}</section>`;
}

function renderCountPanel(title, items) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return `<section class="panel"><div class="section-title"><h2>${escapeHtml(title)}</h2></div>
    <div class="bar-list">${items.map((item) => `<div class="bar-row"><span>${escapeHtml(item.label)}</span><div><i style="width:${(item.count / max) * 100}%"></i></div><b>${item.count}</b></div>`).join("")}</div>
  </section>`;
}

function renderCompactTable(rows) {
  return `<table><thead><tr>${["상태", "기업 / 과정", "교육형태", "OM", "LD", "기간", "매출", "강사"].map((header) => `<th>${header}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((operation) => `<tr>
      <td>${escapeHtml(operation.operationStatus)}</td>
      <td><strong>${escapeHtml(operation.companyName)}</strong><span>${escapeHtml(operation.courseName)}</span></td>
      <td>${escapeHtml(operation.educationFormat)}</td>
      <td>${escapeHtml(operation.om || "배정필요")}</td>
      <td>${escapeHtml(operation.ld || "미정")}</td>
      <td>${escapeHtml(operation.startDate)} ~ ${escapeHtml(operation.endDate)}</td>
      <td>${money(operation.revenue)}</td>
      <td>${escapeHtml(operation.instructors || "-")}</td>
    </tr>`).join("")}</tbody></table>`;
}

function renderMonthlyTrend(allOperations) {
  const counts = Array.from({ length: 12 }, (_, index) => allOperations.filter((operation) => {
    const date = parseDate(operation.startDate);
    return date && date.getFullYear() === now.getFullYear() && date.getMonth() === index;
  }).length);
  const max = Math.max(1, ...counts);
  return `<div class="mini-chart">${counts.map((count, index) => `<div><i style="height:${Math.max(10, (count / max) * 110)}px"></i><span>${index + 1}월</span><b>${count}</b></div>`).join("")}</div>`;
}

function renderMonthCalendar(allOperations) {
  const days = calendarDays(now);
  return `<div class="calendar">${["월", "화", "수", "목", "금", "토", "일"].map((day) => `<b>${day}</b>`).join("")}${days.map((date) => {
    const dayOperations = allOperations.filter((operation) => showsOnDate(operation, date)).slice(0, 2);
    return `<div><time>${date.getDate()}</time>${dayOperations.map((operation) => `<span>${escapeHtml(operation.courseName)}<em>${escapeHtml(operation.om || "배정필요")}</em></span>`).join("")}</div>`;
  }).join("")}</div>`;
}

function renderResourceCard(operation) {
  return `<article class="resource-card">${badge(operation.operationStatus)}<strong>${escapeHtml(operation.courseName)}</strong><span>${escapeHtml(shortRange(operation))}</span></article>`;
}

function renderInfoPanel(title, items) {
  return `<section class="panel"><div class="section-title"><h2>${escapeHtml(title)}</h2></div><div class="info-list">${items.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? "-"))}</strong></div>`).join("")}</div></section>`;
}

function statusGroup(label) {
  if (label === "시작 전") return ["배정필요", "배정예정"];
  if (label === "진행 중") return ["진행중"];
  return ["완료", "회고완료", "아카이빙필요"];
}

function calendarDays(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const startOffset = (first.getDay() + 6) % 7;
  const total = startOffset + last.getDate();
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);
  return Array.from({ length: Math.ceil(total / 7) * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function showsOnDate(operation, date) {
  const start = parseDate(operation.startDate);
  const end = parseDate(operation.endDate);
  if (!start || !end) return false;
  return start <= date && date <= end;
}

function overlapsMonth(operation, date) {
  const start = parseDate(operation.startDate);
  const end = parseDate(operation.endDate);
  if (!start || !end) return false;
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return start <= monthEnd && monthStart <= end;
}

function isSameMonth(value, date) {
  const parsed = parseDate(value);
  return parsed && parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth();
}

function isUpcoming(value) {
  const parsed = parseDate(value);
  return parsed ? parsed > stripTime(now) : false;
}

function isEnded(operation) {
  const parsed = parseDate(operation.endDate);
  return parsed ? parsed < stripTime(now) : false;
}

function isDone(operation) {
  return ["완료", "회고완료"].includes(operation.operationStatus);
}

function splitPeople(value) {
  const people = String(value ?? "")
    .split(/[,，、/]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter(isPersonLike);
  return people.length ? unique(people) : ["배정필요"];
}

function operationOwnersFromRoster(operation, rosterOwners) {
  const rosterOwnerSet = new Set(rosterOwners);
  return splitPeople(operation.om).filter((owner) => rosterOwnerSet.has(owner));
}

function isPersonLike(value) {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "배정필요") return true;
  return !["ld", "om", "매니저", "담당", "미정", "없음", "필요", "확인", "조교", "코치"].some((token) => normalized.includes(token));
}

function topCounts(values, limit) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([label, count]) => ({ count, label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"))
    .slice(0, limit);
}

function average(values) {
  if (!values.length) return null;
  return (values.reduce((total, value) => total + value, 0) / values.length).toFixed(2);
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function stripTime(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function formatDate(value) {
  return `${value.getFullYear()}.${String(value.getMonth() + 1).padStart(2, "0")}.${String(value.getDate()).padStart(2, "0")}`;
}

function shortRange(operation) {
  return `${String(operation.startDate).slice(5).replace("-", "/")}~${String(operation.endDate).slice(5).replace("-", "/")}`;
}

function money(value) {
  return value === null || value === undefined ? "-" : Number(value).toLocaleString("ko-KR");
}

function moneyShort(value) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString("ko-KR")}만`;
  return value.toLocaleString("ko-KR");
}

function unique(values) {
  return Array.from(new Set(values));
}

function badge(value) {
  return `<span class="badge">${escapeHtml(value)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function styles() {
  return `
    :root { --bg:#eef3f8; --surface:#fff; --line:#d8e1ec; --text:#0f1724; --muted:#6b7890; --nav:#111c2d; --blue:#4f46e5; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Arial, "Apple SD Gothic Neo", sans-serif; font-size: 13px; }
    .shell { display: grid; grid-template-columns: 172px minmax(0, 1fr); min-height: 100vh; }
    .side { background: var(--nav); color: #d8e2ee; padding: 20px 14px; }
    .brand { align-items: center; display: flex; gap: 10px; margin-bottom: 34px; }
    .brand span { background: #d9f0e3; border-radius: 12px; color: #8392a5; display: grid; font-weight: 800; height: 42px; place-items: center; width: 42px; }
    .brand strong { color: #fff; font-size: 18px; }
    nav { display: grid; gap: 8px; }
    nav span { border-radius: 8px; padding: 12px 14px; }
    nav .active { background: #22385a; color: #fff; }
    .content { display: grid; gap: 12px; padding: 18px 22px 28px; }
    .page-head { align-items: center; display: flex; justify-content: space-between; }
    h1 { font-size: 20px; margin: 0; }
    h2 { font-size: 14px; margin: 0; }
    .metrics { display: grid; gap: 8px; grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .metric, .panel, .filterbar, .detail-hero { background: #fff; border: 1px solid var(--line); border-radius: 8px; }
    .metric { min-height: 64px; padding: 10px 12px; }
    .metric span, .section-title span, td span, .filterbar, .empty, .detail-hero p { color: var(--muted); }
    .metric strong { display: block; font-size: 18px; margin-top: 4px; }
    .panel { overflow: hidden; }
    .panel-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .section-title { align-items: center; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; padding: 10px 12px; }
    .bar-list { display: grid; gap: 10px; padding: 14px; }
    .bar-row { align-items: center; display: grid; gap: 8px; grid-template-columns: 92px minmax(0, 1fr) 28px; }
    .bar-row span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-row div { background: #edf2f7; border-radius: 999px; height: 9px; overflow: hidden; }
    .bar-row i { background: var(--blue); display: block; height: 100%; }
    table { border-collapse: collapse; min-width: 100%; width: 100%; }
    th, td { border-bottom: 1px solid #e5ebf2; padding: 8px 10px; text-align: left; vertical-align: middle; white-space: nowrap; }
    th { background: #f7f9fc; color: #445160; font-size: 11px; }
    td { font-size: 12px; }
    td span { display: block; font-size: 11px; margin-top: 2px; }
    .wide-table { overflow-x: auto; }
    .wide-table table { min-width: 1740px; }
    .truncate { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
    .badge { background: #dff6e9; border-radius: 999px; color: #087348; display: inline-flex; font-size: 11px; font-weight: 700; padding: 4px 8px; }
    .filterbar { align-items: center; display: flex; gap: 8px; overflow-x: auto; padding: 10px 12px; white-space: nowrap; }
    .filterbar span, .filterbar strong { background: #fbfcfe; border: 1px solid var(--line); border-radius: 7px; min-height: 32px; padding: 8px 10px; }
    .filterbar .search { width: 250px; }
    .mini-chart { align-items: end; display: grid; gap: 8px; grid-template-columns: repeat(12, 1fr); min-height: 160px; padding: 16px; }
    .mini-chart div { display: grid; gap: 4px; justify-items: center; }
    .mini-chart i { background: #6d7fe8; border-radius: 5px 5px 0 0; display: block; width: 100%; }
    .mini-chart span, .mini-chart b { color: var(--muted); font-size: 11px; }
    .calendar { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .calendar > b, .calendar > div { border-bottom: 1px solid #e6e4e0; border-right: 1px solid #e6e4e0; min-height: 88px; padding: 7px; }
    .calendar time { color: var(--muted); display: block; margin-bottom: 6px; }
    .calendar span { border: 1px solid #dedbd5; border-radius: 5px; display: block; font-weight: 700; margin-bottom: 4px; overflow: hidden; padding: 5px; text-overflow: ellipsis; white-space: nowrap; }
    .calendar em { color: #687385; display: block; font-size: 11px; font-style: normal; margin-top: 3px; }
    .resource-board { display: grid; gap: 18px; grid-auto-columns: 250px; grid-auto-flow: column; overflow-x: auto; padding: 12px; }
    .owner-col header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 8px; }
    .owner-group { margin-bottom: 10px; }
    .group-title { align-items: center; color: var(--muted); display: flex; font-size: 12px; justify-content: space-between; margin-bottom: 5px; }
    .resource-card { border: 1px solid #dedbd5; border-radius: 5px; display: grid; gap: 5px; margin-bottom: 6px; padding: 8px; }
    .resource-card strong { line-height: 1.35; }
    .detail-hero { padding: 18px; }
    .detail-hero h2 { font-size: 22px; margin: 10px 0 6px; }
    .detail-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .info-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .info-list div { border-bottom: 1px solid #e5ebf2; padding: 10px 12px; }
    .info-list span { color: var(--muted); display: block; font-size: 12px; }
    .info-list strong { display: block; margin-top: 4px; overflow-wrap: anywhere; }
    @media print { .side { display: none; } .shell { display: block; } .content { padding: 0; } body { background: #fff; } }
  `;
}
