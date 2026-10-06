# 강사 위키 쓰기 API Mongo composition

2026-10-01 기준 `/api/instructor-wiki/save`와 `/api/instructor-wiki/link`를 `INSTRUCTOR_WIKI_BACKEND` selector에 연결했다. 기본값은 PostgreSQL이며, 정확히 `mongodb-shadow`를 선택한 검증 context에서만 `instructorNote`와 `requestActivity`를 같은 잠금 scope로 연다.

기존 권한과 응답 계약은 유지한다. 메모 저장은 workspace 세션을 요구하고 수동 연결은 관리자만 허용한다. 승인된 응답에는 저장한 메모나 연결 대상 이름이 포함될 수 있지만, Mongo의 `InstructorNote`, `ActivityChange`, `ActivityRequest`에는 강사명·메모·Notion ID·actor 정보가 평문으로 남지 않는다. 이 API는 외부 Notion 호출을 하지 않고 이미 동기화된 노트만 조회한다.

실제 loopback MongoDB replica set에서 저장·부분 병합·수동 연결·권한 거절·요청/업무 감사, PostgreSQL fallback 0건과 부분 namespace 무수정 거부를 확인했다. selector를 운영에 설정하거나 실제 데이터·Notion을 사용하지 않았다. production 배포, 운영 shadow 복사·A/B 백업 및 복원, 최종 전환은 미완료다.
