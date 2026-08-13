# om-request ↔ 운영현황 연결 제안

## 배경

의도한 업무 흐름은 `업무 요청(/om-request)` → `운영현황에서 요청 받은 내용 확인 및 수정(엑셀 일괄업로드 병행)`이지만, 현재 코드에는 이 흐름이 연결되어 있지 않습니다.

- `/om-request`가 다루는 `OmRequest`는 Postgres가 아니라 앱 서버의 로컬 파일(`om-requests.json`, `src/lib/data/omRequest/omRequestLocalRepository.ts`)에 저장됩니다. Prisma 스키마(`prisma/schema.prisma`)에는 `OmRequest` 모델 자체가 없습니다.
- 운영현황(`/operations`, `/operations/[operationId]`)이 보여주는 `Course` / `OperationSession`은 Postgres 테이블입니다.
- 두 데이터를 이어주는 코드(참조 키, 자동 생성, 매칭)가 없어서, om-request로 요청이 들어와도 운영현황에는 아무것도 나타나지 않고, 운영자가 수기로 `/operations/new`를 통해 다시 입력하거나 엑셀 일괄업로드로 별도 반영해야 합니다.
- 참고로 Coolify 배포(컨테이너) 환경에서는 로컬 파일 저장 자체가 재배포/재시작 시 유실될 수 있어, 이 부분도 함께 봐야 할 것 같습니다.

## 제안하는 방향

기존에 이미 있는 "staging → 검토 → 운영 데이터 반영" 패턴(엑셀 일괄업로드가 `ImportAdminDashboard` → `importPromotionService.ts`의 `promoteReadyImportRows`를 거쳐 `Course`/`OperationSession`을 만드는 흐름)을 om-request에도 그대로 적용하면 어떨까 합니다.

1. om-request가 배정(`assignedOm` 지정)되는 시점에, 이미 있는 `getOperationRepository().createOperation()`(`src/app/operations/new/actions.ts`에서 쓰는 것과 동일한 함수)을 호출해 `Course` + `OperationSession`을 생성합니다.
   - `courseId`는 비워서 생성합니다. 기존 데이터 정책(코스ID는 운영 업무 요청 시점에 확정되지 않음, `docs/operations/data-model-draft.md`)과 그대로 맞습니다.
   - om-request의 `courseName`, `ld`, `instructorName`, `sessions`(일정), `location`, `trainingType` 등을 `CreateOperationInput` 필드로 매핑합니다.
2. 생성된 `OperationSession`에 어떤 om-request에서 왔는지 남겨두는 참조 필드를 추가합니다(예: `omRequestId`). 이후 om-request 쪽에서 수정이 들어와도 자동 덮어쓰기는 하지 않고, 운영현황 상세 화면에서 운영자가 직접 확인/수정하는 것을 원칙으로 합니다(엑셀 일괄업로드와 동일한 "생성은 자동, 이후 수정은 운영현황에서" 원칙).
3. 운영현황 상세/목록 화면에는 "om-request로 생성됨" 정도의 표시만 추가하고, 나머지 화면(수정 폼, 상태 계산 등)은 기존 UI를 그대로 재사용합니다.
4. `/om-request`는 접수/배정 창구로 계속 남겨두고, 엑셀 일괄업로드도 지금처럼 병행 가능하게 둡니다(같은 `courseId`로 매칭되면 기존 건에 반영, 없으면 새로 생성하는 지금 규칙 유지).

## 필요한 변경 (아직 실행하지 않음 — 이 PR은 문서만입니다)

- Prisma 스키마 변경: `OperationSession`에 om-request 참조 필드 추가, 또는 `OmRequest`를 아예 Postgres 테이블로 옮기는 선택.
- migration 실행.
- `omRequestLocalRepository.ts`를 대체할 repository/adapter 추가 (파일 저장소는 서버 배포 환경상 신뢰하기 어려움).
- 배정 시점에 `createOperation()`을 호출하는 서비스 코드 추가.
- 운영현황 화면에 "om-request로 생성됨" 표시 추가.

## 열린 결정 (기술/데이터 책임자 확인 부탁드립니다)

1. `OmRequest`를 Postgres로 완전히 옮기는 게 맞을지, 아니면 최소한으로 참조 필드만 추가하고 로컬 파일은 유지할지 의견 여쭙고 싶습니다. (로컬 파일 유지 시 Coolify 재배포 시 유실 위험은 그대로 남습니다.)
2. 자동 생성 시점을 "배정 완료" 시점으로 잡았는데, "요청 접수" 시점(배정 전)부터 운영현황에 노출하는 게 맞을지도 확인이 필요할 것 같습니다.
3. om-request 수정과 운영현황 수정이 어긋났을 때(예: om-request에서 강사명을 바꿨는데 이미 운영현황에서 다르게 고쳐놓은 경우) 어느 쪽을 우선할지 규칙이 필요합니다. 이번 제안은 "생성 이후에는 자동 동기화하지 않고 운영현황이 최종본" 쪽으로 가정했습니다.
4. `OperationSession`에 om-request 참조 필드를 추가하는 스키마 변경 자체가 `db-write-safety.md` 기준 검토 대상이라, 실제 migration 전에 별도 확인을 받고 싶습니다.

## 검증

- 이 PR은 문서 추가만 포함합니다. 코드/스키마 변경 없음, migration 없음, 운영 DB 쓰기 없음.
- 실행한 검증 명령: 없음(문서 전용 변경).
