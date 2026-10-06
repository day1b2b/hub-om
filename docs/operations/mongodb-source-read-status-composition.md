# MongoDB 원천 읽기 상태 선택 경계

`/api/source-reads/status`는 기능 단위 composition root에서 저장소를 선택한다. `SOURCE_READ_STATUS_BACKEND`가 비어 있거나 `postgres`이면 기존 PostgreSQL 경로를 그대로 사용하고, 정확히 `mongodb-shadow`일 때만 준비된 Mongo shadow runtime을 연다.

Mongo 선택은 요청 감사와 원천 reader를 같은 scope에 넣는다. URI·database·namespace·활성 암호화 키·HMAC 키를 먼저 검증하고, 그 뒤에만 원천 reader와 Mongo client를 연다. 잘못된 selector, 누락·부분 설정, 부분 namespace, scope 혼입, 키 누락·불일치는 업무 처리와 저장 전에 비공개 오류로 실패하며 PostgreSQL로 fallback하지 않는다. runtime은 기존 namespace를 준비·수리·삭제하지 않는다.

합성 PostgreSQL 17에서 기본 선택과 감사 저장을, MongoDB 8.0.30 replica set에서 명시 선택·감사 저장·외부 fetch/PG 접근 0·부분 namespace 불변·키 누락 차단을 확인했다. 전체 회귀는 1,169 pass / 146 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7이다. 독립 리뷰는 P0 0 / P1 0 / P2 0 / P3 0이다.

이 변경은 첫 기능군 selector 한 개다. 배포 설정은 바꾸지 않았고 생산 기본값은 PostgreSQL이다. 다른 API·화면·CLI·예약 작업의 selector, 실제 원천, 운영 namespace·키·권한, A/B 백업과 각 복원, 실데이터 복사, 최종 전환과 `dev → main`은 아직 완료되지 않았다.
