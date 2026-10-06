**현재 536행 기준, freeze 전에 보완할 항목 5개가 있습니다.** 정적 검토이며 파일 수정·테스트·DB 실행은 하지 않았습니다.

1. **정렬 비교가 드라이버 표현과 불일치합니다.** [324행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:324)은 `sort`를 일반 객체와 비교하지만 설치된 드라이버는 `Map`을 사용합니다. ordered entries로 정규화해 정확히 `[['startedAt', -1]]`인지 검사해야 합니다.

2. **누적 시간 검사는 있으나 드라이버에 남은 시간을 전달하는지 검사하지 않습니다.** [468행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:468)의 101행·두 페이지·8초→16초 반례는 유효합니다. 다만 매번 `timeoutMS:15000`을 전달하고 수신 후에만 초과를 검사하는 변형도 통과합니다. 실제 `find`에 위임하면서 두 번째 페이지 `timeoutMS=7000`, 전체 예산 55초 시점 metadata `timeoutMS=5000`을 기록하고 **제품 catch 밖에서** 단언해야 합니다.

3. **native timeout 오류 허용 범위가 넓습니다.** [516행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:516)의 모든 `MongoServerError` 허용을 `MongoOperationTimeoutError` 또는 `code===50`으로 좁혀야 합니다. reset 후 `currentOp=0`은 정리 후 잔존 없음의 근거이며, timeout 순간 서버 작업 취소까지 증명하지는 않습니다.

4. **cleanup 검증이 호출 시도만으로 통과할 수 있습니다.** [153행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:153)은 close 실패에도 `closed`에 추가하고, [225행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:225)은 옵션 없는 호출을 모두 허용합니다. 커서별 명시적 5초 close 호출·완료를 구분해야 합니다. 별도로 [529행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:529)의 DB 삭제와 후속 확인에도 제한시간이 필요합니다. 테스트 자원 정리는 제품 cleanup 5초와 분리한 30초 제한이 적절합니다.

5. **일부 실패 후 raw 전체 불변성 검사가 빠져 있습니다.** 선택 metadata 오류, 손상 암호문, 행·byte 초과는 실패 직전 raw를 저장하고 **복구 쓰기 전에** 전체 비교해야 합니다. 특히 [395행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:395)과 [443행](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts:443)은 현재 fixture 복원 후 검사가 실패 당시 상태 변화를 가릴 수 있습니다.

긍정적으로, **실제 드라이버 `next` 위임, 실제 쓰기 ACK 후 해제하는 snapshot barrier, metadata를 포함한 정확한 누적 행·byte 경계, catch 밖의 감사·금지 호출·로그 단언**은 확인했습니다. 공유 fixture와 제품은 변경하지 않았습니다.
