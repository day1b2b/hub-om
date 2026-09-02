import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

// 공개 계층에 절대 새면 안 되는 민감(PII) 식별자.
//
// feedback(평가 한줄평)은 2026-07-23 공개 조회로 전환됐다(커밋 7c55530, 사용자 확인).
// 목록에서 빼지 않아 이 테스트가 그때부터 실패 상태로 방치돼 있었다 — CI가 단위 테스트를
// 돌리지 않아 드러나지 않았다. 결정은 이미 났으므로 테스트를 현실에 맞춘다.
// hiredByText·hiredById(섭외 관련)는 그 결정 범위가 아니어서 계속 금지로 남긴다.
const FORBIDDEN_PII_TOKENS = [
  "employeeId",
  "phone",
  "email",
  "birthDate",
  "affiliation",
  "hiredByText",
  "hiredById"
];

const PUBLIC_LAYER_FILES = ["prismaCoachRepository.ts", "coachRepository.ts"];

for (const file of PUBLIC_LAYER_FILES) {
  test(`공개 계층 ${file}에 민감(PII) 식별자가 등장하지 않는다`, () => {
    const source = readSource(file);

    for (const token of FORBIDDEN_PII_TOKENS) {
      // 공개 파일엔 민감 식별자가 select/return 어디에도 없어야 한다.
      // 주석에서 "select 안 함"으로 나열하는 경우만 허용한다(해당 라인은 검사에서 제외).
      const offendingLines = source
        .split("\n")
        .filter((line) => line.includes(token) && !isAllowedCommentMention(line, token));

      assert.equal(
        offendingLines.length,
        0,
        `${file}: 민감 식별자 "${token}"가 비-주석 위치에 등장함:\n${offendingLines.join("\n")}`
      );
    }
  });
}

test("coachPrivateAccess.ts는 fail-closed 게이트(assertCoachPiiAccess)를 호출한다", () => {
  const source = readSource("coachPrivateAccess.ts");
  assert.ok(
    source.includes("assertCoachPiiAccess"),
    "coachPrivateAccess.ts가 assertCoachPiiAccess를 참조하지 않음 — fail-closed PII 게이팅 누락"
  );
});

// 주석 라인에서 "...는 select 안 한다" 식으로 민감 식별자를 나열하는 것은 허용한다.
function isAllowedCommentMention(line: string, token: string): boolean {
  const trimmed = line.trim();
  const isComment = trimmed.startsWith("//") || trimmed.startsWith("*");
  if (!isComment) return false;

  // 주석이더라도 토큰이 실제로 포함돼 있어야 허용 대상이 된다.
  return line.includes(token);
}
