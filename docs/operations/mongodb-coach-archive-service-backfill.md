# 코치 아카이브 서비스 백필 Mongo 경계

## 범위

`db:backfill:coach-archive-service-data`는 최신 completed coach-db 아카이브에서 코치 운영 필드와 일정 접속 로그를 복원한다. 기본 저장소는 암호화 PostgreSQL이다. 준비된 검증용 shadow를 사용할 때만 exact selector를 추가한다.

```bash
npm run db:backfill:coach-archive-service-data -- --dry-run
npm run db:backfill:coach-archive-service-data -- --apply --backup-confirmed --maintenance-confirmed
npm run db:backfill:coach-archive-service-data -- --dry-run --backend=mongodb-shadow
```

apply 확인 플래그는 실제 백업과 쓰기 중단을 수행하지 않는다. Mongo 실행에는 `MONGODB_URI`, `MONGODB_SHADOW_DATABASE`, `MONGODB_SHADOW_NAMESPACE`가 필요하며 CLI는 namespace를 생성·수리·삭제하지 않는다.

## 동작과 안전 조건

- completed snapshot만 사용하고 같은 원천 키에서는 시작 시각, archive ID 내림차순으로 최신 행을 고른다.
- 코치 연결은 복호화된 `sourceCoachId`의 인증된 값으로 수행한다. 저장 시 개인정보 필드와 companion HMAC은 기존 codec/wrapper가 다시 생성한다.
- 코치 값이 실제로 달라진 경우만 갱신한다. dry-run의 `changedCoaches`는 기존 SQL에서 빠졌던 `returnDate`, `deletedBy`도 포함하므로 apply 대상과 일치한다.
- 접속 로그는 기존 `(coachId, yearMonth)` unique 의미로 upsert한다. 같은 원천 재실행은 새 로그를 만들지 않는다.
- PostgreSQL과 Mongo 모두 하나의 snapshot transaction에서 처리하며 후반 로그 오류도 앞선 코치 갱신까지 롤백한다. PostgreSQL은 ID/HMAC metadata만 keyset 조회한 뒤 암호화 wrapper로 payload를 읽고 원문/HMAC을 대조해 잘못된 index key를 성공 0건으로 처리하지 않는다.
- Mongo 최초 upsert 경합의 duplicate-key는 전체 transaction을 최대 5회 재시도한다. 다른 unique 충돌은 재시도 한도 뒤 전체 실패한다.
- raw SQL과 평문 equality 검색을 사용하지 않는다. 저장 문서·오류·CLI 출력에는 토큰, 메모, 삭제 수행자, archive row를 출력하지 않는다.
- Mongo는 코치와 최신 archive group을 250행 keyset page로 읽고 각 page를 32MiB로 제한한다. 원천 키·코치 연결은 HMAC 후보 조회 후 복호화 원문을 다시 확인한다. 전체 작업은 120초 안에 끝나야 하며 실제 운영 규모 적합성은 별도 사전 점검 대상이다.

실패 시 기존 shadow를 자동 수리하지 않는다. validator/index/키 불일치나 이전 정책 문서가 있으면 새 run ID와 namespace로 다시 복사한다. 운영 적용 전 PostgreSQL과 대상 shadow의 백업·복원 확인, writer 중단, dry-run, apply, 재실행 0 변경 확인 순서를 따른다.

## 검증 결과와 한계

- 일반 회귀: 1,121 pass / 114 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 1 root pass(251행 양쪽 page 경계, 암호화, rollback, duplicate-key 재시도, 부분 namespace, 실제 runtime 포함)
- 실제 합성 PostgreSQL 17: 1 pass(잘못된 HMAC key 거부 포함)
- focused command/runtime/value: 6 pass
- typecheck/build 통과
- lint: 오류 0, 기존 경고 7

실제 운영 DB·Atlas·Notion/Google 원천·운영 키·배포 설정에는 접근하지 않았다. 실제 규모·운영 시간대·운영 backup/restore와 production selector는 검증하지 않았다. 이 범위는 한 CLI의 저장소 경계이며 전체 앱 전환이나 운영 이전 완료가 아니다.
