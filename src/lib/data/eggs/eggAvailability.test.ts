import assert from "node:assert/strict";
import test from "node:test";
import {
  getConflicts,
  getDeviceAvailability,
  getFreeRanges,
  getVisibleRentals,
  isDataExhaustedNow,
  searchAvailability
} from "./eggAvailability";
import { parseEggDeviceInput } from "./eggDeviceInput";
import { parseEggPartQuery } from "./eggTypes";
import type { EggDeviceSummary, EggRentalRecord } from "./eggTypes";

function device(overrides: Partial<EggDeviceSummary> = {}): EggDeviceSummary {
  return {
    id: "d1",
    part: "P3",
    number: 1,
    label: "1번",
    wifiName: "WIFI_TEST",
    serialNumber: "000",
    wifiPassword: "",
    modelCode: null,
    chargerType: "USB_C",
    speedMbps: null,
    storageLocation: "보관함",
    monthlyDataGb: 20,
    contractEndsOn: null,
    cautionNote: null,
    dataExhausted: false,
    dataExhaustedAt: null,
    dataExhaustedBy: null,
    ...overrides
  };
}

function rental(id: string, startDate: string, returnDueDate: string, returned = false): EggRentalRecord {
  return {
    id,
    eggDeviceId: "d1",
    borrowerName: "대여자",
    borrowerEmail: null,
    courseName: "과정",
    startDate,
    returnDueDate,
    actualUseNote: null,
    note: null,
    returned,
    returnedAt: returned ? `${returnDueDate}T09:00:00.000Z` : null
  };
}

test("상태 판정: 반납 예정일이 지난 미반납은 반납 지연으로 구분한다", () => {
  const today = "2026-10-28";
  assert.equal(getDeviceAvailability(device(), [rental("r1", "2026-10-20", "2026-10-25")], today), "overdue");
  assert.equal(getDeviceAvailability(device(), [rental("r1", "2026-10-27", "2026-10-29")], today), "rented");
  assert.equal(getDeviceAvailability(device(), [rental("r1", "2026-11-01", "2026-11-02")], today), "reserved");
  assert.equal(getDeviceAvailability(device(), [rental("r1", "2026-10-20", "2026-10-25", true)], today), "available");
});

test("데이터 소진 표시는 표시한 달이 지나면 풀린다", () => {
  const exhausted = device({ dataExhausted: true, dataExhaustedAt: "2026-10-05T01:00:00.000Z" });
  assert.equal(isDataExhaustedNow(exhausted, "2026-10-28"), true);
  assert.equal(isDataExhaustedNow(exhausted, "2026-11-01"), false);
});

test("기간 조회: 일부만 겹치면 비는 구간을 돌려준다", () => {
  const rentals = [rental("r1", "2026-11-03", "2026-11-04")];
  const conflicts = getConflicts(rentals, "d1", "2026-11-01", "2026-11-06");
  assert.equal(conflicts.length, 1);
  assert.deepEqual(getFreeRanges(conflicts, "2026-11-01", "2026-11-06"), [
    { from: "2026-11-01", to: "2026-11-02" },
    { from: "2026-11-05", to: "2026-11-06" }
  ]);
  const [result] = searchAvailability([device()], rentals, "2026-11-01", "2026-11-06", "2026-10-28");
  assert.equal(result.outcome, "partial");
  assert.equal(searchAvailability([device()], rentals, "2026-11-03", "2026-11-04", "2026-10-28")[0].outcome, "full");
});

test("상세 내역: 지난 반납 건은 직전 1건만 보여준다", () => {
  const rentals = [
    rental("old1", "2026-09-01", "2026-09-02", true),
    rental("old2", "2026-10-01", "2026-10-02", true),
    rental("late", "2026-10-20", "2026-10-21"),
    rental("next", "2026-11-01", "2026-11-02")
  ];
  assert.deepEqual(
    getVisibleRentals(rentals, "d1", "2026-10-28").map((item) => item.id),
    ["old2", "late", "next"]
  );
});

test("파트 쿼리와 기기 입력 검증", () => {
  assert.equal(parseEggPartQuery("3"), "P3");
  assert.equal(parseEggPartQuery("12"), "P12");
  assert.equal(parseEggPartQuery(undefined), "P12");

  const missingPart = parseEggDeviceInput({ number: 1, storageLocation: "보관함" });
  assert.equal(missingPart.ok, false);

  const usbEgg = parseEggDeviceInput({ part: "P3", number: 6, label: "USB 1번", storageLocation: "보관함", speedMbps: "31" });
  assert.equal(usbEgg.ok, true);
  if (usbEgg.ok) {
    assert.equal(usbEgg.value.wifiPassword, "");
    assert.equal(usbEgg.value.speedMbps, 31);
  }
});
