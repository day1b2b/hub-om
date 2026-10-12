// PR에서 기획서(specs/*.spec.md) 규칙이 약해지는 변경을 찾아 승인 라벨을 요구하고, 사람이 읽을 변경 요약을 출력한다.
// 설계: docs/operations/behavior-spec-design.md
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { ENTRY_MAP, SPEC_DIR, parseSpec } from "./spec-lib.mjs";

export const APPROVAL_LABEL = "behavior-spec-approved";
const cellKey = (note) => `${note.rule} @ ${note.entrance}`;

/** 기준(base)과 PR(head)의 spec·입구 분류를 비교한다. weakening=true면 승인 라벨이 필요하다. */
export function reviewSpecChanges(baseSpecs, headSpecs, baseMap, headMap) {
  const changes = [];
  const add = (spec, weakening, text) => changes.push({ spec, weakening, text });
  const baseById = new Map(baseSpecs.map((spec) => [spec.id, spec]));
  const headById = new Map(headSpecs.map((spec) => [spec.id, spec]));
  for (const [id, before] of baseById) if (!headById.has(id)) add(id, true, `업무 기획서 삭제: ${before.title}`);
  for (const [id, after] of headById) {
    const before = baseById.get(id) ?? { rules: [], entrances: [], exceptions: [], gaps: [] };
    if (!baseById.has(id)) add(id, false, `새 업무 기획서: ${after.title}`);
    const beforeRules = new Map(before.rules.map((rule) => [rule.id, rule.text]));
    const afterRules = new Map(after.rules.map((rule) => [rule.id, rule.text]));
    for (const [rule, text] of beforeRules) {
      if (!afterRules.has(rule)) add(id, true, `규칙 삭제 ${rule}: ${text}`);
      else if (afterRules.get(rule) !== text) add(id, true, `규칙 변경 ${rule}: "${text}" → "${afterRules.get(rule)}"`);
    }
    for (const [rule, text] of afterRules) if (!beforeRules.has(rule)) add(id, false, `규칙 추가 ${rule}: ${text}`);
    const beforeEntrances = new Set(before.entrances.map((entrance) => entrance.key));
    const afterEntrances = new Set(after.entrances.map((entrance) => entrance.key));
    for (const key of beforeEntrances) if (!afterEntrances.has(key)) add(id, true, `입구 제외: ${key}`);
    for (const key of afterEntrances) if (!beforeEntrances.has(key)) add(id, false, `입구 추가: ${key}`);
    for (const [kind, label] of [["exceptions", "예외"], ["gaps", "알려진 빈칸"]]) {
      const beforeNotes = new Map(before[kind].map((note) => [cellKey(note), note.reason]));
      const afterNotes = new Map(after[kind].map((note) => [cellKey(note), note.reason]));
      for (const [cell, reason] of afterNotes) {
        if (!beforeNotes.has(cell)) add(id, true, `${label} 추가 ${cell}: ${reason}`);
        else if (beforeNotes.get(cell) !== reason) add(id, false, `${label} 이유 수정 ${cell}: ${reason}`);
      }
      for (const cell of beforeNotes.keys()) if (!afterNotes.has(cell)) add(id, false, `${label} 해제 ${cell}`);
    }
  }
  // 처음 도입할 때(기준에 분류표가 없을 때)는 기존 입구를 일괄 "미검토"로 둘 수 있다. 그 뒤로 새 입구는 바로 분류한다.
  const newUnreviewed = baseMap === null ? [] : Object.entries(headMap)
    .filter(([key, value]) => value === "미검토" && baseMap[key] !== "미검토").map(([key]) => key);
  return { changes, newUnreviewed };
}

export function renderReview({ changes, newUnreviewed }) {
  if (!changes.length && !newUnreviewed.length) return "## 기획서 변경\n\n기획서 규칙 변경이 없습니다.\n";
  const lines = ["## 기획서 변경", ""];
  for (const change of changes) lines.push(`- ${change.weakening ? "⚠️ 승인 필요" : "➕"} [${change.spec}] ${change.text}`);
  for (const key of newUnreviewed) lines.push(`- ❌ 새 입구를 "미검토"로 둘 수 없습니다: ${key} — 업무 spec 입구 표에 넣거나 "해당 없음: 이유"로 분류하세요.`);
  return lines.join("\n") + "\n";
}

function git(...args) { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); }
function readAt(ref, file) { try { return git("show", `${ref}:${file}`); } catch { return null; } }
function specsAt(ref) {
  let names = [];
  try { names = git("ls-tree", "--name-only", ref, `${SPEC_DIR}/`).split("\n"); } catch { return []; }
  return names.filter((name) => name.endsWith(".spec.md")).map((name) => parseSpec(readAt(ref, name), name));
}

function main() {
  const base = process.env.SPEC_GUARD_BASE;
  if (!base) throw new Error("SPEC_GUARD_BASE가 필요합니다.");
  const labels = new Set((process.env.PR_LABELS ?? "").split(",").map((label) => label.trim()).filter(Boolean));
  const baseMapText = readAt(base, ENTRY_MAP);
  const review = reviewSpecChanges(specsAt(base), specsAt("HEAD"), baseMapText ? JSON.parse(baseMapText) : null, JSON.parse(readAt("HEAD", ENTRY_MAP) ?? "{}"));
  const summary = renderReview(review);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  const needsApproval = review.changes.some((change) => change.weakening);
  if (review.newUnreviewed.length) { console.error("새 입구는 분류가 필요합니다."); process.exit(1); }
  if (needsApproval && !labels.has(APPROVAL_LABEL)) {
    console.error(`규칙 삭제·변경, 예외·알려진 빈칸 추가는 기획 책임자 확인 뒤 PR 라벨 "${APPROVAL_LABEL}"이 필요합니다.`);
    process.exit(1);
  }
  console.log(needsApproval ? "기획서 변경 승인 라벨을 확인했습니다." : "승인이 필요한 기획서 변경이 없습니다.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
