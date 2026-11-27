import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotionPageId } from "./notionPageLink";

test("노션 페이지 URL에서 32hex pageId를 뽑는다", () => {
  assert.equal(
    parseNotionPageId("https://www.notion.so/workspace/3b84576d6ffa802d9e23db654f1b31cd"),
    "3b84576d6ffa802d9e23db654f1b31cd"
  );
});

test("대시(-) 포함 ID를 정규화한다", () => {
  assert.equal(parseNotionPageId("3b84576d-6ffa-802d-9e23-db654f1b31cd"), "3b84576d6ffa802d9e23db654f1b31cd");
});

test("?v= 뷰 쿼리가 붙어도 (뷰 id가 아니라) 앞의 페이지 ID를 뽑는다", () => {
  assert.equal(
    parseNotionPageId("https://app.notion.com/p/3b84576d6ffa802d9e23db654f1b31cd?v=f0bb25c4d78349e586fd7630f68f457a"),
    "3b84576d6ffa802d9e23db654f1b31cd"
  );
});

test("대문자 hex도 소문자로 정규화", () => {
  assert.equal(parseNotionPageId("3B84576D6FFA802D9E23DB654F1B31CD"), "3b84576d6ffa802d9e23db654f1b31cd");
});

test("32hex가 없으면 null(잘못된 링크)", () => {
  assert.equal(parseNotionPageId("https://notion.so/not-a-valid-page"), null);
  assert.equal(parseNotionPageId(""), null);
  assert.equal(parseNotionPageId("3b84576d6ffa802d9e23db654f1b31"), null); // 30자리(짧음)
});
