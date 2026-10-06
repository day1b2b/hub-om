**원본 독립성과 실제 기술 gate 관찰은 수락합니다. 실패 시 연결 정리에 P2 1건이 있습니다. 제품/full parity 수락은 아닙니다.**

확인한 근거:

- immutable git object **53개**의 baseline blob·SHA가 모두 일치합니다. runtime 의존 대상 누락과 실제 package/lock/schema/loader 해시 차이도 없습니다.
- guard 원문을 유지하며 PG 관찰자는 실제 `pg.Client`에 위임합니다. source도 원본 scanner를 호출하고 반환값을 대체하지 않습니다. 미등록 current import는 resolver에서 차단합니다.
- [pg-gate.log](/private/tmp/hub-om-drive-writer-20260930/logs/pg-gate.log): root **1 PASS·0 fail·0 skip**, 네 실행 모두 cleanup0입니다.
  - prefix17 UTC/Seoul: 각각 run1/result2, source2, 외부fetch0.
  - 날짜: UTC `03~04`, Seoul `02~03`을 실제 저장값까지 확인.
  - prefix18: `23502`, DML시도1·source0·run/result0.
  - current45: 실제 guard 거부, 대상조회·DML·source0.
- child stderr는 내용 대신 bytes/hash만 기록합니다. 로그의 data URL 문구는 Node의 loader 등록 안내이며, **원본 base64 source URL 노출은 확인되지 않았습니다.**

**P2 — cleanup 실패 시 supervisor PG 연결 해제가 누락됩니다.**
[GateHarness:101](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/driveImportWriterGateHarness.fixture.ts:101)의 cleanup DELETE·잔존 assertion 중 하나가 실패하면, 108행 `sql.end()`에 도달하지 않습니다. 정리 실패 상태에서 연결·advisory lock이 남아 종료를 지연시킬 수 있습니다.

cleanup 본문을 내부 `try`로 감싸고 **내부 `finally`에서 `await sql.end()`**를 수행하도록 보완하면 됩니다. cleanup 실패를 숨기거나 cleanup0을 출력하면 안 됩니다. 현재 성공한 네 gate 결과를 무효화하는 지적은 아닙니다.

timeout/signal에서는 observed exit 후 후속 gate를 중단하고 자료를 보존하는 경계가 구현되어 있습니다. 실 Google·성공 후보 추출·부분 commit fault·신규 encrypted writer/native는 여전히 미검증입니다.

파일 변경·DB 접속·테스트 실행은 하지 않았습니다.
