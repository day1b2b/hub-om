---
name: hub-om-manager-workflow
description: Complete hub-om manager workflow for AI-assisted code, docs, database, operational-data, deployment, commit, push, and PR-description work. Use when Codex is asked to change the hub-om site, update docs, touch Prisma/PostgreSQL, handle Coolify deployment settings, work with source integrations, prepare commits, push branches, or open PRs so it reads the required rules first and follows the repo safety gates.
---

# Hub OM Manager Workflow

## Overview

Follow this skill for hub-om work from branch check through implementation, verification, commit, push, and PR explanation. The source of truth is `docs/operations/manager-ai-workflow.md`; read it before making changes.

## Required Startup

1. Read `docs/operations/manager-ai-workflow.md` completely.
2. Read the required documents listed there.
3. Run or inspect:

```bash
git status --short
git branch --show-current
git fetch origin
```

4. Report:

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

## Safety Gates

- Do not work directly on `main` or `dev`; create or use a task branch.
- Do not print, commit, or summarize secret values from `.env`, `.env.local`, real source files, `.local/`, `.omx/`, or `.next/`.
- Do not run production DB migrations, production write-back, imports, bulk update/delete, or `RUN_DB_MIGRATIONS=true` unless the user explicitly states backup confirmation and execution scope.
- Do not add dependencies unless explicitly requested or confirmed by the technical owner.
- Preserve user changes; never revert unrelated dirty work.

## Implementation Rules

- Keep screens behind standard operation types and repository/interface boundaries.
- Keep external source integrations read-only by default; create candidates and let users choose applied values.
- Keep real customer, manager, instructor, money, link, file-name, and source-analysis examples out of the public repo.
- Document DB, Prisma, operational-data, source, auth, and Coolify impacts in commit and PR text.

## Verification

Run the relevant checks:

```bash
npm run db:validate
npm run lint
npm run typecheck
npm run build
```

If a check is not applicable or cannot run, record why in the commit body, PR description, and final report.

## Commit And PR

Use a Conventional Commit title and a detailed Korean body:

```text
feat: 운영 목록 필터 기준 정리

운영자가 같은 기준으로 필터 동작을 확인할 수 있도록 표준 operation 상태 기준에 맞췄다.
기존에는 화면별로 상태 해석이 달라질 여지가 있어서, repository/interface에서 사용하는 표준 상태값 기준으로 필터 비교 기준을 정리했다.
이 변경은 운영 목록 화면의 필터 동작에만 영향을 주며, DB 스키마나 실제 운영 데이터는 변경하지 않는다.

제약: 실제 운영 데이터 예시는 공개 저장소에 커밋하지 않음
영향 범위: 좁음
검증: npm run lint, npm run typecheck
미검증: Coolify preview deployment
남은 리스크: 상태값이 추가되면 필터 옵션 문구도 함께 갱신해야 함
```

Treat PRs as work explanations and change records, not generic review requests. Include 작업 요약, 변경 내용, 확인 방법, 데이터/DB/배포 영향, 검증, 미검증, 남은 리스크, and 머지해도 되는 조건.
