# Clarify Result: mongodb-coach-public-pages

## 목표

기존 `MongoCoachRepository`를 재구현하지 않고 `coachRepositoryFactory`와 명시적 repository context에 연결한다. 코치 목록·상세·일정·투입, 강사 위키, 운영 상세가 명시 Mongo scope에서 PostgreSQL fallback 없이 기존 DTO·권한·빈 상태·오류 의미를 유지하도록 구현하고 합성 검증한다.

## 이유

공개 코치 조회 구현과 PG/Mongo parity 검증은 이미 존재하지만 factory가 Prisma를 고정 반환해 실제 페이지 조립 경계가 미전환이다. 페이지 일부는 조회 오류를 best-effort로 숨기므로 화면만 확인하면 PG fallback을 놓칠 수 있다.

## 성공 기준

- scope 밖 기본 경로는 기존 `DATABASE_URL` guard와 `PrismaCoachRepository`를 유지한다.
- 명시 scope에서는 정확히 주입된 `CoachRepository`가 모든 실제 호출 페이지에서 사용되고, scope에 `coach`가 없으면 PG나 환경을 읽기 전에 `DATA_REPOSITORY_NOT_CONFIGURED: coach`로 실패한다.
- 코치 목록·상세·일정·투입과 강사 위키·운영 상세의 기존 권한, notFound/redirect, best-effort, DTO 및 정렬 의미가 바뀌지 않는다.
- 실제 로컬 Mongo replica set에서 기존 `MongoCoachRepository` 데이터와 페이지 조립을 검증하고 일반 test/typecheck/lint/build 및 독립 리뷰를 통과한다.
- Google Drive와 OneDrive를 독립 백업 위치 A/B 후보로 기록하고 로컬은 암호화 임시 생성·격리 복원 공간으로만 규정한다. 같은 클러스터·계정의 두 Mongo DB는 백업으로 계산하지 않는다.

## 제약

- 운영 DB·실원천·키/env·배포·main/dev에 접근하거나 변경하지 않는다.
- 생산 기본 backend는 PostgreSQL이며 환경변수로 Mongo를 자동 선택하지 않는다.
- 새 의존성·업무 필드·DB schema·삭제/보존 정책을 추가하지 않는다.
- 기존 Mongo codec/readiness/privacy 정책과 기존 페이지 권한·업무 계약을 재사용한다.
- 실제 백업 업로드·무결성 검사·격리 복원·최종 동기화 전에는 운영 전환을 금지한다.

## 현황

- 기준 통합 HEAD: `be365693e2371362e6e4746a7a4f9c7564390f83`.
- 작업 브랜치: `feature/20260930-mongodb-coach-public-pages`.
- `MongoCoachRepository`와 PG/Mongo repository parity 및 native integration 테스트는 이미 존재한다.
- `coachRepositoryFactory.ts`는 현재 `DATABASE_URL`을 확인하고 `PrismaCoachRepository`만 반환한다.
- 호출 페이지는 코치 4개 페이지, 강사 위키 2개 페이지, 운영 상세 1개다.

## 가정·미정 사항

- 이번 단위는 생산 runtime 조립 전체가 아니라 명시 주입 가능한 페이지 경계까지다. 생산 backend 전환은 후속 전체 앱 조립과 운영 승인 대상이다.
- Google Drive·OneDrive의 실제 계정·용량·retention·암호화·독립 삭제 권한은 후보 위치 결정과 별개로 실백업 전 확인해야 한다.
