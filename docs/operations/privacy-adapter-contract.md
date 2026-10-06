# 서버 암호화의 DB adapter 인계 계약

2026-09-21 코드 기준: `4f6254e0fa15f4640135072a2cbb82deeef07f47`, `fix/20260921-pii-encryption-followup`. 이 문서는 현재 구현의 호환 경계를 기록한다. MongoDB 구현·전환 승인이나 운영 검증 완료를 의미하지 않는다. 이번 인계에서 공통 코어·manifest 구조를 바꾸지 않는다.

## 유지할 논리 계약

| 항목 | 현재 구현과 호환 조건 |
|---|---|
| 서버 암호문 | `crypto.ts`의 `pii:v1:<keyId>:<nonce>:<tag>:<ciphertext>`. AES-256-GCM, 12-byte 랜덤 nonce, 16-byte tag, 세 이진 항목은 base64url. 원문 UTF-8. 빈 문자열도 암호화한다. |
| AAD | UTF-8 `pii:v1:<keyId>:<context>`. 필드 context는 대소문자 그대로 `Model.field`. collection 이름이나 BSON 경로로 바꾸면 기존 복호화 실패. 현재 row ID/tenant ID는 AAD에 포함하지 않으므로 같은 논리 필드의 행 간 암호문 교체를 차단한다고 주장하지 않는다. 행 바인딩을 추가하려면 새 버전과 이관 설계가 필요하다. |
| 정확 검색 | 별도 index key로 HMAC-SHA256(context + NUL + value), 결과 lowercase hex. 현재 `indexField`는 `String(value)`이며 trim/case-fold/Unicode normalization을 추가하지 않는다. 동일성·빈도 정보 노출이 있다. 암호화 키 회전과 index key 회전은 다른 작업이다. |
| 설정 | `PII_ENCRYPTION_KEYS` keyId→base64 32-byte key, `PII_ACTIVE_KEY_ID`, 독립 `PII_INDEX_KEY`. 실제 값은 이번 인계에 없음. 과거 암호문 읽기에도 현재 configuration 검증을 거치므로 이전 key만 있으면 충분하다고 가정하지 않는다. |
| 평문 읽기 | 기본 거부. `PII_ALLOW_PLAINTEXT_READS=true`는 명시적 전환 예외다. Mongo adapter의 일반 fallback으로 사용하지 않는다. `isEncrypted`/`storedEncrypted`는 형식 감지이며 무결성 검증은 decrypt로 수행한다. |
| 논리 필드 | `fields.json`은 25개 모델의 암호화 필드 125개. `inventory.json`은 35개 모델의 scalar 분류(`encrypted`/`operational`). 집계는 위 SHA 기준이며 개인정보 혼입 여부의 최종 업무 승인과 같지 않다. |
| 개인정보 로그 | 암호화 필드는 activity 값 allowlist에서 제외. `ActivityChange.changes`의 `allowAuditMetadata`는 값 없는 audit metadata 경로를 위한 제한된 예외다. 원문 JSON 일반 허용으로 확대하지 않는다. |

## 공통 부분과 adapter별 부분

- `src/lib/privacy/crypto.ts`는 Node crypto 기반이며 DB/Prisma를 import하지 않는다. Mongo 준비에서는 이 envelope/AAD/HMAC 계약을 그대로 사용할 수 있다.
- `src/lib/privacy/fields.ts`는 `Prisma.DbNull`/`Prisma.JsonNull`을 import한다. 현재 상태를 DB 중립 모듈로 간주하지 않는다. 공통 표현 타입을 만들 경우 PostgreSQL 동작을 유지하는 별도 합의·테스트가 필요하다.
- `fields.json`의 모델/필드 식별자 및 암호화 분류는 논리 기준이다. `table`, `column`, `primaryKey`, `compoundKeys`, `indexColumn`, `storageColumn`은 현재 PostgreSQL 매핑이고 `index`/`storage`도 현재 Prisma 보조 필드다. BSON 경로·고유 인덱스·null 의미에 그대로 복사하지 않는다.
- 현재 JSON 표현은 `{ __pii: envelope }`. DB null과 JSON null을 구분하며, bytes는 원문을 base64로 바꿔 암호화한 envelope 문자열을 Buffer에 담는다. DateTime은 UTC ISO 문자열을 암호화하고 기존 날짜 필드를 null로 둔 별도 storage 필드를 사용한다. Mongo 표현을 바꾸면 복호화 결과 타입과 기존 값 이동 규칙부터 검증한다.
- `database.ts`의 Prisma delegate/DMMF/select/include/omit/관계/transaction 로직, SQL 제약·활동 trigger·migration은 PostgreSQL adapter 범위다. Mongo 쿼리나 세션에 직접 재사용하지 않는다. repository가 반환하는 평문 업무 타입은 유지하고 index/storage 보조 필드를 노출하지 않는다.
- 서버 파일은 `local:operations`, `local:instructor-wiki`, `local:om-requests`, `local:team-users`, `local:team-members`, `local:reminder-sent` context를 쓴다. 파일 이동이나 DB 교체만으로 context를 변경하지 않는다.
- 브라우저 `browserDraftCrypto.ts`는 별도의 사용자 비밀·wrapped key·JSON envelope 계약이다. 서버의 `PII_*` 키나 `pii:v1` 형식과 호환되는 것으로 취급하지 않는다. 제품 적용은 여전히 사용자 결정 대기다.

