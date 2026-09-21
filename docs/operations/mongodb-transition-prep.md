# MongoDB 이전 준비: 운영·캘린더 오프라인 대조

이 작업은 **DB 없이 입력 파일을 대조하는 준비 도구**다. 현재 PostgreSQL runtime, Prisma schema, 패키지/lock, API 동작은 바꾸지 않는다. MongoDB 접속·적재·BSON 역직렬화·전체 서비스 전환을 구현한 것이 아니다.

## Task Plan

사용자 목적은 Coolify PostgreSQL에서 MongoDB로 이전하는 것이다. 첫 독립 단위는 Company → Course → OperationSession → CalendarEventLink의 전체 scalar 필드를 이전 가능한 표현으로 검증하는 것이다. 나머지 31모델은 manifest의 `deferredModels`에 명시하며 입력으로 들어오면 거절한다. 관계 컬렉션 전부, 첨부·코치 개인정보 날짜·복합 PK는 다음 범위다.

- 브랜치: `refactor/20260921-mongodb-transition-prep`.
- 운영 코드/schema 기준: `06b025c578117f55d8b70171c92c5cdce9454da3`.
- 암호화 코드/정책 기준: `4f6254e0fa15f4640135072a2cbb82deeef07f47`.
- 추가 인계 문서: `82c208d385b812c773b1d43d14a20209d20b9621`의 `docs/operations/privacy-adapter-contract.md`(코드/manifest는 위 SHA와 동일).
- 적용 지침: 상위 AGENTS, 저장소 CLAUDE와 README/docs README/getting-started/working-rules/team-workflow/db-write-safety/database-runbook 재확인. source worktree는 읽기 전용. 운영 쓰기·키 설정·로컬 DB 시작·외부 서비스 호출·push/merge/배포 금지.
- development-harness Level 2: R1(여러 파일·검증), R2(새 이전 계약), R5(거짓 일치 판정 방지), R6(후속 이관 인계) = 4. R3은 조사에서 범위를 고정했고 R4는 기존 runtime/제품 동작을 바꾸지 않아 제외. 전체 이관 Wave가 아닌 준비 Task다.

계획: 고정 baseline 및 저장 표현 manifest → 순수 매핑/무결성 대조 → 독립 golden fixture와 변조 테스트 → CLI·기존 빌드/테스트 검증 → 드라이버/DB 리허설 인계. 새 의존성 없이 실행할 수 있는 파일 비교를 우선하여 실제 driver 구현과 혼동하지 않는다.

## 입력과 실행

`src/lib/migration/operation-transition-manifest.json`은 4모델의 전체 scalar 필드, 암호화 companion, unique 및 조회 인덱스 제안, 31개 미지원 모델과 source/정책/runtime 파일 지문을 가진다. SQL `table/column/indexColumn/storageColumn`을 Mongo 계약으로 직접 가져오지 않았다. privacy manifest의 논리 분류를 검토해 이 slice의 stored logical field를 별도로 명시했다.

CLI는 여섯 인자를 모두 요구한다. 파일을 읽고 건수·결과 코드만 출력한다. env/DB URL/secret을 읽거나 dotenv/Prisma/Mongo client를 import하지 않으며 출력 파일을 만들지 않는다. 파일당 8MiB, 모델당 10,000행 제한의 fixture 검증용이다. 실제 streaming exporter/importer는 별도 작업이다.

```bash
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/check-mongodb-transition.ts \
  --schema prisma/schema.prisma \
  --privacy-policy /검토한-암호화-worktree/src/lib/privacy/fields.json \
  --runtime-root . \
  --source src/lib/migration/fixtures/operation-source.json \
  --target src/lib/migration/fixtures/operation-target.json \
  --sequence-high-water 25
```

`--schema`는 **06b025c의 기준 schema**, `--privacy-policy`는 **4f6254e의 정책**이다. 둘을 합친 예상 암호화 stored row 계약을 검증하는 단계이며 현재 dev DB에서 이런 row를 자동 export할 수 있다는 뜻이 아니다. 암호화 schema가 통합되면 그 schema와 실제 exporter를 기준으로 manifest를 다시 검토해야 한다.

`--runtime-root`에서는 manifest가 지정한 operationTypes/operationRepository/operations API 파일만 읽는다. 기능 담당의 생성 멱등성 변경처럼 schema가 바뀌지 않는 계약 변경도 지문 불일치로 거절한다. 통합 시 실패를 지문만 갱신하여 우회하지 말고 새 필드·응답/입력·ID/중복 규칙의 매핑 영향을 검토한다.

