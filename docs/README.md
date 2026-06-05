# 문서 지도

이 폴더는 hub-om의 협업 기준과 운영 기준을 보관한다. 실제 데이터 예시, 원천 파일명, 원천 분석 문서는 공개 저장소에 두지 않는다.

## 먼저 읽을 문서

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
