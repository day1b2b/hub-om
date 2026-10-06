# 코치 일정·예약·투입 API composition 통합 검토

총괄 `00ffa5044f1ab5e168f8a8a647638bc3a2593f82`에서 시작했다. 제품 변경은 실제 Mongo 집중·repository 회귀, 전체 회귀, typecheck, lint, build와 독립 리뷰를 통과했다. 기능과 1차 인계는 총괄 `1822ba3a5dd23245ccbcf1ff05e35f165ddabf0c`에 선형 통합하고 기능 브랜치와 총괄 원격을 같은 SHA로 확인했다.

생산 기본 PostgreSQL, 기존 일정·예약·투입과 동시 수정 보호, 암호화 저장과 요청·업무 감사 계약은 유지했다. 운영 배포·실데이터 이전·복원 리허설과 `dev → main`은 통합 범위가 아니다.
