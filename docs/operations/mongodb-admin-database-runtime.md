# MongoDB 관리자 DB runtime

관리자 DB 페이지와 셀 수정 API의 `adminDatabase`, `teamMembers`, `requestActivity`를 같은 명시 Mongo shadow runtime으로 조립한다. 담당자 범위 계산, 셀 수정, 업무 감사와 요청 감사가 같은 client/database/namespace에 귀속되며 생산 기본 PostgreSQL은 유지한다.

새 빈 shadow만 request audit→admin database→team read 순서로 준비한다. 준비된 namespace는 mutation 없이 전체 readiness를 확인하고 부분 준비·오래된 정책은 자동 수리·삭제하지 않는다. 등록 scope의 포트 누락과 다른 namespace 중첩 전환은 callback 전에 차단한다.

로컬 MongoDB 8.0.30에서 실제 페이지와 PATCH handler, 파서·권한·8개 테이블 props·조건부 panel·셀 타입·업무/요청 감사·rollback·요청 감사 best-effort·평문 비노출·PG/local/external 0을 확인했다. 준비 재실행, TeamUser 준비 중단 후 재실행 불변, borrowed client와 합성 DB 소유권도 검증했다.

브라우저 전체 상호작용, production selector, 운영 namespace·부하, 실데이터 이전·복원·최종 전환은 검증하지 않았다.
