# OM 요청 쓰기 Mongo composition

OM 요청 생성·수정·삭제와 배정 미리보기·확정 API에 `OM_REQUEST_WRITE_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 Calendar-aware runtime을 open-only로 연다. 요청 저장소·운영·배정·Calendar·맞춤 도구·알림·요청 감사를 같은 잠금 scope에서 사용한다.

실제 MongoDB 8.0.30에서 생성→수정→배정 미리보기→확정→삭제를 실제 route export로 실행했다. 맞춤 도구·접수 알림·배정 Calendar·배정 알림의 호출과 payload를 확인했고, 각 effect 실패 뒤에도 핵심 생성 201·배정 200과 저장 상태가 유지됐다. PostgreSQL 및 scope 밖 외부 호출은 0건이고, 오류 원문은 로그에 남지 않았으며 부분 namespace는 무수정으로 거부됐다.

실제 Slack·Google Calendar·production 배포·운영 데이터·브라우저 전체 흐름·A/B 백업과 복원·복사·최종 전환은 미완료다.
