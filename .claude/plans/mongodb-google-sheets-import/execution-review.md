# Sheets 실행 결과와 한계

2026-09-30. 기준 `8b4d954707933fdd5da8bfbef46a1779e04ceeb0`, 작업 `feature/20260930-mongodb-google-sheets-import`. 부모가 Node24.19.0·PG17.9·Mongo8.0.30의 새 loopback 합성 자원과 env-i에서 실행했다. 원본 workspace·실제 원천·운영 DB/키/설정은 변경하지 않았다. 제품은 두 POST, 전용 source port, context type slot의 4파일뿐이다.

## 실행 증거

원시 로그와 source-final.json은 execution-manifest.json의 durable evidence 디렉터리를 기준으로 한다. exit는 부모 tool 완료 결과로 확인했으며 독립 리뷰어가 재실행한 것으로 표현하지 않는다.

| 검사 | 최종 결과 | 로그 |
| --- | --- | --- |
| 일반 전체 | 971 pass / 86 skip / 0 fail, exit0 | logs/unit-race-final.log |
| 원본 PG 관찰 gate | root1 pass / 0 skip, 내부18관찰, exit0 | logs/pg-gate.log |
| 원본PG/현재PG/Mongo whole-result 대조 | root1 pass / 0 skip, 내부 ledger45/45/45, exit0 | logs/parity-race-final.log |
| HTTP helper + actual handler | 30 pass / 0 skip, exit0 | logs/source-handlers-final.log |
| handler 최종 변수명 수정 후 | 16 pass / 0 skip, exit0 | logs/handlers-final.log |
| native transaction | 16 pass / 0 skip, exit0 | logs/transactions.log |
| Calendar context 인접 회귀 | 24 pass / 0 skip, exit0 | logs/calendar-context.log |
| typecheck / lint / build | exit0 / exit0(오류0·기존경고7) / exit0 | logs/typecheck-race-final.log, logs/lint-race-final.log, logs/build.log |

일반 skip86은 opt-in DB 검사이며 성공으로 세지 않는다. 묶음 간 중복과 ledger를 합산하지 않는다. 이번 결과는 전체 일반 검사와 변경 영향 DB 검사이며 전체 Mongo 묶음 재실행이 아니다. Calendar는 합성 URI 리터럴 한 곳만 새 소유 endpoint로 바꾸는 loader를 사용했고 제품·단언은 그대로다. 변경 diff/hash는 calendar-endpoint-evidence.json에 있다.

## 검증 내용

원본80파일/runtime29 closure를 기준 SHA에서 동결했다. 조회 factory/repository/presenter 각각의 byte 변경·미선언 current import 및 실제 loader 변조의 7개 음성대조를 통과해야 parity가 실행된다. 세 backend 실제 POST·guard·withActivity·parser·저장·조회·DTO를 독립 literal과 대조한다. 정상 대체는 합성 HTTP transport/low-level auth뿐이며 관찰·장애주입 lane을 별도로 둔다.

199/201 실제 저장과 preview200, 모든/부분/같은 업로드 중복, 팀 별칭과 sourceName trim, 알려진/미등록 강사, 안내/빈행 물리번호, 연도 경계, 실제 summary 정렬 및 전체 DTO 대응을 확인했다. 201행 상세의 누락·추가·경계교체는 같은 독립 expected whole DTO가 거부한다. 오류 요청 전후 Run+SourceRecord raw 전체는 불변이고 별도 요청 감사는 허용한다. Company/Course/OperationSession 전체 raw 불변과 source link null을 확인하여 staging을 승격으로 오인하지 않는다.

인증·token·인자·scope 누락·원천/roster/store 오류 우선순위, A/B scope 격리, 요청 감사 await/실패, 오류 exact allowlist와 끝까지 생략 없는 canary 검사를 확인했다. 승인된 복호화 DTO/actor 감사와 금지된 token/raw error 저장·노출을 구분했다.

실제 transaction callback retry는 source/parser/roster/store/요청 감사를 재실행하지 않는다. 실제 일부 insert 후 confirmed abort는 전체 rollback이다. 실제 commit 성공 뒤 ACK 오류의 회복형200/최종전달형400은 둘 다 전체 저장을 유지한다. 별도 unresolved는 commit 전 dispatch 차단 주입으로 전체 미반영을 관찰했으며 실제 네트워크 ACK 손실 재현이 아니다. 두 요청이 모두 commit 전 읽으면 각 저장 가능, 첫 commit 뒤 둘째가 읽으면 중복 run만 생성하는 기존 의미를 유지한다. 전역 exactly-once나 새 unique는 추가하지 않았다.

불변 staging 하위 repository/codec/HMAC/scan/readiness 증거의 재사용 범위는 dependency-evidence-review.md를 따른다. scan20k/32MiB는 scan별,60초는 store 호출부터이며 HTTP 전체 deadline이 아니다.

## 실패를 숨기지 않은 보완

- 첫 handler는 inherited TZ를 fixture가 거부하여 접속 전 실패했다. env-i에서 TZ를 제외해 재실행했다.
- 첫 parity는 테스트의 PG logical mapper가 audit Int status200을 문자열로 바꿔 실패했다. Prisma field metadata의 enum만 변환하도록 고쳐 재실행했다. 제품/원본 closure는 그대로다. 당시 original cleanup0 후 중단, current/native 미실행이었다.
- 독립 리뷰의 V5 누락 fixture·실패 source rows 불변·실제 preview 음성대조, V6 긴 배열/문자열 생략·대소문자 반례를 보강하고 재검증했다.
- V7 최종 리뷰에서 별도 PG/Mongo 경합 입력이 달라 직접 tuple 대조가 부족함을 발견했다. 동일 OM/LD 누락1행으로 두 schedule을 세 backend에서 실행하고 Mongo 제외 필터 없이 전체 ledger45/45/45를 대조했다. 기존44/44/39 성공 로그는 중간 결과로 보존한다.
- 초기 typecheck는 HTTP 테스트 제네릭 union 오류3건을 타입 주석으로 수정했다. lint는 handler 지역변수 module을 moduleMock으로 바꿔 해결했다. 기존7경고는 별도다.
- 첫 자원 감사는 PG35표0을 확인한 뒤 Mongo getCmdLineOpts의 잘못된 속성명에 대한 assertion으로 중단했다. hello.setName으로 소유 replica를 재확인한 별도 Mongo 감사는 성공했다. 실패 로그도 보존한다.

제품4파일 hash는 모든 최종 실행 동안 동일하다. build 이후 변경은 테스트 fixture뿐이며 최종 type/lint/general/parity 및 handler를 영향에 맞게 재실행했다. 모든 묶음을 단일 최종 소스의 한 번 실행이라 부르지 않는다. source-delta.json은 최초 최종검사 snapshot 이후의 테스트 변경을 열거한다.

## 완료 범위 밖

실제 Google/OAuth/브라우저, 현재 비활성 UI의 활성화, Notion 가져오기, Drive CLI writer, 전체 앱·작업의 backend 조립, backup/health와 실제 A/B 백업·복원·복사·운영 전환은 미완료다. 실백업 증거0, 운영 기본PG 유지. snapshot 회사/과정 문자열 privacy 분류와 실제 운영 PG collation도 전체 전환의 필수 후속이다. 브라우저 초안 보호를 완료했다고 주장하지 않는다. dev→main 조건은 아직 충족하지 않았다.
