import { test } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, shiftDateString } from "./reminderDates";

test("shiftDateString: UTC 자정 기준 ±일", () => {
  assert.equal(shiftDateString("2026-11-19", -1), "2026-11-18");
  assert.equal(shiftDateString("2026-11-19", 7), "2026-11-26");
  assert.equal(shiftDateString("2026-11-30", 1), "2026-12-01");
});

test("addBusinessDays: 평일만 센다(주말 건너뜀)", () => {
  // 2026-11-16(월) +3영업일 = 화17·수18·목19 → 2026-11-19
  assert.equal(addBusinessDays("2026-11-16", 3), "2026-11-19");
  // 2026-11-19(목) +3영업일 = 금20·(토일 건너뜀)·월23·화24 → 2026-11-24
  assert.equal(addBusinessDays("2026-11-19", 3), "2026-11-24");
  // 금요일 +1영업일 = 다음 월요일
  assert.equal(addBusinessDays("2026-11-20", 1), "2026-11-23");
});

test("addBusinessDays: 공휴일도 건너뛴다(주입된 판정)", () => {
  // 2026-11-18(수)을 공휴일로 치면 월16 +3 = 화17·목19(수 건너뜀)·금20 → 2026-11-20
  const isHoliday = (d: string) => d === "2026-11-18";
  assert.equal(addBusinessDays("2026-11-16", 3, isHoliday), "2026-11-20");
});

test("addBusinessDays: count<=0 또는 잘못된 날짜면 그대로", () => {
  assert.equal(addBusinessDays("2026-11-16", 0), "2026-11-16");
  assert.equal(addBusinessDays("bad", 3), "bad");
});
