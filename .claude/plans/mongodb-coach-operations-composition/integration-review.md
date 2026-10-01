# 코치 일정·예약·투입 API composition 통합 검토

총괄 `00ffa5044f1ab5e168f8a8a647638bc3a2593f82`에서 시작했다. 제품 변경은 실제 Mongo 집중·repository 회귀, 전체 회귀, typecheck, lint, build와 독립 리뷰를 통과했다. 총괄 통합 SHA와 원격 일치는 최종 통합 커밋에서 기록한다.

생산 기본 PostgreSQL, 기존 일정·예약·투입과 동시 수정 보호, 암호화 저장과 요청·업무 감사 계약은 유지했다. 운영 배포·실데이터 이전·복원 리허설과 `dev → main`은 통합 범위가 아니다.
