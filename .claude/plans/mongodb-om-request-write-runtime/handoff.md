# Mongo OM 요청 쓰기 runtime 인계

- 총괄 기준: `feature/20260922-mongodb-parallel-transition` @ `41f830c38a50497da34312969032105bfd1a1c09`
- 작업 브랜치: `feature/20261001-mongodb-om-request-write-runtime`
- 대상: OM 요청 생성·수정·삭제, 배정 미리보기·확정 handler
- Calendar-aware Mongo 저장소·같은 namespace의 persistence/lock과 명시 합성 effect port를 하나의 등록·잠금 scope로 조립한다.
- 실제 Mongo 1 pass, 전체 1,164 pass / 137 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7을 확인했다.
- 독립 리뷰 P0-P3 0, 제품 SHA `efd0c92af39a14261ca421b48e98f9920b74020e`를 확인했다. 총괄 통합 SHA는 문서 커밋 후 갱신한다.
- 실제 Slack·Calendar, production selector, 실데이터 이전·복원·최종 전환과 `dev`→`main`은 미완료다.
