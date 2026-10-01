# Mongo Hubbot runtime 인계

- 현재 위치: `feature/20261001-mongodb-hubbot-runtime`, 총괄 기준 `5f2ec3b8815b520727e7c284e9013b2363f34285`
- 생명주기: 구현·실제 Mongo·전체 회귀·독립 리뷰·총괄 통합 완료
- 범위: hubBotResponder/requestActivity의 등록·잠금 shadow runtime 조립
- 검증: 실제 Mongo 1 pass; 전체 1,163 pass/145 skip/0 fail; typecheck/build; lint 오류0·기존7; 독립 리뷰 P0-P3 0
- 제품 SHA: `c20d0c0b624051e382687b6037e9ed2c8e9391d4`
- Do Not: 운영 DB·Atlas·실원천·배포·dev/main을 변경하지 않는다.
