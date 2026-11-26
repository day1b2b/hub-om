// 운영현황 '실습코치'(coachText) → MANUAL 투입 백필의 저장소 경계.
// 읽기(회차·기존투입·코치명부)와 쓰기(카탈로그 락 안의 트랜잭션)를 백엔드별 구현 뒤로 숨긴다.
// 기본 구현=Postgres(prismaSessionCoachSyncRepository). Mongo-shadow 구현은 override로 주입한다.
import type { ExistingSessionEngagement } from "../coaches/sessionCoachSync";
import type { SessionCoachWriter, SyncSessionInput } from "../coaches/sessionCoachSyncWorkflow";

export interface SessionCoachSyncInputs {
  /** 삭제되지 않은 회차 → 동기화 입력 형태로 매핑한 것. */
  sessions: SyncSessionInput[];
  /** operationSessionId별 기존 투입(생성/전환/취소 판단용). */
  existingBySession: Map<string, ExistingSessionEngagement[]>;
  /** 코치 명부 원본(동명이인 필터 전). 이름 해석은 커맨드가 한다. */
  coaches: ReadonlyArray<{ id: string; name: string }>;
}

export interface SessionCoachSyncRepository {
  /** 트랜잭션 밖 읽기: 회차·기존투입·코치명부를 한 번에 읽어 동기화 입력을 만든다. */
  readInputs(): Promise<SessionCoachSyncInputs>;
  /**
   * apply 전용 쓰기 경계: 코치 카탈로그 락을 잡은 백엔드 트랜잭션 안에서 write를 실행한다.
   * 청크 분할은 커맨드가 하고, 청크 1개 = withWriter 1회(=트랜잭션 1개)다.
   */
  withWriter<T>(write: (writer: SessionCoachWriter) => Promise<T>): Promise<T>;
}
