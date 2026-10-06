# 실행 매니페스트

기준 `74e1970`, `feature/20260929-mongodb-om-assignment`, 격리 clone에서 작업. 원본 workspace와 운영 설정은 무수정.

|계획 단계|구현·증거|
|--|--|
|원본 보존|omAssignmentOriginal.fixture.ts byte freeze 및 SHA 고정|
|공통 계약/PG|omAssignmentContract.ts의 exact 생성집합·서명·상태전이, omRequestAssignment.ts의 기존 PG Serializable adapter|
|Mongo|mongoOmAssignmentRepository.ts의 기존 restore guard·부분쓰기·암호화/HMAC·원자적 감사·재시도와 시간 상한|
|진입점|dataRepositoryContext, omAssignmentEffects, 실제 assign route. 필수 port 선확인과 후속 실패 로그 비노출|
|검증|PG original/newPG/Mongo oracle, native repository, 실제 8 writer/restore/metadata 경쟁, 실제 handler·권한·retention·후속, 기존 UI 단위|
|인계|coverage/macro 및 최종 실행·리뷰·통합 기록은 최종 결과에 맞춰 갱신|

기존 guard 파일은 공유 목적 주석만 변경한다. 접수 테스트와 boundary 기대값은 이전 전체 차단 대신 필수 port 누락을 검증하며, 확인 없는 legacy helper 둘은 계속 차단한다.

2026-09-30 재개: 코드 보존, 이전 임시 로그 소실로 새 격리 실행. 발견/보완은 gap-plan, 실제 수락 상태는 execution-review와 handoff를 따른다. 검증 통과 전 commit/push 없음.
