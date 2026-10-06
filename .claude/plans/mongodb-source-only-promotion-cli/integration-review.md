# 팀 단위 원천 승격 CLI 통합 검토

이 작업은 총괄 `feature/20260922-mongodb-parallel-transition`의 `43b3e526bf1104f35b94f2c37bfdeb8c6f39f1a7`에서 시작했다. 일반 1,150 pass/130 skip, 실제 PostgreSQL·Mongo, CLI 프로세스, typecheck/build/lint를 확인했다. 두 차례 독립 리뷰의 P2 네 건을 보완하고 최종 재리뷰에서 잔여 P0~P3를 확인한다. 작업 브랜치를 push하고 총괄 브랜치에 fast-forward한 뒤 두 원격 SHA를 대조한다.

이 통합은 `db:promote-source-only` 경계의 완료만 뜻한다. 운영 실행, `db:import:operations`, production selector, 전체 앱 조립, 실제 A/B 백업·각 복원·실데이터 복사·최종 전환과 `dev → main` 조건은 미완료다.
