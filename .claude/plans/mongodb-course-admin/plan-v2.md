# 과정 관리자 실행 계획 v2

plan-v1의 1–5단계를 유지하고 validation-v2의 V1–V8을 수락 기준으로 실행한다.

## v1 대비 보완
- 업무 repository 호출 전 인증, withActivity의 선행 requestActivity 검사 순서는 그대로 유지한다.
- deletedBy 암호문과 HMAC 동시 갱신, 비관련 raw 필드 불변. snapshot read·원자적 부분쓰기·감사 실패 전체원복.
- 실제 Prisma Int범위/UUID표기 구분, 실제writer barrier 경합 재조회, 후행페이지 실패 원복, paging/시간 증거를 구체화한다.
- 메인: interface/PG/routes/context/handler/runtime. Schrodinger: Mongo구현. Kepler: native테스트. Gauss: 실제PG parity. 독립 critic Anscombe, 메타 및 실행 리뷰 Gibbs.
- 마지막 단계는 validation-v2 항목별 실제 증거 검토, 보완 재검증, 인계 및 총괄feature 통합이다. 운영/dev/main 미변경.
