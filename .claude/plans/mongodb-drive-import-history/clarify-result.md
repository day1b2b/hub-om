# Clarify Result — next-drive-history-read

상태: 계획 초안만 작성. Calendar는 최종 검사·독립 수락 중인 현재 Task다. 이 문서는 Calendar 수락/통합, Drive 구현 또는 실행 PASS를 의미하지 않는다.

## 목표·이유

Calendar 다음 후보로 Drive 저장 이력의 두 조회 함수 → 기존 `/drive-import-runs` 페이지를 명시 저장소 경계로 옮기는 작은 Task를 준비한다. 외부 Drive 조회·적재 없이 이미 저장된 합성 이력으로 PG 의미와 명시 Mongo 읽기 경계를 검증할 수 있다.
이번 사전계획 위임 산출물은 외부 디렉터리의 clarify-result.md, plan-v1.md, validation-v1.md 세 파일이다. 사람 사용자의 원래 승인은 구현 지속이며 계획 전용으로 축소되지 않는다. 저장소 코드/문서, branch, DB, 테스트 실행, 네트워크를 변경/접근하지 않는 제한은 조정자가 이번 준비 하위 작업에 정한 경계다. 스킬 기본 산출 경로 및 Step 6까지 진행보다 이 위임 범위가 우선한다.

## 두 선택지

| 후보 | 장점 | 비용·위험 | 결정 |
| --- | --- | --- | --- |
| Drive 이력 read→page | 확인된 화면 호출, 두 조회, 두 이력 모델 중심. 기존 원천 접근 없이 DTO/정렬/권한을 검증 가능 | PG catch/null, 250 동률, 암호화·필수 부모, 페이지 scope 조립 검증 필요. writer는 완료되지 않음 | 우선 추천 |
| Sheets import→기존 staging | 이미 있는 staging 저장 경계 재사용 가능 | Google 토큰·원천 응답·파싱·읽기 전 scope·오류 노출과 실제 API 흐름이 연결됨 | 다음 별도 후보로 보존 |

작게 읽기를 먼저 하는 것은 Sheets/Notion/Drive writer가 불필요하다는 판단이 아니다.

## 요구사항·성공 기준

- R1: 기존 두 export, 인자 기본값, 반환 DTO의 모든 필드·타입·null/빈값·순서·원본 PG catch→null 보존. 기본 backend PG 유지.
- R2: 명시 scope는 누락 시 default PG/local/Notion fallback 없이 실패. 페이지 인증 우선, 의존 저장소 preflight 후 데이터 읽기. Calendar 등록 scope/잠금 불변식을 손상시키지 않음.
- R3: 단건의 run.startedAt↓/createdAt↓, run의 startedAt↓, 결과 candidateCount↓/companyName↑/courseName↑ 및 기본 take=250 유지. 동률의 원본 비결정성을 허용집합으로 판정하고 새 tie-break 업무 규칙을 만들지 않음.
- R4: 기존 privacy registry/codec·raw 오류 비노출·run 필수 관계·nullable operationSession 관계를 구분. 정상 empty와 깨진 명시 Mongo 저장 상태를 구별. 기존 인증 사용자의 합법적인 저장 DTO 표시를 임의 마스킹하지 않음.
- R5: 실제 페이지의 인증/빈 상태/요약/행/링크/후보·이슈 제한을 유지. 현재 전역 최신 run을 팀 필터된 이력이라고 주장하지 않으며 팀 권한 정책을 신설하지 않음.
- R6: 원본 closure와 해시를 동결하고 별도 PG/current PG/native Mongo full DTO oracle 및 실제 페이지 검증을 설계. 현재 helper를 원본 oracle로 재사용하지 않음. 합성 로컬 전용, 외부 호출 0.
- R7: 제품 runtime 이력 조회 경로의 업무 데이터·감사 쓰기 없음. 구현 단계의 명시적 소유 synthetic shadow prepare/index/metadata 준비와 test seed·정리는 허용되며 읽기 함수와 분리한다. 이번 준비에서는 외부 계획 세 파일 외 쓰기 없음. 활성 Calendar 파일 보호, 실제 Drive/CLI writer/전체 런타임 조립·backup/health/운영전환 미완료를 유지. 실행 근거·정리·독립 수락·통합을 별도 단계로 기록.

## 확인한 원본과 증거 위치

저장소 root: `/Users/ga/workspace/hub-om-mongodb-coach-content` (아래 경로는 이 root 기준).
읽기 시 branch `feature/20260930-mongodb-calendar-boundary`, HEAD `8238647961bebe3545128fc95f017881ace7d404`. Calendar 작업 파일은 HEAD 밖의 진행 중 변경이므로 이를 Drive 최종 baseline이라고 고정하지 않는다.

