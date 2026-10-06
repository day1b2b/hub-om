# 중복 회사 병합 CLI Mongo 경계

## 범위

`db:merge:duplicate-company`는 잘못 생성된 회사의 과정과 과정 ID 라벨을 기준 회사로 합친다. 기본 저장소는 암호화 PostgreSQL이며, 준비된 검증용 shadow를 사용할 때만 exact selector로 MongoDB를 선택한다.

```bash
npm run db:merge:duplicate-company -- --source="원본 회사명" --target="기준 회사명" --dry-run
npm run db:merge:duplicate-company -- --source="원본 회사명" --target="기준 회사명" --apply --backup-confirmed --maintenance-confirmed
npm run db:merge:duplicate-company -- --source="원본 회사명" --target="기준 회사명" --dry-run --backend=mongodb-shadow
```

확인 플래그는 실제 백업이나 쓰기 중단을 수행하지 않는다. Mongo 실행에는 `MONGODB_URI`, `MONGODB_SHADOW_DATABASE`, `MONGODB_SHADOW_NAMESPACE`가 필요하며 CLI는 기존 namespace를 생성·수리·삭제하지 않는다.

## 병합 의미와 안전 조건

- source와 target 회사는 이름이 정확히 한 행씩 존재해야 하며 같은 행일 수 없다.
- source 회사 자체는 보존한다. source 회사에 과정이 없으면 기존 CLI와 같이 라벨도 이동하지 않고 종료한다.
- `(courseId, name)`이 같은 target 과정이 있으면 해당 source 과정의 회차를 target 과정으로 옮긴 뒤 중복 source 과정만 물리 삭제한다. 일치 과정이 없으면 source 과정의 회사만 바꾼다.
- 같은 `courseId`의 target 라벨이 있으면 중복 source 라벨만 물리 삭제하고, 없으면 source 라벨의 회사를 바꾼다. 사용자가 확인한 기존 유지보수 의미이며 새 삭제 정책이 아니다.
- source 회사는 삭제하지 않으며 과정·라벨 이외의 모델은 수정하지 않는다.
- dry-run은 같은 snapshot에서 계획만 만들고 쓰지 않는다. apply는 `--backup-confirmed --maintenance-confirmed`가 모두 있어야 하며 모든 변경을 한 transaction으로 수행한다.
- PostgreSQL은 apply에 serializable, dry-run에 repeatable-read를 사용한다. MongoDB는 replica set snapshot transaction과 majority journal write를 사용한다.
- Mongo apply는 과정명 복원·가져오기 promotion·일반 운영 생성/수정과 같은 catalog guard를 잡는다. 첫 guard duplicate-key 경합은 transaction 전체를 최대 5회 재시도한다.
- 후반 라벨 쓰기 실패도 앞선 회차 이동과 과정 변경까지 전부 롤백한다. 재실행은 추가 과정이나 라벨을 만들지 않는다.
- 회차의 과정 연결을 바꾸면 Mongo `updatedAt`도 갱신한다. 저장소 오류 원문은 CLI에 노출하지 않는다.

운영 적용 전에는 양쪽 저장소 백업과 격리 복원을 확인하고, 해당 catalog writer를 중단한 뒤 dry-run 결과를 검토한다. 그 다음 apply와 재실행 0건을 확인한다. 실패한 기존 shadow는 자동 수리하지 않고 새 run ID/namespace 재복사를 우선한다.

## 검증 결과와 한계

- 일반 회귀: 1,125 pass / 116 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 1 root pass(dry-run, apply/replay, guard 경합, 일반 운영 쓰기 차단, 후반 실패 rollback, 부분 namespace 무수정 거부, `updatedAt` 포함)
- 실제 합성 PostgreSQL 17: 1 root pass(dry-run, apply/replay, source 회사 보존, 후반 실패 rollback 포함)
- command/runtime 단위: 4 pass
- typecheck/build 통과
- lint: 오류 0, 기존 경고 7

실제 운영 DB·Atlas·원천·운영 키·배포 설정에는 접근하지 않았다. 실제 백업·복원, 운영 규모, production selector와 최종 전환은 검증하지 않았다. 이 범위는 한 유지보수 CLI의 저장소 경계이며 전체 앱 전환이나 운영 이전 완료가 아니다.
