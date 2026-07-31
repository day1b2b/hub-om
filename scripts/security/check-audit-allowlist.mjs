// 프로덕션 의존성 critical 취약점 차단 (확인된 예외 허용)
//
// 기존에는 `npm audit --omit=dev --audit-level=critical`로 critical이 하나라도 있으면
// 무조건 실패했다. 하지만 수정 버전이 아직 출시되지 않은 취약점(예: 2026-07-23 공개된
// @auth/core 3건)은 우리가 당장 해결할 방법이 없는데도 모든 PR을 막아버린다.
//
// 이 스크립트는 같은 검사를 하되, audit-allowlist.json에 등록된 "확인된 예외"만 통과시킨다.
// - 예외는 GHSA ID 단위로 등록하고, 사유·등록일·재확인일을 함께 남긴다.
// - 예외 목록에 없는 새 critical 취약점이 나타나면 기존과 동일하게 실패(exit 1)한다.
// - 재확인일이 지난 예외는 경고를 출력한다 (차단하지는 않음 — 수정판 출시는 우리가
//   통제할 수 없으므로, 기한 초과로 다시 모든 PR을 막는 상황을 만들지 않는다).

import { spawnSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWLIST_PATH = join(dirname(fileURLToPath(import.meta.url)), "audit-allowlist.json");

function ghsaIdOf(url) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url ?? "");
  return match ? match[0].toUpperCase() : null;
}

// 1. 예외 목록 읽기
let allowlist;
try {
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
} catch (err) {
  console.error(`예외 목록을 읽지 못했습니다: ${ALLOWLIST_PATH}`);
  console.error(String(err));
  process.exit(1);
}
const exceptions = new Map(
  (allowlist.exceptions ?? []).map((e) => [e.ghsa.toUpperCase(), e])
);

// 2. npm audit 실행 (취약점이 있으면 npm이 exit 1을 내므로 종료 코드는 무시하고 JSON만 읽는다)
const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024
});
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("npm audit JSON 출력을 파싱하지 못했습니다.");
  console.error(audit.stdout?.slice(0, 2000) ?? "");
  console.error(audit.stderr?.slice(0, 2000) ?? "");
  process.exit(1);
}
const vulnerabilities = report.vulnerabilities ?? {};

// 3. critical 취약점 판정
// - 패키지의 rolled-up severity가 critical인 항목만 본다 (기존 --audit-level=critical과 동일).
// - via가 객체(직접 advisory)이고 severity가 critical이면 예외 목록에 있어야 한다.
// - via가 문자열(다른 취약 패키지 의존)이면 그 패키지가 통과해야 함께 통과한다.
const covered = new Map(); // 패키지명 -> boolean (순환 의존 대비 방문 기록 겸용)

function isCovered(name, trail = new Set()) {
  if (covered.has(name)) return covered.get(name);
  if (trail.has(name)) return true; // 순환 참조는 다른 경로에서 판정
  trail.add(name);

  const vuln = vulnerabilities[name];
  if (!vuln) return false; // audit 결과에 없는 참조 — 안전하게 실패로 처리

  let ok = true;
  const vias = Array.isArray(vuln.via) ? vuln.via : [vuln.via];
  let hasEvaluatableVia = false;
  for (const via of vias) {
    if (typeof via === "string") {
      hasEvaluatableVia = true;
      if (!isCovered(via, trail)) ok = false;
    } else if (via && typeof via === "object") {
      if (via.severity !== "critical") continue; // critical 미만 advisory는 이 게이트 대상 아님
      hasEvaluatableVia = true;
      const ghsa = ghsaIdOf(via.url);
      if (!ghsa || !exceptions.has(ghsa)) ok = false;
    }
  }
  // critical인데 판정할 via가 하나도 없으면 안전하게 실패로 처리
  if (!hasEvaluatableVia) ok = false;

  covered.set(name, ok);
  return ok;
}

const criticals = Object.entries(vulnerabilities).filter(([, v]) => v.severity === "critical");
const blocked = [];
const excused = [];
for (const [name] of criticals) {
  (isCovered(name) ? excused : blocked).push(name);
}

// 4. 결과 요약
const today = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push("## 🛡️ 프로덕션 critical 취약점 차단 (확인된 예외 허용)");
lines.push("");
lines.push(`- critical 취약 패키지: ${criticals.length}개`);
lines.push(`- 확인된 예외로 통과: ${excused.length}개 (${excused.join(", ") || "-"})`);
lines.push(`- 차단: ${blocked.length}개 (${blocked.join(", ") || "-"})`);
lines.push("");
if (exceptions.size > 0) {
  lines.push("| 예외 (GHSA) | 패키지 | 사유 | 등록일 | 재확인일 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const e of exceptions.values()) {
    lines.push(`| ${e.ghsa} | ${e.package ?? "-"} | ${e.reason ?? "-"} | ${e.added ?? "-"} | ${e.recheck ?? "-"} |`);
  }
  lines.push("");
}
for (const e of exceptions.values()) {
  if (e.recheck && e.recheck < today) {
    const msg = `예외 ${e.ghsa}(${e.package ?? "?"})의 재확인일(${e.recheck})이 지났습니다. 수정 버전 출시 여부를 확인하세요.`;
    lines.push(`⚠️ ${msg}`);
    console.log(`::warning::${msg}`);
  }
}

const summary = lines.join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  } catch {
    // 요약 파일 쓰기 실패는 판정에 영향 없음
  }
}

if (blocked.length > 0) {
  console.error("");
  console.error("예외 목록에 없는 critical 취약점이 있습니다. 아래 중 하나가 필요합니다.");
  console.error("1) 취약한 패키지를 수정 버전으로 업그레이드 (권장)");
  console.error("2) 수정 버전이 없으면 기술 책임자 확인 후 scripts/security/audit-allowlist.json에 예외 등록");
  process.exit(1);
}
process.exit(0);
