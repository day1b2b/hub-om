# 코치 데이터 검증 CLI 통합 검토

이 작업은 총괄 `feature/20260922-mongodb-parallel-transition`의 `4eb953a011e9411c337d91a9c4d03fd03e8d0f89`에서 시작했다. 제품·검증 SHA는 `d1af2a5`다. 일반 1,131 pass/121 skip, 실제 PG·Mongo·동일 fixture parity, typecheck/build/lint와 독립 최종 리뷰를 통과했다. 작업 브랜치를 push한 뒤 총괄 브랜치에 fast-forward하고 원격 SHA를 대조한다.

이 통합은 `db:verify:coach-data` 읽기 경계의 완료만 뜻한다. 실제 coach-db archive/import, 운영 실행, production selector, 남은 CLI·예약 작업, 전체 앱 조립, 실제 백업·각 복원·실데이터 복사·최종 전환과 `dev → main` 조건은 미완료다.
