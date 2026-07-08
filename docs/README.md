# 문서 지도

이 폴더는 hub-om의 협업 기준과 운영 기준을 보관한다. 실제 데이터 예시, 원천 파일명, 원천 분석 문서는 공개 저장소에 두지 않는다.

## 먼저 읽을 문서

AI 작업자는 먼저 [operations/manager-ai-workflow.md](operations/manager-ai-workflow.md)를 읽고, 그 문서가 지시하는 필수 문서를 순서대로 읽는다.

사람이 직접 작업할 때는 아래 순서로 읽는다.

1. [collaboration/getting-started.md](collaboration/getting-started.md)
2. [collaboration/working-rules.md](collaboration/working-rules.md)
3. [collaboration/team-workflow.md](collaboration/team-workflow.md)
4. [operations/db-write-safety.md](operations/db-write-safety.md)
5. [operations/database-runbook.md](operations/database-runbook.md)

## 확정 앱 스택

- `Next.js`
- `React`
- `TypeScript`
- `PostgreSQL 18`
- `Coolify`
- Next.js `standalone` 배포 빌드
- repository/interface 기반 데이터 접근

현재 앱은 PostgreSQL을 기준으로 연결한다. 외부 원천 수집/적재 세부 정보와 실제 데이터 예시는 공개 저장소에 올리지 않는다.

## 폴더 역할

- `collaboration/`: 브랜치, PR, 역할 분담, 팀 작업 방식.
- `operations/`: DB 연결과 운영 데이터 쓰기 작업의 안전 규칙.

## AI 작업 진입점

- [operations/manager-ai-workflow.md](operations/manager-ai-workflow.md): Codex, Claude Code, 기타 AI 작업자가 작업 시작부터 커밋/푸시/PR 설명까지 따라야 하는 공통 절차.
- [`../codex-skills/hub-om-manager-workflow/SKILL.md`](../codex-skills/hub-om-manager-workflow/SKILL.md): Codex에서 `$hub-om-manager-workflow`로 사용할 스킬 원본.
- [`../.claude/commands/hub-om-work.md`](../.claude/commands/hub-om-work.md): Claude Code에서 사용할 명령 진입점.

## 운영 데이터 연동 문서

- [operations/data-model-draft.md](operations/data-model-draft.md): 과정, 주제, 회차, 사람, 원천 기록을 어떻게 나눌지 검토하는 데이터 모델 초안.
- [operations/source-read-contract.md](operations/source-read-contract.md): 외부 원천을 읽어 표준 운영 데이터로 연결하기 위한 공개 가능 계약.
- [operations/source-automation-todo.md](operations/source-automation-todo.md): 엑셀 수기 입력을 실제 원천 자동화로 대체하기 위한 TODO.
- [operations/excel-initial-migration.md](operations/excel-initial-migration.md): 엑셀을 초기 이관 원천으로 사용하는 기준.
