# SessionSurveyResult 컬렉션 생성 절차 (무중단)

회차별 만족도 결과 기록(응답자 수·긍정률·수강생 코멘트·반영 출처)을 위해 운영 Mongo에 새 컬렉션
`SessionSurveyResult`를 추가할 때 이 절차를 따릅니다.

## 무엇이 바뀌나

- OM이 survey_analysis에서 **[hub-om 반영]**을 누르면 `/api/satisfaction/round-apply`가 지금처럼
  회차의 종합·강사 만족도를 쓰고, 같은 회차의 `SessionSurveyResult` 한 행을 덮어씁니다(누른 시점이 최종본).
- 운영 회차 상세(`/operations/<operationId>`)의 "수강생 코멘트" 칸이 이 기록을 읽습니다.
  코멘트는 AI 요약 네 갈래(좋았던 점·강사 개선·운영·환경 보완·후속 니즈)를 JSON 한 칸에 암호화해 둡니다.
- 기존 `OperationSession` 문서·validator는 바꾸지 않습니다. 새 컬렉션 하나만 생깁니다.

## 왜 헬스체크를 끄지 않아도 되나

이 기록은 부가 정보라서, 컬렉션이 없으면 저장소가 **빈 결과를 돌려주고 쓰기만 실패로 알리는 대체 저장소**로
열립니다(`openSessionSurveyResultsOrUnavailable`). 그래서 컬렉션이 생기기 전에도:

- 운영 현황·회차 상세는 정상으로 열리고, 코멘트 칸만 "아직 반영된 만족도가 없어요"로 보입니다.
- [hub-om 반영]은 회차 만족도를 그대로 쓰고, 응답에 "응답자 수·코멘트는 저장하지 못했어요. 다시 반영해 주세요."를 덧붙입니다.
- 로그에 `SESSION_SURVEY_RESULT_UNAVAILABLE`이 남습니다.

`/api/health`도 이 컬렉션을 검사하지 않습니다. **평소처럼 배포한 뒤 컬렉션을 만들면 됩니다.**

## 실행 순서

### 0. 준비

1. 이 기능 PR을 `dev`·`main`에 머지합니다. 라벨은 `database-change-reviewed`, `mongodb-validator-ready`입니다.
2. [DB 작업 안전 규칙](db-write-safety.md)에 따라 백업 여부를 확인합니다. 실행 범위는
   "운영 Mongo에 신규 컬렉션 `SessionSurveyResult` 1개 생성(인덱스 포함), 기존 컬렉션/문서 변경 없음"입니다.

### 1. 배포

Coolify에서 평소처럼 Deploy합니다(헬스체크 켠 상태). "New container is healthy"와 `/api/health` 200을 확인합니다.

### 2. 점검 (읽기 전용, 운영 컨테이너 Terminal)

```bash
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/apply-mongodb-session-survey-result-collection.ts
```

`"ready": false`가 정상입니다. `target` 값을 다음 단계에 그대로 씁니다.

### 3. 생성 (운영 DB 쓰기)

```bash
MONGODB_ALLOW_SHADOW_WRITES=true \
  node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/apply-mongodb-session-survey-result-collection.ts \
  --apply --confirm-target=<2단계 target 값> --backup-confirmed
```

`"mode": "applied"`이면 성공입니다. 다시 2단계를 실행하면 `"ready": true`가 나옵니다. 새 요청부터 바로 씁니다(재배포 불필요).

### 4. 확인

1. 운영 현황·회차 상세가 정상으로 열리는지 확인합니다.
2. survey_analysis에서 회차 하나를 [hub-om 반영]한 뒤, 그 회차 상세의 "수강생 코멘트"에 응답자 수·코멘트가 보이는지 확인합니다.
3. Logs에 `SESSION_SURVEY_RESULT_UNAVAILABLE`이 더 이상 나오지 않는지 확인합니다.

## 되돌리기

코드를 롤백해도 컬렉션은 그대로 둬도 됩니다(이전 버전은 이 컬렉션을 모릅니다). 컬렉션을 지워야 하면
데이터/기술 책임자와 상의합니다. 이 도구는 생성/점검만 합니다.
