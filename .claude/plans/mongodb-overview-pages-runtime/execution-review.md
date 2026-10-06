# Mongo 공통 개요 화면 runtime 실행 리뷰

- 기준 총괄 SHA: `d1ceb1da2b70835a16f087cccad809389e807306`
- 작업 브랜치: `feature/20261001-mongodb-dashboard-pages-runtime`
- 제품 커밋: `13fa625`
- 범위: 대시보드·내 페이지·회사 위키·자료실의 초기 서버 조회
- 저장소: `operations`, `teamMembers`, `teamUsers`, `omRequests`
- 외부 원천: Calendar disabled 합성 port, 실제 외부 접근 없음
- 실제 MongoDB 8.0.30: 1 pass / 0 skip / 0 fail
- 전체 테스트: 1,164 pass / 135 skip / 0 fail
- typecheck/build: 통과
- lint: 오류 0 / 기존 경고 7
- 독립 리뷰: P0/P1/P2/P3 0건
- 생산 기본 PostgreSQL, 운영 데이터, 배포 설정과 자동화 상태는 변경하지 않음
