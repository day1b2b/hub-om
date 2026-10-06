# 코치 공개 화면 composition 실행 검토

- 코치·강사 공개 화면 6개의 PostgreSQL 기본·정확한 Mongo shadow selector를 구현했다.
- 인증 후 operations·instructorNote·coach 세 포트만 같은 잠금 namespace로 열고, 누락·혼입·부분 준비 상태에서는 fallback 없이 callback 전에 실패하게 했다.
- 실제 MongoDB 8.0.30에서 selector 단위 6건과 기존 페이지·factory 포함 13건, 합계 19건이 통과했다. 여섯 화면 직접 실행, 인증 선행, 저장 snapshot 불변, 부분 namespace 무수정 거부와 PostgreSQL 접근 0건을 확인했다.
- 일반 전체 회귀는 1,330 통과 / 168 제외 / 0 실패였다. typecheck·build 통과, lint 오류 0 / 기존 경고 7이었다. 중복 검사는 합산하지 않는다.
- 첫 실행은 Node module mock 플래그 누락으로 통합 테스트 시작 전에 실패했다. 플래그를 보완한 뒤 실제 selector 검사는 통과했다. 이어 selector 환경 원복 누락으로 후속 테스트 7건이 실패해 finally 원복을 추가했고 전체 묶음이 통과했다.
- 독립 리뷰는 전용 3포트 runtime 축소 후 P0-P3 0건이었다.
- 운영 데이터·production 배포·브라우저 전체 흐름·A/B 백업·복원·복사·최종 전환은 검증하지 않았다.
