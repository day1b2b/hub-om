# MongoDB 코치 포털 runtime

토큰 기반 코치 본인 조회와 월별 일정 조회·저장, 요청 감사를 같은 명시 Mongo shadow runtime으로 조립한다. `coachToken`, `coachSchedule`, `requestActivity`는 하나의 borrowed client/database/namespace와 등록·잠금 scope를 사용하며 생산 기본 PostgreSQL은 유지한다.

새 빈 shadow만 준비하고 기존·부분 준비 namespace는 자동 수리·삭제하지 않는다. 로컬 MongoDB 8.0.30에서 실제 API로 토큰 본인 조회, 일정 조회→교체→재조회, 무토큰 거부, 요청·업무 감사, 암호화 저장, scope 분해·중첩 차단과 준비 중단 재실행 불변을 확인했다.

브라우저 전체 상호작용, production selector, 실제 외부 원천·운영 namespace, 실데이터 이전·복원·최종 전환은 검증하지 않았다.
