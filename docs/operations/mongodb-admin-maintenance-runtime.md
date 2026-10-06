# MongoDB 관리자 유지보수 runtime

과정 조회·소프트 삭제, 삭제 운영 조회·복원, onsite·OM 배정 보정과 요청 감사를 같은 명시 Mongo shadow runtime으로 조립한다. `courseAdmin`, `deletedOperations`, `operationBackfill`, `requestActivity`는 하나의 borrowed client/database/namespace와 등록·잠금 scope를 사용하며 생산 기본 PostgreSQL은 유지한다.

새 빈 shadow만 request audit→course admin→deleted operations→operation backfill 순서로 준비한다. 준비된·부분 준비된 namespace는 자동 수리·삭제하지 않는다. 로컬 MongoDB 8.0.30에서 실제 과정 조회→삭제→삭제 목록→복원→두 보정의 연속 흐름, 업무/요청 감사, 암호화 저장, 준비 재실행·중단 불변, 포트 누락·중첩 차단과 DB/client 소유권을 확인했다.

브라우저 전체 상호작용, production selector, 운영 namespace·부하, 실데이터 이전·복원·최종 전환은 검증하지 않았다.
