# MongoDB 운영 쓰기 runtime

운영 생성, 회차 추가, 회차 순서 변경, 회차 삭제 API를 Calendar 반영과 요청 감사까지 포함한 하나의 명시 Mongo shadow runtime으로 조립한다. 기존 `MongoCalendarRuntime`의 `operations`를 `CalendarReflectingOperationRepository`로 열어 Mongo 업무 저장이 끝난 뒤 합성 Calendar에 반영하며, `requestActivity`, Calendar mapping·lease, 팀 명단은 같은 borrowed client/database/namespace를 사용한다.

`prepareMongoOperationWriteRuntime`은 완전히 빈 shadow namespace에서만 기존 Calendar runtime store를 준비한다. namespace 접두사의 collection이 하나라도 있으면 현재 계약에 없는 legacy 이름이어도 schema를 만들거나 고치지 않고 일반 open readiness만 수행한다. `openMongoOperationWriteRuntime`은 환경변수로 backend를 선택하지 않고 준비된 명시 옵션만 연다. 생산 factory와 기본 PostgreSQL backend는 바꾸지 않았다.

로컬 MongoDB 8.0.30 replica set과 독립 합성 Calendar HTTP remote에서 실제 운영 생성 POST, 회차 추가 POST, 순서 변경 POST, 삭제 DELETE를 순서대로 실행했다. 각 API의 성공 응답과 request audit, Calendar 이벤트·mapping, 마지막 soft-delete를 확인했다. Calendar 생성 실패에서는 업무 저장과 200 응답을 유지하고 후속 회차 순서 변경이 빠진 일정을 중복 없이 복구했다. Calendar 삭제 실패에서는 soft-delete와 200 응답을 유지하고 원격 이벤트·mapping을 남겨 유실을 피한다. 동일 DELETE는 업무 행을 다시 쓰지 않고 남은 mapping의 Calendar 삭제만 재시도하며, 성공하면 mapping도 제거한다. mapping이 없는 삭제 완료 행이나 존재하지 않는 ID는 기존처럼 404다.

감사 문서는 route·method·status·actorType과 복호화가 승인된 actor 값을 확인했고 raw BSON에는 actor·기업·과정·담당자 평문이 없음을 확인했다. 감사 저장 validator를 의도적으로 실패시켜도 업무 전 검증의 400 응답은 유지됐다. 회차 순서 변경 로그는 사용자 이메일·업무 식별자·원문 예외 대신 요청 ID와 변경 건수, 고정 오류 코드만 기록한다. 준비된 namespace 재실행, 부분 namespace, 계약 밖 legacy collection만 있는 namespace에서는 준비 변경 명령이 없었고 PostgreSQL adapter·pool과 비합성 외부 fetch 호출은 0건이었다.

이번 범위는 위 네 쓰기 API의 실행 조립이다. 운영 상세의 Drive 적용·원천 새로고침, 만족도·OM 배정 등 이미 별도 검증한 writer를 이 runtime에 추가로 묶지 않는다. 실제 Google, 운영 데이터·namespace·부하, production selector, 배포 설정, A/B 백업·각 복원·복사·최종 전환은 검증하지 않았다. `dev`→`main` 조건도 아직 충족하지 않았다.
