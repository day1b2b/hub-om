# 후속 단위 준비 — 운영 승격

현재 staging 완료 여부와 별개인 사전 조사다. 후속 구현은 이 단위의 검증·통합 후 별도 브랜치에서 한다. 현재 기본PG·실원천·배포 설정은 바꾸지 않는다.

## 현재 코드에서 확인한 계약

- `importPromotionService.ts`는 run의 미연결 원천 행 전체를 시트/행 순으로 읽어 한 PG transaction에서 반영한다. 상세 UI의 200건 제한은 승격 제한이 아니다.
- sourceType에 notion이 포함되면 서버에서 차단한다. run이 없으면 현재 서비스는 빈 sourceRows 요약을 반환한다. 이를 임의 404 정책으로 바꾸지 않는다.
- validationErrors, OM/LD, 기업/과정/날짜의 순서 있는 검증을 유지한다. 차단 이유는 사용자에게 허용된 결과지만 저장 감사/오류와 구분한다.
- 지문으로 기존 운영을 먼저 찾고 삭제 표시 건도 포함한다. 삭제 상태면 기존 값 생성 규칙으로 복원하되 operationId/과정 연결/지문은 유지한다. 정상 기존 건이면 원천 행만 연결한다.
- 지문이 없거나 못 찾으면 활성 운영의 기업 정규화명·과정명·시작/종료일로 매칭한다. 기업/과정 upsert 후 신규 운영 생성은 마지막 분기다.
- `stableOperationId`의 기존 지문 앞12문자 결정성을 유지한다. 서로 다른 지문의 앞부분 충돌은 unique 실패로 전체 abort해야 하며 새 중복 정책을 만들지 않는다.
- Course.processSeq는 기존 내부 counter와 PG sequence high-water 계약을 사용한다. `numericMoney`의 PG 반올림/overflow 검증을 재사용할지 실제 oracle로 판단한다.
- actual promote POST는 workspace 권한이고 commit 뒤 Calendar 전체 backfill을 수행한다. Calendar 실패는 commit을 취소하지 않는다. 기존 기본 suppress-mail/100event/예정·교육일 조건을 유지한다.

## 검토할 구현안

1. 기존 알고리즘을 좁은 transaction port와 순수 값 변환으로 분리하고 PG/Mongo adapter를 둔다. 원본 파일을 byte 동결해 공유 로직 자체의 회귀를 검출한다. 기존 service export와 PG 기본은 유지한다.
2. 범용 Prisma 호환 Mongo adapter는 관계/sequence/감사·경쟁 의미를 숨기므로 사용하지 않는다. 이미 존재하는 일반 operation.create를 반복 호출하는 방식도 한 transaction과 원본승격 규칙을 깨므로 사용하지 않는다.

후속 plan에서 감사 exact 집합, source link와 과정명복원 역의존 경합의 guard 참여, sequence exhaustion, 금액/날짜/UUID, 잘못된키·원문조회, 원자성/재시도/unknowncommit, Calendar 부수효과의 선행scope검사까지 확정한다. 합성 실제PG/Mongo 원본대조와 actual handler로 검증하고 실Google은 호출하지 않는다. promotion 후 실제Sheets/Notion 저장 경계, Drive 기록, Calendar 저장·잠금, backup/health, CLI/전체앱구성을 계속한다.

## 독립 후속 inventory (Carver, 읽기 전용)

