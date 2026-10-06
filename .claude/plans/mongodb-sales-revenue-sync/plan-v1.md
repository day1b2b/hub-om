# Plan v1

핵심 난이도: 응답에 쓰이는 JS 금액과 저장 Decimal 반올림, 조회시점 snapshot과 쓰기시점 최신행, 일괄업무/별도 sync log/요청감사의 세 실패 경계를 보존하는 것.

1. [Core] 원본 조건표/동결 oracle. disabled/failed면 저장 호출 없음. partial+apply면 모든 업무 차단하고 sync log 시도. 정상 apply이면 snapshot 기준 pending 순서대로 전부 쓰거나 전부 취소. duplicate 원천은 dedupe하지 않고 snapshot before/반영횟수 유지. 다중동일금액은 max 하나(해결방식 무시), 다른금액은 sum/max/min/exclude, 복수 Course 모두 매칭. 산출물 source audit/oracle, 수락: 분기·부작용·응답 매핑 누락0.
2. [Core] PG 기본 port와 Mongo 구현. facade는 명시 source/repository부터 해결하고 source읽기; disabled/failed에는 PG 초기화 없음. Mongo는 준비된 namespace/replicaset/codec 인증만 사용. Course 목록과 Company 이름 조회, 쓰기 트랜잭션에서는 최신행 재읽고 revenue/revenueRaw/updatedAt만 변경, 감사 함께 기록. 재시도는 최신행 재읽기, pending 계산은 원본처럼 유지. sync log는 별도 암호화 best effort. 금액은 PG 실측에 맞춘 rounding/range 변환, 공통 codec 완화 금지. 산출물 product patch, 수락: 원본 의미 및 원자성/비노출.
3. [Core] API와 외부 경계. 기존 admin/secret/잘못된bearer fallback/status/body 유지. 명시 scope에서 알림도 실Slack/PG로 넘어가지 않게 port 검토, 운영 알림 조건은 유지. source/driver/raw 오류는 고정 안전 오류로 제한하되 허용된 preview 결과 이름과 구분. 산출물 handler/source integration, 수락: 외부 실호출0, 누락 scope failclosed, 권한/감사 결과 대조.
4. [Check] 새 loopback 실제PG/Mongo에서 원본/newPG/Mongo preview/apply/reapply 정확 대조(무정렬 복수 결과와 생성시각/UUID만 이유를 명시해 정규화). decimal 반올림/경계/오류, 반복원천/복수과정/partial, 실제 경쟁 writer 양방향, 실패중간 rollback, 암호화/키손상, sync/request log 실패 검증. 수락: 요구사항과 테스트 연결, skip/미실행 구분, 독립 원본 근거.
5. [Check] 전체 unit/Mongo 묶음/type/lint/build와 독립 최종 리뷰. 수락: 실패0 또는 미해결 차단 명시, 중복집계 금지, 기존 경고 분리, 새 변경 없는 검사는 반복하지 않음.
6. [Shell] coverage/macro/운영·실행·인계 갱신, 합성자원 소유확인 후 정리, feature commit/push와 총괄 FF/동일제품 확인/원격SHA 대조. 수락: 미커밋0, 운영영향0, 전체이전미완료 명시.
