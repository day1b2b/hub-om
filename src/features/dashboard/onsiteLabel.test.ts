import assert from "node:assert/strict";
import { test } from "node:test";

import { calendarLabel, isOnsiteSupportForViewer } from "@/features/dashboard/onsiteLabel.ts";

test("현장운영 OM에만 내 이름이 있으면 지원 건이다", () => {
  assert.equal(isOnsiteSupportForViewer({ om: "가담당", onsiteOm: "나지원" }, "나지원"), true);
});

test("담당 OM이면 현장에 가더라도 지원 건이 아니다", () => {
  // 담당 OM이 현장에 가는 경우엔 "_현장운영지원"이 붙지 않아야 한다.
  assert.equal(isOnsiteSupportForViewer({ om: "나지원", onsiteOm: "나지원" }, "나지원"), false);
  assert.equal(isOnsiteSupportForViewer({ om: "나지원", onsiteOm: "" }, "나지원"), false);
});

test("담당·현장 양쪽에 이름이 여러 명이어도 담당이 우선한다", () => {
  assert.equal(isOnsiteSupportForViewer({ om: "가담당, 나지원", onsiteOm: "다지원, 나지원" }, "나지원"), false);
});

test("여러 명 중 현장운영에만 있으면 지원 건이다", () => {
  assert.equal(isOnsiteSupportForViewer({ om: "가담당, 다른이" , onsiteOm: "라지원, 나지원" }, "나지원"), true);
});

test("어느 칸에도 없으면 지원 건이 아니다", () => {
  assert.equal(isOnsiteSupportForViewer({ om: "가담당", onsiteOm: "다지원" }, "나지원"), false);
});

test("이름 표기 흔들림(괄호·공백·대소문자)을 흡수한다", () => {
  assert.equal(isOnsiteSupportForViewer({ om: "가담당", onsiteOm: " 나지원(1파트) " }, "나지원"), true);
  // 이름 뒤 영문자는 떼지 않는다 — A/B는 다른 사람이다.
  assert.equal(isOnsiteSupportForViewer({ om: "", onsiteOm: "나지원A" }, "나지원"), false);
});

test("내 이름이 없으면(명단 미등록) 지원 건으로 보지 않는다", () => {
  assert.equal(isOnsiteSupportForViewer({ om: "가담당", onsiteOm: "나지원" }, null), false);
  assert.equal(isOnsiteSupportForViewer({ om: "가담당", onsiteOm: "나지원" }, "  "), false);
});

test("캘린더 이름은 지원 건에만 표시를 붙인다", () => {
  assert.equal(calendarLabel("가온물산", true), "가온물산_현장운영지원");
  assert.equal(calendarLabel("가온물산", false), "가온물산");
});
