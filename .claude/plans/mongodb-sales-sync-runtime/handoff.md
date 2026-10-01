# Mongo 매출 동기화 runtime 인계

- 현재 위치: `feature/20261001-mongodb-sales-sync-runtime`, 총괄 기준 `3b01e9a55bf0b8f592db42ce5db46f5fe6cd4b25`
- 생명주기: 구현·실제 Mongo·전체 회귀·독립 리뷰 완료, 커밋·통합 대기
- 범위: salesRevenueSync/source/notifier/requestActivity의 등록·잠금 shadow runtime 조립
- 검증: 실제 Mongo runtime 1, handler 17, repository 28 pass; 전체 1,163 pass/142 skip/0 fail; typecheck/build; lint 오류0·기존7
- 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0
- 제품 SHA: `c78799add9e0e3858572a62f31223336274b7026`
- 남은 작업: 제품/문서 커밋, 원격 push, 총괄 fast-forward, 소유 합성 자원 정리
- 허용한 위험: 실제 외부 원천·알림·예약과 production selector는 이 단위에서 검증하지 않음
- 정렬 결과: `update_handoff_only`
- Do Next: 제품/문서 커밋과 총괄 통합을 완료한다.
- Do Not: 운영 DB·Atlas·실원천·배포·dev/main을 변경하지 않는다.
- 재개 동작: `update_handoff`
