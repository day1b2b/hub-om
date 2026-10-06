# Sheets 명시 경계 인계

기준 `8b4d954707933fdd5da8bfbef46a1779e04ceeb0`, 작업 `feature/20260930-mongodb-google-sheets-import`, 격리 clone `/Users/ga/workspace/hub-om-mongodb-coach-content`. 원본 `/Users/ga/workspace/hub-om`은 수정하지 않았다.

## 구현

두 기존 tabs/import POST에 `googleSheetsImportSource`를 연결했다. import는 원천 읽기 전에 imports/teamMembers/instructorNote도 해석해 누락 scope의 PG fallback을 막는다. 공개 가능한 고정 오류만 전달한다. 기존 source/parser/staging/권한/OAuth/화면/스키마/의존성·기본PG는 유지한다.

검증·실패보완은 execution-review, 독립 수락은 alignment-review, 명령은 verification-commands를 읽는다. 이전 계획의 PENDING은 작성 당시 상태이고 현재 상태는 execution-status를 따른다. 원본closure80파일/runtime29와 이전Drive증거는 재작성하지 않는다. 기존 완료기능을 다시 구현하지 않는다.

## 남은 전체 이전

Notion 가져오기·Drive CLI writer, CLI/예약작업 호출조사, backup/health, 전체 요청·페이지·작업 Mongo 조립과 권한/브라우저 대조가 남았다. snapshot 회사/과정 문자열의 privacy 정책 대조 및 실제PG collation은 전체 전환 차단 항목이다. 실A/B 독립백업·각복원·복사·최종변경대조·Mongo쓰기이후 무손실복귀·운영전환 증거는 아직 없다. 실백업증거0, dev→main 조건미충족. 브라우저임시저장보호는 별도후속이다.

다음 작은 후보는 기존 Notion 가져오기 API→같은 staging 경계다. 실제 원천을 읽지 말고 현재 호출/권한/adapter/입력·오류·저장 의미를 먼저 확인한 뒤 원본대조계획을 독립 검토한다. 사용자 기존개발승인을 유지하며 새업무/삭제/의존성정책을 추가하지 않는다.

자동화는 사용자 인계의 PAUSED를 유지하며 이 작업에서 조회/변경/자동재개하지 않았다. 운영접근/배포승인을 추론하지 않는다.

소유 합성 자원 정리는 완료했다. 실행 증거는 `/Users/ga/.cache/hub-om-verification/20260930-google-sheets-import`에 보존했다. 최종 문서 수락과 원격통합 상태는 alignment-review/integration-review에 별도로 기록한다.

제품·검증 커밋309b242f9885f008b6213ccf794bc89afab7520e의 작업/총괄 원격 일치를 확인했다. 문서 후속 HEAD는 integration-review 및 durable final-remote.txt를 따른다.
