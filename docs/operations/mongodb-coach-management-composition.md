# 코치 관리 API Mongo composition

2026-10-01 기준 코치 목록·생성 API와 코치 단건 조회·수정·상태 변경·삭제 API에 `COACH_MANAGEMENT_BACKEND` selector를 연결했다. 기본값은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 coach-management 저장소와 request audit를 하나의 등록·잠금 shadow scope로 연다.

실제 로컬 MongoDB replica set에서 여섯 handler를 연속 실행해 생성·조회·수정·삭제와 요청 감사 6건을 확인했다. Mongo 선택 중 PostgreSQL 접근은 차단했고, 저장된 감사와 문서에 합성 이름·이메일 평문이 없는지 확인했다. 인증 redirect/notFound는 Next.js 제어 흐름 객체를 그대로 보존하며, 부분 준비된 namespace는 자동 수리하거나 변경하지 않는다.

운영 selector 설정, 운영 데이터 복사, 브라우저 전체 흐름, A/B 백업과 각 복원, 최종 전환은 완료하지 않았다. 생산 기본 backend는 계속 PostgreSQL이다.
