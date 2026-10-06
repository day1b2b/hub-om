# Mongo 공통 개요 화면 runtime 인계

- 총괄 기준: `feature/20260922-mongodb-parallel-transition` @ `d1ceb1da2b70835a16f087cccad809389e807306`
- 작업 브랜치: `feature/20261001-mongodb-dashboard-pages-runtime`
- 대상: `/dashboard`, `/me`, `/company-wiki`, `/resources`
- 네 화면이 공유하는 네 repository를 같은 등록·잠금 Mongo shadow scope로 조립한다.
- 빈 namespace만 준비하고 기존·부분 namespace는 자동 수리하지 않는다.
- 실제 Mongo page 검증은 합성 데이터와 disabled 외부 source로 수행한다.
- 제품 커밋: `13fa625`
- 실제 Mongo 1 pass, 전체 1,164 pass / 135 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7을 확인했다.
- 독립 리뷰는 P0~P3 0건으로 수락됐다.
- 총괄 통합 SHA는 통합 후 갱신한다.
- production selector, 실제 외부 원천, 실데이터 이전·복원·최종 전환과 `dev`→`main`은 미완료다.
