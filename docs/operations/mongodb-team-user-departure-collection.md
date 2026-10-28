# TeamUserDeparture 컬렉션 생성 절차 (무중단)

퇴사자 표시 기능(멤버 관리 "퇴사 처리")을 위해 운영 Mongo에 새 컬렉션 `TeamUserDeparture`를
추가할 때 이 절차를 따릅니다.

## 왜 생성 순서가 중요한가

이 기능은 기존 `TeamUser` 문서/스키마를 바꾸지 않습니다. 퇴사 여부는 완전히 새로운 컬렉션에
별도로 기록합니다. 그래서 [2026-10-21 장애](2026-10-21-mongodb-validator-contract-incident.md)와
같은 "기존 문서가 새 계약과 안 맞아서 저장소 열기·읽기가 전부 실패하는" 위험이 없습니다.

대신 다른 순서 문제가 있습니다: 새 코드(TeamUserDeparture를 읽는 경로)가 먼저 배포되면, 그
코드는 저장소를 열 때 `TeamUserDeparture` 컬렉션이 올바른 validator로 **존재하는지** 검사합니다
(`assertMongoReadStoreReady`). 컬렉션이 아직 없으면 그 경로 전체가 `VALIDATOR_NOT_READY`로
막힙니다. 이 범위는 멤버 관리/역할 로스터 한 곳이 아니라 훨씬 넓습니다 — `MongoTeamMemberRepository.open`을
쓰는 운영 상세·운영 현황 화면, 캘린더, 관리자 DB 화면, 가져오기(Notion·Sheets·Drive)와,
`MONGO_TEAM_USER_MODELS`를 쓰는 멤버 관리, OM 요청 처리, 강의 후속, 매출 동기화, 코치 평가까지
전부 포함됩니다.

그래서 **배포 전에 컬렉션부터 만들어 둬야** 합니다. 이전(지금 실행 중인) 버전은 이 컬렉션의
존재를 전혀 모르므로, 먼저 만들어 둬도 이전 버전 동작에는 영향이 없습니다 — 1)과 2) 사이에
중단이 없습니다.

## 지원 범위

도구(`scripts/apply-mongodb-team-user-departure-collection.ts`)는 `TeamUserDeparture` 컬렉션
하나만 생성/점검합니다. `TeamUser`를 포함한 다른 컬렉션은 절대 건드리지 않습니다.

## 실행 순서

### 0. 준비

1. 이 기능 PR을 `dev`에 머지합니다. 라벨은 `database-change-reviewed`, `mongodb-validator-ready`를
   붙입니다(계약 파일 `mongoRuntimeContracts.json` 변경 포함).
2. [DB 작업 안전 규칙](db-write-safety.md)에 따라 백업 여부를 확인합니다. 실행 범위는
   "운영 Mongo에 신규 컬렉션 `TeamUserDeparture` 1개 생성, 기존 컬렉션/문서 변경 없음"입니다.

### 1. 점검 (읽기 전용, 운영 컨테이너 Terminal)

Coolify → hub-om → **Terminal**에서, 아직 배포 전인 **지금 실행 중인 버전** 기준으로 실행합니다.

```bash
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/apply-mongodb-team-user-departure-collection.ts
```

`"ready": false`가 정상입니다(아직 컬렉션이 없으므로). `target` 값을 다음 단계에 그대로 씁니다.

### 2. 생성 (운영 DB 쓰기, 배포 전)

```bash
MONGODB_ALLOW_SHADOW_WRITES=true \
  node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/apply-mongodb-team-user-departure-collection.ts \
  --apply --confirm-target=<1단계 target 값> --backup-confirmed
```

`"mode": "applied"`이면 성공입니다. 이 시점에는 아무 경로도 아직 이 컬렉션을 읽지 않으므로
안전하게 다음 단계(배포)로 넘어갈 수 있습니다.

### 3. 배포

Coolify에서 **Deploy**를 누릅니다(또는 `main` 동기화 PR 머지로 자동 배포).

### 4. 확인

1. 멤버 관리(`/admin/users`)에서 퇴사 처리/재직 복귀가 정상 동작하는지 확인합니다.
2. OM 요청 배정(`/om-request/manage/...`), 운영 상세의 OM/LD 수정 드롭다운이 정상 동작하는지
   확인합니다(퇴사자가 신규 후보에서 빠지는지).
3. 운영 상세(`/operations/<operationId>`), 운영 현황(`/operations`), 캘린더(`/resources`)가
   500 없이 정상 조회되는지 확인합니다 — 이 화면들도 `MongoTeamMemberRepository.open`을 거칩니다.
4. 관리자 DB 화면(`/admin/database`), 가져오기(Notion·Sheets·Drive) 화면도 같은 경로를 쓰므로
   함께 확인합니다.
5. Logs에 `TEAM_READ_FAILED`, `VALIDATOR_NOT_READY`가 없는지 확인합니다.

## 되돌리기

이 컬렉션을 읽는 코드를 롤백해야 한다면, 컬렉션은 그대로 둬도 무방합니다(이전 버전은 이
컬렉션을 모르므로 존재해도 영향이 없습니다). 컬렉션 자체를 지워야 하는 경우는 데이터/기술
책임자와 상의합니다 — 이 도구는 생성/점검만 지원하고 삭제는 지원하지 않습니다.
