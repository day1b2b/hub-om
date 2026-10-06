# 과정명 복원 산출물

기준 `95cdb6fb71e49b7e3f230571d867bca357a114fe`, 작업 브랜치 `feature/20260929-mongodb-course-name-restore`, 격리 clone `/Users/ga/workspace/hub-om-mongodb-coach-content`.

- main: contract/types/conflict, 기존 service facade, PG adapter/factory/context, factory·PG error·실제 handler 검사, 운영·계획·검증·인계 문서.
- Schrodinger: Mongo repository와 내부 guard.
- Kepler: 실제 Mongo repository 통합 검사.
- Gauss: 실제 PG 원본/newPG/Mongo 대조 검사와 고정 원본 fixture, PG COMMIT 충돌 원인 확인.
- Anscombe: 계획 v1/v2 독립 검증. Gibbs: 메타 검토 및 최종 독립 코드·실행 검토.

PG 분리 시 기존 함수 본문 동일성을 먼저 확인했다. 최종 구현에는 실제 PG 검사에서 드러난 adapter-pg COMMIT 충돌을 재조회 오류로 변환하는 좁은 catch 보완이 추가되었다. 원본 query·계획 직렬화·선택/쓰기 로직은 유지한다. 최종 PG 함수 전체가 byte-identical이라는 뜻이 아니다.

`courseNameRestoreOriginalOracle.fixture.ts`는 기준 commit의 원본 파일과 byte-identical인 테스트 전용 oracle이다. SHA256 `7d1799b834f6407aef97fae8735e3fa11279398f94da8d884fc2c7b9db8be92c`. 운영 경로에서 사용하지 않는다.

신규 테스트: factory, PG adapter error, 실제 handler, native Mongo repository, PG 대조 및 실제 SSI 경합. 기존 route/UI, privacy/schema, 35개 업무 모델, package 의존성은 바꾸지 않는다. 내부 `CourseNameRestoreGuard`와 기존 과정 번호 counter 준비가 Mongo 구현에 필요하다.

실DB 실행은 main이 담당했다. `/private/tmp/hub-om-course-name-restore-20260929`의 PG56649/Mongo27749만 사용하며 상세 실행·실패·재검증·정리는 execution-review.md를 따른다. 성공 검사 뒤 코드가 같으면 같은 검사를 반복하지 않는다.
