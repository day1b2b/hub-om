**최종 native 증거 검토: 기존 5개 지적 모두 종결, 추가 차단 사항 없음입니다.**

현재 [테스트 파일](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/adminBackup.integration.test.ts)은 592행이며 SHA-256 `74ceb952…bab2550`과 일치합니다.

1. **정렬:** Map/객체를 ordered entries로 해석하고 정확한 내림차순을 검사합니다.
2. **누적 deadline:** 실제 드라이버 위임에서 페이지별 `15000→7000ms`, 남은 전체 예산 `5000ms`를 catch 밖에서 단언합니다.
3. **실제 timeout:** 오류를 `MongoOperationTimeoutError` 또는 code 50으로 제한합니다. 관찰용 조회 후 failpoint를 설정하고 서버 진입·첫 Coach 조회를 확인합니다.
4. **정리:** 명시적 커서 close의 5초 옵션과 완료를 검사합니다. 소유 DB 정리는 별도 누적 30초 제한·삭제 후 확인·실패 전파를 유지합니다.
5. **실패 후 불변성:** metadata·암호문 손상과 행·byte 초과에서 복구 쓰기 전에 전체 raw를 비교합니다.

[완료 로그](/private/tmp/hub-om-admin-backup-20260930/logs/native-fixed.log)는 **14개 하위 테스트 + root = 15 PASS, 0 FAIL, 0 SKIP**입니다.

이 증거는 **실제 POST 직접 호출에서 드라이버 읽기 deadline 15초와 제한된 후속 cleanup**을 검증합니다. GET 또는 HTTP 응답 전체가 15초 내 완료된다는 의미는 아닙니다. 파일 수정·테스트·DB 실행 없이 검토했습니다.