## 새 adapter에서 필요한 검증 계약

현재 테스트를 다른 DB의 통과 증거로 사용할 수 없다. 가짜 데이터로 Unicode/빈값/null/JSON null/bytes/date, 잘못된 키·AAD·변조, 구키 읽기와 신규키 쓰기, HMAC 동일성, 보조필드 비노출, compound unique, relation filtering, cursor/정렬/페이지 의미, rollback을 검증해야 한다.

서버 부분검색은 안전한 필요조건으로 후보를 줄인 뒤 복호화하며 20,000행 초과를 오류 처리한다. 직렬화 32MiB 상한은 DB 수신 이후 검사여서 전체 메모리 상한이 아니다. root 개인정보 정렬은 RepeatableRead로 두 조회를 묶지만 callback transaction은 기존 단일 payload 경로를 유지한다. Mongo 쪽 snapshot/일관성 보장은 따로 설계·검증해야 한다. 더 높은 상한이나 검색 token index는 자동 선택하지 않는다.

## 이번 재개 점검과 잔여 결정

`origin/dev`는 기존 통합 기준 `06b025c578117f55d8b70171c92c5cdce9454da3`에서 변하지 않았다. 서버 검색/CLI/파일/로그의 확인한 경로에서 새로운 수정 근거는 찾지 못했다. 확인은 factory의 privacy→activity wrapper, 직접 pg CLI의 legacy guard, repository/file 암호화 사용처, backfill·migration의 원문 없는 오류, inventory/activity coverage 코드에 한정된다. 전 경로 보안감사를 완료했다는 뜻은 아니다. 이미 차단된 legacy SQL 도구를 임의로 활성화하지 않는다.

| 구분 | 남은 항목 | 독립 진행 범위 / 해제 조건 |
|---|---|---|
| 기술 선택 | Prisma null/물리 매핑 분리, Mongo 표현·검색·unique·transaction·audit 동등성 | Mongo 담당이 별도 adapter 준비. 공유 crypto/AAD/manifest 변경은 총괄과 조율. |
| 기술 선택 | 차단된 SQL CLI/HTML export 중 repository 전환 우선순위 | 실제 업무 사용 도구 식별 후 필요한 도구만 전환. 현재 차단 유지. |
| 제품 선택 | 별도 초안 잠금 암호 UI·분실 시 복구 정책 | 사용자 결정 대기. 실제 폼/실제 legacy 변경 금지. 독립 prototype 완료. |
| 제품/데이터 계약 | 업무 문자열 분류, 20,000행 제한과 광범위 검색 요구 | 데이터/제품 책임자가 수용 또는 변경 요구 확정. |
| 운영 승인 | 격리 PostgreSQL 통합 검증, 키 보관/복원, 백업·maintenance, 실제 백필/제약/rollback, PG↔Mongo 전환 순서 | 승인 환경·실행 범위 필요. 로컬 DB 임의 시작·실제 데이터/키 설정·배포 금지 유지. |

기존 검증: 전체548개 중544 pass/DB4 skip, lint(기존 경고7)/typecheck/build 통과. 마지막 브라우저 코어 보완 후 관련23개 및 typecheck/변경파일 lint 통과. 이번 변경은 문서만이며 위 검증을 반복하지 않았다. DB·실계정·운영, 브라우저 전체 프로세스 재시작/OS 네트워크 차단은 미검증. 서버+브라우저 전체 완료 선언 및 원격 push/merge는 하지 않는다.
