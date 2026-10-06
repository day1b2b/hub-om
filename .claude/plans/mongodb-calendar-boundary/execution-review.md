# Calendar 실행 기록 — 구현·합성 검증 수락

이번 Calendar 경계의 구현·합성 검증·독립 코드/증거 리뷰를 수락했다. 운영 PG/실원천/실Google 접근 없음. parent가 모든 테스트/DB 실행을 담당했다. 전체 앱 조립·실제 데이터 이전 수락은 아니다. 원격 통합 상태는 integration-review.md를 따른다.

## 최종 결과

Node24.19.0, PG17.9, Mongo8.0.30 replica set, env-i. 작업 clone에는 .env.example만 있다.

| 검사 | 결과 | 로그 |
| --- | --- | --- |
| 일반 전체 | 954pass/77skip/0fail, exit0 | calendar-unit-regression1.log |
| 실제 원본 PG/current PG/Mongo 비교 및 PG 정지·연결 종료 | 5pass/0skip, exit0 | calendar-pg-final.log |
| 전체 Mongo 54파일/59개 root | 963pass/0skip, exit0, 기존 mock4 포함 | calendar-mongo-regression1.log |
| 리뷰 후 adjacent 단언 강화 | 12pass/0skip, exit0 | calendar-adjacent-strengthened.log |
| 최종 typecheck/lint | exit0 / 오류0·기존경고7 | calendar-typecheck-final.log, calendar-lint-final.log |
| build | exit0 | calendar-build-regression1.log |
| 소유 합성 정리 | PG active client0/public table0, Mongo test DB0; 두 프로세스 종료·dbpath 제거·포트 닫힘 | cleanup.log, cleanup-result.json |

963 결과의 Calendar 부분집합은 lease33/storage52/handler21/edges12/adjacent12이다. 별도 결과와 합산하지 않는다. 전체 실행 뒤 제품 코드는 바뀌지 않았고 adjacent 테스트의 단언만 강화했다. source-before-regression1.json의130파일과 대조해 이 테스트 한 파일만 변경됐음을 확인했다. 따라서 단일 최종 테스트 소스 전체명령 PASS라고 하지 않고 전체963 + 강화본12의 증거로 보고한다. 일반 테스트의77skip은 전용 opt-in이 필요한 검사를 포함하며 PASS가 아니다.

내구 증거: `$HOME/.cache/hub-om-verification/20260930-calendar-boundary/`. 최초47개 파일의 evidence-digests.json을 생성·재검증했다. 원본 실패 로그도 보존했다. 저장된 전체 원본919파일은 이번 검증의 임시 original과 원본 digest로 동결했으며, 실제 PG oracle 의존 폐쇄63파일은 저장소 original/과 manifest로 보존한다. 이후 추가되는 통합 증거는 별도 기록이다.

Confucius의 제품/기반 리뷰, Carver의 PII/API/원본 oracle/adjacent 증거 리뷰 모두 열린 확정 지적 없음. metadata 자동수리·추가 unique·빈 prepare·역사적 문서 정책, lease 증거3건, H3/PG oracle/adjacent 증거 보완을 닫았다. 실제 exit와 소유 자원 정리는 부모가 확인했으며, cleanup은 리뷰어의 코드 수락과 구분한다.

## 검증 한계

- 실제 native 경합·서버시간·정상 갱신·SIGSTOP/재개와 driver ACK/clock/owner fault를 구분한다. 외부 응답·OAuth·Slack은 합성이다. E2의 정확한 cached-token await 직후 경합은 단위검사이며 실제 lease 전송 경계 전체 증거로 과장하지 않는다.
- 원본에도 없는 전체 writer fencing/Google exactly-once/전체 rollback을 추가 보장하지 않는다. 이미 완료한 외부 효과와 mapping은 뒤의 실패에 남을 수 있다. key 형식이 정상인 오답 HMAC의 equality miss 한계도 유지한다.
- timeout worker 종료/후속 실행 차단은 정적 리뷰를 받았으나 timeout 자체의 강제 실행 증거는 없다. 정상 PG 실행과 실제 OS pause/연결 종료는 실행했다.
- 실제 계정/권한/메일·전체 앱/브라우저/CLI/예약 작업 조립·실백업 A/B·복원·최종복사/전환·dev→main은 미완료다. 브라우저 초안 암호화는 별도 후속이다.

