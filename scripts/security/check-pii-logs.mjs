// 로그 개인정보 노출 점검 (경고 전용, 빌드를 막지 않음)
//
// console.* 호출에 이름·이메일·전화·토큰·비밀번호 같은 개인정보/비밀이
// 그대로 찍히는 코드를 찾아 검토 대상으로 보여준다.
// 휴리스틱이라 오탐이 있을 수 있으므로 '위반'이 아니라 '검토 필요'로 다룬다.
// 항상 exit 0.

import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_ROOT = "src";
const CODE_EXT = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

const CONSOLE_CALL = /console\.(log|error|warn|info|debug)\s*\(/;

// 로그에 들어가면 검토가 필요한 개인정보/비밀 신호
const PII_TOKENS = [
  "email",
  "phone",
  "mobile",
  "password",
  "passwd",
  "secret",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "ssn",
  "residentregistration",
  "birth",
  "이메일",
  "전화",
  "휴대폰",
  "비밀번호",
  "주민",
  "생년월일"
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (CODE_EXT.test(entry)) out.push(full);
  }
  return out;
}

function toPosix(p) {
  return p.split(sep).join("/");
}

let files;
try {
  files = walk(SRC_ROOT);
} catch {
  console.log(`소스 디렉터리를 찾지 못했습니다: ${SRC_ROOT}`);
  process.exit(0);
}

const findings = [];

for (const file of files) {
  const rel = toPosix(relative(process.cwd(), file));
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!CONSOLE_CALL.test(line)) continue;
    const lower = line.toLowerCase();
    const hits = PII_TOKENS.filter((t) => lower.includes(t));
    if (hits.length === 0) continue;
    findings.push({ file: rel, line: i + 1, hits: [...new Set(hits)], text: line.trim().slice(0, 160) });
  }
}

const out = [];
out.push("## 🕵️ 로그 개인정보 노출 점검");
out.push("");
if (findings.length === 0) {
  out.push("검토가 필요한 로그 호출을 찾지 못했습니다. ✅");
} else {
  out.push(
    `console 로그에 개인정보/비밀이 섞였을 수 있는 지점 **${findings.length}곳**입니다. ` +
      "오탐일 수 있으니 각 줄이 실제로 개인정보 값을 남기는지 확인하세요. " +
      "(식별자나 개수 로깅이면 무시해도 됩니다.)"
  );
  out.push("");
  out.push("| 위치 | 걸린 단어 | 코드 |");
  out.push("| --- | --- | --- |");
  for (const f of findings) {
    const code = f.text.replace(/\|/g, "\\|");
    out.push(`| \`${f.file}:${f.line}\` | ${f.hits.join(", ")} | \`${code}\` |`);
  }
}

const summary = out.join("\n");
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  } catch {
    // 요약 파일 쓰기 실패는 무시
  }
}

for (const f of findings) {
  console.log(
    `::warning file=${f.file},line=${f.line}::로그에 개인정보/비밀이 노출될 수 있습니다 (${f.hits.join(", ")}). 실제 값이 찍히는지 확인하세요.`
  );
}

process.exit(0);
