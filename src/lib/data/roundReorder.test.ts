import assert from "node:assert/strict";
import { test } from "node:test";

import { moveRoundInOrder, planRoundReorder } from "@/lib/data/roundReorder.ts";

function siblings(...roundNumbers: string[]) {
  return roundNumbers.map((roundNo, index) => ({ operationId: `OP-${index + 1}`, roundNo }));
}

test("마지막 회차를 맨 위로 옮기면 1회차가 되고 나머지가 한 칸씩 밀린다", () => {
  const plan = planRoundReorder(siblings("1", "2", "3"), ["OP-3", "OP-1", "OP-2"]);

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && plan.changes, [
    { fromRoundNo: "3", operationId: "OP-3", toRoundNo: "1" },
    { fromRoundNo: "1", operationId: "OP-1", toRoundNo: "2" },
    { fromRoundNo: "2", operationId: "OP-2", toRoundNo: "3" }
  ]);
});

test("앞 회차가 비어 있던 과정은 한 번 옮기면 1부터 연속이 된다", () => {
  // 제보 사례: 2~4회차만 있는 과정. 마지막에 5회차를 추가한 뒤 맨 위로 끌면
  // 그 회차가 1회차가 되고 나머지는 번호가 그대로다(구멍이 메워진다).
  const plan = planRoundReorder(siblings("2", "3", "4", "5"), ["OP-4", "OP-1", "OP-2", "OP-3"]);

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && plan.changes, [{ fromRoundNo: "5", operationId: "OP-4", toRoundNo: "1" }]);
});

test("제자리에 놓으면 바꿀 것이 없다", () => {
  const plan = planRoundReorder(siblings("1", "2", "3"), ["OP-1", "OP-2", "OP-3"]);

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && plan.changes, []);
});

test("회차 일부만 보내면 거절한다(나머지 번호를 짐작하지 않는다)", () => {
  const plan = planRoundReorder(siblings("1", "2", "3"), ["OP-1", "OP-2"]);

  assert.equal(plan.ok, false);
  assert.match(plan.ok === false ? plan.error : "", /전부의 순서/);
});

test("다른 과정의 회차나 중복이 섞이면 거절한다", () => {
  const foreign = planRoundReorder(siblings("1", "2"), ["OP-1", "OP-99"]);
  assert.equal(foreign.ok, false);

  const duplicated = planRoundReorder(siblings("1", "2"), ["OP-1", "OP-1"]);
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.ok === false ? duplicated.error : "", /두 번/);
});

test("moveRoundInOrder는 뽑아낸 뒤 그 자리에 넣는다", () => {
  assert.deepEqual(moveRoundInOrder(["a", "b", "c", "d"], "d", 1), ["a", "d", "b", "c"]);
  assert.deepEqual(moveRoundInOrder(["a", "b", "c", "d"], "a", 4), ["b", "c", "d", "a"]);
  assert.deepEqual(moveRoundInOrder(["a", "b", "c"], "b", 1), ["a", "b", "c"]);
});

test("범위를 벗어난 자리는 양 끝으로 붙인다", () => {
  assert.deepEqual(moveRoundInOrder(["a", "b", "c"], "c", -5), ["c", "a", "b"]);
  assert.deepEqual(moveRoundInOrder(["a", "b", "c"], "a", 99), ["b", "c", "a"]);
});
