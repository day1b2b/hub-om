# Clarify Result — Google Sheets import boundary

2026-09-30. 상태: 사전계획 v1, 독립 계획 검토 대기. 실행 수락 아님.

## 목표와 위임

상위 사용자의 계속 구현 승인은 유효하다. 이번 사전계획 위임 산출물은 지정 외부 경로의 clarify-result.md, plan-v1.md, validation-v1.md 세 파일이다. 이번 하위 역할의 plan-only 제한을 상위 구현 승인 취소로 해석하지 않는다. 현재 Drive 최종 수락 전 다음 구현을 시작하지 않는다. Drive 최종 baseline SHA는 향후 확정해야 하며, 현재 branch/작업 트리를 frozen 원본으로 선언하지 않는다.

다음 최소 수직 단위는 POST google-sheets/tabs → POST google-sheets/import → 기존 Mongo staging이다. UI 복원이나 실제 Google 연결을 포함하지 않는다. 원본 기본 HTTP/PG 경로를 보존하면서 명시 scope에서 합성 원천과 기존 Mongo imports를 조합하고, 원천 접근 전에 필요한 저장소 경계를 확인한다.

## 대안과 선택

| 대안 | 이점 | 비용·위험 | 선택 |
| --- | --- | --- | --- |
| Sheets 두 API | 단일 tab/values 읽기와 기존 parseImportTable/storeParsedImport 재사용. staging과 검토까지 닫힌 작은 경계 | UI 호출 부재, OAuth Sheets 권한 미요청. 실제 기능 복원 완료로 주장할 수 없음 | 이번 사전계획 대상으로 선택 |
| Notion import | 같은 staging 재사용 가능 | token/env/team 기본값, cursor pagination, page→row 매핑, 원천 rowCount와 저장 rowCount 차이를 별도 증명해야 함 | 다음 별도 Task. 이번에 일반 원천 프레임워크로 합치지 않음 |

선택 이유는 현재 사용량이 아니라 저장소 경계의 작은 구현 범위다. 사용자에게 현재 Sheets UI가 있다고 가정하지 않는다.

## 확인 근거와 원본 호출 경로

아래 경로는 /Users/ga/workspace/hub-om-mongodb-coach-content 기준이다. 실제 코드 정적 읽기이며 API/DB 실행 관찰이 아니다.

- src/app/api/admin/imports/google-sheets/tabs/route.ts: 실제 export POST=withActivity. requireWorkspaceSession → googleAccessToken → request.json → parseGoogleSpreadsheetUrl → listGoogleSheetTabs → JSON.
- src/app/api/admin/imports/google-sheets/import/route.ts: 같은 인증 → tabTitle.trim → URL parser → readGoogleSheetRows → parseImportTable → storeParsedImport → JSON. 현재 fetch가 imports/roster scope 확인보다 먼저다.
- src/lib/data/googleSheetsImport.ts: 공개 export GoogleSheetTab, parseGoogleSpreadsheetUrl, listGoogleSheetTabs, readGoogleSheetRows. 내부 fetchGoogleSheetsApi/quoteSheetTitle 포함 HTTP 동작 보존.
- src/lib/data/importStagingWriter.ts: scope imports 우선. 무scope는 getPrismaClient + 직접 PrismaTeamMemberRepository + PrismaInstructorNoteRepository; OPERATION_DATA_SOURCE=local/notion이어도 기본 PG 저장 정책.
- src/lib/data/mongoImportRepository.ts: storeParsedImport는 teamMembers.listRoleRosters / instructorNote.listNotes를 확인·읽은 뒤 기존 validation/중복조회/원자 저장. DataImportRun + OperationSourceRecord. 이 두 모델의 mutation audit 제외, 별도 withActivity 요청 감사 유지.
- src/lib/data/dataRepositoryContext.ts: scope 밖 undefined, scope 안 누락 throw. requestActivity는 src/lib/activity/request.ts의 wrapper 시작 시 확인되며 런타임 감사 실패는 best-effort.
- 실제 UI: src/app/admin/imports/page.tsx → features/imports/ImportAdminDashboard.tsx → ImportUploadPanel.tsx → /api/admin/imports/upload → /admin/imports/{id}. 별도 ImportPromoteButton은 promote API. 현재 TSX 검색에서 Sheets 두 API 호출 없음.
- src/auth.ts: Sheets 링크 UI 제거 기록과 현재 OAuth scope openid/email/profile만 있음. 만족도 preview/link/apply는 동일 googleSheetsImport export의 별도 호출자다. 이번에 바꾸지 않는다. 검색 범위는 저장소 src/public/scripts이며 외부 호출자·실운영 사용량은 미확인.
- docs/operations/source-read-contract.md의 OperationSourceReader는 readCourseBoard/readCalendarEvents/readDiscussionReferences/readSalesRecords 계약이다. 이번 두 메서드 원천 port와 다르다. OPERATION_SOURCE_READER_MODULE/disabled/partial 정책을 가져오지 않는다.
- docs/operations/mongodb-runtime-coverage.md, mongodb-cutover-remaining.md 및 .claude/plans/mongodb-import-staging/plan-v2.md의 기존 한계·동시성 계약을 따른다.

