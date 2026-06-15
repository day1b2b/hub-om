# hub-om work

Use this command before starting any hub-om code, docs, DB, deployment, or operational-data change.

1. Read `docs/operations/manager-ai-workflow.md`.
2. Follow its 작업 시작 게이트, 필수 문서 읽기, 작업 분류, 중단 조건, 검증, 커밋, PR 설명 규칙.
3. Do not write to production DB, run production migrations, change Coolify secrets, or modify real operational data unless the user explicitly states backup confirmation and execution scope.
4. Treat PRs as 작업 설명서 and 변경 이력, not as a generic review request.

Start by reporting:

```text
작업 시작 확인:
- 현재 브랜치:
- 읽은 문서:
- 작업 종류:
- 작업 범위:
- 수정 금지:
- 실제 데이터 영향:
- DB/migration 영향:
- 배포/Coolify 영향:
- 열린 결정 가능성:
```
