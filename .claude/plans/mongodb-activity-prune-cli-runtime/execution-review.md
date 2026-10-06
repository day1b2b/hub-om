# Mongo 활동 정리 CLI runtime 실행 리뷰

기본 PG와 명시 Mongo 선택을 분리했다. 최초 전체 회귀는 기존 CLI 인자 호환성 회귀 7건을 찾아 기존의 무시 인자 호환성을 복구했다. 최종 일반 회귀는 1,094 pass/108 opt-in skip/0 fail이다. 실제 MongoDB 8.0.30에서 준비된 shadow 삭제, 미생성 DB의 collection 0, 부분 namespace의 collection·문서 불변을 1 pass로 확인했다.

소유 client의 종료 실패, open/prune 실패 시 close 정확히 1회와 내부 canary 비노출은 실제 CLI 함수 호출 4 pass로 확인했다. typecheck/build는 통과했고 lint는 오류 0·기존 경고 7이다. 독립 리뷰의 P2를 모두 보완해 잔여 P0/P1/P2 없이 최종 수락받았다. 운영 DB·설정·예약에는 접근하거나 쓰지 않았다.