## 요구사항

| ID | 요구사항 |
| --- | --- |
| R1 | 두 POST와 그 최소 경계만 구현 대상으로 삼는다. 이번 실제 쓰기는 외부 계획 3파일만. Drive frozen 테스트·원본·제품 무변경. |
| R2 | 최종 Drive 수락 및 SHA 확정 뒤 original closure를 동결한다. 실제 loader/runtime hash와 independent literal oracle, 원본 변조 검출을 포함한다. |
| R3 | 기존 exports/HTTP 요청·응답 해석·tabs 순서와 인증을 보존한다. UI/OAuth/만족도/Notion/OperationSourceReader 변경 없음. |
| R4 | 기본은 기존 HTTP+PG. 명시 scope는 source/requestActivity 및 import의 imports/teamMembers/instructorNote를 fetch 전에 확인. 누락 때 원천·업무 저장·PG/local/Notion fallback 0. |
| R5 | 원본 파싱/팀·연도·이름 기본값/빈행/오류행/중복·건수/whole DTO·저장 의미 보존. 자동 승격·Company/Course/OperationSession 갱신 없음. |
| R6 | 원천 token·원문·식별자·driver 오류는 응답/콘솔/감사에 비승인 노출하지 않는다. 고정 allowlist만 공개. rawHTTP 실패의 보안 보완 차이를 명시한다. |
| R7 | 기존 staging 암호화/companion/부모참조/예산/원자성/두 동시 중복 schedule 보존. 새 schema·unique·guard·재시도 정책 없음. request audit 실패와 commit 실패 구별. |
| R8 | 독립 frozen PG/current PG/native actual handler+합성 raw HTTP로 전체 응답 및 persisted semantic tuple 검증. mock-only를 native 저장이나 실제 Google 증거라 부르지 않는다. |
| R9 | 비동기 요청 scope·namespace·token 격리, 실패 후 복구, no external fallback을 검증. registered Calendar 전체 조립은 별도 후속. |
| R10 | type/lint/build·영향 회귀·최종 source hash·불변 runner·소유 자원 정리·독립 검토를 실행 단계에서 기록. 미실행은 pending. 운영 이전/실원천/OAuth/UI 활성화 완료 주장 금지. |

## 제약·미정·수락 경계

- 이번 단계: 저장소 코드/문서/branch/DB/tests/network/env 읽기·변경 없음(공개 소스/문서 읽기만 허용). 운영·원천 접근 없음. 원격 fetch도 수행하지 않는다.
- 구현 단계의 synthetic shadow prepare/test seed/owned cleanup은 검증상 필요하고 허용할 범위다. 원천 시스템 쓰기는 계속 0. staging 업무 쓰기는 이번 수직 기능의 의도된 동작이다.
- 새 업무 정책 질문 없음. 기술 gate: 최종 SHA/원본 closure, 합성 endpoint 소유 확인, 원본 동적 ID/시각 비교 정책, current source port 연결. 실제 OAuth 복원은 범위 밖이라 지금 결정하지 않는다.
- harness sizing: Effort/Complexity/Uncertainty/Risk/Validation/Handoff 각 1, 6/6 → Level3. 기술 불확실성은 actual 원본 oracle로 닫는다. 이 표의 축 이름과 요구사항 R1~R10은 별도 식별 체계다.
- 이번 v1은 작성자 구조 자체검토까지이며 독립 critic/architect 수락은 부모가 진행한다. 실행 결과는 전부 pending.
