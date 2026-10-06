# 통합 검토

이 작업은 총괄 `feature/20260922-mongodb-parallel-transition`의 `6cb33268ad5f796a57b53cc0f0b50479109a73b9`에서 시작했다. 검증과 독립 리뷰 후 작업 브랜치를 push하고 총괄 브랜치에 fast-forward한 뒤 원격 SHA를 대조한다.

이 통합은 운영 JSON 가져오기 CLI 경계만 완료한다. 운영 실행, production selector, 전체 앱·예약 작업 조립, 실제 A/B 백업·각 복원·실데이터 복사·최종 전환과 `dev → main` 조건은 미완료다.
