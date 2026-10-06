# 코치 메모 API Mongo composition

2026-10-01 기준 코치 메모 목록·생성 API를 기존 `CHANGES_BACKEND` selector에 연결했다. 기본값은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 changes runtime의 coachContent·requestActivity 잠금 scope를 연다. 메모 수정·삭제와 같은 경계를 사용한다.

실제 로컬 MongoDB replica set에서 목록·생성 handler의 요청 감사, 생성 업무 감사, 암호화 저장, PostgreSQL 접근 0건과 부분 namespace 전체 snapshot 불변을 확인했다. 운영 selector·운영 데이터·브라우저 전체 흐름·A/B 복원·최종 전환은 미완료다.
