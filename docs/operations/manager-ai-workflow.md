# AI 작업자 운영 절차

이 문서는 Codex, Claude Code, 기타 AI 작업자가 hub-om 작업을 시작할 때 먼저 따라야 하는 공통 절차입니다. 목적은 사람이 매번 모든 규칙을 읽지 않아도 AI가 브랜치, DB, 배포, 실제 데이터 위험을 먼저 판정하고 작업을 끝까지 설명 가능한 단위로 남기는 것입니다.

## 1. 작업 시작 게이트

AI 작업자는 구현 전에 아래를 실행하거나 확인합니다.

```bash
git status --short
git branch --show-current
git fetch origin
```

- 현재 브랜치가 `main` 또는 `dev`이면 직접 작업하지 않습니다.
- 작업 브랜치는 기본적으로 최신 `dev`에서 만듭니다.
- 이미 작업 브랜치에 있다면 기존 변경을 읽고, 사용자 변경을 되돌리지 않습니다.
- `.env`, `.env.local`, 실제 원천 파일, `.local/`, `.omx/`, `.next/`의 본문은 출력하거나 커밋하지 않습니다.

권장 브랜치:

```text
feature/YYYYMMDD-작업명
fix/YYYYMMDD-작업명
docs/YYYYMMDD-작업명
chore/YYYYMMDD-작업명
hotfix/YYYYMMDD-작업명
```

## 2. 필수 문서 읽기

모든 작업 전에 아래 문서를 읽습니다.

1. `README.md`
2. `docs/README.md`
3. `docs/collaboration/getting-started.md`
4. `docs/collaboration/working-rules.md`
5. `docs/collaboration/team-workflow.md`
6. `docs/operations/db-write-safety.md`
7. `docs/operations/database-runbook.md`

작업이 외부 원천, Drive, Slack, Excel, 데이터 모델과 관련되면 해당 문서를 추가로 읽습니다.

- `docs/operations/source-read-contract.md`
- `docs/operations/source-automation-todo.md`
- `docs/operations/excel-initial-migration.md`
- `docs/operations/google-drive-operation-import.md`
- `docs/operations/slack-discussion-matching.md`
- `docs/operations/data-model-draft.md`

## 3. 작업 분류

작업 전에 아래 항목을 판정하고 짧게 보고합니다.

```text
작업 시작 확인:
- 현재 브랜치:
- 읽은 문서:
- 작업 종류: 코드 | 문서 | DB schema | 운영 데이터 | 원천 연동 | 배포 설정
- 작업 범위:
- 수정 금지:
- 실제 데이터 영향:
- DB/migration 영향:
- 배포/Coolify 영향:
- 열린 결정 가능성:
```

## 4. 중단해야 하는 작업

아래 작업은 사용자가 백업 여부와 실행 범위를 명시하지 않으면 진행하지 않습니다.

- 운영 DB migration
- 운영 DB write-back
- 원천 데이터 적재
- 대량 update/delete
- 비용, 매출, 수익, 권한 데이터 변경
- 운영 DB 접속 정보 변경
- `RUN_DB_MIGRATIONS=true`를 통한 Coolify 운영 migration

허용되는 기본 작업은 코드/문서 변경, 로컬 검증, PR 설명 작성입니다. 운영 DB나 실제 원천에 쓰는 작업은 별도 게이트를 통과해야 합니다.

## 5. 구현 원칙

- 화면 컴포넌트는 원천 데이터나 PostgreSQL 테이블에 직접 의존하지 않습니다.
- 화면은 표준 operation 타입과 repository/interface를 통해 데이터를 받습니다.
- 외부 원천은 기본적으로 읽기 전용으로 연결하고, 후보를 만든 뒤 사용자가 선택한 값만 적용합니다.
- 실제 고객사명, 담당자명, 강사명, 금액, 링크, 파일명, 원천 분석 문서는 공개 저장소에 남기지 않습니다.
- 새 의존성은 명시 요청 또는 기술 책임자 확인 없이 추가하지 않습니다.
- 공통 타입, repository/interface, auth, 배포, Prisma schema 변경은 영향 범위를 별도로 설명합니다.

## 6. 검증

작업 종류에 맞춰 가능한 검증을 실행합니다.

```bash
npm run db:validate
npm run lint
npm run typecheck
npm run build
```

- 코드 변경이면 `lint`, `typecheck`, `build`를 우선 실행합니다.
- Prisma schema 또는 migration 변경이면 `db:validate`를 포함합니다.
- 실행하지 못한 검증은 이유와 함께 커밋 본문과 PR 설명에 남깁니다.
- 검증 실패를 숨기지 않습니다. 실패하면 가능한 범위에서 수정 후 다시 검증합니다.

## 7. 커밋 메시지

커밋 제목은 Conventional Commits 형식으로 씁니다.

```text
feat: 운영 목록 필터 기준 정리
fix: 운영 상세 저장 실패 처리 보강
docs: AI 작업자 운영 절차 추가
chore: PR 설명 템플릿 추가
```

본문은 작업 설명서처럼 자세히 씁니다.

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

필수 본문 항목:

- 왜 바꿨는지
- 어떤 기준과 제약을 따랐는지
- DB/migration/운영 데이터/배포 영향 여부
- 실행한 검증
- 실행하지 못한 검증
- 남은 리스크

## 8. PR 목적과 설명

PR은 리뷰 요청서가 아니라 작업 설명서, 변경 이력, 병합 전 체크포인트입니다.

PR 설명에는 아래를 포함합니다.

- 작업 요약
- 변경 내용
- 확인 방법
- 데이터 / DB / 배포 영향
- 검증
- 미검증
- 남은 리스크
- 머지해도 되는 조건

기본 문구로 "리뷰 부탁드립니다"를 쓰지 않습니다. 대신 무엇을 확인하면 되는지와 어떤 조건이면 `dev`에 합쳐도 되는지를 씁니다.

## 9. 작업 완료 보고

최종 보고에는 아래를 포함합니다.

- 변경한 파일
- 실행한 검증과 결과
- DB/migration/운영 데이터/배포 영향
- 커밋/푸시/PR 상태
- 사용자가 직접 해야 하는 남은 작업
