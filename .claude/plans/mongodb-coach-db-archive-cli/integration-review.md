# 코치 DB 아카이브 CLI 통합 검토

총괄 `feature/20260922-mongodb-parallel-transition`의 `7ec8c4385e25d6e4274aefadd1c152675095ecc2`에서 시작했다. 제품·검증 SHA는 `09fca63`이다. 일반 1,134 pass/123 skip, 실제 PG·Mongo, typecheck/build/lint와 독립 최종 리뷰를 통과했다. 작업 브랜치를 push한 뒤 총괄 브랜치에 fast-forward하고 원격 SHA를 대조한다.

이 통합은 아카이브 CLI의 저장 경계만 뜻한다. 실제 운영 아카이브, 독립 A/B 백업과 각 복원, coach import, production selector, 실데이터 복사·최종 전환과 `dev → main` 조건은 미완료다.
