# 처음 작업자 안내

이 문서는 저장소를 처음 pull 받아 작업하려는 사람이 가장 먼저 읽는 문서입니다.

## 1. 저장소를 받은 직후 확인할 것

```bash
git status
git branch --all
```

현재 기본 작업 흐름은 아래 브랜치를 사용합니다.

- `main`: 배포용 브랜치.
- `dev`: 배포 전에 함께 모으는 통합 브랜치.
- `feature/YYYYMMDD-작업명`: 새 기능 작업 브랜치.
- `fix/YYYYMMDD-작업명`: 버그 수정 브랜치.
- `docs/YYYYMMDD-작업명`: 문서 작업 브랜치.
- `chore/YYYYMMDD-작업명`: 설정/정리 작업 브랜치.

작업 전에는 항상 최신 원격 상태를 가져옵니다.

```bash
git fetch origin
```

## 2. 현재 앱 스택

이 저장소의 앱 스택은 아래 기준으로 작업합니다.

- 앱 프레임워크: `Next.js`
- 언어: `TypeScript`
- UI 런타임: `React`
- 호스팅: `Coolify`
- 데이터베이스: `PostgreSQL 18`
- 배포 빌드: Next.js `standalone`
- 데이터 접근 방식: `repository/interface`
- 현재 데이터 연결: PostgreSQL + Prisma
- 외부 원천 adapter와 실제 데이터 예시는 공개 저장소에 커밋하지 않음

화면은 원천 데이터나 DB 테이블에 직접 연결하지 않습니다. 화면은 표준 operation 타입과 repository interface만 사용합니다.

## 3. 내 기능 브랜치 만들기

작업은 `main`이나 `dev`에서 직접 하지 않습니다. 항상 `dev`에서 새 기능 브랜치를 만들어 작업합니다.

```bash
git switch dev
git pull origin dev
git switch -c feature/20260604-queue-filters
```

작업 성격에 따라 prefix와 작업명만 바꿉니다.

```bash
feature/20260604-operation-detail
fix/20260604-status-calculation
docs/20260604-data-contract
chore/20260604-project-setup
```

## 4. 작업 전에 읽을 문서

AI 작업자에게 맡기는 작업은 먼저 [../operations/manager-ai-workflow.md](../operations/manager-ai-workflow.md)를 읽고 그 절차를 따릅니다.

사람이 직접 작업할 때도 최소한 아래 문서는 읽고 시작합니다.

1. [../../README.md](../../README.md)
2. [../README.md](../README.md)
3. [team-workflow.md](team-workflow.md)
4. [working-rules.md](working-rules.md)
5. [../operations/db-write-safety.md](../operations/db-write-safety.md)
6. [../operations/database-runbook.md](../operations/database-runbook.md)

## 5. Claude Code에 작업을 맡기는 방법

Claude Code에는 큰 요청을 한 번에 주지 않습니다.

작업을 맡길 때는 먼저 이렇게 요청합니다.

```text
/hub-om-work 절차대로 먼저 확인하고 시작해줘.
```

Codex에 맡길 때는 `$hub-om-manager-workflow` 스킬로 시작합니다.

좋은 요청:

```text
비공개 데이터 계약을 기준으로 운영 목록 화면의 필터 상태만 구현해줘.
원천 필드는 화면에서 직접 쓰지 말고 repository adapter를 거쳐 표준 필드로 매핑해줘.
변경 후 테스트 또는 확인 방법도 알려줘.
```

나쁜 요청:

```text
대시보드 전체 만들어줘.
```

## 6. 코드 작업 원칙

- 화면은 특정 원천 구조에 직접 의존하면 안 됩니다.
- 데이터는 `repository/query interface`를 통해 표준 operation schema로 들어와야 합니다.
- 실제 운영 데이터는 임의로 수정하거나 삭제하지 않습니다.
- `operation_type`은 날짜 차이로 자동 계산하지 않습니다.
- 회차 기간 계산이 필요하면 `session_duration_days`, `session_duration_type`을 씁니다.
- 매출은 회차별로 단순 합산하지 않습니다.
- 비용은 회차별 데이터로 봅니다.
- 새 DB 필드가 필요하면 먼저 문서를 업데이트합니다.
- `main`과 `dev`에는 직접 커밋하지 않습니다.

## 7. 커밋 전 확인

커밋 전에는 아래를 확인합니다.

```bash
git status
```

코드 변경이 있으면 가능한 범위에서 아래 검증 명령을 실행합니다.

```bash
npm run lint
npm run typecheck
npm run build
```

문서만 변경했다면 링크와 경로가 맞는지 확인합니다. 실행하지 못한 검증은 커밋 메시지나 PR 설명의 `미검증`에 명확히 적습니다.

## 8. 커밋 메시지

커밋 메시지는 Conventional Commits 형식으로 씁니다. 제목은 `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:` 중 하나로 시작하고, 설명은 한국어로 작성합니다.

```text
feat: 운영 목록 필터의 표준 데이터 계약 적용

원천 필드가 화면 컴포넌트에 직접 들어가면 Gmail/Sheet/DB adapter가 늘어날 때 수정 범위가 커진다.
repository adapter에서 표준 필드로 매핑하고, 화면은 표준 operation schema만 사용하도록 정리했다.

제약: 실제 원천 데이터와 데이터 예시는 공개 저장소에 커밋하지 않는다
신뢰도: 중간
영향 범위: 좁음
검증: npm run lint
미검증: Gmail/외부 채널 adapter 연동
```

## 9. PR 또는 공유 전 확인

- 내가 어떤 브랜치에서 작업했는지 확인합니다.
- Claude Code가 작업 시작 프로토콜을 수행했는지 확인합니다.
- 변경한 문서/코드가 내 담당 워크플로우 범위인지 확인합니다.
- 다른 사람 작업에 영향을 주는 데이터 계약 변경이 있으면 비공개 계약 문서 또는 이슈에 남깁니다.
- UI 변경은 앱이 생긴 뒤부터 스크린샷을 첨부합니다.
- 스키마/API/권한/배포 관련 변경은 데이터/기술 책임자 검토가 필요합니다.

PR을 만들기 전에는 Claude Code가 [working-rules.md](working-rules.md)의 `PR 생성 전 Claude Code 체크리스트`를 확인해야 합니다.

PR을 만든 뒤에는 Claude Code가 알려주는 PR 링크, 확인할 화면 주소, 확인할 동작 목록을 따라 확인합니다. 자세한 방법은 [working-rules.md](working-rules.md)의 `PR / 리뷰 안내 규칙`, `PR 확인 방법`, `PR 확인자 체크리스트`를 따릅니다.
