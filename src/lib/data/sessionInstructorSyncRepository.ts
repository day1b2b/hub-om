// 운영현황 '강사'(instructorsText) → MANUAL 투입 백필/입력반영의 저장소 경계.
// 읽기(회차·기존투입·강사명부)와 쓰기(카탈로그 락 안의 트랜잭션)를 백엔드별 구현 뒤로 숨긴다.
// 기본 구현=Postgres(prismaSessionInstructorSyncRepository). Mongo-shadow 구현은 override로 주입한다.
// 코치 sessionCoachSyncRepository 미러(coachId↔instructorNoteId, 명부=코치DB↔InstructorNote).
import type { ExistingSessionInstructorEngagement } from "../instructors/sessionInstructorSync";
import type { ApplySessionInstructorsResult, SessionInstructorWriter, SyncInstructorSessionInput } from "../instructors/sessionInstructorSyncWorkflow";

export interface SessionInstructorSyncInputs {
  /** 삭제되지 않은 회차 → 동기화 입력 형태로 매핑한 것. */
  sessions: SyncInstructorSessionInput[];
  /** operationSessionId별 기존 투입(생성/전환/취소 판단용). */
  existingBySession: Map<string, ExistingSessionInstructorEngagement[]>;
  /** 강사 명부 원본(동명이인 필터 전, InstructorNote). 이름 해석은 커맨드가 한다. */
  instructors: ReadonlyArray<{ id: string; name: string }>;
}

export interface SessionInstructorSyncRepository {
  /** 트랜잭션 밖 읽기: 회차·기존투입·강사명부를 한 번에 읽어 동기화 입력을 만든다. */
  readInputs(): Promise<SessionInstructorSyncInputs>;
  /**
   * apply 전용 쓰기 경계: 강사 카탈로그 락을 잡은 백엔드 트랜잭션 안에서 write를 실행한다.
   * 청크 분할은 커맨드가 하고, 청크 1개 = withWriter 1회(=트랜잭션 1개)다.
   */
  withWriter<T>(write: (writer: SessionInstructorWriter) => Promise<T>): Promise<T>;
  /**
   * 입력 반영: 한 회차의 강사 투입을 '위키에서 선택된 instructorNoteId 집합'으로 맞춘다.
   * 그 회차의 기존 투입을 읽고 적용하는 과정을 한 트랜잭션(카탈로그 락) 안에서 수행한다.
   */
  setSessionInstructors(operationSessionId: string, instructorNoteIds: ReadonlyArray<string>, today: Date): Promise<ApplySessionInstructorsResult>;
}
