# Mongo 공통 개요 화면 runtime 통합 검토

작업 브랜치는 총괄 `feature/20260922-mongodb-parallel-transition`의 `d1ceb1da2b70835a16f087cccad809389e807306`에서 시작했다. 실제 Mongo 검증, 전체 회귀, typecheck/lint/build와 독립 리뷰를 통과한 제품·문서 커밋만 총괄에 fast-forward 통합한다.

제품 커밋은 `13fa625`다. 실제 Mongo 1 pass, 전체 1,164 pass / 135 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7을 확인했다. 독립 리뷰는 P0~P3 0건으로 수락됐다.

이번 통합은 대시보드·내 페이지·회사 위키·자료실의 초기 서버 조회 범위다. 생산 selector, 실제 외부 원천, 운영 데이터 이전·복원·최종 전환 및 `dev`→`main` 조건 충족을 뜻하지 않는다. 작업·총괄 원격 SHA 일치는 통합 후 확인한다.
