# MongoDB 운영 화면 runtime

운영 목록, 운영 상세, 신규 운영 작성 화면의 서버 조회를 하나의 명시 Mongo shadow runtime으로 조립한다. `operations`, `teamUsers`, `teamMembers`, `instructorNote`, `coach`, `omRequests`는 같은 borrowed client/database/namespace를 사용한다. 맞춤 도구 목록은 저장소를 새로 만들지 않고 호출자가 명시적으로 제공한 `omCustomTools` port를 사용한다.

`prepareMongoOperationPagesRuntime`은 새 합성 shadow를 준비하는 검증 전용 함수다. `openMongoOperationPagesRuntime`은 준비된 상태만 열며 collection, validator, index를 생성·수정·삭제하지 않는다. 등록한 repository 묶음은 실행 중 잠가 일부 port만 다른 namespace로 교체하는 구성을 차단한다. 생산 기본 backend와 factory의 PostgreSQL fallback은 바꾸지 않았다.

로컬 MongoDB 8.0.30 replica set에서 실제 `/operations`, `/operations/[operationId]`, `/operations/new` page 함수를 실행해 목록, 담당자 명단, 강사·코치 선택지와 맞춤 도구를 확인했다. 조회 전후 전체 Mongo snapshot은 같았고 PostgreSQL 접속 주소는 실패 tripwire로 두었다. 불완전한 namespace는 일반 open이 거부하고 저장 상태를 변경하지 않는 것도 확인했다.

이번 범위는 세 화면의 초기 서버 조회 조립이다. 운영 생성·수정·삭제 API, Calendar 반영, 요청 감사, 브라우저 상호작용, production selector, 운영 namespace와 실제 데이터는 포함하지 않는다. 실제 A/B 백업·각 복원·복사·최종 전환과 `dev`→`main` 병합 조건도 아직 충족하지 않았다.