- `src/lib/driveImports/driveImportResults.ts:73,110`: 두 조회. DATABASE_URL 없으면 null; Prisma 조회/복호화/DTO 변환 예외를 catch하고 null. 상태 필터·운영 soft-delete 필터·팀 필터 없음.
- `src/app/drive-import-runs/page.tsx:18`: requireWorkspaceSession 후 stored teamMembers와 최신 run, searchParams를 읽음. teamScope는 탐색/링크에 사용. 현재 페이지는 전체 최신 run을 표시한다.
- `src/lib/auth/requireWorkspaceSession.ts`, `src/lib/data/teamMemberRepositoryFactory.ts`: workspace 이메일 인증·기존 개발 bypass, 저장용 명단의 local/PG 기본 경로. 일반 Notion 명단 factory와 혼동 금지.
- `prisma/schema.prisma:272,302`: DriveImportRun/Result, 필수 runId(Cascade), nullable operationSessionId. 이력의 companyName/courseName은 자체 snapshot 문자열이다.
- `src/lib/privacy/fields.json:210,229`: Run summary/notes 및 Result inputValue/folderId/folderTitle/folderUrl/keyCandidates/folderCandidates/issues/error 보호. companyName/courseName/operationId는 이 모델의 현재 registry에는 없다. 이 목록을 전체 개인정보 보호 충족 승인으로 해석하지 않는다.
- `src/lib/data/dataRepositoryContext.ts:101`: 명시 scope 누락 실패와 등록 Calendar composition 검사. `mongoOperationStore.ts:8,49`: 기존 bounded scan/codec 기반.
- `scripts/run-drive-import-dry-run.mjs:85,119,130,220` + `scripts/assert-legacy-storage.mjs`: 원천 조회와 PG 실행/결과 INSERT·run UPDATE. 암호화 저장소에서 legacy guard로 거부. package.json의 drive:import:dry-run 등록 확인; 실제 예약/배포 실행 여부 미확인.
- `docs/operations/mongodb-runtime-coverage.md`, `mongodb-cutover-remaining.md`, `.claude/plans/mongodb-read-repositories/macro-plan.md`: 기능 경계와 전체 앱 조립/운영 이전 분리 근거.

src 검색에서 run 조회의 실제 페이지 호출을 확인했다. 단건 조회 및 DriveImportResultDialog의 추가 runtime 사용은 이번 검색에서 확인되지 않았다. export/컴포넌트를 제거하거나 미사용 판정하지 않는다.

## 승인·열린 사항

목표/이유/성공 기준/제약 4개가 제공되어 추가 확인 질문 없음. 사람 사용자의 구현 지속 승인은 유효하다. 이번 조정자 위임은 사전계획 작성이며, 이를 완료한 뒤 상위 구현 흐름은 기존 승인에 따라 계속한다.
기술 증거로 닫을 항목: 원본 PG collation·Prisma take 특수값 의미, closure 해시, nullable 관계/키 손상 처리, 실제 페이지 테스트 방법. 이는 업무 결정을 사용자에게 떠넘길 항목이 아니다.
사업 판단이 실제로 필요한 경우만 상위에 제시: 팀별 이력 제한 신설, 기존 snapshot 이름 필드의 암호화 정책 확대, 동률 tie-break 고정, CLI writer 포함으로 범위 확대. 현재는 모두 신설하지 않는다. 기존 이름 필드 정책이 상위 PII 필수 게이트와 충돌하면 별도 gap으로 공개하며 전체 전환을 수락하지 않는다.

## Level 3 및 인계

R1=1(여러 계층·테스트), R2=1(저장 contract+page composition), R3=1(collation/limit/기존 암호화 증거 필요), R4=1(조회·PII·권한), R5=1(full DTO·사용자 화면), R6=1(Calendar 후속 인계): 6/6, Level 3. 계약 변경/R4/R5는 최소 Level 2이며 점수로 Level 3 선택. downgrade 없음.
적용: development-harness 및 해당 harness가 지정한 `/Users/ga/.codex/skills/validated-plan/SKILL.md`. 이번 단계는 v1까지이며 same-session 작성·검토다. 독립 critic/architect 검토 완료로 표시하지 않는다.
Lifecycle=candidate, artifact=planning, 전체 Task handoff-incomplete. 계획 문서 작성만 완료 가능. 실행 verification/validation=NOT_RUN.
Alignment=update_next_task (제안). 저장소 macro/coverage/handoff 반영은 deferred; Calendar 수락 후 담당자가 처리한다.
Do Next: 이 세 파일을 순서대로 읽고 독립 메타검토→validation-v2/plan 리뷰→plan-v2. Calendar 최종 수락/통합 baseline 확인 후 조정자가 기존 구현 승인 아래 다음 실행 단위를 진행한다. 단순 단계 전환 재승인은 요구하지 않는다.
Do Not: 현재 Calendar 수락 선점, 현재 branch 제품 수정, 실제 Drive/DB/운영키 접근, CLI guard 우회, 원본 oracle 변경.
Resume action=continue_current_task (계획 성숙만). 실제 실행 evidence/manifest/review/alignment/cleanup/integration은 이후 산출물이며 현재 존재하거나 PASS라고 주장하지 않는다.