source는 raw SQL export나 복호화 DTO가 아닌 **정규화된 암호화 저장 row**다. 키는 Prisma 논리 scalar/companion 이름이며 relation include 객체를 포함하지 않는다. 필수값·nullable 값·빈 문자열·빈 배열을 구분한다. nullable field도 누락하지 않고 명시적 null을 요구한다. 모든 4모델 키가 있어야 하며 전체 빈 slice는 거절한다.

`--target`은 mapper 결과와 별도로 제공하는 대상 컬렉션 표현이다. fixture target은 TypeScript mapper를 실행해 만든 값이 아니라 별도 Python 날짜/Decimal 계산으로 작성한 golden 값이다. row 순서만 무시하고 모든 field/type/array 순서/암호문을 비교한다. 추후 실제 BSON에서 export한 target을 사용할 때는 driver/EJSON 변환을 별도로 검증해야 한다.

입력 fixture의 키·nonce는 공개된 테스트 상수이며 실제 서비스에서 사용하지 않는다. 테스트만 Node crypto로 encrypted JSON null과 빈 문자열 HMAC을 확인한다. CLI는 실제 키를 요구하지 않으며 **envelope 형식과 원본 bytes/string의 보존만 확인**한다.

성공 응답에도 `readyForCutover:false`와 암호 인증/나머지 모델/실제 인덱스/DB/감사/잠금/복원 미검증 gate가 포함된다. `equivalent:true`는 **해당 4모델 fixture 표현 일치**만 뜻한다. 지문은 코드 manifest 지문이며 고객 데이터 hash를 출력하지 않는다. 오류도 고정 코드만 출력하여 값·암호문·HMAC·파일 경로가 로그로 새지 않게 한다.

## 구현한 매핑 및 검증 계약

| 항목 | 이번 도구가 검증하는 것 | 다음 단계 |
|---|---|---|
| ID | 소문자 UUID 문자열 그대로 `_id`, 원본 ID·대상 ID 중복/변경 거절 | 나머지 모델의 shared PK/복합 PK 합성 ID와 실제 BSON key 검증 |
| 금액 | Decimal(14,2) 정확 문자열 → `$numberDecimal`, 12자리 정수부/2자리 소수부, 지수·Number 입력·묵시 반올림 거절 | Decimal128 driver 왕복·금액 집계와 기존 UI number DTO 검증 |
| 업무 날짜 | YYYY-MM-DD의 실제 날짜 검증 → UTC 00:00 epoch millisecond `$date/$numberLong` | 교육일 필터·KST 경계의 API/DB 동등성 |
| 시각 | UTC ISO, millisecond 3자리만 허용. offset/zone 없는 입력·자동 날짜 보정 거절 | source exporter가 PG timestamp와 timestamptz 의미를 구분해 정규화 |
| 정수 | Int32 범위 확인 → `$numberInt` | 실제 BSON number type/index 대조 |
| null | 누락 거절, DB null은 null로, JSON null은 암호화 `__pii` envelope로 보존 | `Prisma.DbNull/JsonNull`을 export adapter에서 구분. fields.ts import로 대체하지 않음 |
| enum | 논리 Prisma enum 값 명시 목록 검사. SQL @map 소문자 값을 자동 추측하지 않음 | exporter enum 매핑 명시 |
| 암호화 | PII text/JSON envelope 형식, 명시 HMAC lowercase hex 및 nullable 동반 일치, 값 그대로 복사 | 같은 Model.field AAD/키 버전/HMAC 입력으로 실제 decrypt·재계산·보조필드 비노출 검증 |
| unique | UUID, normalizedName, processSeq, 회사+코스ID+과정명, operationId, sourceFingerprint, operationId+eventDate | sourceFingerprint는 여러 null 허용 partial unique. Mongo 실제 unique/partial filter/collation 생성·경합 검증 |
| 참조 | Company→Course→Session 존재 검증. Calendar operationId dangling도 별도 코드로 거절 | Calendar 연결은 SQL FK가 아닌 loose join 검토 gate임. slice 밖 참조와 삭제/복구·동시 변경 검증 |
| sequence | 값 명시 필요, 모든 processSeq 이상, 다음 Int32 번호 여유 확인. 행 최댓값으로 fallback 안 함 | 실제 PG sequence가 예약/소모한 상한 export·counter 초기화·atomic increment 검증. 이번 입력값의 진위는 확인 안 함 |