- 활동 쓰기/보존: `MongoRequestAuditRepository`와 handler 검증은 이미 있다. PG 요청감사 2.5초 제한과 Mongo insert의 지연 계약, PG 두표 동일 transaction retention과 Mongo 순차 delete의 부분실패 차이, instance별 lastPruned를 검증·보완한다. `scripts/prune-activity.ts` 명시 backend 연결도 필요하다. 기존 구현을 다시 만들지 않는다.
- backup API: 기존 권한은 BACKUP_API_SECRET 또는 명시 PII 관리자. 코치11모델+archive snapshot 메타20건의 복호화 JSON 다운로드다. 전체 DB snapshot/암호화된 이중백업/복원 도구가 아니다. backend 연결과 전체 복구 구축을 구분하며 기존 권한을 임의 확대하지 않는다.
- health/시작: 현재 공개 PG SELECT1, 운영오류고정/비운영 raw message. 선택 backend의 상태를 판정하고 Mongo 경로가 PG migration을 실행하지 않도록 시작 경계를 검증한다. 운영 설정은 바꾸지 않는다.
- 전체 조립: 테스트 외 runWithDataRepositories 호출은 아직 없다. coachRepositoryFactory는 공개 coach scope 없이 PG고정이다. Drive 이력은 실패를 null로 가려 앱이 열린다는 것만으로 연결 성공을 판단할 수 없다. operation override는 Calendar 래퍼를 자동 적용하지 않는다.
- sequence: PG exporter는 last_value/is_called를 읽고 manifest에는 last_value만 남긴다. Mongo importer는 내부 counter를 자동 구성하지 않는다. 기존 preparation high-water/공유counter를 조립한다. Mongo transaction rollback의 번호 재사용은 PG nextval 결번과 다르므로 동등한 번호열로 주장하지 않는다. 안전한 고유성·단조성·미사용sequence/삭제최고번호/고갈·재시작 계약을 명시한다.
- 놓치지 않을 경계: Sheets/Notion import+tabs는 원천조회가 scope검사보다 앞선다. Calendar sync/backfill/refresh, Drive dry-run CLI의 실제 SQL INSERT, lecture-followup의 Slack/임시파일 중복기록, sync/source routes, om-custom-tools 로컬파일, company merge/seed/관리CLI와 legacy-storage guard.
- 활성 예약·Coolify probe·외부 env는 미확인이다. 불명확한 CLI를 제외하거나 삭제하지 않는다. 브라우저 임시 초안은 후속이지만 실제 DB·첨부·필수보조파일의 보호/백업은 유지한다.
- 별도 최소Task: activity write/retention, backup API, health/시작, 전체 app/sequence. 이 네 Task가 승격·Calendar·Drive를 대체하지 않는다. token backfill CLI는 이미 명시scope전환되어 반복하지 않는다.

## Calendar 독립 보존 조건 (Parfit, 읽기 전용)

- PG 경계3개는 event link CRUD, OperationSession.updatedAt 조회, 전용 pg.Pool advisory lock이다. 모두 scope에서 PG fallback0이어야 한다.
- lock은 DB transaction이 아니라 Google 호출을 포함한 전체 callback 수명이다. 같은 회차 재진입 허용/다른 회차 중첩 거부, 연결손실 AbortSignal, 해제실패·획득불확실 시 연결 폐기를 보존한다. 이미 성공한 Google 변경은 abort로 취소되지 않는다.
- backfill/cleanup의 무메일과 정방향 생성/삭제의 기본메일을 혼동하지 않는다. patch는 기본억제지만 참석자변경은 발송한다. withoutCalendarReflection은 역반영 자동루프 억제다.
- GET만 제한 retry. 생성 deterministic ID/409표식 확인은 Google성공→mapping실패 복구를 지원하나 patch/delete/메일의 exactly-once는 아니다. 외부 호출을 Mongo transaction 자동retry callback 안에 넣지 않는다.
- mapping은 있는데 Google event가 삭제된 경우 역반영 무조치·mapping유지/backfill skip, 이후 일반저장에서 missing patch를받아 이전eventID포함생성키로복원하고기본메일발송한다.
- mapping 자체가없으면 운영createdAt>=2026-08-21인일반수정만생성허용,이전/모름은skip. cleanup설명의포괄적재생성차단과현재코드의차이는임의정책정리가아닌회귀사례로고정한다.
- 핵심실행사례: lock손실직전Google성공,Google성공후mapping실패,cleanup후일반저장,mapping유지된Google삭제. 이조사는실Google실행증거가아니다.
