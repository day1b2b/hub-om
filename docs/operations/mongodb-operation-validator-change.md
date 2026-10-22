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

도구(`scripts/apply-mongodb-operation-validator.ts`)는 **enum 값 추가**만 처리합니다. 예: 교육형태에 "온라인" 추가.

필드 추가·삭제, 타입 변경, enum 값 삭제는 기존 문서를 거부할 수 있습니다. 이 도구의 대상이 아니므로 데이터/기술 책임자와 별도 계획을 세웁니다.

## 실행 순서

validator를 넓히는 순간부터 새 버전이 뜰 때까지 **1~3분 정도 화면이 동작하지 않습니다.** 지금 실행 중인 버전은 옛 validator를 기대하기 때문입니다. 사용자가 적은 시간에 진행하고 팀에 미리 알립니다.

### 0. 준비

1. 계약 변경 PR을 `dev`에 머지합니다. 라벨은 `database-change-reviewed`, `mongodb-validator-ready`를 붙입니다.
2. Coolify에서 hub-om 앱의 **Auto Deploy를 끕니다**(Advanced → Auto Deploy).
3. dev→main 동기화 PR을 `main`에 머지합니다. Auto Deploy가 꺼져 있으므로 배포는 시작되지 않습니다.
4. [DB 작업 안전 규칙](db-write-safety.md)에 따라 운영 Mongo 백업을 확인합니다. 실행 범위는 "운영 Mongo `OperationSession` 컬렉션 validator 1개 변경, 문서 변경 없음"입니다.

### 1. 점검 (읽기 전용, 운영 컨테이너 Terminal)

Coolify → hub-om → **Terminal**에서 실행합니다. 지금 실행 중인 버전 기준으로 동작합니다.

`bash
V="node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/apply-mongodb-operation-validator.ts"

# 현재 상태: 모든 컬렉션이 "same"이어야 합니다.
$V

# 계획: 새 계약의 enum 전체 목록을 새 mongoRuntimeContracts.json과 같은 순서로 적습니다.
$V --widen=OperationSession.educationFormat=OFFLINE,REMOTE,ONLINE,BLENDED,FLIPPED,NEEDS_REVIEW
```

계획 결과는 `"kind": "widening"`, `"values": ["ONLINE"]`, `"nonconformingSample": false`여야 합니다. 다르면 멈추고 원인을 확인합니다.

### 2. 적용 (운영 DB 쓰기)

`bash
MONGODB_ALLOW_SHADOW_WRITES=true $V --widen=OperationSession.educationFormat=OFFLINE,REMOTE,ONLINE,BLENDED,FLIPPED,NEEDS_REVIEW \
  --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- `<DB 이름>/<namespace>`는 1단계 출력의 `target` 값을 그대로 씁니다.
- 결과가 `"mode": "applied"`이면 성공입니다. **이 순간부터 화면이 실패하므로 바로 3단계로 갑니다.**

### 3. 배포

Coolify에서 **Deploy**를 누릅니다. 새 버전이 헬스체크를 통과하면 교체됩니다.

### 4. 확인

1. `/operations`, 대시보드, 운영 상세 저장을 확인합니다.
2. 새 컨테이너 Terminal에서 `$V`를 실행합니다. 모든 컬렉션이 `"same"`이어야 합니다.
3. Logs에 `*_COMPOSITION_FAILED`, `DATABASE_HEALTH_READINESS_FAILED`가 없는지 10분 이상 봅니다.
4. Auto Deploy를 다시 켭니다.

## 3단계 배포가 실패하면

새 버전이 뜨지 않으면 이전 버전은 넓어진 validator 때문에 계속 실패합니다. validator를 되돌립니다. **지금 실행 중인 이전 버전 컨테이너**의 Terminal에서 실행합니다.

``bash
MONGODB_ALLOW_SHADOW_WRITES=true $V --restore=OperationSession --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- 새 값(예: `ONLINE`)으로 저장된 문서가 이미 있으면 `EXISTING_DOCUMENTS_POLICY_MISMATCH`로 거부합니다. 이 경우 문서를 지우지 말고 데이터/기술 책임자와 상의합니다.
- 되돌린 뒤 `main`도 이전 계약으로 되돌려야 다음 배포에서 다시 실패하지 않습니다.
