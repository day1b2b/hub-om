**원본 배치의 시각·원자성 gate와 실제 CLI gate를 분리하는 것이 최소 구성입니다.** helper만 호출하면 dotenv·반복 종료·exit·disconnect를 놓치고, CLI만 실행하면 정확한 cutoff와 배치 rollback을 분리하기 어렵습니다.

1. **동결 범위**
   `b333931a2e7d281b697baf20a75bdf13b8e2b094`의 [CLI](/Users/ga/workspace/hub-om-mongodb-coach-content/scripts/prune-activity.ts), retention, getPrisma와 privacy/activity/context runtime closure를 Git blob/hash로 고정합니다. 실제 dotenv·Prisma·pg 및 package/lock/schema/ts-loader도 추적합니다. 기존 resolver 패턴을 재사용하되 원본의 current 탈출을 거부합니다.

2. **실제 CLI**
   합성 cwd의 `.env.local`·`.env`, 최소 환경의 subprocess에서 원본 entry를 그대로 실행합니다. 우선순위는 **기존 process.env > .env.local > .env**입니다. 성공 JSON·exit0·실제 socket close를 검사합니다.

   주의할 원본 동작:
   - `getPrismaClient()`는 `try` **밖**입니다. 초기화 실패에 finally 실행을 요구하면 잘못된 oracle입니다.
   - dotenv 자체 안내 출력이 있으므로 원본 stdout을 무조건 JSON 한 줄로 가정하면 안 됩니다.
   - 기존 실패는 미처리 rejection이고, 새 고정 오류와는 의도적 차이로 구분합니다.

3. **최소 데이터·경계**
   full45 schema에 **ActivityRequest/ActivityChange만** 합성 seed합니다. 빈 상태, 보존 대상, 만료 대상, 한쪽만 1000, 양쪽 1000, 1001＋동률을 묶습니다. 정확히 1000이면 다음 배치가 실행되는지도 관찰합니다.

   남은 **전체 ID집합과 raw 행**을 검사하고, 각 backend 내부에서는 암호문까지 불변을 요구합니다. backend 간 임의 nonce 암호문 비교 대신 독립 literal의 전체 논리행을 비교합니다. 요청 삭제 후 아직 보존기간인 연결 ActivityChange가 남는 사례도 포함합니다.

4. **cutoff·동률**
   [원본 SQL](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/retention.ts)은 동일 transaction의 `now()`와 strict `<`, 날짜 오름차순을 사용합니다. PG gate는 같은 transaction에서 서버 시각을 관찰하고 경계 전후를 seed합니다. **PG `now()`의 microsecond와 저장열 `timestamptz(3)`를 구분**하며, 반올림된 값을 정확한 동률이라고 주장하지 않습니다. native는 확인된 `$$NOW` 시각으로 별도 경계를 검증합니다. 날짜 동률은 허용 ID 부분집합으로 판정하고 특정 tie-break를 강제하지 않습니다.

5. **실패·재실행**
   실제 첫 DELETE 후 두 번째 DELETE에 명시 장애를 주입해 배치 전체 rollback을 확인합니다. 다음으로 첫 배치 commit 후 다음 배치를 실패시켜 **이전 commit만 잔존·성공 합계 JSON 없음**을 검사합니다. 재실행으로 잔여분을 삭제하고, 다시 실행하면 0입니다. callback retry와 commit ACK 불확정은 별도 사례이며 불확정 결과를 rollback으로 판정하지 않습니다.

자동 정리는 [기존 recordRequest](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoRequestAuditRepository.ts)의 **감사 INSERT 유지, 1시간 조건, 실패해도 주기 갱신, best-effort 고정 로그**를 실제 경로로 확인하면 됩니다. 공유 helper의 4초/1500ms와 CLI의 10초를 구분하고, 개인정보 접근 감사 전체 회귀까지 확대할 필요는 없습니다.

읽기만 수행했습니다. 파일 변경·런타임·DB 실행은 없습니다.
