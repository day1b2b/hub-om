# Drive 가져오기 결과 이름 암호화 적용 순서

## 범위

`DriveImportResult.companyName`과 `DriveImportResult.courseName`을 AES-256-GCM으로 저장하고 각각의 HMAC companion을 함께 유지한다. 권한 있는 결과 화면과 관리자 백업 응답은 복호화한 원래 값을 반환한다. DB, Mongo shadow, 오류와 로그에는 원문을 남기지 않는다.

두 이름은 업무상 중복될 수 있으므로 companion 인덱스는 고유하지 않다. 합성 PostgreSQL의 `C` collation에서 확인한 `candidateCount DESC, companyName ASC, courseName ASC` 의미는 복호화한 UTF-8 byte 순서로 보존한다. 운영 DB의 collation이 같은지는 적용 전 별도 확인한다. 무작위 암호문의 정렬이나 unique로 원문 의미를 대신하지 않는다.

## PostgreSQL 적용

운영 적용은 이번 코드 작업에 포함하지 않는다. 실제 적용 전 독립 백업과 복원 가능 여부, 암호화 키 회수 가능 여부를 확인한다.

1. Drive 가져오기 writer, 앱, 스케줄러를 점검 모드에서 중지한다. 적용 중 새 결과가 생기지 않게 한다.
2. migration `20260930150000_encrypt_drive_import_result_names`를 적용해 nullable companion 열과 비고유 인덱스를 만든다.
3. 같은 키 세트로 `npm run privacy:migrate`를 실행해 dry-run 결과를 확인한다. 평문 수, 암호문 수, companion 누락·불일치를 건수로만 기록한다.
4. 백업과 점검 모드를 다시 확인한 후 `--apply --backup-confirmed --maintenance-confirmed`로 backfill한다. 정상 암호문은 보존하고 평문 또는 companion 누락만 처리하므로 같은 키로 재실행할 수 있다.
5. `--enforce --backup-confirmed --maintenance-confirmed`로 전수 복호화·HMAC 검증과 평문 저장 거부를 설치한다.
6. 이름 검색·중복 결과·candidateCount 및 이름 정렬·결과 화면을 확인한 뒤 writer와 앱을 재개한다.

schema 적용 전 backfill은 실패해야 한다. 부분 중단은 같은 키로 dry-run부터 재실행한다. 누락된 companion은 인증된 원문에서 다시 만들 수 있지만, 이미 값이 있는 companion이 현재 계산과 다르면 키 불일치나 손상으로 간주해 apply 전에 중단한다. 키 교체는 별도의 전체 재암호화·companion 재생성 계획 없이는 수행하지 않는다.

## Mongo shadow 처리

이전 정책으로 만든 namespace에는 두 이름의 평문이 남아 있을 수 있다. `collMod`로 validator만 바꾸거나 기존 문서를 무조건 수리하지 않는다. 원본 PostgreSQL을 점검 모드에서 고정하고 새 run ID와 새 namespace로 35모델 snapshot을 다시 export/import한다. 새 codec은 두 이름의 암호문과 companion을 검증하며, 정책 지문이 다른 기존 spool/namespace는 전환 대상으로 승인하지 않는다.

기존 namespace는 검증과 복구 판단이 끝날 때까지 삭제하지 않는다. 명시적 변환을 선택할 경우에도 원본 namespace의 immutable 백업, 행 수·PK·FK·HMAC·복호화 대조, 중단 후 재실행 절차가 먼저 필요하다.

## 복구

- 앱 재개 전 실패: 서비스를 중지한 채 같은 키로 backfill을 재실행하거나, migration 전 PostgreSQL 백업과 해당 코드 버전을 함께 복원한다.
- 앱 재개 후 실패: 새 쓰기를 먼저 중지한다. PostgreSQL 백업 또는 기존 Mongo namespace로 단순 주소만 되돌리지 말고, 재개 후 생성·수정·삭제분의 역동기화 계획을 적용한다.
- 키 분실·불일치: 암호문을 원문으로 복원할 수 없으므로 복구 키 또는 검증된 백업 없이는 진행하지 않는다.

실제 운영 DB, Atlas, Google Drive/Sheets, Notion에는 이 절차를 실행하지 않았다. 합성 검증 통과는 독립 A/B 백업과 각 복원 리허설을 대체하지 않는다.
