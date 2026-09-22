# MongoDB 강사 노트 병렬 저장소

`MongoInstructorNoteRepository`는 기존 5개 메서드를 제공하며 생산 factory에는 연결하지 않는다. 명시적 shadow database/namespace, allowShadowWrites, replica set 또는 mongos의 transaction 지원, 준비된 InstructorNote validator/index가 필요하다. 준비는 `prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS)`로 별도로 수행한다.

## 기존 계약과 개인정보

- getNote(name)는 같은 이름 중 notionNo가 null인 행을 우선한다. saveNote(name)는 기존 PostgreSQL처럼 notionNo 오름차순(null last)의 첫 행을 갱신한다. 두 경로의 기존 우선순위 차이를 임의로 바꾸지 않았다.
- NO 기반 upsert는 NO 고유키를 사용한다. 동시 신규 upsert 충돌은 새 transaction에서 재조회하며, 업데이트는 snapshot에서 읽은 전체 문서를 codec으로 다시 암호화해 저장한다.
- saveNote(name) 신규 생성은 lookup 이름을 사용하고 patch의 notionNo/instructorName은 기존 PG처럼 무시한다. 이름은 unique가 아니므로 동시 첫 등록의 동일 이름 여러 행을 막는 새 규칙은 도입하지 않았다.
- 누락 필드는 보존하고 기존 빈 문자열→null 변환을 유지한다. 기존 stripPiiFromNote에 따른 연락처/이메일/생년월일 제외 및 자유 입력 연락처 가림을 유지한 뒤, 남은 이름·메모·Notion profile은 기존 필드 정책으로 암호화한다.
- JSON SQL null은 MongoDbNull로 명시하며 DB에는 해당 sentinel symbol을 저장하지 않는다.
- DB/암호화 오류는 일반화된 오류로 전파하고 빈 결과로 숨기지 않는다. open의 연결 오류도 민감한 원문을 노출하지 않는다.

## 검증 범위

단위 계약 검사 3개: 부분 갱신, 동명이인·NO 변경·누락/빈값, 기존 redaction, 저장 평문 비노출, 잘못된 날짜·키 누락, standalone 차단·open 오류 일반화. 이는 실제 PostgreSQL 쿼리 동등성 검증이 아니다.

실제 MongoDB 7.0.43 replica set의 합성 검사: 동시 NO upsert 4건 후 문서1개, 서로 다른 부분 수정 동시 보존, validator 실패 및 NO 충돌 rollback, 암호문 companion 변조/키 누락 차단, 두 namespace 격리. 테스트는 MONGODB_INSTRUCTOR_NOTE_TEST_URI의 명시 loopback 주소만 허용하며 MONGODB_URI나 env 파일을 자동 사용하지 않는다. 테스트 키는 랜덤 생성하고 테스트 DB는 finally에서 제거한다.

생산 factory·직접 Notion 동기화·요청 활동 기록 연결, 실제 PG 쿼리 대조 및 대상 MongoDB 8.0 검증은 남아 있다.
