// 회차 순서 바꾸기(드래그) 계획을 세우는 순수 함수.
//
// 회차는 별개의 운영 행이고 순서는 roundNo로만 정해진다. 그래서 "순서 바꾸기"는 곧
// **번호를 다시 매기는 일**이다. 결과는 항상 1부터 연속이다 — 이혜림님이 정한 "회차는
// 순차 등록" 규칙을 넣는 순간이 아니라 결과로 지킨다. 덕분에 원천 적재나 삭제로 앞 회차가
// 비어 있던 과정(2회차부터 시작하던 과정)도 한 번 옮기면 구멍이 메워진다.
//
// 1회차가 사라질 수 없다는 규칙도 여기서 함께 지켜진다 — 회차가 하나라도 있으면 첫 자리는
// 반드시 1회차다. 삭제 쪽 가드는 api/operations/[operationId]/route.ts에 있다.

export interface RoundReorderSibling {
  operationId: string;
  roundNo: string;
}

export interface RoundReorderChange {
  fromRoundNo: string;
  operationId: string;
  toRoundNo: string;
}

export type RoundReorderPlan =
  | { changes: RoundReorderChange[]; ok: true }
  | { error: string; ok: false };

/**
 * 새 순서(orderedOperationIds)대로 1..N을 다시 매긴다.
 *
 * orderedOperationIds는 같은 과정 회차 전체의 **순열**이어야 한다. 일부만 보내면 나머지
 * 번호를 어떻게 할지 서버가 추측해야 하므로 아예 거절한다(운영 데이터를 짐작으로 쓰지 않는다).
 */
export function planRoundReorder(
  siblings: RoundReorderSibling[],
  orderedOperationIds: string[]
): RoundReorderPlan {
  if (siblings.length === 0) return { error: "순서를 바꿀 회차가 없습니다.", ok: false };

  const byId = new Map(siblings.map((sibling) => [sibling.operationId, sibling]));
  const seen = new Set<string>();

  for (const operationId of orderedOperationIds) {
    if (!byId.has(operationId)) {
      return { error: "이 과정의 회차가 아닌 항목이 순서에 들어 있습니다.", ok: false };
    }
    if (seen.has(operationId)) {
      return { error: "같은 회차가 순서에 두 번 들어 있습니다.", ok: false };
    }
    seen.add(operationId);
  }

  if (seen.size !== siblings.length) {
    return {
      error: `회차 ${siblings.length}건 전부의 순서를 보내야 합니다 (받은 것: ${seen.size}건).`,
      ok: false
    };
  }

  const changes = orderedOperationIds.flatMap((operationId, index) => {
    const sibling = byId.get(operationId);
    const toRoundNo = String(index + 1);

    if (!sibling || sibling.roundNo === toRoundNo) return [];

    return [{ fromRoundNo: sibling.roundNo, operationId, toRoundNo }];
  });

  return { changes, ok: true };
}

/**
 * 목록에서 한 건을 다른 자리로 옮긴 순서를 만든다. 드래그 한 번이 이 함수 한 번이다.
 * toIndex는 "옮긴 뒤 그 항목이 있어야 하는 자리"다. 범위를 벗어나면 양 끝으로 붙인다.
 */
export function moveRoundInOrder(operationIds: string[], operationId: string, toIndex: number): string[] {
  const fromIndex = operationIds.indexOf(operationId);
  if (fromIndex < 0) return [...operationIds];

  const rest = operationIds.filter((candidate) => candidate !== operationId);
  const target = Math.max(0, Math.min(toIndex, rest.length));

  return [...rest.slice(0, target), operationId, ...rest.slice(target)];
}
