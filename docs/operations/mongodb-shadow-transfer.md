# PostgreSQL 유지 + 암호화된 MongoDB 검증 복사

현재 서비스는 PostgreSQL을 계속 사용한다. `MONGODB_URI`를 추가하거나 이 코드를 배포해도 앱의 DB는 바뀌지 않는다. 이 문서는 **복사 도구**의 계약이며 MongoDB 앱 전체 구현·운영 이전 완료를 뜻하지 않는다.

## 선택한 전환 방식

PostgreSQL을 먼저 암호화하고 다시 MongoDB로 옮기는 방식 대신, 사용자가 선택한 **기존 PostgreSQL 유지 → 내보내는 순간 개인정보 암호화 → 별도 MongoDB 검증 → 최종 동기화·전환**을 적용한다. 운영 중 두 DB에 동시에 쓰는 기능은 없다. 따라서 최초 snapshot 이후 PostgreSQL 변경은 MongoDB에 자동 반영되지 않는다.

암호화 PR #599의 공통 키/AAD/HMAC 정책을 사용하지만 PostgreSQL의 기존 데이터를 backfill하지 않는다. 평문 DB의 보존 기간, 과거 백업, 외부 파일, 브라우저 초안 보호와 앱 런타임 전환은 각각 검증해야 한다.

## 구현 경계

- Prisma 논리 모델 35개의 scalar/nullable/list/enum/UUID/복합 PK를 검증한다. 실제 SQL 열·타입·PK가 맞지 않으면 source 읽기를 중단한다. 평문 source에서 누락된 개인정보 companion만 허용한다.
- 단일 `READ ONLY REPEATABLE READ` transaction에서 읽는다. PostgreSQL에 INSERT/UPDATE/DELETE/DDL을 실행하지 않는다. 날짜/시각, Decimal(14,2), SQL NULL과 JSON null을 구분한다.
- 개인정보 정책의 25모델 125필드는 파일에 기록하기 **전에** 암호화한다. 암호화된 source 모드는 기존 암호문 인증과 HMAC 일치를 검증한다. 키·평문 행·DB URL은 로그에 출력하지 않는다.
- 새 0700 폴더에 0600 파일을 배타적으로 생성한다. 파일 fsync와 read-only transaction 종료 후 최종 manifest를 공개한다. 불완전 폴더는 재사용하지 않는다.
- importer는 manifest/모든 파일/암호문/행 수/정렬/해시를 먼저 검증한다. 한 파일 32 MiB, 합계 128 MiB, 최대 100만 행으로 제한한다. 제한을 넘으면 실패하며 일부만 성공으로 처리하지 않는다.
- 대상은 명시된 `hub_om_shadow_...` DB와 `shadow_<runId>_<Model>` 컬렉션이다. URI의 기본 DB를 쓰기 대상으로 자동 선택하지 않는다. insert-only로 복사하고 재실행 시 동일 ID·내용만 허용한다.
- BSON Date/Decimal128/Binary를 왕복 검증하고 원본 암호문·ID·내용을 대조한다. 선언된 FK와 논리 unique/HMAC unique는 대상 전체를 독립 재조회하여 검증한다.
- 성공 결과도 항상 `cutoverAuthorized: false`다. source sequence는 MVCC 대상이 아니므로 `sequenceValuesRequireFrozenRecheck: true`로 기록한다.

`mongodb@7.2.0`을 고정 사용한다. Node 24에서 검증한다. 기존 4모델 `mongodb-transition-prep.md`와 manifest는 과거 fixture 검증 기록이다. 현재 schema에서는 과거 지문 검사가 실패하는 것이 정상이며, 지문만 갱신해 우회하지 않는다.

## 환경변수

| 이름 | 용도 |
|---|---|
| `DATABASE_URL` | source PostgreSQL. export 프로세스에만 제공 |
| `MONGODB_URI` | MongoDB 접속. 이 값만으로 쓰기/앱 전환이 활성화되지 않음 |
| `MONGODB_SHADOW_DATABASE` | 별도 DB 이름. `hub_om_shadow_[a-z0-9_]{1,40}` 필수 |
| `MONGODB_PRODUCTION_DATABASE` | 보호할 MongoDB 이름. shadow와 같으면 importer 중단 |
| `MONGODB_ALLOW_SHADOW_WRITES` | importer 실행 시에만 `true` |
| `PII_ACTIVE_KEY_ID`, `PII_ENCRYPTION_KEYS`, `PII_INDEX_KEY` | 암호화/인증/HMAC. 기존 암호화 계약과 동일 |

도구는 `.env`를 자동 탐색하지 않는다. 실행자가 보안 환경 또는 Node의 명시적 `--env-file`로 주입한다. 키를 CLI 인자·Git·공유 로그에 넣지 않는다. source와 대상의 키를 바꾸면서 이전하지 않는다.

## 실행 순서

