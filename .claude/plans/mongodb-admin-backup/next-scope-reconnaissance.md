**다음 최소 범위는 `activity:prune` CLI의 저장소 전환입니다.** 운영용 npm 진입점과 직접 Prisma 호출이 모두 남아 있습니다.

- **호출 근거:** [package.json:36](/Users/ga/workspace/hub-om-mongodb-coach-content/package.json:36) → [prune-activity.ts:12](/Users/ga/workspace/hub-om-mongodb-coach-content/scripts/prune-activity.ts:12) → [retention.ts:4](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/retention.ts:4)의 PostgreSQL 삭제 쿼리.
- **최소 범위:** 명시적 저장소 선택, 배치 반복, 삭제 합계, 연결 종료까지 CLI 한 경로를 완성합니다. 기존 [Mongo 정리 구현](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoRequestAuditRepository.ts:76)을 활용할 수 있습니다.
- **핵심 함정:** PG는 두 로그 삭제를 한 트랜잭션으로 묶지만 기존 Mongo 구현은 순차 삭제합니다. 30일/365일·배치 1,000건뿐 아니라 두 번째 삭제 실패 시 원자성도 보존해야 합니다.
- **활성 근거의 한계:** [운영 문서](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/activity-logging.md:34)에 수동·스케줄러 사용이 명시되어 있지만, 실제 정기 스케줄 설치 여부는 확인되지 않았습니다.

다음 두 경로는 별도 후속으로 구분하는 편이 맞습니다.

- **예약 작업의 전체 앱 구성:** [강의 후속 알림 POST](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/api/reminders/lecture-followup/route.ts:9)는 운영 저장소 factory를 거치며, [override 없는 기본 경로는 Prisma](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/operationRepositoryFactory.ts:16)입니다. 완료된 repository 재구현보다 작업 진입점의 저장소·원천·감사 연결 검증 대상입니다.
- **배포 migration:** [컨테이너 진입점](/Users/ga/workspace/hub-om-mongodb-coach-content/scripts/docker-entrypoint.sh:4)은 `RUN_DB_MIGRATIONS=true`일 때 Prisma migration을 실행합니다. 이는 배포 전환 과제이며 repository 전환과 분리해야 합니다.

`satisfaction:dry-run`은 [보관 기능의 명시적 수동 점검 도구](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/satisfaction-matching.md:24)라 이번 활성 후보에서 제외했습니다. 파일 변경·런타임·DB 실행·환경값 열람은 하지 않았습니다.
