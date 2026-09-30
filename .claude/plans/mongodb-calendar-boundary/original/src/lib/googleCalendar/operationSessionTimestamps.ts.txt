// 회차의 최종 수정 시각만 읽는 좁은 조회.
//
// 역반영은 "구글 이벤트가 더 최근인가, 운영현황이 더 최근인가"로 승자를 정해야 하는데
// 표준 OperationSession 타입에는 updatedAt이 없다. 화면에 쓰이는 타입을 넓히는 대신
// 이 모듈에서 필요한 컬럼 하나만 읽는다.

import { getPrismaClient } from "@/lib/data/prisma";

export async function findOperationUpdatedAt(operationIds: string[]): Promise<Map<string, Date>> {
  if (operationIds.length === 0) return new Map();

  const rows = await getPrismaClient().operationSession.findMany({
    where: { operationId: { in: operationIds } },
    select: { operationId: true, updatedAt: true }
  });

  return new Map(rows.map((row) => [row.operationId, row.updatedAt]));
}
