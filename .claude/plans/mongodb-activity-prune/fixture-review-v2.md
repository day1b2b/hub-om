**command의 기존 P2는 종결하며, 동결 native fixture도 정적 수락합니다. 추가 차단 결함은 발견하지 못했습니다.** 두 파일의 SHA가 전달값과 일치합니다.

- **Command P2 종결:** [184행 parser](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activityPruneCommand.test.ts:184)가 dotenv 8개 literal·정확한 줄 수·순서를 검사합니다. 같은 parser에 suffix·미등록 tip·추가/빈/누락/역순 출력 음성대조가 연결됐습니다.
- **getMore 공백 종결:** [238행 관찰자](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activityPrune.integration.test.ts:238)가 실제 wire의 `getMore`를 금지하고, `singleBatch:true`·limit 1000 및 101/999/1000/1001 실제 삭제 수를 함께 검사합니다.
- **원자성·집계:** 두 번째 배치의 두 번째 삭제에 실제 서버 장애를 넣고, 앞선 commit 보존·실패 배치 rollback·성공 출력 없음·전체 raw를 확인합니다. callback transient와 commit ACK 주입도 구분했습니다.
- **API 회귀·시간:** 실제 withActivity에서 요청 기록 보존, 한 배치/시간당 조건, best-effort를 검사합니다. [456행 사례](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activityPrune.integration.test.ts:456)는 실제 지연 명령의 서버 진입·1500ms signal 발동·재시도 후 4초 잔여 예산을 관찰합니다.
- **정리·거짓 PASS 방지:** close 완료·session 종료·금지 호출·전체 raw 비교가 제품 catch 밖에 있습니다. timeout 뒤 서버 작업 소멸과 recovery를 확인하며, 클라이언트 취소가 즉시 서버 작업을 종료했다고 과장하지 않습니다.

**한계:** command **21 PASS는 부모 전달 결과**이며 로그를 독립 확인하지 않았습니다. native 실행은 진행 중이므로 실행 수락은 보류합니다. ACK·transient·정확한 cutoff는 명시 주입이고, 10초 CLI 지연 자체는 4초 공통 helper 검증과 구분해야 합니다. PG 및 별도 `mongoApiContext`·`adminDatabaseHandlers` 실행도 이번 수락에 포함하지 않습니다.

파일 수정·DB 접속·테스트 실행은 하지 않았습니다.
