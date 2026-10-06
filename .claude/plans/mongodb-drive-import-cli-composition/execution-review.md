# Drive 가져오기 CLI composition 실행 리뷰

- 범위: `drive:import:dry-run` 실제 명령 진입점
- 선택: PostgreSQL 기본, exact `--backend=mongodb-shadow`에서 open-only Mongo runtime
- 기존 동작: PostgreSQL 환경 파일 순서·인자·진행 출력·이력 쓰기·close 순서를 유지
- 실제 Mongo 확인: 합성 source, run/result 이력 생성, 결과 이름 암호문, 실제 `.mjs` 성공·실패 프로세스, PostgreSQL 환경 파일 접근 0, 부분 namespace 무수정 거부
- 집중 검증: 실제 진입·runtime·scope·Mongo 통합 21건 통과. 실제 `.mjs` Mongo 성공·실패 시나리오를 포함한다.
- 전체 회귀: 1547개 중 1372 pass·175 skip·0 fail, typecheck·build 통과, lint 오류 0·기존 경고 7
- 독립 리뷰: 초기 P2 2건·P3 1건을 보완했고 최종 P0~P3 모두 0건
- 미완료: 실제 Drive 접근, 운영 실행·예약·배포, 운영 데이터 이전·복구
