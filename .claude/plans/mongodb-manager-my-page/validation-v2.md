# 검증 기준 v2

독립 critic Anscombe: 계획 적합. 구현 완료는 아래 실행 증거로 별도 판정한다.

| ID | 필수 결과 |
| --- | --- |
| M1 | 실제 admin guard 유지. 미인증·비관리자 조회 전 거부. 세션 이메일만 사용하며 searchParams로 타인 identity 지정 불가. 빈 화면과 분류 props 확인. |
| M2 | context 없음 PG, 명시 서비스 누락 실패. 예약 exact/HMAC 원문 확인과 명단 trim/lower 첫 일치 구분. 원문 contains→split→normalize 보존. |
| M3 | 메서드별 동일 snapshot. 두 page 호출 전체 원자성은 요구하지 않음. null link 제외, dangling non-null Mongo fail-closed 별도 검사. |
| M4 | 예약 coach·linked 우선·중복 제거·삭제 coach·활성 슬롯·라벨·기간·정렬 보존. UTC 오늘 및 partition·빈 props 확인. |
| M5 | 키 누락·변조·관계 손상은 원문 없이 실패. scan limit·timeout은 부분 결과나 정상 빈 결과로 대체하지 않음. 부하 보장을 의미하지 않음. |
| M6 | 실제 격리 PG/Mongo와 독립 기대값 비교. 전체 회귀·typecheck/lint/build·독립 리뷰. 문서/commit/push/SHA 인계 별도 판정. |

PASS/FAIL/NOT RUN을 구분한다. 동률·동명이인 기존 모호성 및 선택 부하 검사 미실행은 그 자체로 차단하지 않는다. 신규 계약 회귀·인증/암호화/snapshot 실패·필수 검증 미실행은 차단한다.
