import assert from "node:assert/strict";
import { test } from "node:test";

import { describeCellUpdateError, prismaErrorCode } from "@/lib/admin/databaseCellError.ts";

test("Prisma 오류에서 code를 꺼낸다", () => {
  assert.equal(prismaErrorCode({ code: "P2002" }), "P2002");
  assert.equal(prismaErrorCode(new Error("boom")), null);
  assert.equal(prismaErrorCode(null), null);
  assert.equal(prismaErrorCode("P2002"), null);
  assert.equal(prismaErrorCode({ code: 2002 }), null);
});

test("기업명 중복은 합칠 수 없다는 것까지 알려준다", () => {
  // 실제로 났던 상황: "삼양식"을 이미 있는 "삼양식품"으로 바꾸려다 막혔다.
  const message = describeCellUpdateError({
    code: "P2002", table: "companies", field: "name", label: "기업명", value: "삼양식품"
  });
  assert.match(message, /이미 "삼양식품" 기업이 있습니다/);
  assert.match(message, /합칠 수는 없습니다/);
  assert.match(message, /과정을 옮겨야/);
});

test("멤버명 중복도 같은 안내를 쓴다", () => {
  const message = describeCellUpdateError({
    code: "P2002", table: "members", field: "name", label: "이름", value: "홍길동"
  });
  assert.match(message, /이미 "홍길동" 멤버가 있습니다/);
});

test("이름이 아닌 칼럼의 중복은 일반 문구로", () => {
  const message = describeCellUpdateError({
    code: "P2002", table: "courses", field: "courseId", label: "코스ID", value: "261578"
  });
  assert.match(message, /중복될 수 없습니다/);
  assert.doesNotMatch(message, /합칠 수는 없습니다/);
});

test("행이 사라진 경우는 새로고침을 안내한다", () => {
  const message = describeCellUpdateError({
    code: "P2025", table: "operation_sessions", field: "startDate", label: "시작일", value: "2026-09-01"
  });
  assert.match(message, /운영 회차를 찾을 수 없습니다/);
  assert.match(message, /새로고침/);
});

test("참조 제약은 참조 중이라고 알려준다", () => {
  const message = describeCellUpdateError({
    code: "P2003", table: "companies", field: "name", label: "기업명", value: "가온물산"
  });
  assert.match(message, /참조하고 있어/);
});

test("모르는 오류는 어떤 칼럼인지라도 알려준다", () => {
  const message = describeCellUpdateError({
    code: null, table: "courses", field: "revenue", label: "매출", value: "abc"
  });
  assert.match(message, /저장하지 못했습니다/);
  assert.match(message, /매출 값을 확인해 주세요/);
});

test("조사를 받침에 맞춘다", () => {
  // "멤버이"·"회차을"처럼 틀린 조사가 화면에 나가면 안내가 어설퍼 보인다.
  const company = describeCellUpdateError({ code: "P2002", table: "companies", field: "name", label: "기업명", value: "가온" });
  const member = describeCellUpdateError({ code: "P2002", table: "members", field: "name", label: "이름", value: "가온" });
  assert.match(company, /기업이 있습니다/);
  assert.match(company, /두 기업을 합칠/);
  assert.match(member, /멤버가 있습니다/);
  assert.match(member, /두 멤버를 합칠/);
});

test("영문 라벨에도 조사를 붙여 문장을 만든다", () => {
  // 한글이 아니면 받침을 판단할 수 없다. 던지지 않고 문장을 만들어 낸다.
  const message = describeCellUpdateError({ code: "P2002", table: "courses", field: "courseId", label: "courseId", value: "261578" });
  assert.match(message, /courseId는 중복될 수 없습니다/);
});