`queryIndexes`의 개인 담당자/캘린더 참조 조회는 원래 ciphertext 열 대신 지정된 HMAC companion을 대상으로 제안한다. 설치되는 인덱스가 아니며 개인정보 부분검색·정렬을 지원한다고 주장하지 않는다. 이 slice에는 암호화 필드의 unique가 없고, 나머지 모델의 HMAC unique/복합 unique는 미구현이다.

Extended JSON 표현은 [MongoDB 공식 Extended JSON v2](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/)의 canonical Date/Decimal128/Int32 형식이다. 일반 JSON payload를 임의로 EJSON로 해석하지 않는다. 이 slice의 JSON인 validationErrors는 암호화 wrapper만 허용한다.

## 감사·잠금과 암호화 보존의 필수 gate

이번 단계는 runtime adapter가 없어 transaction/lock interface를 흉내 내는 코드를 추가하지 않는다. CLI가 반환하는 미검증 gate와 다음 승인 기준으로 남긴다.

- business write와 ActivityChange를 하나의 Mongo session transaction에 묶고 실패 시 모두 rollback. 사용자 context 분리, nested/bulk write, soft delete/restore, metadata-only PII 감사, 별도 ActivityRequest 실패 정책까지 기존 의미 유지.
- replica set 실제 구성과 primary failover/write-conflict 재시도 검증. 외부 Calendar 요청은 transaction callback 재시도에 넣지 않는다.
- Calendar 회차 잠금의 동일 회차 재진입·다른 회차 중첩 거부·역반영 억제 context·연결 상실 중단을 유지. lease/fencing만으로 외부 API가 보호되지 않으므로 stale worker의 외부 쓰기와 멱등 처리에 대한 재현 검증 필요.
- `crypto.ts`는 재사용 후보지만 `fields.ts`는 Prisma null sentinel에 의존한다. SQL/Prisma 물리 매핑을 그대로 옮기지 않는다. Model.field의 대소문자, HMAC의 `context + NUL + String(value)`를 보존하고 trim/case-fold를 추가하지 않는다.
- v1 AAD에는 row/tenant ID가 없다. 같은 논리 필드의 행 간 암호문 치환을 막는다고 주장하지 않는다. 새로운 AAD나 index key rotation은 이전과 분리해 결정한다.
- 모든 old key ID와 활성 설정/index key를 별도로 복구 검증하고 평문 read 우회 플래그는 일반 서비스에서 false/미설정. 첨부·코치 개인정보 날짜·원천/로그·로컬 파일·브라우저 초안은 별도 범위이며 4모델 성공으로 보호 완료를 선언하지 않는다.

## Verification / Validation

검증은 가짜 데이터와 기존 lockfile 의존성만 사용한다. `npm ci --ignore-scripts --no-audit --no-fund`로 기존 519개 패키지를 설치했으며 새 패키지 추가·package/lock 수정은 없다. `db:generate`는 존재하지 않는 로컬 포트의 가짜 URL로 client만 생성했고 DB 접속 명령은 실행하지 않았다. dotenv 주입은 0개였다.

검증 명령 및 결과는 완료 후 아래 Execution Summary에 기록한다. 전체 test/typecheck/build는 env를 비워 DB·실계정 값을 상속하지 않고 실행한다. 기존 세 DB 통합 테스트는 환경변수 부재로 skip되며 DB를 임의 시작하지 않는다.

Validation 원천 시나리오: “실제 DB 이전 전에 정확 금액·윤일·교육일 공백·암호화 JSON null·빈 문자열 HMAC·sourceFingerprint nullable unique·부모 참조·기존 채번 상한이 그대로 이전되는지, 잘못된 대상은 값 노출 없이 거절하는지 확인한다.” 독립 target fixture와 값/타입/행/참조 변조로 검증한다. 단순 mapper 자기 왕복이나 DB 없는 성공을 전체 이관 성공으로 삼지 않는다.

## Execution Summary

