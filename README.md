# hub-om

OM이 기업교육 운영 현황을 한 곳에서 확인하고 관리하기 위한 hub-om 저장소입니다.

이 저장소는 hub-om의 제품 코드와 프로젝트 작업 규칙을 관리합니다. 실제 운영 데이터 예시, 원천 파일, 원천 분석 문서는 공개 저장소에 올리지 않습니다.

## 역할 기준

- OM 작업은 업무 흐름 단위로 나누어 진행합니다.
- 모든 작업은 작업 종류 기반 브랜치에서 진행합니다.

## 확정 앱 스택

- 앱 프레임워크: `Next.js`
- 언어: `TypeScript`
- UI 런타임: `React`
- 호스팅: `Coolify`
- 데이터베이스: `PostgreSQL 18`
- 배포 빌드: Next.js `standalone`
- 데이터 접근 방식: `repository/interface` 구조
- 현재 데이터 연결: PostgreSQL + Prisma
- 외부 원천 adapter는 별도 비공개 작업에서 관리

화면 컴포넌트는 원천 데이터나 PostgreSQL 테이블에 직접 의존하지 않습니다. 화면은 표준 operation 타입과 repository interface만 사용해야 합니다.

## 처음 작업할 때

먼저 [docs/collaboration/getting-started.md](docs/collaboration/getting-started.md)를 읽습니다.

그 다음 아래 문서를 순서대로 확인합니다.

- [docs/README.md](docs/README.md)
- [docs/collaboration/working-rules.md](docs/collaboration/working-rules.md)
- [docs/collaboration/team-workflow.md](docs/collaboration/team-workflow.md)
- [CLAUDE.md](CLAUDE.md)

## 공개 저장소 원칙

- 실제 고객사명, 담당자명, 강사명, 금액, 링크, 파일명 예시는 커밋하지 않습니다.
- 원천 파일과 원천 분석 문서는 Git에 올리지 않습니다.
- 데이터 계약 상세가 필요하면 비공개 문서나 별도 보안 저장소에서 관리합니다.
- 공개 저장소에는 코드, 협업 규칙, DB 쓰기 안전 규칙만 남깁니다.
