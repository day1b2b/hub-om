# 운영 Mongo validator 변경 절차

`src/lib/data/mongoRuntimeContracts.json`(Mongo 런타임 계약)을 바꾸는 PR은 이 절차를 따릅니다. 계기는 [2026-10-21 장애](2026-10-21-mongodb-validator-contract-incident.md)입니다.

## 왜 필요한가

운영 Mongo 저장소는 열 때마다 컬렉션에 저장된 validator가 코드 계약에서 만든 validator와 **완전히 같은지** 검사합니다(`assertMongoOperationStoreReady`). 다르면 `VALIDATOR_NOT_READY`로 열기를 거부하고, 운영현황·대시보드·운영 저장이 모두 실패합니다.

그래서 계약 변경은 코드 배포만으로 끝나지 않습니다. 운영 validator도 같은 내용으로 바꿔야 합니다. enum 값 순서까지 같아야 합니다.

## 자동 보호 장치

- **헬스체크:** `HEALTH_BACKEND`가 Mongo 모드이면 `/api/health`가 같은 준비 상태 검사를 합니다. validator가 맞지 않는 버전은 헬스체크에 실패하므로 Coolify가 기존 컨테이너를 유지합니다. 장애 대신 "배포 실패"로 끝납니다.
- **CI:** 계약 파일이 바뀐 PR은 `database-change-reviewed`와 함께 **`mongodb-validator-ready`** 라벨이 있어야 통과합니다. 이 라벨은 "아래 절차로 운영 반영 계획을 세웠다"는 확인입니다.
- **로그:** 준비 실패 원인 코드가 로그에 그대로 남습니다. 예: `DATABASE_HEALTH_READINESS_FAILED VALIDATOR_NOT_READY`, `MONGO_OPERATION_PAGES_RUNTIME_FAILED VALIDATOR_NOT_READY`.

## 지원 범위

도구(`scripts/apply-mongodb-operation-validator.ts`)는 두 가지 변경을 처리합니다.

