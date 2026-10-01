# Mongo OM 요청 화면 runtime 인계

- 총괄 기준: `feature/20260922-mongodb-parallel-transition` @ `8490c7e43b0318e11c3adcb9135c867373edd8c3`
- 작업 브랜치: `feature/20261001-mongodb-om-request-pages-runtime`
- 대상: `/om-request`와 관리 목록·상세·수정·완료 화면
- 기존 운영 화면 runtime의 동일 repository 묶음을 재사용한다.
- 실제 Mongo 1 pass, 전체 1,164 pass / 136 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7을 확인했다.
- 제품 커밋: `61a413f`
- 독립 리뷰 지적을 보완해 최종 P0~P3 0건으로 수락됐다.
- 완료 화면은 이제 workspace 인증 전에 Mongo 요청을 읽지 않는다.
- 총괄 통합 SHA는 통합 후 갱신한다.
- OM 요청 쓰기/배정 handler 조립, production selector, 실데이터 이전·복원·최종 전환과 `dev`→`main`은 미완료다.