- 파일: 새 `operationTransition.ts`, `operation-transition-manifest.json`, `operationTransition.test.ts`, source/target fixture 2개, 읽기 전용 CLI, 이 문서. 기존 runtime/schema/package/lock/공통 ts-loader 변경 없음.
- 검증: `npm test` 509개 중506 pass/실패0/DB3 skip. 신규 `operationTransition.test.ts` 12/12 pass(최종 runtime 지문 추가 후 재실행). `npm run lint` 오류0/기존 경고7, 변경 TS 파일 lint 오류/경고0. `npm run typecheck`, `npm run build`, 가짜 URL의 `npm run db:validate`, `git diff --check` 통과.
- CLI: 실제 지정 baseline schema+암호화 정책+runtime으로 4컬렉션 각1건 `equivalent:true`, `readyForCutover:false`. 별도 임시 target의 field 변조는 exit1/ROW_MISMATCH, 임시 public runtime 파일 변조는 exit1/RUNTIME_CONTRACT_DRIFT. 값/파일 경로 미출력 확인. 입력 파일은 synthetic fixture/공개 코드뿐이며 임시 파일은 검사 후 제거.
- 최초 검증에서 schema coverage 테스트 정규식이 줄바꿈을 넘겨 필드 하나를 놓치는 실패를 수정했다. 타입 검사에서 테스트 subprocess 환경의 NODE_ENV 필수 타입 오류를 수정한 뒤 통과했다. 실패를 기존 제품 문제로 분류하지 않았다.
- 독립 읽기 전용 검토자가 개인정보 대상/companion과 source 정책을 직접 대조하고 신규 테스트12개를 재실행했다. 차단 결함을 발견하지 않았으며 runtime drift 분기의 추가 실행 권고는 위 negative CLI 리허설로 확인했다. 이 검토는 전체 보안감사나 DB 인증이 아니다.
- 상태: 이번 4모델 오프라인 준비 Task complete / handoff-ready. 기존 runtime·패키지/lock·다른 worktree 불변을 diff로 확인했다. 로컬 커밋만 남기며 원격 push/merge/배포는 하지 않는다.
- 미검증: driver/BSON, 실제 인덱스와 검색/집계, replica set/transaction, 감사·잠금, 원본 sequence 진위, exporter/importer, 31모델, 실제 데이터/키/백업/복원/운영/브라우저.
- sizing: right — 정적 slice와 독립 target 검증으로 제한해 runtime 변경 없이 필요한 증거를 만든다.

## Alignment Note / 인계

정렬 결과는 `update_handoff_only`: 전체 전환 전략은 유지하며 다음 작업의 baseline·도구·미검증 증거를 추가한다. 적용 대상은 이 문서와 새 manifest다. 현재 Task 준비 검증은 완료했으며 명령·검증 근거는 Execution Summary에 남겼다. MongoDB 전체 이전은 미완료다.

다음 담당은 이 문서 → manifest → tests/fixture → 암호화 `privacy-adapter-contract.md` 순서로 읽는다. runtime 생성 멱등성 계약과 암호화 통합 후 바뀐 baseline을 검토하고 새 manifest/fixture를 확정하는 것이 재개 지점이다. 그 후 승인된 native driver와 격리 DB로 실제 저장/대조를 구현한다. 검증 실패를 지문 변경만으로 해결하거나 gate를 제거하지 않는다.

**한 번에 필요한 결정:**

1. native driver 후보 **`mongodb@7.6.0`** 설치 승인. 2026-09-21 [공식 패키지 메타데이터](https://registry.npmjs.org/mongodb/7.6.0) 기준 Node `>=20.19.0`, runtime transitive `bson ^7.2.0`, `@mongodb-js/saslprep ^1.4.11`, `mongodb-connection-string-url ^7.0.1`. 저장소 Docker Node 24는 최소 요구를 충족하지만 실제 조합 검증은 남았다. 설치 시 exact version과 lock 갱신을 별도 변경으로 남기고 optional compression/auth/CSFLE 패키지는 필요가 확인되기 전 추가하지 않는다. 기존 AES-GCM 계약에 `mongodb-client-encryption`이 자동으로 필요한 것은 아니다.
2. 대안은 PG 유지하며 준비 작업 지속, 또는 Prisma 새 Mongo API를 별도 평가하는 것. 현재 Prisma7의 provider 변경으로는 해결되지 않는다. native driver는 session/Decimal128/index를 직접 제어할 수 있으나 repository와 쿼리 구현 비용이 있다. Prisma 새 API는 기존 호환을 가정할 수 없어 비교 PoC가 추가된다.
3. 기준 통합: 암호화 정책/DB schema/생성 멱등성 계약 최종 SHA, 나머지31모델의 다음 수직 범위. PG 먼저 암호화할지 Mongo 적재 시 최초 암호화할지 운영 책임자가 결정해야 한다.
4. 격리 replica set 환경을 누가 어떤 범위로 제공/시작할지, 실제 데이터 없이 어떤 synthetic volume/SLO·transaction/lock/복구 리허설을 허용할지. 현재 로컬 DB 임의 시작 금지 유지.

Do Next: 위 결정 확정 및 통합 계약 검토(`ask_user_for_decision`은 총괄의 통합 질문에 모음). Do Not: 운영 접속/키 설정/실제 변환/외부 write/원격 push/merge/배포/무승인 의존성 추가/다른 담당 worktree 변경.
