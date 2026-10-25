# 코치 평가·사실 기록 컬렉션 준비

코치 운영 정책의 투입별 역할·평가·사실 기록을 담을 새 컬렉션 3개를 운영 Mongo에 만드는 절차입니다.

| 모델 | 컬렉션 | 담는 것 |
| --- | --- | --- |
| `CoachEngagementDetail` | `coach_engagement_details` | 투입 1건에서 맡은 역할(실습코치·리드·운영조교), 실습 난이도, 대상, 신규 고객사 여부 |
| `CoachEvaluation` | `coach_evaluations` | 투입 후 평가(출처 OM·리드·강사, 항목 점수, 재투입 의향, 사유·근거) |
| `CoachFactRecord` | `coach_fact_records` | 지각·무단 불참·공식 불만 등 사실 기록 |

기존 `coach_engagements`(투입 이력)는 바꾸지 않습니다. 기존 평점·재투입·피드백은 "이전 방식 평가"로 그대로 읽습니다.

## 왜 별도 절차가 필요한가

운영 Mongo 저장소는 열 때마다 컬렉션 validator가 계약과 같은지 검사합니다([2026-10-21 장애](2026-10-21-mongodb-validator-contract-incident.md)). 이 컬렉션을 쓰는 화면을 배포하기 **전에** 컬렉션이 준비돼 있어야 합니다.

이 단계(PR-A)의 코드는 아직 어떤 화면·저장소에서도 세 컬렉션을 열지 않습니다. 그래서 PR-A를 먼저 배포해도 기존 기능의 준비 상태 검사는 영향을 받지 않습니다. 화면·API(PR-B)는 아래 준비가 끝난 뒤에 배포합니다.

## 명령

도구: `scripts/prepare-mongodb-coach-evaluation-collections.ts`

- **없는 컬렉션만 만듭니다.** 이미 있는 컬렉션의 validator·index는 바꾸지 않습니다.
- 계약과 다른 컬렉션이 하나라도 있으면 아무것도 만들지 않고 멈춥니다.
- 문서(데이터)는 쓰지 않습니다.

## 실행 순서

### 0. 준비

1. PR-A를 `dev` → `main`에 반영하고 배포합니다. 라벨은 `database-change-reviewed`, `mongodb-validator-ready`가 필요합니다.
2. [DB 작업 안전 규칙](db-write-safety.md)에 따라 운영 Mongo 백업을 확인합니다. 실행 범위는 "운영 Mongo에 빈 컬렉션 3개 생성, 기존 컬렉션·문서 변경 없음"입니다.

### 1. 점검 (읽기 전용, 운영 컨테이너 Terminal)

Coolify → hub-om → **Terminal**에서 실행합니다.

```bash
P="node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/prepare-mongodb-coach-evaluation-collections.ts"
$P
```

처음에는 세 컬렉션 모두 `"state": "missing"`이어야 합니다. `"different"`가 있으면 멈추고 원인을 확인합니다.

### 2. 생성 (운영 DB 쓰기)

```bash
MONGODB_ALLOW_SHADOW_WRITES=true $P --apply --confirm-target=<DB 이름>/<namespace> --backup-confirmed
```

- `<DB 이름>/<namespace>`는 1단계 출력의 `target` 값을 그대로 씁니다.
- 결과가 `"mode": "applied"`이고 `created`에 세 모델이 있으면 성공입니다.
- 이미 만들어진 것은 `alreadyReady`에 나옵니다. 다시 실행해도 아무것도 바뀌지 않습니다.

### 3. 확인

1. `$P`를 다시 실행해 세 컬렉션이 모두 `"ready"`인지 확인합니다.
2. 운영현황·코치 목록·대시보드가 그대로 열리는지 봅니다. 이 단계는 기존 화면에 영향이 없어야 합니다.

## 되돌리기

세 컬렉션은 비어 있고 어떤 화면도 쓰지 않으므로, 문제가 생기면 그대로 두어도 됩니다. 지워야 할 때는 데이터/기술 책임자와 확인한 뒤 해당 컬렉션만 삭제합니다.
