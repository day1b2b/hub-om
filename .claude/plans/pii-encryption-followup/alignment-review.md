# 정렬 및 인계 계약

> 최신 정정: 아래 서버 후속 완료는 서버 범위의 기록이다. 브라우저 제외 결정은 철회되었으며 전체 완료 조건에 초안 암호화가 포함된다. `.claude/plans/browser-draft-encryption/plan.md`와 `docs/operations/browser-draft-encryption.md`가 현재 후속 상태다. 사용자 잠금 암호 결정 전 제품 통합은 보류한다.

- Initiative: 개인정보 해당 필드 전부 암호화. Scope: PR599 안전 후속 보완.
- 상태: 이번 코드 구현/DB 없는 검증 완료, 전체 릴리즈 검증·운영 전환 blocked.
- rigor: Level3. Artifact directory: .claude/plans/pii-encryption-followup.
- 결과: update_handoff_only. 총괄의 원래 scope/merge gate 유지, 최신 dev 충돌·누락·근거 및 남은 결정을 추가한다.
- 마지막 완료: 검색/정렬 정확성 반례 보완, CLI/직원파일 및 audit migration, 전체 검증.
- 증거: execution-review.md, database.test.ts, coachAccessTokenBackfill.test.ts, localJsonTeamMemberRepository.test.ts, privacy/coverage.test.ts.
- 산출물 상태: 코드 reviewable, 미검증/gap 명시. UI/DB 완료 증거 없음.
- Do Next: 기술 책임자에게 필드 분류·키/백필·복구·CLI 사용과 PostgreSQL/MongoDB 전환 순서를 확인하고 승인된 격리 DB에서 검증. 로컬 변경은 커밋 후 총괄 인계, push하지 않음.
- Do Not: 기존 worktree/미저장 초안/과거 백업/외부 원천 변경, 운영/로컬 DB 임의 시작, 실제 키 생성/교체, 배포, push, 원격 merge.
- Resume action: run_validation (DB 사용 승인과 책임자 결정 후).
- MongoDB: crypto.ts/envelope/AAD/key policy 및 논리 field 분류 공유 가능. Prisma sentinel/DMMF/SQL trigger/index/migration은 PostgreSQL adapter. 이 작업에서 MongoDB 구현 없음.
- 철회된 당시 브라우저 범위: 기존 localStorage/보존/복구 유지. 평문 저장과 계정 간 접근 보호는 미해결/미검증이며 후속 오프라인 암호화·키 관리 검증 대상. 이번 서버 구현은 차단하지 않음.
- 잔여 위험 및 적용: gap-plan.md 전 항목 총괄 인계, 현재 머지 차단 유지. 문서 반영 완료.
