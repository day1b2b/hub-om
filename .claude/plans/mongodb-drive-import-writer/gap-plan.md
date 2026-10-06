# Drive writer 보완 계획

## G1 — 기술 gate 정리 실패 시 연결 해제

독립 리뷰 P2: cleanup DELETE/assert 실패 시 sql.end를 건너뛴다. harness cleanup을 내부 try/finally로 감싸 연결 종료를 보장했다. 정리 실패를 숨기지 않으며 성공한 원본 관찰의 의미를 바꾸지 않는다. 보완 후 부모 gate root1 PASS/0skip/0fail, 독립 후속 확인 완료.

## G2 — 원본 SQL의 큰 limit

독립 코드 리뷰 P2: 원본 bigint LIMIT에서 허용하는 MAX_SAFE_INTEGER+1/1e18을 Prisma take가 거부한다. 공통 경계에서 양수 limit의 SQL bigint 상한을 검사하고, Prisma 안전 정수보다 크지만 SQL에서 유효한 limit는 take를 생략한다. JS materialized 배열 길이는 이 값에 도달할 수 없어 같은 결과를 반환한다. 상한 초과를 무조건 clamp해 성공시키지 않는다. native도 같은 SQL 상한을 유지한다.

부모의 실제 소유 PG 읽기 전용 probe에서 MAX_SAFE/MAX_SAFE+1/1e18은 성공, 2**63/1e20은 SQLSTATE22003이었다. /private/tmp/hub-om-drive-writer-20260930/logs/limit-probe.log. 제품 보완 후 최종 원본/current PG/native parity에서 큰 limit와 overflow를 확인했고 독립 재수락했다. 이 probe만으로 전체 CLI 검증 PASS를 주장하지 않는다.

## G3 — import 중 HTTP 없는 원천 호출 관찰

scope fixture의 fetch0만으로 scanner0을 주장했던 공백을 보완했다. 실제 scan/search 진입을 계수하고 HTTP 없이 반환하는 import 회귀 음성대조를 추가했다. scope-fixed.log 11 PASS/0skip/0fail, 독립 scope-fix-review 수락.

## G4 — V3 실행기 실패 경로

합성 cwd의 현재 @/ alias 누락과 DB 이름 길이 초과로 첫 두 실행이 실패했다. fixture만 수정했고 이후 실제 source/native/reader 12 PASS(root+11)를 확인했다. 독립 리뷰의 timeout/signal 후속 실행 중지·close 시점 출력 검사·고정 IPC 진단 세 항목도 보완했다. 최종 source-http-final.log 12 PASS/0skip/0fail. 정상 성공이 실제 timeout 강제 실행 증거는 아니다.

## G5 — parity 증거 보강

첫 parity는 두 시간대×세 backend×21개 ledger가 일치해 root1 PASS였다. 독립 리뷰에 따라 이전 결과의 동일 ID 내용 변조, current/native 출력 비노출, pending SQL NULL과 JSON null 구분을 보강하고 최종 parity-verified.log root1 PASS/0skip/0fail 및 3backend×2TZ별22 ledger 일치를 확인했다. parity-code-review.md 참조. 원본 기술 gate를 불필요하게 반복하지 않는다.

## G6 — native row 예산 검사

첫 native 실행은 42 PASS/2 FAIL(root 포함)이었다. 한 row-overflow 사례가 기대한 row 상한까지 도달하지 못해 실패했다. byte 예산 등의 선행 실패를 row 예산 PASS로 오인하지 않는 단언이 실패를 검출했다. 원인은 20,000개 Session BSON 합계가 행 상한보다 byte 상한을 먼저 넘는 것이었다. 실제 Company/Course/Session 각6,667행, 총20,001행과32MiB 미만을 관찰하도록 조정했고 최종 native45 PASS/0skip/0fail 및 독립 수락을 마쳤다. 해당 소유 DB 삭제·부재 확인도 성공했다.

## 최종 판정

Scope11·V3 HTTP12·gate1·native45·CLI6·parity1은 각각 최종 PASS이며 합산하지 않는다. 일반1034/93skip·type/build/lint를 확인하고 독립 실행 수락·소유 자원 정리를 완료했다. CLI 첫 실행의 합성 cwd 정규화와 타입/lint, parity 관찰용 PG 동시 query 경고 실패도 보완했으며 모든 이전 실패 로그를 보존했다. 최종 원격 통합은 integration-review 기록을 따른다.
