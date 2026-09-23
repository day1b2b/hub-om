# 배정 확인 팝업 통합 인계

2026-09-21 사용자 승인: 배정 변경/취소 전에 영향 회차를 확인하고, 승인하면 수동 배정을 포함해 모두 변경한다. 취소 승인 시 연결 회차 담당자를 모두 비운다. 운영 반영은 실행하지 않았다.

## 사용자 동작

요청 상세의 저장/배정 취소 → 서버에서 영향 회차 조회 → 회차 수·현재 담당자·새 담당자 또는 해제 안내 → 돌아가기 또는 최종 확인.
돌아가기는 업무 데이터를 쓰지 않는다. 조회/저장 실패 시 오류를 표시하고 재시도할 수 있다. 확인 중에는 중복 실행을 막는다. 팝업 이후 대상·팀·담당자가 변경됐거나 확인이 만료되면 다시 확인해야 한다.

수동으로 지정했던 담당자 이름과 계정 지정도 변경 대상이다. 이름 기반 기존 배정 계약을 유지하며 새 담당자 이름 설정과 함께 기존 omUserId를 해제한다. 취소는 두 값을 모두 비운다. 완료 회차의 상태는 유지한다. 요청과 연결 회차는 하나의 Serializable 트랜잭션에서 변경한다. 외부 캘린더/알림은 커밋 후 기존 처리이며 이번 검증에서 실제 전송하지 않았다.

## 정확한 범위와 제한

DB에 요청의 하위 회차 FK 목록은 없고 대표 operationId만 있다. 대표 회차와 동일 요청 생성 이벤트의 activity requestId/route/method/action/targetId로 연결을 확정한다. 개인정보 changes.before/after는 읽지 않으며 마스킹 정책을 유지한다. 같은 courseRecordId나 같은 이름만으로 전체 회차를 포함하지 않는다.

따라서 팝업은 **이 요청 접수 시 생성된 연결 회차**를 뜻한다. 나중에 같은 과정에 추가한 별도 회차는 요청 연결 근거가 없어 자동 포함하지 않는다. 미연결·생성 감사 누락/중복·부분 생성·일정 수 불일치·삭제된 회차가 있으면 일부만 변경하지 않고409로 안내한다. 기존 과거 요청은 연결 확인이 필요할 수 있다. 로컬 JSON 모드에서는 원자성을 보장하지 못해 미리보기/저장을 거부한다.

## 구현 계약

- POST /api/om-request/assign: JSON id/assignedOm, 권한 검사 후 preview. 이름을 URL에 넣지 않는다.
- PATCH 같은 경로: id/assignedOm/confirmationToken. 권한을 다시 확인하고 tx 안에서 최신 snapshot 검증 후 쓴다.
- token: 10분 만료시각+HMAC만 반환. 로그인 주체/선택OM/요청과 대상회차 상태에 묶고 UI 메모리에서만 보관한다. AUTH_SECRET 또는 NEXTAUTH_SECRET이 없으면 발급하지 않는다.
- 응답 Cache-Control: no-store. 서버 이메일과 관리자 명단 기준의 검증된 보안 helper를 preview/write/page에 await 적용.
- 새 DB 필드/마이그레이션/의존성 없음. API 계약 변경이므로 머지 전 데이터/기술 책임자 검토 대상.

## 구성과 검증

브랜치 fix/20260921-assignment-confirmation-integration, 기준53abfc7(개인정보 암호화+로컬 저장 통합). 기능 담당 브랜치의 이번 F3 범위만 이식했다. 이전 기능 브랜치의 브라우저 평문 snapshot은 가져오지 않았다.
추가 독립 테스트 src/lib/privacy/om-assignment.test.ts는 실제 withPrivacyDatabase 어댑터와 암호문 raw fixture로 preview/재배정/취소/기존token거부/DONE유지/저장실패 롤백을 확인한다. 실제 DB 서버 검증과는 구분한다.
Node24.19.0: 전체609개 중605pass/4 DBskip/0fail, lint0error/기존7warning, typecheck pass. build pass. [명령 실행 근거](../../.claude/plans/assignment-confirmation-integration/test.txt).
담당자가 실제 AssignForm을 사용하는 합성 브라우저 화면에서 돌아가기 쓰기0, 확인 변경, 전체 해제,409 재확인, 네트워크 실패 재시도를 검증. [화면 및 총괄 검토](../../.claude/plans/assignment-confirmation-integration/review.md)를 참고한다.

미검증: 실제 PostgreSQL 동시 실행·활동 트리거 포함 end-to-end, 실제 사용자 로그인 전환, 운영 데이터 적용, Coolify 배포. 운영 파일/DB/키/원격push/merge 변경 없음. DB4skip은 활동 트리거·과정명 복원·캘린더잠금·PII migration.

## 다음 작업

통합 담당자는 이 브랜치에서 이번 F3 파일과 기존53abfc7을 함께 보존하고 API/권한 검토 및 격리 DB 검증을 진행한다. 기존 자동/수동 소유권 판별 코드로 되돌리지 않는다. 이름 마스킹을 풀거나 같은 과정 전체로 대상을 확장하지 않는다.
브라우저 초안 암호화의 암호 없는 복구 방식 검토, 전체 보안 변경 통합, Mongo 이전은 이번 완료 범위가 아니다.
