// API 라우트 권한 커버리지 점검 (경고 전용, 빌드를 막지 않음)
//
// hub-om의 모든 API 라우트가 미들웨어(proxy.ts) 1차 보호 위에서 동작하지만,
// 관리자/권한 분기가 필요한 라우트가 라우트 내부 확인 없이 추가되는 것을 막기 위해
// 각 route.ts가 명시적 인증/권한 신호를 가지고 있는지 표로 보여준다.
//
// - CHANGED_FILES(쉼표 구분)가 있으면 이번 PR에서 바뀐 라우트를 강조하고,
//   그중 명시적 확인이 없는 라우트는 GitHub 경고 어노테이션으로 남긴다.
// - 항상 exit 0. 판단은 사람이 한다.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = join("src", "app", "api");

// 의도적으로 공개이거나, 자체 인증 메커니즘을 쓰는 라우트
const EXEMPT = new Map([
  ["src/app/api/auth/[...nextauth]/route.ts", "NextAuth 인증 처리 엔드포인트"],
  ["src/app/api/health/route.ts", "상태 확인용 (의도적 공개)"]
]);

// 라우트 내부의 명시적 인증/권한 신호
const AUTH_SIGNALS = [
  /\bauth\s*\(/,
  /getServerSession/,
  /isAllowedWorkspaceEmail/,
  /requireCoach/i,
  /coachPrivateAccess/,
  /coachAccessToken/,
  /verifyCoachToken/i,
  /SYNC_API_SECRET|BACKUP_API_SECRET/,
  /authorization/i,
  /\bBearer\b/,
  /getToken\s*\(/,
  /\bsession\b/
];

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

function hasAuthSignal(source) {
  return AUTH_SIGNALS.some((re) => re.test(source));
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
const changedMissing = [];

for (const route of routes) {
  const source = readFileSync(route, "utf8");
  const exemptNote = EXEMPT.get(route);
  const covered = Boolean(exemptNote) || hasAuthSignal(source);
  const isChanged = changed.has(route);

  let status;
  if (exemptNote) status = `➖ 예외 (${exemptNote})`;
  else if (covered) status = "✅ 확인 있음";
  else status = "⚠️ 명시적 확인 없음";

  rows.push({ route, status, isChanged, covered: covered || Boolean(exemptNote) });

  if (isChanged && !covered && !exemptNote) changedMissing.push(route);
}

const missingTotal = rows.filter((r) => !r.covered).length;

const lines = [];
lines.push("## 🔐 API 라우트 권한 커버리지");
lines.push("");
lines.push(
  "모든 라우트는 미들웨어(proxy.ts)로 1차 보호됩니다. 아래 표는 **라우트 내부에 " +
    "별도 인증/권한 확인이 있는지**를 보여주는 참고 자료입니다. ‘명시적 확인 없음’이 " +
    "곧 취약점은 아니지만, 관리자/특정 사용자만 접근해야 하는 라우트라면 확인이 필요합니다."
);
lines.push("");
lines.push(`- 전체 라우트: ${rows.length}개`);
lines.push(`- 명시적 확인 없음: ${missingTotal}개`);
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
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  } catch {
    // 요약 파일 쓰기 실패는 무시 (경고 전용)
  }
}

for (const route of changedMissing) {
  console.log(
    `::warning file=${route}::이번 PR에서 변경된 API 라우트에 명시적 인증/권한 확인이 보이지 않습니다. ` +
      `관리자/특정 사용자 전용이라면 라우트 내부에서 권한을 확인하세요.`
  );
}

process.exit(0);
