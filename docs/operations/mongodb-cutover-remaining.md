# 서비스 이전까지 남은 순서

2026-09-29, 총괄 39c70e2 및 활동 조회 작업의 코드 조사 기준. 최신 통합 여부는 각 작업의 integration-review를 따른다. 운영에 접속하지 않았으며 날짜나 완료율을 추정하지 않는다. 기능별 최신 증거는 [runtime coverage](mongodb-runtime-coverage.md)와 각 실행·통합 기록을 따른다.

서비스를 Mongo로 옮기는 시점은 아래 세 단계의 차단 항목을 닫고 운영 실행 조건을 확인한 뒤다. 기능 repository 구현이 끝난 시점이나 dev→main 코드 병합만으로 이전 완료를 판단하지 않는다.

## 1. 남은 코드 기능군

| 남은 단위 | 실제 남은 호출 근거 | 선행 관계와 외부 조치 |
| --- | --- | --- |
| OM 접수·배정 | omRequestLocalRepository/omRequestAssignment는 실제 PG 호출. 이름의 Local은 운영 DB 미사용을 뜻하지 않음 | 접수와 OperationSession 배정의 원자성·권한/명단을 함께 검증. 개발은 합성 데이터로 진행 가능 |
| 가져오기·staging·승격·Drive 기록 | prismaImportRepository/importStagingWriter/importPromotionService/driveImportResults. 직접 Prisma 명단·강사 위키 조회도 존재 | 표준 운영 writer·명단 경계를 연결한 뒤 staging/승격/재실행. 합성 원천 검증 가능, 실제 원천 연결/적재는 별도 실행 조건 필요 |
| 강사 Notion 동기화 | notionInstructorSync 직접 PG upsert | 기존 위키 저장 경계를 재사용하되 동기화 writer·원천 오류/재실행 별도. 실제 Notion 접속은 이번 승인 밖 |
| 매출 동기화 | salesRevenueSync 직접 PG | 과정/감사 경계 위에서 금액·충돌·재실행 대조. 실제 금액 변경/원천 읽기는 별도 운영 조건 필요 |
| Calendar 반영·역동기화 | calendarEventLinkRepository/operationSessionTimestamps의 PG와 calendarOperationLock의 raw pg.Pool | 단순 운영 CRUD 구현과 별개. 저장 연결·시각·프로세스 간 잠금·외부 부작용을 같이 검증. 실제 Google 권한/캘린더 반영은 외부 조치 필요 |
| 백업·health | api/admin/backup raw snapshot, api/health PG 조회 | 전체 Mongo 선택과 함께 백업/복원·상태 판정 계약 설계. 실제 복원 검증은 3단계 |
| CLI·예약 작업·브라우저 초안 | coverage는 src runtime 중심. 기존 backfill CLI/배포 entrypoint/로컬 파일·브라우저 저장은 별도 점검 | 사용 중인 실행 경로를 식별하고 필요한 전환만 진행. 브라우저 암호화를 DB 암호화로 갈음하지 않음 |

이미 완료된 운영 CRUD·코치 인증/토큰/개인정보 내보내기·일정/예약/투입/평가·코치 시트/Notion 동기화·코치 관리/콘텐츠·담당자 내 페이지·토큰 보완·관리자 과정/삭제 운영/보정/과정명 복원·관리자 DB·공지/첨부·활동 조회 경계 전환을 새 미전환 기능으로 반복하지 않는다. 단, 이들의 전체 앱 연결은 다음 단계에 포함한다.

## 2. 전체 Mongo 실행 연결

`runWithDataRepositories`는 현재 테스트/내부 명시 주입 장치다. 생산 요청 전체를 구성하는 진입점은 아직 없다. 여러 factory는 기본 PG adapter를 반환하며, operationRepositoryFactory는 CalendarReflectingOperationRepository(new PrismaOperationRepository()), coachRepositoryFactory는 Prisma 고정이다. 일반 getTeamMemberRepository의 local/Prisma/Notion 선택과 저장용 명단 scope도 구분해야 한다.

남은 기능 구현과 병행해 전체 요청·페이지·작업 실행의 저장소 묶음, 원천 adapter, 요청 감사, Calendar 부작용, 키/오류 처리를 일관되게 연결한다. 누락된 저장소가 PG로 넘어가지 않는지 검사하고 실제 앱/브라우저·권한 흐름을 통합 확인한다. 환경변수 이름만 바꾸는 것으로 완료되지 않는다. 이 연결 코드는 먼저 격리 환경에서 검증하고 운영 설정은 바꾸지 않는다.

health·백업·배포 entrypoint의 Prisma migration 실행 및 활성 CLI/예약 작업을 함께 점검해야 한다. 완성된 repository를 다시 만드는 단계가 아니라 실제 사용 경로에 맞춰 묶고 검증하는 단계다.

## 3. 실제 복사·복원·최종 전환

1. 운영 데이터 범위·백업·키 보존/복구·권한·검증 지표와 중단/복귀 조건을 확정한다. 실제 운영 접근과 쓰기는 승인된 범위/백업 확인이 필요하다.
2. PG legacy 평문/암호화·HMAC·필수 schema 상태를 확인하고, 필요한 backfill/enforce의 적용 순서를 실행한다. 기존 shadow는 자동 삭제/수리하지 않고 새 namespace 복사 또는 명시 변환 절차를 따른다.
3. 실제 데이터를 일관된 snapshot으로 복사하고 모델별 건수·관계·암호화·식별자·파일 bytes·동기화 상태를 대조한다. 복사 후 변경분·삭제 반영과 재실행도 검증한다.
4. 백업에서 별도 환경으로 실제 복원하고 앱 주요 흐름과 키 복구를 확인한다. Mongo 장애 시 PG 복귀 및 전환 후 쓰기 처리 방안을 검증한다.
5. 최종 쓰기 중단 구간·동기화/sequence 재확인 후 생산 backend·health·작업 설정을 함께 바꾸고 기능/오류/감사를 확인한다. 조건 미충족 시 사전에 정한 복귀 절차를 실행한다.

1단계의 개발·합성 검증은 기존 승인으로 계속 가능하다. 2단계의 격리 앱 연결 검증도 운영 설정 없이 진행할 수 있다. 3단계는 운영 백업·키/접근권한·실데이터 범위·전환 시간대·복구 책임자 등 외부 조치가 필요하며 과거 승인 이력과 별개로 최종 작업의 구체적인 백업·대상 범위·실행 조건 확인 및 완료 증거는 아직 없다. 2026-09-29 저장된 hub-om 개발 진행 heartbeat는 ACTIVE로 읽기 확인했다. 이 자동화 상태는 운영 DB·배포의 자동 실행을 허용하지 않으며 이번 작업에서 자동화 설정을 변경하지 않았다.

다음 개발 후보는 강사 Notion 동기화의 저장·합성 원천 경계다. 기존 강사 위키 저장소를 재사용하면서 NO/이름 매칭, 수동 입력값 보존, dry-run·재실행·부분 오류·감사와 경합을 별도 계획에서 확정한다. 실제 Notion 접속 없이 개발 검증이 가능하다. OM 접수·배정의 운영 생성·Slack 부작용보다 좁은 단위이며, 실제 원천 연결은 기존 운영 조건을 별도로 확인해야 한다. 아직 다음 단위 구현은 시작하지 않았다.
