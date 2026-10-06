# Mongo 중복 회사 병합 통합 검토

이 작업은 총괄 `feature/20260922-mongodb-parallel-transition`의 `ba3e4e3d28479e3080b9dce4ae67f092b5cec506`에서 시작했다. 제품·검증 커밋은 `a74a566`이다. 문서를 커밋하고 작업 브랜치를 push한 뒤 총괄 브랜치에 fast-forward하며 원격 SHA를 대조한다.

이 통합은 `db:merge:duplicate-company` 경계의 완료만 뜻한다. 운영 실행, production selector, 실제 원천 접근, 남은 활성 CLI·예약 작업, 전체 앱 조립, 실제 A/B 백업·각 복원·실데이터 복사·최종 전환과 `dev → main` 조건은 미완료다.
