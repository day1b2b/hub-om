# 검증 v2

독립 critic Anscombe가 architect 메타평가를 반영. core 적합, 2026-09-29. 각 항목은 PASS/FAIL/NOT RUN/BLOCKED와 실행 근거·한계를 기록한다. skip은 PASS가 아니다.

| 항목 | 필수 결과 |
| --- | --- |
| V1 | 기본 PG, 명시 scope 서비스 누락 실패, fallback/병렬·중첩 혼선 없음 |
| V2 | 기존 입력/응답/작성자/id+coachId 계약, 삭제메모·이력 임의제한 없음, 기존 helper PG 유지 |
| V3 | 메모/이력/감사 원자성, 후행 실패 rollback, 재시도 중복 및 이력 중복감사 없음 |
| V4 | Mongo 동시토글 원복·정확한 이력, 본문/토글 필드보존, 메모연산×purge 양방향 고아 없음. PG 기존 경쟁결함 수정 제외 |
| V5 | 새 정확성 전제의 guard/validator/index/transaction 확인; 미준비 실패·자동수리 없음. 포괄 환경조합 검사 제외 |
| V6 | source별 DB조회 300 및 최종600, NOTE/후기/null/빈값/삭제코치 계약·경계검사. 동률선택집합 동일강요 없음 |
| V7 | ACTIVE/미삭제·월접근로그 기반 분류·집계·DTO·입력URL |
| V8 | coachAdmin count, 실제 admin page 권한/탭/redirect; PG진입 없음 |
| V9 | 실제 guard/withActivity; 감사누락 선행실패·기록장애 성공유지; actor/status/requestId/민감원문비노출 |
| V10 | 기존 개인정보정책, 저장평문/응답companion/오류원문 없음, 키/변조 실패, 관련 private-access 회귀 |
| V11 | 실제 격리 PG/Mongo 고정fixture 엄격비교. ID/시각 제한정규화. 동률/collation만 별도한계이며 일반불일치 면책금지 |
| V12 | 신규 필수 suite skip0, 전체 test/type/lint/build 결과분류, 페이지실행/독립리뷰. 과거결과 재사용금지 |

인계 조건은 별도: coverage/macro/실행/인계 문서, commit/push/원격SHA, 소유합성자원정리. 선택은 장시간부하/추가collation·버전/광범위 시각검증. OAuth/운영환경·실데이터·브라우저초안 암호화는 범위 밖이다.