| 변경 | 예 | 운영 문서 변경 |
|---|---|---|
| **enum 값 추가** | 교육형태에 "온라인" 추가 | 없음 |
| **nullable 필드 추가** | 기업에 사업자등록증 정보 필드 추가(#762) | 기존 문서 전체에 새 필드를 `null`로 채움 |

필드 삭제, 타입 변경, enum 값 삭제, `null`을 허용하지 않는 필드 추가, 새 필드의 unique 인덱스는 기존 문서를 거부할 수 있습니다. 이 도구의 대상이 아니므로 데이터/기술 책임자와 별도 계획을 세웁니다. 도구는 이런 변경을 쓰기 전에 거부합니다(예: `ENUM_VALUES_NOT_WIDENING`, `VALIDATOR_CHANGE_NOT_FIELD_ADDITION`, `FIELD_ADDITION_INDEX_NOT_ALLOWED`).

한 컬렉션에서 enum 추가와 필드 추가가 함께 있으면 처리하지 못합니다. PR을 나누거나 별도 계획을 세웁니다. 여러 컬렉션이 바뀌면 컬렉션마다 절차를 실행합니다(B1 참고).

**코치 평가 컬렉션**(`CoachEngagementDetail`·`CoachEvaluation`·`CoachFactRecord`)은 enum 값 추가만 지원하고, 절차가 다릅니다. [C. 코치 평가 컬렉션 enum 따라잡기](#c-코치-평가-컬렉션-enum-따라잡기)를 따릅니다. 필드 추가는 운영현황 컬렉션 전용입니다.

## 공통: 다운타임과 준비

validator를 바꾸는 순간부터 새 버전이 뜰 때까지 **1~3분 정도 화면이 동작하지 않습니다.** 지금 실행 중인 버전은 옛 validator를 기대하기 때문입니다. 사용자가 적은 시간에 진행하고 팀에 미리 알립니다.

1. 계약 변경 PR을 `dev`에 머지합니다. 라벨은 `database-change-reviewed`, `mongodb-validator-ready`를 붙입니다.
2. Coolify에서 hub-om 앱의 **Auto Deploy를 끕니다**(Advanced → Auto Deploy).
3. dev→main 동기화 PR을 `main`에 머지합니다. Auto Deploy가 꺼져 있으므로 배포는 시작되지 않습니다.
4. [DB 작업 안전 규칙](db-write-safety.md)에 따라 운영 Mongo 백업을 확인합니다. 실행 범위는 아래 각 절차에 적었습니다.

운영 컨테이너 명령은 Coolify → hub-om → **Terminal**에서 실행합니다. 지금 실행 중인 버전 기준으로 동작합니다.

```bash
V="node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/apply-mongodb-operation-validator.ts"
```

## A. enum 값 추가

백업 확인 시 실행 범위: "운영 Mongo `OperationSession` 컬렉션 validator 1개 변경, 문서 변경 없음".

### A1. 점검 (읽기 전용)

```bash
# 현재 상태: 모든 컬렉션이 "same"이어야 합니다.
$V

# 계획: 새 계약의 enum 전체 목록을 새 mongoRuntimeContracts.json과 같은 순서로 적습니다.
$V --widen=OperationSession.educationFormat=OFFLINE,REMOTE,ONLINE,BLENDED,FLIPPED,NEEDS_REVIEW
```

계획 결과는 `"kind": "widening"`, `"values": ["ONLINE"]`, `"nonconformingSample": false`여야 합니다. 다르면 멈추고 원인을 확인합니다.

### A2. 적용 (운영 DB 쓰기)

```bash
MONGODB_ALLOW_SHADOW_WRITES=true $V --widen=OperationSession.educationFormat=OFFLINE,REMOTE,ONLINE,BLENDED,FLIPPED,NEEDS_REVIEW \
  --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- `<DB 이름>/<namespace>`는 A1 출력의 `target` 값을 그대로 씁니다.
- 결과가 `"mode": "applied"`이면 성공입니다. **이 순간부터 화면이 실패하므로 바로 [배포](#배포와-확인)로 갑니다.**

## B. nullable 필드 추가

운영 컨테이너에는 아직 새 계약이 없습니다. 그래서 **새 계약이 든 빌드(`main`)에서 목표 validator를 한 줄 토큰으로 만들고**, 운영 컨테이너에서 그 토큰으로 적용합니다. 도구는 토큰이 "지금 계약에 null 허용 필드만 더한 것"인지 확인한 뒤에만 받습니다.

백업 확인 시 실행 범위: "운영 Mongo `<모델>` 컬렉션 validator 1개 변경, 인덱스 N개 생성, 기존 문서 전체에 새 필드 `null` 추가(기존 값 변경·삭제 없음)". N과 필드 목록은 B2 계획 출력에 나옵니다.

### B1. 토큰 만들기 (로컬, DB 연결 없음)

준비 3단계까지 끝난 `main`을 받아서 실행합니다. 환경변수나 DB 연결이 필요 없습니다.

```bash
git switch main && git pull

# 바뀐 컬렉션 확인: <배포 중인 커밋>은 Coolify 배포 기록의 커밋입니다.
git diff <배포 중인 커밋>..main -- src/lib/data/mongoRuntimeContracts.json src/lib/privacy/fields.json

# 바뀐 컬렉션마다 토큰을 만듭니다.
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/apply-mongodb-operation-validator.ts --emit-field-addition=Company
```

- 출력의 `token`(한 줄, 1KB 안팎)과 `digest`(16자리)를 적어 둡니다.
- 토큰을 만든 `main` 커밋과 3단계에서 배포할 커밋이 같아야 합니다. 그 사이에 `main`이 바뀌면 토큰을 다시 만듭니다.
- 여러 컬렉션이 바뀌었으면 B2·B3을 컬렉션마다 실행한 뒤 한 번에 배포합니다. 하나라도 빠지면 새 버전이 `VALIDATOR_NOT_READY`로 뜨지 않습니다.

### B2. 점검 (읽기 전용)

```bash
# 현재 상태: 모든 컬렉션이 "same"이어야 합니다.
$V

# 계획
$V --add-fields=<token>
```

계획 결과에서 아래를 확인합니다. 하나라도 다르면 멈추고 원인을 확인합니다.

- `"state": "ready"`
- `"digest"`가 B1의 digest와 같음
- `"fields"`가 계약 PR에서 추가한 필드 목록과 같음
- `"nonconformingSample": false`
- `"documentsToFill"`은 지금 문서 수, `"indexesToCreate"`는 새로 만들 인덱스입니다.

### B3. 적용 (운영 DB 쓰기)

```bash
MONGODB_ALLOW_SHADOW_WRITES=true $V --add-fields=<token> \
  --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- 순서: 인덱스 생성 → validator 변경 → 기존 문서에 새 필드 `null` 채우기 → 결과 확인.
- 결과가 `"mode": "applied"`이면 성공입니다. **이 순간부터 화면이 실패하므로 바로 [배포](#배포와-확인)로 갑니다.**
- `"applied"`가 아니면 배포하지 않습니다. 배포 후 `$V`의 `"same"`은 validator만 비교하므로, 채우기가 덜 된 문서를 잡지 못합니다.
- 중간에 끊겼으면 같은 명령을 다시 실행합니다. 이미 된 단계는 건너뜁니다. 계획 출력의 `state`는 validator 변경 전이면 `"ready"`, 변경 후 채우기가 남았으면 `"partially-applied"`입니다.

## C. 코치 평가 컬렉션 enum 따라잡기

코치 평가 컬렉션(`CoachEngagementDetail`·`CoachEvaluation`·`CoachFactRecord`)은 배포 헬스체크 대상이 아닙니다. 그래서 enum 값을 더한 계약을 배포해도 **배포는 성공**하고, 운영 validator를 맞출 때까지 **코치 평가 저장·조회만** `VALIDATOR_NOT_READY`로 실패합니다. 운영현황·대시보드 등 다른 화면은 영향이 없습니다.

A절차와 달리 **새 버전을 먼저 배포하고, 새 버전 컨테이너에서** 운영 validator를 새 계약까지 넓힙니다(따라잡기). 따라잡기는 저장된 validator가 새 계약에서 enum 값만 빠진 상태일 때만 적용하고, 그 밖의 차이는 쓰기 전에 거부합니다.

백업 확인 시 실행 범위: "운영 Mongo `<모델>` 컬렉션 validator 1개 변경, 문서 변경 없음".

1. 계약 변경 PR을 `dev` → `main`에 반영합니다. 라벨은 `database-change-reviewed`, `mongodb-validator-ready`입니다. Auto Deploy를 끌 필요는 없습니다.
2. 코치 평가를 잠깐 못 쓴다고 팀에 알리고 **Deploy**합니다. 헬스체크는 통과합니다.
3. [DB 작업 안전 규칙](db-write-safety.md)에 따라 운영 Mongo 백업을 확인합니다.
4. **새 컨테이너** Terminal에서 점검합니다(읽기 전용).

```bash
$V --catch-up=CoachEngagementDetail
```

`"kind": "widening"`, `"added"`에 이번에 더한 값만, `"nonconformingSample": false`여야 합니다. 다르면 멈추고 원인을 확인합니다.

5. 적용합니다(운영 DB 쓰기).

```bash
MONGODB_ALLOW_SHADOW_WRITES=true $V --catch-up=CoachEngagementDetail --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- 결과가 `"mode": "applied"`(이미 맞으면 `"already-applied"`)이면 성공입니다. 바로 코치 평가가 다시 동작합니다.
- `$V`를 실행해 모든 컬렉션이 `"same"`인지 확인하고, 코치 상세 → 근무이력에서 평가 화면이 열리는지 봅니다.

**되돌리기:** 따라잡기 뒤에는 운영 validator가 새 계약과 같습니다. 이전 버전으로 롤백하면 이전 버전의 코치 평가가 실패하므로, 롤백 대신 새 버전을 유지하는 것을 기본으로 합니다. 이전 버전으로 꼭 돌아가야 하면 데이터/기술 책임자와 상의합니다.

## 배포와 확인

1. Coolify에서 **Deploy**를 누릅니다. 새 버전이 헬스체크를 통과하면 교체됩니다.
2. `/operations`, 대시보드, 운영 상세 저장, 그리고 이번 변경으로 바뀐 화면(예: 기업위키 사업자 정보 저장)을 확인합니다.
3. 새 컨테이너 Terminal에서 `$V`를 실행합니다. 모든 컬렉션이 `"same"`이어야 합니다.
4. Logs에 `*_COMPOSITION_FAILED`, `DATABASE_HEALTH_READINESS_FAILED`가 없는지 10분 이상 봅니다.
5. Auto Deploy를 다시 켭니다.

적용 후 배포 전에는 이전 버전 컨테이너에서 `$V`가 바뀐 컬렉션을 `"incompatible"`로 보고합니다. 정상입니다.

## 배포가 실패하면

새 버전이 뜨지 않으면 이전 버전은 바뀐 validator 때문에 계속 실패합니다. validator를 되돌립니다. **지금 실행 중인 이전 버전 컨테이너**의 Terminal에서 실행합니다. enum 추가와 필드 추가 모두 같은 명령이며, 도구가 어느 쪽인지 판단합니다.

```bash
MONGODB_ALLOW_SHADOW_WRITES=true $V --restore=<모델> --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- enum 추가: 새 값(예: `ONLINE`)으로 저장된 문서가 이미 있으면 `EXISTING_DOCUMENTS_POLICY_MISMATCH`로 거부합니다.
- 필드 추가: 새 필드에 값이 저장된 문서가 하나라도 있으면 `FIELD_ADDITION_HAS_VALUES`로 거부합니다. 값이 모두 `null`이면 새 필드를 문서에서 지운 뒤 validator를 되돌립니다. 중간에 끊겼으면 같은 명령을 다시 실행합니다. B3에서 만든 인덱스는 남습니다. 이전 버전은 모르는 인덱스를 무시하므로 문제없습니다.
- 필드 추가 되돌리기는 문서 검증을 우회해(`bypassDocumentValidation`) 필드를 지웁니다. 운영 DB 계정에 이 권한이 없으면 실패하므로, 처음 쓰기 전에 데이터/기술 책임자가 권한을 확인합니다.
- 거부되면 문서를 지우지 말고 데이터/기술 책임자와 상의합니다. 되돌리는 도중 새 버전이 값을 저장하면, validator는 이전 계약으로 돌아갔는데 새 필드가 남은 문서가 생길 수 있습니다. 이 경우 재실행해도 `EXISTING_DOCUMENTS_POLICY_MISMATCH`로 멈추며, 이전 버전 도구로는 필드 이름을 알 수 없어 수동 조치가 필요합니다.
- 되돌린 뒤 `main`도 이전 계약으로 되돌려야 다음 배포에서 다시 실패하지 않습니다.

## 도구 검증

- 단위 테스트: `src/lib/data/mongoValidatorWidening.test.ts`, `src/lib/data/mongoValidatorFieldAddition.test.ts`
- 실제 mongod 테스트(로컬 loopback 전용):

```bash
FIELD_ADDITION_DATABASE_TESTS=1 FIELD_ADDITION_TEST_MONGO_URI=mongodb://127.0.0.1:<port>/ \
  node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/mongoValidatorFieldAddition.integration.test.ts
```
