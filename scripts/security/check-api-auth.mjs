// API 라우트 권한 커버리지 점검 (경고 전용, 빌드를 막지 않음)
//
// hub-om의 모든 API 라우트는 미들웨어(proxy.ts)로 1차 보호되지만,
// (1) 로그인 확인조차 없는 라우트, (2) admin 경로인데 admin 확인이 없는 라우트를
// 가시화한다. 실제 프로젝트가 쓰는 권한 헬퍼 이름을 신호로 등록해 오탐을 줄인다.
//
// - CHANGED_FILES(쉼표 구분)가 있으면 이번 PR에서 바뀐 라우트를 강조하고,
//   그중 문제 라우트는 GitHub 경고 어노테이션으로 남긴다.
// - 항상 exit 0. 판단은 사람이 한다.

import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = join("src", "app", "api");
const ADMIN_PREFIX = "src/app/api/admin/";

// 의도적으로 공개이거나, 자체 인증 메커니즘을 쓰는 라우트
const EXEMPT = new Map([
  ["src/app/api/auth/[...nextauth]/route.ts", "NextAuth 인증 처리 엔드포인트"],
  ["src/app/api/health/route.ts", "상태 확인용 (의도적 공개)"]
]);

// 로그인/토큰 등 "인증이 하나라도 있는지" 신호 (프로젝트 실제 헬퍼 포함)
const LOGIN_SIGNALS = [
  /requireWorkspaceSession/,
  /requireAdminSession/,
  /assertAdminSession/,
  /assertCoachPiiAccess/,
  /isCoachPiiViewer/,
  /isAdminEmail/,
  /validateCoachToken/,
  /extractCoachToken/,
  /isAllowedWorkspaceEmail/,
  /\bauth\s*\(\s*\)/,
  /getServerSession/,
  /getToken\s*\(/,
  /SYNC_API_SECRET|BACKUP_API_SECRET/
];

// admin 등급 확인 신호 (admin 경로가 이 중 하나는 써야 한다)
const ADMIN_SIGNALS = [
  /assertAdminSession/,
  /requireAdminSession/,
  /isAdminEmail/,
  /assertCoachPiiAccess/,
  /isCoachPiiViewer/
];

// 미들웨어(auth.ts)가 경로 단위로 직접 인증하는 라우트(sync/backup bearer 등)를
// 자동 인식한다. auth.ts에 해당 API 경로 문자열이 있으면 미들웨어가 처리하는 것으로 본다.
const AUTH_MIDDLEWARE_SOURCE = (() => {
  try {
    return readFileSync(join("src", "auth.ts"), "utf8");
  } catch {
    return "";
  }
})();

function apiPathOf(route) {
  return "/api" + route.replace(/^src\/app\/api/, "").replace(/\/route\.ts$/, "");
}

function isMiddlewareHandled(route) {
  return AUTH_MIDDLEWARE_SOURCE.includes(`"${apiPathOf(route)}"`);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function matchesAny(source, signals) {
  return signals.some((re) => re.test(source));
}

const changed = new Set(
  (process.env.CHANGED_FILES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toPosix)
);

let routes;
try {
  routes = walk(API_ROOT).map((p) => toPosix(relative(process.cwd(), p)));
} catch {
  console.log(`API 디렉터리를 찾지 못했습니다: ${API_ROOT}`);
  process.exit(0);
}
routes.sort();

const rows = [];
const flaggedChanged = [];

for (const route of routes) {
  const source = readFileSync(route, "utf8");
  const exemptNote = EXEMPT.get(route);
  const hasLogin = matchesAny(source, LOGIN_SIGNALS);
  const isAdminPath = route.startsWith(ADMIN_PREFIX);
  const hasAdmin = matchesAny(source, ADMIN_SIGNALS);
  const isChanged = changed.has(route);

  // severity: none(인증없음) > admin-gap(admin확인없음) > ok
  let severity;
  let status;
  if (exemptNote) {
    severity = "exempt";
    status = `➖ 예외 (${exemptNote})`;
  } else if (isMiddlewareHandled(route)) {
    severity = "middleware";
    status = "➖ 미들웨어 인증 (sync/backup 등)";
  } else if (!hasLogin) {
    severity = "none";
    status = "⛔ 인증 없음";
  } else if (isAdminPath && !hasAdmin) {
    severity = "admin-gap";
    status = "⚠️ admin 경로인데 admin 확인 없음";
  } else {
    severity = "ok";
    status = "✅ 확인 있음";
  }

  rows.push({ route, status, severity, isChanged });
  if (isChanged && (severity === "none" || severity === "admin-gap")) {
    flaggedChanged.push({ route, severity });
  }
}

const noneCount = rows.filter((r) => r.severity === "none").length;
const adminGapCount = rows.filter((r) => r.severity === "admin-gap").length;

const lines = [];
lines.push("## 🔐 API 라우트 권한 커버리지");
lines.push("");
lines.push(
  "모든 라우트는 미들웨어(proxy.ts)로 1차 보호됩니다. 아래는 라우트 내부의 " +
    "**추가 권한 확인**을 본 참고 자료입니다."
);
lines.push("");
lines.push(`- 전체 라우트: ${rows.length}개`);
lines.push(`- ⛔ 인증 확인이 하나도 없음: ${noneCount}개`);
lines.push(`- ⚠️ admin 경로인데 admin 확인 없음: ${adminGapCount}개`);
if (changed.size > 0) lines.push(`- 이번 변경에 포함된 라우트: ${rows.filter((r) => r.isChanged).length}개`);
lines.push("");
lines.push("| 라우트 | 이번 변경 | 상태 |");
lines.push("| --- | :---: | --- |");
for (const r of rows) {
  lines.push(`| \`${r.route.replace(/^src\/app\/api\//, "")}\` | ${r.isChanged ? "🔸" : ""} | ${r.status} |`);
}

const summary = lines.join("\n");
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  } catch {
    // 요약 파일 쓰기 실패는 무시 (경고 전용)
  }
}

for (const { route, severity } of flaggedChanged) {
  const msg =
    severity === "none"
      ? "이번 PR에서 변경된 라우트에 인증 확인이 하나도 없습니다. 로그인/권한 확인이 필요한지 검토하세요."
      : "이번 PR에서 변경된 admin 경로 라우트에 admin 등급 확인(assertAdminSession 등)이 없습니다.";
  console.log(`::warning file=${route}::${msg}`);
}

process.exit(0);
