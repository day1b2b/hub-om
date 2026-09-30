**현재 전체 fixture 수락은 보류합니다.** Carver 동결본은 핵심 CLI 계약을 검증하지만 출력 판별에 P2 공백 1개가 있습니다. PG/native는 작성 중이므로 아직 없는 사례를 구현 결함과 구분했습니다. 실행은 하지 않았습니다.

### 확정 지적

**[P2] dotenv 안내문 허용 규칙이 임의 출력까지 통과시킵니다.**  
[activityPruneCommand.test.ts:217](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activityPruneCommand.test.ts:217)

`tip: .+`를 허용하고 전체 stdout 줄 수도 제한하지 않습니다. 따라서 dotenv 형식을 흉내 낸 추가 로그나 미등록 민감 문자열 suffix가 있어도, 211행의 열거된 marker에 없으면 통과할 수 있습니다.

최소 보완은 설치된 dotenv의 실제 안내문 후보와 예상 출력 횟수를 한정하거나, 동일 parser에서 **임의 suffix·추가 안내문을 거부하는 음성대조**를 추가하는 것입니다. 제품 출력 정책 변경은 필요하지 않습니다.

### Carver 동결본 검토

전달된 두 SHA와 현재 파일이 일치합니다.

- 실제 script subprocess와 실제 command/factory/PG guard/retention SQL을 사용합니다. **Prisma I/O는 합성**이라는 한계도 정확히 적었습니다.
- exact 1000 반복, 합계 1회 집계, 후속 실패의 성공 출력 금지, summary→close 순서, close 실패 exit 1을 검사합니다.
- env 순서·상속값 우선순위·import 무부수효과·중첩/동시 scope를 검증합니다.
- 금지 I/O를 별도 ledger에 남겨 catch에 삼켜져도 검사하며 음성대조가 있습니다.
- subprocess 강제 종료를 성공으로 처리하지 않고, close 이후 임시 경로를 정리합니다.

위 P2 외에 현재 확인한 핵심 계약의 정적 차단 결함은 없습니다. 부모 실행 결과는 별도 확인 대상입니다.

### Native — 현재 작성분과 남은 필수 기준

읽은 [activityPrune.integration.test.ts](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activityPrune.integration.test.ts)는 **312행 버전**입니다.

현재 좋은 점:

- 실제 Mongo 위임 이후 관찰하며, 경계용 시계 주입을 명시적으로 구분합니다.
- 전체 암호문 다중집합·session 동일성·서버 시각 1회·실제 aggregate 명령을 검사합니다.
- `observe()`와 raw 비교가 제품 catch 밖에 있습니다.
- cursor close의 옵션·완료, session 종료, borrowed client close 금지를 관찰합니다.

아직 작성되지 않은 필수 증거:

- 999/1000/1001·동률·실제 drain과 재실행.
- 두 번째 삭제 rollback, 후속 배치 실패와 이전 commit 보존.
- callback retry, ACK retry, 미확정 commit의 독립 raw 확인.
- 동시 drain·A/B 격리.
- 실제 withActivity 자동 정리·시간당 조건·best-effort·한 배치 유지.
- CLI 10초/API 4초·1500ms의 실제 지연 및 재시도 중 남은 예산 검증.

특히 [224행 관찰자](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activityPrune.integration.test.ts:224)의 `timeoutMS ≤ 상한`과 `AbortSignal` 존재만으로는 **deadline 비초기화나 실제 취소 시점**을 증명하지 못합니다. 준비된 `abortedAt` 등을 사용하는 후속 사례가 필요합니다.

### PG fixture — 현재 검토 범위

- [shared.fixture.ts:35](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activity-prune-tests/shared.fixture.ts:35)의 전체 raw 비교는 중복·누락·잔존 암호문 변경을 검출합니다. 동률도 특정 ID 대신 허용 집합으로 검사합니다.
- baseline loader는 Git 객체·manifest와 허용 의존성 경계를 사용하고 변경 원본·현재 코드 탈출 음성대조를 갖췄습니다.
- [cli-observer.fixture.ts:58](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activity-prune-tests/cli-observer.fixture.ts:58)는 같은 실제 PG client에서 transaction 시각을 관찰하며, 두 번째 삭제 장애도 실제 SQL 오류로 transaction을 중단시키도록 작성됐습니다.
- 다만 실제 PG runner가 아직 없어 관찰 ledger를 **부모가 최종 단언하는지**, subprocess 실패·정리 실패를 전파하는지, 전체 사례가 연결되는지는 아직 판정할 수 없습니다. helper 존재만으로 V1/V2/V3 PASS가 되지 않습니다.

**판정:** CLI 출력 판별 P2 보완 필요, native/PG는 작성 완료 후 재검토 필요입니다. 파일 수정·DB 접속·테스트 실행은 하지 않았습니다.
