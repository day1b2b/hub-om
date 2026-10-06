# 총괄 통합 검토

2026-09-22, 대상1601e60a8a369ec0b6410ebbf9aba900d2abd9a8, 이전총괄cc9eeb4. 총괄 feature 브랜치로 fast-forward하여 동일 소스를 보존했다.

- 직접 확인: Mongo/Prisma 일정·예약 저장소, 실제route, 공통context/감사allowlist diff, native반례와 독립리뷰/manifest/handoff.
- 별도 총괄 독립검토: release_db_verification이 READONLY 확인, 신규 확정 P1/P2나 통합차단 없음.
- 통합 clone 재실행: npm test 853 total / 837 pass / 16 skip / 0 fail. /tmp/hub-schedules-integrated-tests.log. git diff cc9eeb4 HEAD --check 통과.
- 같은 코드SHA의 기존실행로그 대조: nativeMongo8.0.30 47pass0skip(mock4포함), type/buildpass, lint0error기존7warning. 이번 총괄에서 native/build를 재실행한 것처럼 보고하지 않는다.
- 제품코드 변경 없는 fast-forward이므로 동일검사를 반복하지 않았다. 운영PG/Atlas/키/환경/main/dev/배포미변경.

다음 필수 범위는 engagement 확정·예약자동취소 및 외부동기화/삭제writer의 공통저장소/transaction 계약이다. 확정 tx가 예약0건을 읽은 뒤 다른 tx가 새예약을 넣는 빈조건 경쟁은 서로다른문서라 snapshot/active unique만으로 해결되지 않는다. 공통 guard에 모든writer가 참여하고 확정상태를 재검사해야 한다. 이미확정된날짜에새예약을허용하는지와 물리삭제SetNull/soft-delete 의미는 기존사용처·계약에서 판독하며 새정책을 추측하지 않는다.

예약자동취소는 cancelledAt·confirmedEngagementId·감사를 같은transaction에 보존해야 한다. OAuth/UI/실PG경합·실데이터/최종동기화/복원/운영전환은 여전히 미검증이다.
