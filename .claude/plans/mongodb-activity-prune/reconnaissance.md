**최소 권고는 두 모델만 다루는 새 repository에서, 배치당 하나의 트랜잭션과 하나의 서버 기준시각을 사용하는 것입니다.** 기존 Mongo 감사 정리를 그대로 호출하면 동등하지 않습니다.

- **현재 차이:** [PG 정리](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/retention.ts:4)는 같은 트랜잭션의 `now()`로 두 cutoff를 계산합니다. 반면 [기존 Mongo](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoRequestAuditRepository.ts:76)는 모델마다 `Date.now()`를 계산하고 두 삭제를 별도로 실행합니다.

- **서버 시각:** 트랜잭션 callback 첫 단계에서 `$$NOW`를 projection으로 한 번 받아 두 cutoff를 고정하십시오. 빈 collection에도 시각이 반환되도록 **collectionless `$documents:[{}]` → `$project:{serverNow:"$$NOW"}`**를 우선 검토할 만합니다. 다만 이 조합의 **트랜잭션 내 실행 가능성은 부모 native gate가 필요**합니다. Calendar에서 확인한 것은 [서버 `$$NOW` 사용](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCalendarOperationLock.ts:120)이며, 재사용할 `serverNow` 함수는 찾지 못했습니다. 모델별 명령에서 `$$NOW`를 다시 평가하면 고정 cutoff가 아닙니다.

- **원자성·선택:** 동일 session에서 각 모델의 `occurredAt < cutoff`를 날짜 오름차순으로 최대 1,000개 선택한 뒤, 선택 ID와 같은 cutoff로 삭제합니다. 두 번째 삭제 실패 시 첫 삭제도 rollback되어야 합니다. PG 동률 순서는 미정이므로 특정 ID 선택을 동등성 기준으로 강제하지 마십시오. [PG 연결은 UTC](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/prisma.ts:24)이므로 30·365일의 밀리초 차감과 DST 충돌은 없습니다.

- **재시도·집계:** cutoff와 삭제 수는 **callback 실행별 지역값**으로 둡니다. 새 트랜잭션 재시도는 서버 시각을 새로 얻고, 그 시도 안에서는 고정합니다. callback은 `{requests,changes}`만 반환하고, `withTransaction`이 성공한 뒤 CLI에서 한 번 합산합니다. 오류를 callback 안에서 일반 Error로 변환하면 드라이버 재시도 라벨을 잃으므로 고정 오류 변환은 바깥에서 합니다.

- **limit·drain:** 원본 기본값은 고정 1,000입니다. 옵션을 노출한다면 정수·양수·허용 상한을 I/O 전에 검사하고, `undefined`만 기본값으로 처리하십시오. Mongo `limit(0)`은 무제한이므로 그대로 넘기면 안 됩니다. [기존 CLI](/Users/ga/workspace/hub-om-mongodb-coach-content/scripts/prune-activity.ts:11)처럼 양쪽 삭제 수가 모두 limit 미만일 때 종료합니다. 후속 배치 실패에도 앞서 커밋한 배치는 남으며, 전체 drain 원자성을 주장하면 안 됩니다.

- **오류·소유권:** `allowShadowWrites:true`는 런타임에도 검사하고 env fallback을 두지 않습니다. commit 결과 미확정은 실패로 전파하되 “삭제 0/rollback 확정”으로 표현하지 않습니다. transaction·cleanup은 제한시간을 두고, repository는 session/cursor만 정리하며 borrowed client는 닫지 않습니다.

현재 브랜치는 `feature/20260930-mongodb-activity-prune`입니다. 코드 변경·테스트·DB 실행 없이 확인했습니다.
