# 검증 v1 — 독립 critic

검토자 Anscombe, 2026-09-29, 현재 브랜치와 clarify/plan-v1 정적 검토. 판정 REVISE. 테스트 결과 아님.

필수 기준:
- V1: 기본 PG, 명시 scope 누락 실패, 병렬·중첩 context 격리와 PG 접근 차단.
- V2: 실제 메모 trim/빈값/잘못된 JSON/toggle 우선/작성자 보존/DTO/날짜. 타 코치·없는 ID 무변경, 삭제 메모·이력 기존 조건.
- V3: NOTE·EDIT_HISTORY·ActivityChange 원자성; 후행 이력/감사 실패 rollback; 이력 중복 감사 없음.
- V4: 각 생성/수정/삭제/토글과 purge 양방향 barrier 경합, 고아 없음. 동시 toggle 2회 원복·정확한 이력, 본문·경고 상호 덮어쓰기 없음.
- V5: guard 후 부모/행 판정; 초기 guard 충돌·재시도 한도. standalone/guard/validator/index 미준비 거부, 자동 DDL 없음.
- V6: 피드 각 source 서버 300 제한, 전체600, EDIT_HISTORY 제외/삭제코치 포함/rating0/빈feedback/null/299·300·301/누락관계/동률.
- V7: ACTIVE/미삭제·해당월 로그 3분류, 다른월·비활성·삭제 제외, 월 검증/URL null·encoding.
- V8: 실제 admin page 권한·content redirect 선행·배열/기본 탭·count; 전체 목록 복호화 없는 count.
- V9: 실제 guard/withActivity, workspace/admin 구분, request audit 누락 선행실패와 기록실패 성공유지; actor/status/requestId.
- V10: 저장 평문·응답 companion 없음, 키/암호문/HMAC 실패, 오류·감사 평문 비노출, 기존 private access 회귀.
- V11: 실제 합성 PG/Mongo fixture 대조. 새 PG adapter만 정답으로 삼지 않고 e1b9749 기존 조건을 독립 기준으로 사용. ID/시각만 제한 정규화.
- V12: 신규 DB suite skip0, 전체 검사와 독립 리뷰, 문서/commit/push/원격 SHA 및 자원 정리.

계획 보완: context 자체 부재와 명시 scope 서비스 누락 구별; count는 coachAdmin 배치; 프로필/후기 helper PG 유지; baseline 독립성·경합 주입 지점·env-i·자원 정리 명시.

한계: 기존 동률 300번째 선택 집합과 collation은 보장되지 않는다. 기존 auth mock 시험은 실제 guard를 대신하지 않는다. 합성 세션은 OAuth E2E가 아니다. 과거 검증·운영/Atlas·실키·브라우저 초안은 근거 아님.

결과는 PASS/FAIL/NOT RUN/BLOCKED와 실행 근거를 기록한다. 선택: 추가 collation·장시간 부하·광범위 시각회귀. 필수 미실행을 PASS로 올리지 않는다.
