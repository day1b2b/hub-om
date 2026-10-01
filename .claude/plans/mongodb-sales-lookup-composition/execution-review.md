# 매출 조회 composition 실행 리뷰

- 범위: `/api/sales/lookup` GET
- 선택: operations·기존 salesRevenueSource·requestActivity 전용 runtime과 exact selector
- 검증: selector 단위 5건, 실제 Mongo route 1건
- 실제 Mongo 확인: 코스ID/고객사 필터, 401, source 오류 정제, warming 후 캐시 재사용, 매출 비노출, 요청 감사, 토큰 비저장, PG 접근 0건, 부분 namespace 불변
- 전체 회귀: 1539개 중 1365 pass·174 skip·0 fail, typecheck·build 통과, lint 오류 0·기존 경고 7
- 미완료: 실제 Salesmap, production 배포, 운영 데이터 복사·A/B 복원·최종 전환
