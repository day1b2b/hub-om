# Mongo 코치 아카이브 서비스 백필 실행 리뷰

기존 SQL의 completed archive 선택과 코치·접속 로그 복원 의미를 repository command로 옮겼다. PostgreSQL은 Prisma 암호화 wrapper를 사용하고 Mongo는 Coach, CoachScheduleAccessLog, CoachdbArchiveRow, CoachdbArchiveSnapshot, ActivityChange의 준비 상태를 확인한다. 기본 backend는 PostgreSQL이며 exact selector 이외에는 Mongo를 열지 않는다.

코치는 250행씩 읽고 row-key HMAC으로 최신 archive 후보를 좁힌 뒤 원문을 확인한다. 최신 접속 로그는 HMAC 인덱스 순서로 최대 250행만 읽어 key를 로컬 중복 제거하고, 해당 key에 대해서만 latest lookup/group한 뒤 source-coach HMAC 후보의 원문을 확인한다. 따라서 archive 전체를 첫 페이지부터 정렬·그룹하지 않는다. PostgreSQL은 ID/HMAC metadata page와 wrapper payload를 분리하고 원문/HMAC을 대조해 잘못된 index key를 차단한다. 실제 변경 필드만 다시 암호화하고 무관한 저장 필드는 보존하며 접속 로그는 `(coachId, yearMonth)`로 upsert한다. 전체 작업은 snapshot transaction이며 잘못된 후반 로그, unique 충돌, 키·validator/index 불일치에서 부분 적용하지 않는다. Mongo의 unlabeled 11000은 전체 transaction 재시도로 수렴시키며 재실행에서 코치 ciphertext와 `updatedAt`을 바꾸지 않는다. nullable을 포함한 timestamp without time zone은 기존 PostgreSQL cast처럼 원천 offset을 적용하지 않고 wall-clock 구성요소를 보존한다.

일반 회귀 1,121 pass/114 opt-in skip/0 fail, 실제 MongoDB 8.0.30 root 1 pass, 실제 합성 PostgreSQL 17 1 pass, focused 6 pass, typecheck/build 통과, lint 오류 0·기존 경고 7이다. 독립 리뷰에서 지적된 timestamp, PostgreSQL 조회·키 검증, Mongo 페이지 확장성·16MiB batch 경계 문제를 수정하고 재검증했으며 최종 P0~P3는 모두 없다. 실제 운영 규모와 운영 데이터·원천·키·설정은 검증하지 않았다.