## 보존한 실행 경과

아래 대기/실패 문구는 각 실행 시점의 기록이며 최종 판정은 위 결과표를 따른다.

- 기존 baseline: Calendar119pass/1skip, 실제PG잠금 별도1pass/0skip/exit0. baseline 및pg-lock-baseline 로그.
- native lease pipeline spike: 서버$$NOW/Long/동시단일owner/이전세대거부/renew 확인, 소유probeDB정리, exit0. 제품완료검증 아님.
- 초기제품 typecheck-first exit0.
- native storage-smoke exit0: CRUD/재진입/타회차중첩거부/잠금없는쓰기거부/조건부삭제. 소유DB정리. 최종suite대체아님.
- runtime-smoke exit0: 실제8port준비/open/disabledbackfill/혼합scope/nestedscope의callback0. 소유DB정리.
- PG facade 기존검사3pass/0skip/exit0.
- Calendar PII+기존단위 첫실행142pass/1fail/0skip/exit1. 신규API오류test의Next Node ESM 확장자 해석 실패, 제품오류가 아니며 next/server.js와resolve hook으로 보완. 해당파일7pass/0skip/exit0. 최종전체수치로합산하지않는다.
- typecheck-pii exit2: 다른 agent 작성중인 PGtest의ProcessEnv.NODE_ENV 누락. 작성자에게전달, 최종재확인대기.
- actual handler 첫 실행21fail: 합성 Course의 processSeq=0이 기존 validator에 거부됨. R=1/A=2로 fixture를 수정했다. 다음 실행19pass/2fail은 H3 한 하위검사와 root 집계이며, 재실행에 따른 CourseNameRestoreGuard.nonce 변경을 업무 불변 비교에 포함한 문제다. 그 nonce만 비교에서 제외하고 모든 업무/감사/카운터 문서를 비교한다. 최종 해당 파일21pass/0skip/exit0 (`calendar-handler-replay-fixed.log`). 실제 promotion→backfill→합성 Google→native mapping/audit 경로이며 실제 Google 검증이 아니다.
- frozen PG/current PG/Mongo oracle 첫 실행은1pass/4fail/exit1(세 persistence 하위실패+root)이다. reverse Map 후보의 JSON 키 순서 비교는 객체 전체 동등 비교로 보완했다. PG 감사 시각은 Node clock 구간을 잘못 기준으로 사용했으므로 실제 생성 주체 PG의 호출 전후 `clock_timestamp()::timestamptz(3)`로 관찰한다. 넓은 허용 오차는 추가하지 않았다. 수정 후 persistence3종과 root4pass/0skip/exit0 (`calendar-pg-oracle-fixed.log`). 이미 통과한 frozen PG lock 하위검사는 이 재실행에서 명시 skip-pattern으로 제외해 Node의 skip집계에도 포함되지 않는다.
- 실제 frozen PG lock 첫 실행 하위검사1pass: 연결 종료 후 별도 Prisma mapping/감사 잔존, 실제 SIGSTOP 60초 초과에서 session 생존 시 다른 소유자 거부, session 종료 후 재개 시 abort 확인. 첫 실행 로그의 BL01~BL11 증거. 변경 없는 lock 검사는 반복하지 않았다. 따라서 PG 최종 증거는 두 로그의 하위검사 합집합이며 단일 최종 전체명령 PASS로 표현하지 않는다.

