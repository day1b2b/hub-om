# 남은 차이와 실행 순서

이번 shadow repository 범위의 코드·합성 검증은 완료. 전체 운영 전환은 미완료다.

1. implementation_gap: TeamUser 기존 물리삭제와 운영규칙 충돌. 새경로는 차단상태. 실제 데이터 삭제는 수행하지 않으며, 비활성/복원/명단·권한조회 제외 의미를 정의하는 별도 contract가 필요하다.
2. implementation_gap: 직접 PG runtime 64개파일/기능18군 및 간접 activity/Calendar/auth 등 전환. docs/operations/mongodb-runtime-coverage.md를 기준으로 코치 관리 CRUD와 강사 메모 API부터 provider 경계를 분리하고 PG 회귀검증 후 연결한다. Mongo 선택은 전체gate 통과후.
3. verification_gap: 대상 Mongo8.0 및 실제PG쿼리 대조 미완료. 새7.0.43검증은 보조근거. 사용자 실제데이터는 fixture로 사용하지 않는다.
4. validation_gap: 실제PG snapshot복사/최종동기화/복원·rollback/배포 후 smoke미완료. 본작업은운영쓰기없음.
5. external_blocker: 이전GitHub DNS연결실패. 이번로컬commit은 원격반영/merge/배포와구분.
