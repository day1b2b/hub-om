# Execution Review: mongodb-snapshot-privacy

기준 SHA는 `7e7c6500b1f7d7a31b2732491321a7bf53ac2df9`다. Node 24.19.0, PostgreSQL 17.9와 MongoDB 8.0.30 replica set, 새 loopback 포트·합성 데이터·임시 키만 사용했다. 운영 DB·Atlas·실원천·운영 키·env·배포·main/dev는 변경하지 않았다.

## 구현

- `DriveImportResult.companyName`, `courseName`을 encrypted로 분류하고 nullable non-unique HMAC companion과 SQL 인덱스를 추가했다.
- 기존 PG `C` 정렬 의미를 유지하도록 두 필드에 byte ordering 정책을 적용했다. 다른 암호화 필드의 한국어 locale 정렬은 유지한다.
- Mongo runtime 계약·validator·HMAC 인덱스와 35모델 migration/runtime codec의 개인정보 필드 수를 129로 갱신했다.
- 이전 정책 문서가 있는 namespace는 준비 단계에서 거부하며 자동 수정·삭제하지 않는다. 새 run ID와 namespace 재복사를 운영 절차로 문서화했다.
- Sheets/Notion 동결 oracle의 원본 파일·digest는 유지하고, 현재 runtime schema의 승인된 정확한 digest만 추가했다. 다른 runtime 변경은 계속 실패한다.

## 실행 결과

| 검사 | 결과 |
| --- | --- |
| 실제 합성 PostgreSQL 전환 | 1 PASS / 0 skip / 0 fail |
| 실제 Mongo Drive history/runtime | 79 PASS / 0 skip / 0 fail |
| 35모델 codec/export/import·privacy | 65 PASS / 0 skip / 0 fail |
| 기존 source ID 부분 backfill 회귀 | 1 PASS / 0 skip / 0 fail |
| Sheets/Notion 동결 원본 회귀 | 60 PASS / 0 skip / 0 fail |
| 일반 전체 테스트 | 1084 PASS / 101 opt-in skip / 0 fail |
| Prisma validate/generate | PASS |
| typecheck / production build | PASS / PASS |
| lint | 오류 0 / 기존 경고 7 |

PostgreSQL 검사는 legacy 평문, schema 적용 전 backfill 실패와 rollback, 평문·암호문 혼재, dry-run, apply·재실행 불변, companion 누락 복구와 non-null 불일치 apply 전 거부·저장 불변, 잘못된 암호화/HMAC 키, exact HMAC 조회 후 원문 확인, 동일 이름 중복 허용, 음수·fraction·비정상 limit 및 합성 C byte 정렬, enforce 후 평문 직접 쓰기 거부를 확인했다. 기존 source ID의 205행 첫 batch commit·충돌·재실행도 최신 migration을 포함해 다시 통과했다. Mongo 검사는 저장 평문 0, 암호문·companion, 전 필드 인증, 잘못된 키/companion, validator/index, 구 정책 평문 이름 문서의 무수정 거부와 오류 원문 비노출, PG C 정렬 동등성, 20,000행·32MiB·시간 경계를 확인했다.

검사 묶음은 서로 겹치므로 합산하지 않는다. 일반 테스트의 101 skip은 PASS로 세지 않았고, 이번 변경 영향의 실제 PG/Mongo 검사는 별도 opt-in 실행으로 대체했다.

## 실패와 보완

1. 최초 실제 Mongo 실행의 정확한 32MiB fixture가 새 암호문 길이 때문에 424바이트 부족했다. 개인정보 암호문을 padding으로 훼손하지 않고 operational `inputKind`에 현재 길이만큼 추가하는 방식으로 고쳤고 전체 78개를 재실행해 통과했다.
2. 첫 일반 검사 실행 명령은 격리 PATH에 Node가 없어 시작 전 exit 127이었다. Node 24 bin을 PATH에 추가해 재실행했다.
3. 첫 일반 회귀는 승인된 Prisma schema 변경을 Sheets/Notion 동결 guard가 감지해 1026 PASS/101 skip/2 fail이었다. 원본 동결 schema와 digest는 바꾸지 않고 현재 schema 정확한 digest만 승인했다. 두 검사 60 PASS 후 일반 전체를 다시 실행해 1084 PASS/101 skip/0 fail을 확인했다.

## 미검증

- 운영 PostgreSQL migration/backfill/enforce와 실제 데이터 규모·성능
- 운영 Mongo/Atlas의 새 shadow 재복사와 실제 데이터 대조
- 운영 collation/TZ, 전체 앱·활성 CLI/예약/배포 조립
- Google Drive/OneDrive 실제 A/B 백업, 각각의 격리 복원과 키 회수
- 실데이터 복사·최종 동기화·전환·역동기화 rollback

이 항목은 PASS가 아니며 운영 전환과 dev→main을 계속 차단한다.

## 독립 리뷰와 정리

독립 리뷰는 최초 P1 2건과 P2 2건을 제기했다. 음수·fraction·비정상 take 호환, non-null HMAC의 apply 전 거부, skip 경계, 실제 Error.message 비노출과 음성대조를 보완한 뒤 최종 재검토에서 P0/P1/P2 잔여 없음으로 기능 수락됐다. 리뷰는 검사를 재실행하지 않았으며 위 수치는 부모 실행 결과다.

정리 전 Mongo에는 `admin`, `config`, `local`만 있었고, PostgreSQL에는 시스템 DB와 소유 `snapshot_privacy_test`, `pii_source_ids_test`만 있었다. 소유 Mongo/PG를 정상 종료하고 포트 27850·56770 폐쇄, `/private/tmp/hub-om-snapshot-privacy-20260930` 부재를 확인했다. 첫 Mongo `--shutdown` 옵션 시도는 지원되지 않아 쓰기·삭제 없이 실패했고, admin shutdown으로 종료했다.
