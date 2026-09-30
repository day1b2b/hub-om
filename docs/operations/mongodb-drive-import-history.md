# Drive 가져오기 이력의 명시 Mongo 조회 경계

현재 구현 범위는 저장된 이력 두 조회와 `/drive-import-runs` 결과 페이지다. 최종 검증·독립 수락·통합 상태는 [작업 기록](../../.claude/plans/mongodb-drive-import-history/execution-status.md)을 따른다. 기본 운영 backend는 PostgreSQL이며 실제 데이터 이전은 하지 않았다.

## 선택과 기존 동작

- `driveImportResults.ts`의 기존 async export·DTO 경로를 유지한다. 별도 scope가 없으면 원본 PG adapter를 사용한다. `DATABASE_URL`이 없거나 기존 PG 조회·복호화·응답 변환이 실패하면 기존처럼 null이다.
- 명시 scope에서는 `driveImportHistory`가 반드시 있어야 한다. 환경변수나 PG의 catch로 명시 저장소 실패를 숨기거나 PG로 재시도하지 않는다.
- 페이지는 기존 workspace 인증 이후 저장용 `teamMembers`와 이력 저장소를 모두 선택한 다음 읽기를 시작한다. 부분 scope에서는 양쪽 업무 읽기가 시작되지 않는다.
- 페이지 이력은 전역 최신 run이다. 기존 팀 선택은 명단·탐색 링크의 의미이며 새 이력 접근 필터로 바꾸지 않았다. 최신 pending/failed·결과0인 run도 건너뛰지 않는다.
- 단건은 exact operationId의 후보에서 run 시작 시각, 결과 생성 시각 순으로 선택한다. run 결과는 후보 수 내림차순, 저장된 회사/과정 이름 오름차순이다. 원본에 없는 ID tie-break를 업무 계약으로 추가하지 않는다.
- 실제 frozen PG 관찰에 따라 기본250, 0, 251, 음수 뒤쪽 선택, 유한 safe-number 범위의 소수 절삭을 보존한다. 음수로 고른 뒤에도 정상 정렬 순서다. 비유한 수나 safe 범위 밖 숫자는 null이다. 잘못된 인자보다 scope 선택이 먼저다.
- 현재 재현한 문자열 정렬 기준은 합성 PG의 C collation/SQL_ASCII와 UTF-8 전송 바이트다. 다른 운영 collation 지원을 확인한 것으로 해석하지 않는다. 실제 source collation 대조는 전체 이전 전 필수다.

## Mongo 읽기와 의도적 차이

`MongoDriveImportHistoryRepository.open`에는 client·shadow database·namespace를 명시한다. 기존 validator/index를 읽어 확인하며 환경변수로 backend를 바꾸지 않는다. 원본 35모델 runtime codec과 기존 개인정보 정책을 재사용한다. 업무 필드·migration·의존성 추가는 없다.

각 읽기는 하나의 read-only snapshot을 사용한다. 단건은 해당 operationId의 결과 전부, run 조회는 선택 run의 결과 전부를 take 전에 인증·복호화하고 부모를 검사한다. 따라서 take0·출력250 밖·음수 선택 밖에 손상된 고려 후보가 있어도 실패한다. 이는 원본 PG보다 엄격한 명시 Mongo 경계이며 PG의 기존 보장이라고 주장하지 않는다.

- Result의 Run은 필수다. nullable session은 허용하고, non-null session은 같은 namespace/snapshot에서 정확한 `_id` 존재만 확인한다.
- session의 삭제 상태·현재 operationId·현재 회사/과정 이름을 과거 이력의 새 조건으로 강제하지 않는다. session의 무관한 개인정보 payload는 읽지 않는다.
- 미선택 Run의 private payload, 다른 operation/run의 무관한 결과를 전역 감사하지 않는다. 선택에 쓰는 identity·시각은 검증한다.
- 정상 빈 결과는 null 또는 빈 results이다. 고려 후보의 손상·키·부모·자원·driver 오류는 원문/cause 없는 고정 `DRIVE_IMPORT_HISTORY_READ_FAILED`다.

스캔별 15초·20,000행·32MiB와 호출별 60초·누적20,000행·32MiB를 적용한다. 실제 받은 raw BSON 전체 batch, 선택 projection·full 재조회·부모를 모두 계상한다. 출력250은 이 한도와 다르다. 정확 행/byte 한도는 포함하고 시간은 만료 시각부터 실패한다. 초과분을 버려 부분 성공으로 반환하지 않는다. 공통 store나 Calendar lease의 제한은 바꾸지 않았다.

자동 transaction 재시도 없이 bounded single-batch keyset 쿼리를 사용한다. cursor close·session end를 await하고 각 cleanup에도 제한을 준다. 실패 이후 정리 시간은 정상 처리 deadline과 구분한다. 드라이버의 로컬 session 종료만으로 모든 네트워크 장애에서 서버 정리가 즉시 완료됐다고 주장하지 않는다.

## 저장 보호와 응답의 구분

반환되는 inputValue·폴더 제목/URL·후보·이슈·저장 error는 기존 승인 DTO에 맞춰 복호화한다. Run summary/notes·Result folderId는 반환 필드에 추가하지 않으면서 full codec 인증을 수행한다. 저장된 과거 오류의 표시와 새 runtime 예외의 로그 비노출을 구분한다.

Drive 모델의 snapshot `companyName`/`courseName`은 현행 privacy registry의 보호 대상이 아니다. 이번 작업은 이 분류를 암호화 제외 승인으로 인정하지 않으며 전체 개인정보 보호가 끝났다고 주장하지 않는다. 이름이 포함될 수 있는 snapshot 문자열의 정책 대조는 전체 전환의 잔여 보안 검토 항목이다.

명시 `prepareMongoDriveImportHistory`는 별도 합성 setup에서만 실행한다. 기존 세 collection의 metadata와 과거 문서 정책을 먼저 검사하고 모두 적합할 때 누락 collection만 만든다. 기존 namespace의 자동 삭제·수리·`collMod`는 하지 않는다. 정책이 다른 shadow는 기존 절차대로 새 shadow 복사 또는 별도 명시 변환 대상이다.

## 미완료 범위

- `drive:import:dry-run`은 실제 run/result를 저장하는 CLI다. 조회 전환이나 테스트 seed를 writer 전환으로 세지 않는다. 사용 여부·source scan/search·암호화 writer·실패/재실행은 별도다.
- Sheets/Notion 실제 원천, Drive candidate/apply, Calendar 등록 bundle을 포함한 전체 요청·페이지·CLI·예약 작업 조립, backup/health는 별도다.
- 페이지 검증은 실제 reader·workspace guard·page의 SSR 통합이다. 실제 브라우저·Google OAuth·운영 권한 검증을 대신하지 않는다.
- 운영 키·설정·DB·배포는 변경하지 않았다. 실제 A/B 백업·복원·복사·최종 전환 증거는0이다. dev→main 완료 조건은 충족하지 않았다.
