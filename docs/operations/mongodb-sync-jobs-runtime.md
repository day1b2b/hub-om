# MongoDB 코치 동기화 작업 runtime

`/api/admin/sync-notion`, `/api/sync/engagements`, `/api/sync/samsung-schedule`, `/api/sync/all`이 사용하는 Notion 저장·원천, 시트 저장·원천, 실행 로그와 요청 감사를 하나의 명시 Mongo shadow namespace로 조립한다. 생산 기본 backend와 실제 Notion·Google 원천은 그대로 유지한다.

`prepareMongoCoachSyncRuntime`은 완전히 빈 namespace만 준비한다. 기존 또는 부분 namespace는 validator·index·catalog/scheduling guard 전체 readiness를 읽기 전용으로 확인하며 자동 생성·수리·삭제하지 않는다. 여섯 port는 등록 후 실행 동안 잠가 누락 port, 다른 namespace, PostgreSQL fallback을 차단한다.

로컬 MongoDB 8.0.30 replica set에서 실제 `/api/sync/all` bearer POST를 실행했다. 합성 빈 원천을 Notion→계약→일정 순서로 한 번씩 읽고 완료 `CoachSyncLog`와 `ActivityRequest`를 같은 namespace에 기록했으며 PostgreSQL과 비합성 외부 fetch는 0이었다. 기존 상세 repository 검증이 증명한 행별/단계별 commit, 부분 성공, 암호화, guard 경쟁 의미를 재구현하지 않고 그대로 조립한다.

실제 Notion·Google, Coolify 예약 설정, production selector, 운영 데이터 이전·복원·최종 전환은 실행하지 않았다.
