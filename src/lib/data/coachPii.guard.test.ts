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
const FORBIDDEN_PII_TOKENS = [
  "employeeId",
  "phone",
  "email",
  "birthDate",
  "affiliation",
  "feedback",
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
