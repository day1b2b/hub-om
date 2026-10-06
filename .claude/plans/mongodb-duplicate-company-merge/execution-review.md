# Mongo 중복 회사 병합 실행 리뷰

기존 raw Prisma CLI를 repository command로 옮겼다. 기본 backend와 기존 병합 의미는 PostgreSQL이며, exact `--backend=mongodb-shadow`만 준비된 shadow runtime을 연다. source 회사는 남기고, 일치 target 과정이 있으면 회차를 이동한 뒤 중복 source 과정만 삭제한다. 일치 과정이 없으면 회사를 재지정한다. 라벨도 같은 course ID의 target 행이 있을 때만 source 중복 행을 삭제한다.

apply는 백업·점검 확인 플래그를 요구하고 PostgreSQL serializable 또는 Mongo snapshot transaction 하나에서 실행한다. Mongo는 과정명 복원 guard를 일반 운영 create/update, import promotion, 과정명 복원과 공유하므로 병합 중 고아 과정 참조를 만들지 않는다. 첫 guard 11000은 전체 transaction을 최대 5회 재시도하고, 후반 라벨 오류는 앞선 과정·회차 변경까지 롤백한다. 부분 namespace와 준비 불일치는 쓰기 없이 실패한다. source/target 이름이나 저장소 오류 원문은 공개 오류에 포함하지 않는다.

일반 회귀 1,125 pass/116 opt-in skip/0 fail, 실제 MongoDB 8.0.30 root 1 pass, 실제 합성 PostgreSQL 17 root 1 pass, focused 4 pass와 typecheck/build를 확인했다. lint는 오류 0·기존 경고 7이다. 독립 리뷰의 초기 P1 1건과 P2 3건, 후속 P3 3건을 보완했고 최종 P0~P3는 모두 없다. 운영 실행·실데이터·키·설정은 검증하지 않았다.
