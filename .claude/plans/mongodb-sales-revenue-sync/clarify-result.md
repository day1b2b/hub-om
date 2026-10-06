# 매출 동기화 전환

Initiative PG→Mongo/개인정보 암호화, Wave runtime 경계, Task salesRevenueSync. 기준 a52f191f0f5ffd6aeb805eea8e040ab78196eb6c. 사용자 계속 진행 승인으로 구현·검증·독립 리뷰·feature/총괄 통합까지 수행한다. 전체 앱 연결/실제 복사/복원/운영 전환/dev→main은 이 단위 완료가 아니다.

R1 다중파일, R2 원천/저장/API 구성, R3 금액·감사 parity 실측, R4 매출 변경 위험, R5 원본 의미 대조, R6 다음 단위 인계: 6축 Level3. development-harness/validated-plan 적용.

성공: 기존 PG 기본 유지, 명시 scope에서 Mongo/source/requestActivity 누락 PG fallback·실원천 접근 0. 원본 매칭/응답/집계/금액 선택/부분조회 차단/재실행 유지. 일괄 업무+변경감사 원자성, sync log 별도 best effort, 암호화 저장 및 오류 비노출. 실제 합성 PG/Mongo/handler, 전체 test/type/lint/build, 독립 리뷰 후 문서/원격 SHA/정리.

제약: 격리clone만 변경. 운영 DB/Atlas/실Salesmap/Notion/Google/Slack/PII/키/env/배포/main/dev/원본workspace/자동화 변경 금지. 새 의존성/스키마/업무필드/삭제정책 없음. 미검증은 PASS 금지, 실패 기록, 불필요한 동일 검사 반복 금지.

대안: 기존 함수를 두 backend에 복제하면 빠르지만 계산 drift가 생긴다. 계산 workflow를 공통으로 두고 최소 저장/source port를 추출하면 PG query 순서와 결과를 보존하며 Mongo를 독립 검증할 수 있어 후자 선택. 원본 PG 동결 oracle로 공통 로직 오류의 false pass를 차단한다.

가정: 기존 무정렬 Course 조회는 복수 매칭 표시 순서 보장이 없다. 순서를 임의 계약으로 추가하지 않고 비교 범위/첫 항목 차이 한계를 명시한다. 금액은 PG Decimal(14,2) 실제 변환을 확인한다. 동시 매출은 기존 후행 쓰기 우선, 관련 없는 수동필드 보존. 새 충돌 거부 정책은 추가하지 않는다.
