# 에그·운영물품 대여 컬렉션 준비

에그(포켓 와이파이)·운영물품(마이크) 대여 화면(`/eggs`, `/mics`)이 쓰는 새 컬렉션 6개를 운영 Mongo에 만드는 절차입니다.

| 모델 | 담는 것 |
| --- | --- |
| `EggDevice` | 에그 기기(파트·번호, WiFi 이름·비밀번호, 충전 단자, 보관 위치, 데이터 소진 표시) |
| `EggRental` | 에그 대여(대여자, 과정명, 대여 시작일·반납 예정일, 반납·취소 기록) |
| `EggGuide` | 파트별 에그 주의사항 |
| `SupplyItem` | 운영물품(마이크) 목록 |
| `SupplyRental` | 운영물품 대여 |
| `SupplyRentalItem` | 한 대여에 함께 나간 물품 연결 |

WiFi 비밀번호·대여자 이름 같은 개인정보는 `src/lib/privacy/fields.json` 계약대로 암호문(`pii:v1:...`)으로 저장됩니다. 그래서 데이터는 SQL이나 스크립트로 직접 넣지 않고, 화면의 관리자 기기 등록·예약으로만 넣습니다.

## 왜 별도 절차가 필요한가

운영 Mongo 저장소는 열 때마다 컬렉션 validator가 계약과 같은지 검사합니다([2026-10-21 장애](2026-10-21-mongodb-validator-contract-incident.md)). 이 컬렉션이 없으면 `/eggs`·`/mics`가 "불러오지 못했습니다" 상태로 열립니다. 다른 화면에는 영향이 없습니다.

이 컬렉션은 운영 헬스체크 대상(`OPERATION_MODELS`)에 넣지 않은 별도 컬렉션입니다. 기존 운영 컬렉션의 validator는 바뀌지 않으므로 다운타임이 없습니다.

## 명령

도구: `scripts/prepare-mongodb-egg-supply-collections.ts`

- **없는 컬렉션만 만듭니다.** 이미 있는 컬렉션의 validator·index는 바꾸지 않습니다.
- 계약과 다른 컬렉션이 하나라도 있으면 아무것도 만들지 않고 멈춥니다.
- 문서(데이터)는 쓰지 않습니다.

## 실행 순서

### 0. 준비

1. 에그·물품 Mongo 저장소 PR을 `dev` → `main`에 반영하고 배포합니다.
2. [DB 작업 안전 규칙](db-write-safety.md)에 따라 운영 Mongo 백업을 확인합니다. 실행 범위는 "운영 Mongo에 빈 컬렉션 6개 생성, 기존 컬렉션·문서 변경 없음"입니다.

### 1. 점검 (읽기 전용, 운영 컨테이너 Terminal)

Coolify → hub-om → **Terminal**에서 실행합니다.

```bash
P="node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/prepare-mongodb-egg-supply-collections.ts"
$P
```

처음에는 여섯 컬렉션 모두 `"state": "missing"`이어야 합니다. `"different"`가 있으면 멈추고 원인을 확인합니다.

### 2. 생성 (운영 DB 쓰기)

```bash
MONGODB_ALLOW_SHADOW_WRITES=true $P --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- `<DB 이름>/<namespace>`는 1단계 출력의 `target` 값을 그대로 씁니다.
- 결과가 `"mode": "applied"`이고 `created`에 여섯 모델이 있으면 성공입니다.
- 이미 만들어진 것은 `alreadyReady`에 나옵니다. 다시 실행해도 아무것도 바뀌지 않습니다.

### 3. 확인

1. `$P`를 다시 실행해 여섯 컬렉션이 모두 `"ready"`인지 확인합니다.
2. 관리자 계정으로 `/eggs`·`/mics`가 빈 목록으로 열리는지 봅니다.
3. 운영현황·대시보드 등 기존 화면이 그대로 열리는지 봅니다.

### 4. 데이터 입력

`/eggs` 관리자 기기 등록으로 시트의 에그를 하나씩 입력합니다. 앞으로 잡힌 대여만 화면에서 다시 예약하고, 지난 기록은 시트에 둡니다.

## 되돌리기

컬렉션을 만든 직후에는 비어 있으므로 그대로 두어도 됩니다. 데이터를 입력한 뒤에는 지우지 않습니다. 지워야 할 때는 데이터/기술 책임자와 확인한 뒤 해당 컬렉션만 삭제합니다.
