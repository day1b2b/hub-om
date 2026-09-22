# 독립 실행 검토 Gap 보완

sql_review가 P2 두 건으로 수락 보류했다.

1. 행마다 모든 코치와 프로필 순차조회 → listLiveCoaches는 프로필 batch 1회, ensureCoach는 별도 exact-name reader로 제한. Mongo name HMAC equality+fullrow검증 후 live선택, PG name/live equality findMany의 마지막행. 기존 우선순위계약을새로만들지않는다. native querycounter 및 PGmock 회귀.
2. public reader raw driver예외 HTTP노출 → 모든 publicread에 고정 COACH_SHEET_READ_FAILED 경계, log open에도 고정code. 실제handler marker주입회귀.

수정후 해당native와순수회귀, 전체test/type/lint/build 결과재검토. 기존독립검토조건은완화하지않는다.
