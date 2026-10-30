import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "@/lib/data/operationTypes";
import { courseLinkValue } from "./courseLinkSource";

function round(operationId: string, driveLink = "", operationDetail = ""): OperationSession {
  return { operationId, driveLink, operationDetail } as OperationSession;
}

test("과정의 회차 중 값이 있는 첫 회차 값을 과정 값으로 본다 — 어느 회차를 열어도 같다", () => {
  const rounds = [round("r1"), round("r2"), round("r3", "https://drive/r3", "https://syncup/r3"), round("r4", "", "https://syncup/r4")];
  assert.equal(courseLinkValue(rounds, "operationDetail"), "https://syncup/r3");
  assert.equal(courseLinkValue(rounds, "driveLink"), "https://drive/r3");
});

test("과정 전체에 값이 없으면 빈 값", () => {
  assert.equal(courseLinkValue([round("r1", "  "), round("r2")], "driveLink"), "");
});

test("링크 칸이 비어 있어도 메모 안의 주소를 열기 링크로 찾는다", async () => {
  const { findLinkHref } = await import("@/lib/links");
  assert.equal(findLinkHref("", "강의관리 시트: https://docs.google.com/x/edit#gid=1 참고"), "https://docs.google.com/x/edit#gid=1");
  assert.equal(findLinkHref("https://a.example/1", "https://b.example/2"), "https://a.example/1");
  assert.equal(findLinkHref("", "주소 없음"), null);
});
