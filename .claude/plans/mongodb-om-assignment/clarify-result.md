# OM 전체 배정 — 범위와 승인
Initiative PG→Mongo 및 개인정보암호화 / Wave 명시 기능 경계 전환 / Task 확인 후 전체 OM 배정.
기준74e1970, branch feature/20260929-mongodb-om-assignment. 독립clone만 사용.
사용자 계속진행/총괄통합 승인 유지. 첫 접수단위 완료에 이어 docs/operations/assignment-confirmation-integration.md의 확정정책을 이행한다.

## 성공 기준
실PG 원본과 Mongo preview/confirm/cancel 및 정확한 생성batch 일치. 수동이름/계정 전부 교체/해제, DONE상태 보존. 최신 확인서명·로그인주체·담당자·만료 재검증. 요청+모든회차+감사 원자성. 실Mongo 경쟁/phantom과 일반writer 경합 검증. 실제API권한/부수작업실패/비노출 검증.

## 제약
운영기본PG, 실제원천/DB/키/env/배포/원본workspace/main/dev 금지. 신규업무schema/dependency/deletion 정책 금지. 내부 동시성 보호는 기존 guard패턴과 무스키마대안을 비교하고 근거를 검토한다. 자동화설정은 이담당에서 변경하지 않음.
R1~6 모두해당(6), Level3. 서명 snapshot과Mongo snapshot isolation의 write-skew 불확실성, 일반writer영향, 사용자확인계약으로독립검토필수.
열린사용자정책결정 없음. 새 스키마 등 기존범위넘는 결정이 꼭 필요하면 구현전 명시한다.
