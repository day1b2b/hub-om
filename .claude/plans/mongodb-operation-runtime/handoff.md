# Handoff — MongoDB operation runtime

- Initiative: Mongo 병렬 전환. 상위 문서 docs/operations/mongodb-shadow-transfer.md.
- Current scope: shadow-only OperationRepository runtime. Lifecycle: complete(로컬 구현/검증 범위). Rigor: Level3.
- Artifact status: handoff-ready. 디렉터리 `.claude/plans/mongodb-operation-runtime/`.
- Baseline: c257b82281b04d591731842674a583998c77a4b4. Branch: feature/20260922-mongodb-operation-runtime.
- Last completed: 독립 리뷰 보완 및 전체/실제 replica-set 검증. owned mongod 종료 완료, 임시 파일은 남김.
- Verification: npm test777pass5skip; 별도 실제 Mongo16pass; lint0error7기존warning; typecheck/build 성공; diffcheck 성공.
- Validation: 생성→조회→수정→replay/다른내용 conflict/삭제후거부; 동시성 및 late audit rollback; metadata privacy/검색 한도. execution-review.md 참조.
- Open gaps: 외부 Mongo권한/TLS/운영규모 SLO/다중노드 장애·backup reverse; 전체 repository/API/Calendar/감사 request 전환. 로컬 엔진 실증을 배포 환경 실증으로 간주하지 말 것.
- Accepted differences: 최종 courseId+name atomic수정, 새과정속성복사, 목적label 적용, 금액소수2자리초과·역전날짜 거부, tx rollback sequence 재사용. docs에 명시.
- Alignment: update_handoff_only, 기록 적용 완료.
- Do Next: 부모에서 이 local commit diff/검증을 확인해 통합 여부를 정하고, 다음 repository 또는 승인된 외부 shadow gate 진행.
- Do Not: production factory 교체, 운영DB/키 접근, 임의 remote push/PR/deploy, 서비스/Docker 변경, 기존 PG 원본 수정 금지.
- Resume action: start_next_task.
- Read order: 본 handoff → docs/operations/mongodb-operation-runtime.md → execution-review/manifest → 필요한 codec/repository tests.