독립 정적 리뷰: Carver는 PII slice에서 확정 결함 없음. API catch7건과 E1~E4 단위검사는 mocked 경계이며 native 증거로 합산하지 않는다. Confucius P2 두 건(공유 모델 metadata 자동 보정, 추가 unique index의 collation 강화 허용)은 부모가 보완했다. 준비 함수는 세 모델의 기존 metadata를 모두 먼저 확인하고 없는 컬렉션만 생성한다. mapping은 이름/키/partial/collation까지 알려진 unique index만 허용한다. 재리뷰 및 native 검증 대기.

- native2파일 첫 실행82검사 중79pass/3fail/0skip/exit1. Lease32하위+root33pass: 기본65초 작업의 갱신, native 경합, 라벨 ACK fault, 실제 프로세스 정지/자연만료/교체 후 이전 소유자 거부 및 commit 잔존을 확인했다. storage48하위 중2실패+root실패: 역조회 후보의 객체 키 순서 비교와 capped fixture 재생성의 `unique:undefined`가 원인이다. 보완 후 storage 재검증 대기. 로그 calendar-native-first.log. 전체 native PASS는 아니다.
- 준비함수의 metadata 자동수리 제거 후 빈 missing 목록 전달 회귀는 `if (missing.length)`로 고쳤고 정적 재리뷰에서 닫혔다. 기존 generic prepare의 역사적 문서 정책 검사도 없애지 않도록 read-only `$nor` 검사를 추가했다. 올바른 현재 metadata 아래 남은 과거 정책 문서도 거부하며, 이 추가 변경은 후속 native 검증 대상이다.
- 증거 리뷰의 P2: H3 이벤트 설명·일정/생성 표식 exact 검사를 추가했다. PG 실제loader digest와 timeout 뒤 child 종료/후속작업 차단은 보완 중이다. 원본 제품 함수를 대체한 hidden mock은 발견되지 않았고 승인된 정상 DTO와 로그 비노출은 구분한다.

- storage 수정 후52pass/0skip/exit0 (`calendar-storage-fixed.log`). 과거 부적합 문서/정상 metadata 세 모델 거부와 기존 metadata 보존, 암호화/HMAC·유일성·감사 원자성·행/byte/시간 scan 경계를 확인했다. 이 결과는 전체Mongo 묶음의 부분집합이다.
- handler edge12pass/0skip/exit0 (`calendar-edges-first.log`). H5의 callback/ACK fault·native Company 경합과 H10b 다른 캘린더 및 F10/11/14/15의 확정/불명/부분 성공을 실제 API로 확인했다. F15는 예산 내 강제 owner 교체·ACK 결함 주입이며 자연만료 성공이라고 하지 않는다. 후속 typecheck에서 fetchmock 인자 타입과 observer DB의 ReadConcern 타입을 보완했다.
- combined typecheck 첫 실행exit2: 새 테스트의 fetch 인자 타입 및 ReadConcern/worker NODE_ENV 문제8개. 제품 타입 오류는 없었고 각각 작성자/부모가 보완 중이다. 최종검사 전까지 typecheck 완료로 취급하지 않는다.
- 독립 리뷰의 H3·PG loader/timeout·edge 의미 항목은 정적으로 닫혔다. timeout fault를 실제 실행했다는 주장은 없고, 종료 관찰 뒤에도 소유자원 감사가 필요한 실패 경로로 기록한다. native lease의 L12·L6a·L11b 증거 단언3건은 추가 강화 중이며 후속 전체검증에 포함한다.

증거 root `/private/tmp/hub-om-calendar-boundary-20260930/logs`. 원본실패로그보존. 큰묶음실행중driver수정금지.

Carver 초기lease 정적리뷰: 확정P0/P1 없음. healthy/native/timeout 실제수락은대기. driver abortTransaction은실패정리시별도timeout을사용하므로 실패정리까지의mutex점유10초상한은주장하지않는다. DB10초는callback+commit CSOT이며 abort정리는별도관찰한다. 계획문서시간표의수명보장도이한계를명시한다.
