# Mongo 강의 후속 알림 runtime 인계

- 총괄 기준: `feature/20260922-mongodb-parallel-transition` @ `b19586c80a0a532691a96e0d702343cf42967b7a`
- 작업 브랜치: `feature/20261001-mongodb-lecture-followup-runtime`
- 대상: `/api/reminders/lecture-followup` GET/POST
- operations·teamUsers·requestActivity, 명시 notifier와 Mongo HMAC 원자 선점 로그를 하나의 등록·잠금 scope로 조립한다.
- 실제 Mongo 1 pass, 전체 1,163 pass / 139 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7을 확인했다.
- 제품 SHA: `eb6d723`; 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0. 총괄 통합 SHA는 통합 후 갱신한다.
- 동시 요청의 중복 발송은 Mongo 선점으로 차단했다. 외부 Slack과 단일 transaction인 exactly-once, 실제 Slack·Coolify, production selector, 실데이터 이전·복원·최종 전환과 `dev`→`main`은 미완료다.