다음은 실행 형식이다. 실제 운영 데이터 export/import는 백업·대상 DB·복구 키를 확인한 뒤 수행한다. 파일 위치·run ID·DB 이름은 해당 실행에 맞춰 지정한다.

1. 읽기 전용 연결 진단: `npm run mongodb:check`. ping/hello만 실행한다. replica set 보고는 실제 transaction/rollback 성공을 보증하지 않는다.
2. 합성 DB 검증: `npm run mongodb:check-synthetic -- --allow-synthetic-shadow-writes --cleanup-synthetic-db`. `MONGODB_SHADOW_DATABASE`를 지정하면 그 DB 내 이번 실행의 무작위 컬렉션만 생성·정리하며 DB 자체는 삭제하지 않는다. 미지정이면 무작위 독립 DB를 생성·정리한다. 임시 테스트 키만 사용하고 실제 개인정보를 읽지 않는다. 최소 권한 방식은 `hub_om_shadow_validation` DB 하나에만 `readWrite`를 부여하고 그 이름을 명시하는 것이다. 전체 DB 관리자 권한은 필요하지 않다.
3. source export:

```sh
npm run mongodb:export -- --allow-read-only-source-export \
  --output-parent /secure/export-parent --source-mode plaintext
```

4. export 완료 후 반환된 디렉터리로 검증 복사:

```sh
npm run mongodb:import -- /secure/export-parent/export-directory rehearsal_01 --apply-shadow-only
```

5. 성공 결과와 독립 업무 대조를 보관한다. 복사 도구가 성공해도 MongoDB 앱을 운영에 연결하지 않는다. 재시도는 같은 immutable spool과 run ID로 수행하며, 새 snapshot에는 새 run ID를 사용한다.

## 전환 전 남은 필수 구현·검증

- 앱의 PostgreSQL/Prisma 직접 접근, 운영 생성 멱등성·채번·트랜잭션, 개인정보 검색/정렬, 권한, 감사 기록, 캘린더 잠금/외부 동기화, 백업/보존 정책을 MongoDB repository로 구현한다. URI 추가나 OperationRepository 일부 교체만으로 완료되지 않는다.
- MongoDB의 실제 unique/partial/query 인덱스와 validator를 설치하고 동시 쓰기를 시험한다. 현재 복사 도구의 사후 unique 검사만으로 향후 쓰기를 보호할 수 없다.
- SQL FK가 없는 업무 연결(예: CalendarEventLink.operationId), 소프트 삭제, 첨부 복원, 교육일 경계, 집계/화면 동등성을 별도로 대조한다.
- 최종 짧은 쓰기 중지 구간에 새 snapshot/sequence 상한을 다시 확보하고 변경분·삭제분을 포함해 동기화한다. 최초 export 성공은 최신 상태 보장이 아니다.
- MongoDB 신규 쓰기 이후에는 PostgreSQL로 주소만 되돌리면 신규 데이터가 사라진다. 역동기화 또는 전진 복구 리허설, 복구 키 및 DB 백업 검증이 필요하다.
- 암호화된 첨부 등 최종 BSON 문서가 MongoDB 문서 크기 제한을 넘는 경우를 조사하고 대응한다. 드라이버 오류를 성공으로 숨기지 않는다.

## 확인 결과 기록 원칙

단위/모의 테스트, 실제 독립 PostgreSQL, 실제 MongoDB 합성 데이터, 실제 운영 데이터, 앱 화면 검증을 구분한다. 접속 주소·키·고객 데이터·행 단위 해시는 공개 기록에 넣지 않는다. 이번 작업의 실제 실행 결과는 PR/총괄 보고에 별도로 기록한다.

2026-09-22 확인:

- 전체 자동 테스트 763개 통과·4개 환경 의존 검사 생략. lint 오류 0개·기존 경고 7개, 타입 검사·프로덕션 빌드 통과.
- 별도 실제 PostgreSQL 18에서 PII 전/후 42/44 migration, 각각 35모델·7개 합성 행 export→대조→메모리 import·재시도 검증 통과. [재현 절차](mongodb-shadow-postgres-verification.md).
- 설정된 MongoDB ping/hello 성공, replica set 확인. **별도 무작위 검증 DB의 listCollections 단계에서 권한 오류(code 13)**로 실제 MongoDB 저장 검증 중단. 이 실행에서 데이터 쓰기·삭제 없음. 실제 BSON 왕복은 로컬 직렬화 테스트로만 통과했고, MongoDB 서버의 쓰기/rollback 성공으로 해석하면 안 된다.
- 로컬 빌드 `/sign-in` 200, 비로그인 `/api/operations` 307. 로그인 후 업무 흐름이나 MongoDB 앱 화면 전체 검증은 미실행.
- 운영 데이터 export/import·키 변경·PostgreSQL backfill·배포·서비스 DB 전환은 미실행.
