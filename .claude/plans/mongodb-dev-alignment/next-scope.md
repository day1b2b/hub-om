# 다음 필수 전환 조사

2026-09-30. Mill 읽기 전용 조사와 기존 parent 코드 확인을 통합했다. 운영 사용량·설정·외부 예약 작업은 확인하지 않았다. 미사용 추정으로 기능을 제외하지 않는다.

## 우선 단위: 엑셀 업로드 → staging → 목록·상세 검토

관리자 메뉴/`src/app/admin/imports/page.tsx` → `ImportUploadPanel` → `/api/admin/imports/upload` → 상세 페이지가 코드로 연결돼 있다. 두 페이지는 `PrismaImportRepository`를 직접 생성한다. upload는 5MB 및 빈 행 제한, stored/duplicate/error 건수 응답을 유지한다. 현재 import 전용 context가 없다.

staging은 실제 저장용 명단·강사노트 조회, 지문과 sourceTeam/sourceName/sourceType 중복 조건, 업로드 내 중복, 전체 transaction, 원문 snapshot/검증오류 보존이 필요하다. sourceName·sourceSheet 등이 암호화되므로 raw equality/암호문 정렬을 그대로 사용하지 않는다. 기존 codec·HMAC 조회 후 원문 확인을 사용하고 PG oracle로 DTO/순서를 대조한다.

권한: 페이지는 requireAdminSession, upload/승격/Sheets/Notion/template API는 requireWorkspaceSession이다. 기존 차이를 Mongo 전환 중 임의 변경하지 않는다. 권한 확대나 기존 차이가 해결됐다는 주장을 하지 않는다. shadow 검증에서는 기존 허용/거부를 각각 검증한다.

실제 upload POST의 withActivity가 요구하는 requestActivity도 같은 scope에 포함한다. 허용·거부 요청 감사와 PG fallback 차단을 검증한다.

최소 단위는 업로드/검토까지다. 승격 전체는 후속 필수이며 Mongo staging run을 PG 승격으로 넘기는 구성은 배포하지 않는다. 기본 PG 유지·명시 scope의 미설정 경계 거부를 보존한다.

## 후속 승격과 Calendar

`ImportPromoteButton`은 run ID만 보낸다. `promoteReadyImportRows`는 Notion sourceType을 서버에서도 거부한다. 상세 표시는 최대200행이지만 승격은 해당 run의 전체 미연결 행을 처리한다. 저장된 검증 오류, OM·LD·기업·과정 누락, 날짜 누락/역전은 기존 서버 규칙으로 차단하며 UI의 적용 준비 표시를 허가 근거로 사용하지 않는다. 결정적 operationId, 삭제 행 재활성화, 기존 지문/업무키 연결, 미연결 행만 처리, transaction/요약을 유지한다.

승격 API는 성공 후 `backfillMissingCalendarEvents({dryRun:false})`를 호출한다. 이는 해당 run에 한정되지 않은 운영 목록·매핑·팀 사용자를 조회하며 매핑은 PG, 잠금은 raw PG다. 실패가 승격 성공을 취소하지 않는 기존 계약, 기본 상한100·메일 억제를 보존한다. 저장/합성 부수효과 경계를 먼저 마련한다.

## 제외하면 안 되는 잔존 경로

- Sheets/Notion import API는 동일 staging writer를 호출한다. UI 호출 미발견만으로 폐쇄하지 않는다. 실원천 없이 source port/합성 응답으로 검증한다.
- `/drive-import-runs`는 최근250개 읽기 화면. reader는 직접 PG이며 오류/null 계약이 있다. `readLatestDriveImportResult` 및 Drive 패널 상위 호출자는 미발견이다.
- `/api/operations/[operationId]/drive-import/apply`는 일반 운영 편집·자동저장에서도 사용된다. Drive UI 미사용 여부와 무관하게 보존한다.
- `scripts/run-drive-import-dry-run.mjs`는 이름과 달리 run/result SQL 쓰기를 한다. `import-operations-from-local-json.mjs`와 `promote-source-only-operations.mjs`도 별도 SQL 경로다. 셋의 legacy 암호화 가드 존재를 실제 배포에서 차단된다는 증거로 쓰지 않는다.
- npm 명령과 Docker scripts 복사는 존재한다. 저장소 workflow에서 import 예약은 미발견이나 외부 cron/Coolify는 미확인이다.

다음 단위 시작 전 최신 dev/총괄 fetch 및 겹침 확인, 별도 feature/작업 계획·독립 검토 후 구현한다. 새 정책·운영 접속·실데이터 쓰기는 수행하지 않는다.

Franklin의 독립 조사 검토에서 요청 감사, 표시200행/전체 승격 구분, 서버 적격성 판단을 보완했다. 이는 다음 구현의 검증 기준이며 구현 완료 증거가 아니다.
