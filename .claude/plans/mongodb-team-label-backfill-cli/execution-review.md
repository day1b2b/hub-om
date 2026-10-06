# Mongo 팀 명칭 보정 CLI 실행 리뷰

legacy raw SQL과 암호화 schema 차단을 TeamUser count/조건부 rename으로 교체했다. 기본 PG·기본 dry-run·`--apply`·두 exact 라벨·출력은 유지하고 local-file 선택은 거부한다. 명시 Mongo는 준비된 user-admin shadow만 열며 PII를 복호화하거나 재암호화하지 않고 team만 갱신한다.

일반 회귀 1,110 pass/110 opt-in skip/0 fail, 실제 MongoDB 8.0.30 1 pass, focused 8 pass, typecheck/build 통과, lint 오류 0·기존 경고 7이다. dry-run 전체 raw 불변, 공백 변형 제외, 재실행 0, PII 암호문·companion byte 불변, 부분 runtime namespace 불변을 확인했다. 독립 리뷰의 local-file 오선택과 PII 재암호화 지적을 보완해 잔여 P0/P1/P2 없이 수락받았다. 운영 DB·설정·데이터에는 접근하지 않았다.
