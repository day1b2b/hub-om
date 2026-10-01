# 매출 조회 composition 인계

`SALES_LOOKUP_BACKEND` 기본값은 PostgreSQL이다. Mongo 선택에서 운영현황 조회·Salesmap source port·요청 감사가 한 namespace를 사용한다. 실제 Salesmap과 운영 설정은 변경하지 않았다. 첫 통합 SHA는 `9bb1940bd0aebed75933fcac721ea8f8367e7693`이며, 독립 리뷰는 P0~P3 모두 0건이다.

실제 로컬 Mongo replica set과 loopback 합성 Salesmap 서버로 원천 실패 정제, warming, 완료 후 캐시 재사용, 매출 필드 비노출을 검증했다. 전체 회귀는 1539개 중 1365 pass·174 skip·0 fail이고 typecheck·build 통과, lint 오류 0·기존 경고 7이다.
