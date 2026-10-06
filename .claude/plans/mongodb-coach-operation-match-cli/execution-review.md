# Mongo 코치 운영 매칭 CLI 실행 리뷰

기존 raw SQL 진단·백필을 `coachOperationMatch` 저장소 계약과 공용 command로 교체했다. 기본 PostgreSQL은 Prisma 암호화 wrapper로 이름을 복호화해 기존 매칭 엔진에 전달한다. 명시 Mongo는 Company, Course, OperationSession, Coach, CoachEngagement, CoachEngagementSchedule의 준비 상태와 catalog guard를 확인한 뒤 snapshot 조회와 조건부 연결을 수행한다.

Mongo transaction의 동일 session 조회는 순차 실행한다. apply는 catalog guard, 살아 있는 operation, `operationSessionId: null` 조건을 사용하며 최초 guard duplicate-key는 최대 5회 재시도한다. 기존 연결을 덮어쓰지 않고 PII 암호문·HMAC companion을 byte 불변으로 유지한다. 부분 namespace는 metadata/index/document mutation 없이 거부한다. 진단의 승인된 복호화 표시는 유지하지만 command lifecycle 오류는 고정 메시지로 변환한다.

일반 회귀 1,115 pass/112 opt-in skip/0 fail, 실제 MongoDB 8.0.30 1 pass, 실제 합성 PostgreSQL 17 연속 2회 pass, typecheck/build 통과, lint 오류 0·기존 경고 7이다. 독립 리뷰의 transaction 병렬 조회, 합성 DB 소유권, guard 충돌, 종료 오류, 부분 namespace, limit 표기, fixture cleanup 지적을 보완했고 잔여 P0~P3 없이 수락받았다. 운영 DB·원천·키·설정에는 접근하지 않았다.
