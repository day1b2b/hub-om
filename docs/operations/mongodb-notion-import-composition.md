# MongoDB Notion 가져오기 선택 경계

`/api/admin/imports/notion/import`는 기능 단위 composition root에서 저장소를 선택한다. `NOTION_IMPORT_BACKEND`가 비어 있거나 `postgres`이면 검증된 기존 PostgreSQL 경로를 그대로 사용하고, 정확히 `mongodb-shadow`일 때만 준비된 Mongo shadow runtime을 연다.

Mongo 선택은 import staging·팀 명단·강사노트·요청 감사·기존 Notion source를 같은 잠금 scope에 넣는다. URI·database·namespace·활성 암호화 키·HMAC 키를 인증과 원천 호출 전에 검증한다. 잘못된 selector·부분 설정·부분 namespace·scope 혼입은 쓰기 전에 고정 오류로 실패하고 PostgreSQL로 fallback하지 않는다. production 요청은 namespace를 준비·수리·삭제하지 않는다.

합성 PostgreSQL 17에서 기본 선택의 실제 Notion 파싱·암호화 staging·요청 감사를, MongoDB 8.0.30 replica set에서 명시 선택의 동일 흐름·PG 접근 0·부분 namespace 불변을 확인했다. 전체 회귀는 1,174 pass / 148 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7이다. 독립 리뷰는 P0 0 / P1 0 / P2 0 / P3 0이다.

실제 Notion에는 접근하지 않았고 합성 HTTP 응답만 사용했다. 배포 설정과 생산 기본값은 변경하지 않았다. 다른 기능군 selector, 운영 namespace·키·권한, A/B 백업과 각 복원, 실데이터 복사, 최종 전환과 `dev → main`은 아직 완료되지 않았다.
