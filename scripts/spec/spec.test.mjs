import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMatrix, checkEntranceClassification, parseSpec, parseTags } from "./spec-lib.mjs";
import { reviewSpecChanges } from "./check-spec-change-review.mjs";

const SPEC = `# 예시 업무

업무 ID: \`sample\`

## 규칙

- **R1** 첫 규칙.
- **R2** 둘째 규칙.

## 입구

| 입구 | 화면 |
|---|---|
| \`POST /api/a/[id]\` | A |
| \`DELETE /api/b\` | B |

## 예외

- **R2 @ \`DELETE /api/b\`** — B는 해당 없음.

## 알려진 빈칸

- **R1 @ \`DELETE /api/b\`** — 고칠 예정.
`;

test("spec Markdown에서 규칙·입구·예외·알려진 빈칸을 읽는다", () => {
  const spec = parseSpec(SPEC);
  assert.deepEqual(spec.errors, []);
  assert.deepEqual(spec.rules.map((rule) => rule.id), ["R1", "R2"]);
  assert.deepEqual(spec.entrances.map((entrance) => entrance.key), ["POST /api/a/[id]", "DELETE /api/b"]);
  assert.equal(spec.exceptions[0].reason, "B는 해당 없음.");
  assert.equal(spec.gaps[0].rule, "R1");
});

test("이유 없는 예외와 없는 규칙을 가리키는 예외는 형식 오류다", () => {
  assert.ok(parseSpec(SPEC.replace("B는 해당 없음.", "")).errors.length > 0);
  assert.ok(parseSpec(SPEC.replace("**R2 @", "**R9 @")).errors.some((error) => error.includes("R9")));
});

test("테스트 이름 태그는 대괄호가 든 입구와 여러 규칙을 읽는다", () => {
  assert.deepEqual(parseTags("이름 [spec:sample R1,R2 | POST /api/a/[id]]"), [
    { spec: "sample", rule: "R1", entrance: "POST /api/a/[id]" }, { spec: "sample", rule: "R2", entrance: "POST /api/a/[id]" }
  ]);
});

test("표: 통과는 ✅, 빈칸·실패는 ❌, 알려진 빈칸은 🟡, 예외는 ➖이고 고아 테스트는 경고다", () => {
  const spec = parseSpec(SPEC);
  const ok = (name, passed = true, todo = false) => ({ name, file: "x.test.ts", passed, todo });
  const matrix = buildMatrix([spec], [ok("a [spec:sample R1 | POST /api/a/[id]]"), ok("gap [spec:sample R1 | DELETE /api/b]", false, true), ok("orphan [spec:sample R7 | POST /api/a/[id]]")]);
  assert.deepEqual(matrix.tables[0].rows.map((row) => row.cells.map((cell) => cell.mark)), [["✅", "🟡"], ["❌", "➖"]]);
  assert.equal(matrix.failures.length, 1);
  assert.equal(matrix.warnings.length, 1);
  const filled = buildMatrix([spec], [ok("a [spec:sample R1 | POST /api/a/[id]]"), ok("gap [spec:sample R1 | DELETE /api/b]", true, true), ok("b [spec:sample R2 | POST /api/a/[id]]", false)]);
  assert.equal(filled.tables[0].rows[0].cells[1].status, "gap-filled");
  assert.ok(filled.failures.some((failure) => failure.startsWith("실패한 테스트")));
});

test("입구는 spec 또는 분류표에 있어야 하고, 코드에 없는 입구는 남기지 않는다", () => {
  const spec = parseSpec(SPEC);
  const errors = checkEntranceClassification([spec], { "GET /api/c": "미검토", "POST /api/gone": "해당 없음: 지움" }, ["POST /api/a/[id]", "DELETE /api/b", "GET /api/c", "PUT /api/new"]);
  assert.ok(errors.some((error) => error.includes("분류 안 된 입구: PUT /api/new")));
  assert.ok(errors.some((error) => error.includes("POST /api/gone")));
  assert.equal(errors.length, 2);
});

test("규칙 삭제·변경과 예외·빈칸 추가는 승인이 필요하고, 규칙 추가는 필요 없다", () => {
  const base = parseSpec(SPEC);
  const head = parseSpec(SPEC.replace("- **R2** 둘째 규칙.", "- **R2** 바뀐 규칙.\n- **R3** 새 규칙.").replace("- **R1 @ `DELETE /api/b`** — 고칠 예정.\n", ""));
  const review = reviewSpecChanges([base], [head], {}, {});
  assert.deepEqual(review.changes.map((change) => [change.weakening, change.text.split(" ")[0] + " " + change.text.split(" ")[1]]), [
    [true, "규칙 변경"], [false, "규칙 추가"], [false, "알려진 빈칸"]
  ]);
  assert.equal(reviewSpecChanges([base], [], {}, {}).changes[0].weakening, true);
  assert.deepEqual(reviewSpecChanges([], [], { "GET /api/x": "미검토" }, { "GET /api/x": "미검토", "POST /api/y": "미검토" }).newUnreviewed, ["POST /api/y"]);
  assert.deepEqual(reviewSpecChanges([], [], null, { "POST /api/y": "미검토" }).newUnreviewed, []);
});
