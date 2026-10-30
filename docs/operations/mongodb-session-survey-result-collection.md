# SessionSurveyResult 컬렉션 생성 절차 (무중단)

회차별 만족도 결과 기록(수강생 코멘트·응답자 수·긍정률·반영 출처)을 위해 운영 Mongo에 새 컬렉션
`SessionSurveyResult`를 추가할 때 이 절차를 따릅니다. 절차는
[TeamUserDeparture 컬렉션 생성 절차](mongodb-team-user-departure-collection.md)와 같습니다.

## 무엇이 바뀌나

- OM이 survey_analysis에서 **[hub-om 반영]**을 누르면 `/api/satisfaction/round-apply`가 지금처럼
  회차의 종합·강사 만족도를 쓰고, 같은 회차의 `SessionSurveyResult` 한 행을 덮어씁니다(누른 시점이 최종본).
- 강사 위키 상세가 이 기록을 읽어 "수강생 코멘트" 카드와 투입 이력의 코멘트 줄을 보여 줍니다.
- 기존 `OperationSession` 문서·validator는 바꾸지 않습니다. 새 컬렉션 하나만 생깁니다.

## 왜 생성 순서가 중요한가

새 코드는 만족도 반영 런타임과 강사 위키 런타임(코치 공개 런타임)을 열 때 `SessionSurveyResult`
컬렉션이 올바른 validator로 존재하는지 검사합니다(`assertMongoReadStoreReady`). 컬렉션이 없으면
그 경로가 `VALIDATOR_NOT_READY`로 막힙니다. 강사 위키 런타임은 **코치 목록·코치 상세·코치 일정 화면도**
함께 엽니다. 그래서 `/api/health`도 이 컬렉션을 검사해, 컬렉션 없이 배포하면 Coolify가 이전 컨테이너를
유지하게 했습니다(장애 대신 "배포 실패").

**배포 전에 컬렉션부터 만들어 둡니다.** 지금 실행 중인 버전은 이 컬렉션을 모르므로 먼저 만들어도
영향이 없습니다.

## 실행 순서

### 0. 준비

1. 이 기능 PR을 `dev`에 머지합니다. 라벨은 `database-change-reviewed`, `mongodb-validator-ready`를
   붙입니다(계약 파일 `mongoRuntimeContracts.json` 변경 포함).
2. [DB 작업 안전 규칙](db-write-safety.md)에 따라 백업 여부를 확인합니다. 실행 범위는
   "운영 Mongo에 신규 컬렉션 `SessionSurveyResult` 1개 생성(인덱스 2개), 기존 컬렉션/문서 변경 없음"입니다.

### 1. 점검 (읽기 전용, 운영 컨테이너 Terminal)

```bash
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/apply-mongodb-session-survey-result-collection.ts
```

이 스크립트는 새 이미지에만 있습니다. 지금 실행 중인 버전에 없으면, TeamUserDeparture 때처럼
헬스체크를 잠시 끄고 새 버전을 띄운 뒤 그 컨테이너에서 1~2단계를 실행하고 헬스체크를 다시 켭니다.
`"ready": false`가 정상입니다. `target` 값을 다음 단계에 그대로 씁니다.

### 2. 생성 (운영 DB 쓰기)

```bash
MONGODB_ALLOW_SHADOW_WRITES=true \
  node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/apply-mongodb-session-survey-result-collection.ts \
  --apply --confirm-target=<1단계 target 값> --backup-confirmed
```

`"mode": "applied"`이면 성공입니다. 다시 1단계를 실행하면 `"ready": true`가 나옵니다.

### 3. 배포와 확인

1. Coolify에서 Deploy(헬스체크 켠 상태)를 누르고 "New container is healthy"를 확인합니다.
2. `/api/health`가 200인지 확인합니다.
3. 강사 위키 상세, 코치 목록·상세가 500 없이 열리는지 확인합니다.
4. survey_analysis에서 회차 하나를 [hub-om 반영]한 뒤, 강사 위키 상세에 코멘트가 보이는지 확인합니다.
5. Logs에 `VALIDATOR_NOT_READY`, `SESSION_SURVEY_RESULT_`가 없는지 확인합니다.

## 되돌리기

코드를 롤백해도 컬렉션은 그대로 둬도 됩니다(이전 버전은 이 컬렉션을 모릅니다). 컬렉션을 지워야 하면
데이터/기술 책임자와 상의합니다. 이 도구는 생성/점검만 합니다.
