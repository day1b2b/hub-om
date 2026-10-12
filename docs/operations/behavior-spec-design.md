# 실행되는 기획서(Behavior Spec) 설계

상태: 초안 · 시범 적용(회차 삭제, OM 변경) · 2026-10-12

## 왜 만드나

2026-10-12에 버그 두 개가 났다. 원인은 같았다. **같은 업무를 하는 입구가 여러 개인데, 입구마다 동작이 같은지 비교할 장치가 없었다.**

- OM 변경: 업무요청 배정 폼에서는 Slack 알림이 갔는데, 운영 상세 화면에서는 안 갔다.
- 회차 삭제: 회차 하나를 지우면 Calendar 일정도 지워졌는데, 관리자 과정 삭제에서는 지워지지 않았다.

기획(규칙)은 사람 머릿속이나 대화에만 있고, 코드는 입구마다 따로 자랐다. 이 설계는 **기획을 코드 옆에 두고, CI가 "규칙 × 입구" 표를 매번 채워 보게 하는 것**이다. 표에 빈칸이 생기면 머지가 막힌다.

## 한눈에 보기

```text
업무 기획서 (specs/<업무>.spec.md)     ← 사람이 읽고 고침
   ├─ 규칙 R1, R2 … (사람 말 문장)
   ├─ 입구 표 (이 업무를 하는 API 경로)
   ├─ 예외 (이 입구엔 해당 없음 + 이유)
   └─ 알려진 빈칸 (지금은 안 되지만 고칠 예정 + 이유)

테스트 이름의 표시 [spec:업무 R2 | 입구]  ← 규칙 하나 × 입구 하나를 증명
코드에서 입구 자동 수집 (API 경로 전부 + package.json 스크립트)
                ↓
node scripts/spec/spec-status.mjs → specs/STATUS.md (규칙 × 입구 표, PR에서 diff로 보임)
CI: 빈칸 ❌ · 분류 안 된 입구 · 표 갱신 누락 → 실패
CI: 규칙 삭제·변경, 예외·빈칸 추가 → behavior-spec-approved 라벨 필요
```

## 결정한 것 (2026-10-12, 하연희 확인)

| 항목 | 결정 | 이유 |
|---|---|---|
| 기획서 형식 | Markdown + 정해진 줄 형식 | GitHub에서 그대로 읽고 고칠 수 있다. 새 의존성 없음. |
| 입구 분류 강도 | 코드의 모든 입구를 분류해야 통과 | 오늘 같은 "아무도 모르는 새 입구"를 잡으려면 빠짐없이 봐야 한다. |
| CI 강도 | 표 빈칸·미분류 입구는 실패, 고아 테스트는 경고 | 빈칸은 곧 버그 후보. 고아 테스트는 규칙 이름이 바뀐 흔적일 수 있어 경고만. |
| 이미 아는 빈칸 | "알려진 빈칸"으로 이유와 함께 적으면 🟡로 통과 | 발견 즉시 숨기지 않고 표에 남기되, 고치는 일은 따로 진행할 수 있게. |

## 1. 기획서 파일 형식

위치: `specs/<업무-id>.spec.md`. 업무 하나에 파일 하나. 사람과 AI 모두 **업무 하나의 파일만 읽으면** 규칙과 입구를 다 알 수 있게 한다.

```markdown
# 회차 삭제

업무 ID: `operation-delete`

한두 문장 설명.

## 규칙

- **R1** 회차는 표시 삭제만 한다. 실제 데이터는 지우지 않고 삭제한 사람을 남긴다.
- **R2** 삭제한 회차에 연결된 Google Calendar 일정을 지운다.

## 입구

| 입구 | 화면 | 누가 |
|---|---|---|
| `DELETE /api/operations/[operationId]` | 운영 상세 > 회차 삭제 | 로그인한 팀원 |
| `DELETE /api/admin/courses/[courseId]` | 관리자 > 과정 삭제 | 관리자 |

## 예외

- **R8 @ `DELETE /api/admin/courses/[courseId]`** — 과정 전체를 지우는 입구라 해당 없음.

## 알려진 빈칸

- **R3 @ `DELETE /api/operations/[operationId]`** — 지금은 안 됨. 언제 누가 확인했고 어떻게 할지.
```

작성 규칙:

- 규칙은 **기본적으로 모든 입구에 적용**된다. 안 맞는 입구는 "예외"에 이유와 함께 적는다. 이유 없는 예외는 형식 오류다.
- 규칙 문장은 화면을 쓰는 사람 기준으로 쓴다. "~함수를 호출한다"가 아니라 "~가 된다/보낸다/막는다".
- 규칙 ID는 재사용하지 않는다. 지운 규칙의 번호는 비워 둔다.
- 입구 칸에는 코드의 메서드와 경로를 그대로 쓴다(`node scripts/spec/spec-status.mjs`가 코드와 맞는지 확인한다).
- 한 입구가 여러 업무에 속할 수 있다(예: 과정 삭제는 "회차 삭제"이면서 나중에 "과정 정리" 업무에도 들어갈 수 있다).

## 2. 입구 자동 수집과 분류

`scripts/spec/spec-lib.mjs`의 `collectEntrances`가 코드에서 입구를 모은다. 기존 `src/lib/activity/coverage.test.ts`와 같은 방식이다.

- `src/app/api/**/route.ts`에서 export된 HTTP 메서드 전부(TypeScript AST로 읽음)
- `package.json`의 스크립트 전부(`SCRIPT db:backfill:...` 형태). 운영 데이터를 바꾸는 스크립트도 입구다.

모든 입구는 아래 둘 중 정확히 하나에 있어야 한다.

1. 어떤 업무 spec의 **입구 표**
2. `specs/entry-map.json`: `"해당 없음: 이유"`, `"기획서 없음: 업무명"`, `"미검토"` 중 하나

처음 도입할 때는 기존 입구 135개를 일괄 `"미검토"`로 넣었다. **새로 생긴 입구는 `"미검토"`로 둘 수 없다.** PR 검사가 막는다. 그래서 새 API를 만드는 사람(또는 AI)은 그 순간 "이건 어떤 업무의 입구인가"를 판단해야 한다. 오늘 버그는 바로 이 판단이 없어서 생겼다.

> 예약 작업(cron): 현재 저장소에는 별도 스케줄러 코드가 없고, 예약 실행도 API 경로(예: `GET /api/admin/calendar/refresh-events`)로 들어온다. 그래서 API 수집에 포함된다. 저장소 밖(Coolify 등)의 예약 설정은 수집하지 못한다. 남은 결정 D5 참고.

## 3. 규칙과 테스트 연결

테스트 이름에 표시를 넣는다.

```ts
test(`과정 삭제는 지운 회차의 Calendar 일정을 지운다 [spec:operation-delete R2 | DELETE /api/admin/courses/[courseId]]`, ...)
test(`... [spec:operation-delete R2,R4 | DELETE /api/admin/courses/[courseId]]`, ...)   // 여러 규칙
test(`... [spec:om-change R2 | 공통]`, ...)   // 여러 입구가 함께 쓰는 함수의 테스트
```

- **입구 칸은 그 입구를 직접 호출한 테스트로만 채운다.** 공통 함수 테스트(`| 공통`)는 표의 "공통 테스트" 열에 따로 보이고, 입구 칸을 대신 채우지 못한다. 오늘 버그는 둘 다 "공통 함수는 맞는데 그 입구가 안 불렀다"였기 때문이다.
- 입구 테스트는 route handler를 실제로 import해 호출한다. 바꾸는 것은 **바깥 경계**(Google Calendar API, Slack, DB 저장소, 로그인)뿐이고, 그 사이 연결 로직은 실제 코드를 돌린다. 공용 가짜: `src/behavior/fakes/`.
- 테스트 위치: `src/behavior/<업무-id>/<입구>.test.ts`. 업무 단위로 모여 있어 업무 하나만 읽으면 된다. 기존 테스트에 표시만 붙여도 된다.
- 알려진 빈칸은 "원래 이래야 한다"는 테스트를 `{ todo: "알려진 빈칸: specs/..." }`로 써 둔다. 실패해도 `npm test`를 막지 않고, 고쳐져서 통과하기 시작하면 표가 "빈칸 해제 필요"로 알려 준다.

## 4. 표 생성과 CI 검사

`node scripts/spec/spec-status.mjs`

1. `[spec:`가 들어간 테스트 파일만 골라 node 테스트로 돌린다(전용 리포터 `scripts/spec/spec-reporter.mjs`).
2. 결과로 규칙 × 입구 표를 만들어 `specs/STATUS.md`에 쓴다.

| 표시 | 뜻 | CI |
|---|---|---|
| ✅ | 그 입구를 부른 테스트가 통과 | 통과 |
| ❌ | 연결된 테스트가 없거나 실패 | **실패** |
| 🟡 | 알려진 빈칸(이유 기록됨) | 통과 |
| ➖ | 예외(해당 없음, 이유 기록됨) | 통과 |

`node scripts/spec/spec-status.mjs --check`(CI)는 추가로 다음을 실패 처리한다: 분류 안 된 입구, 코드에서 사라진 입구가 남아 있음, spec 형식 오류, `specs/STATUS.md`가 최신이 아님. 고아 테스트(없는 규칙·입구를 가리키는 표시), 통과하기 시작한 todo, 예외 칸에 연결된 테스트는 경고만 낸다.

CI 위치: `.github/workflows/verify.yml`의 `Behavior spec status`(빌드 전), `Behavior spec change review gate`, `Behavior spec tool tests`. `src/behavior/` 테스트는 기존 `npm test`에도 포함된다.

## 5. PR에서 보이는 것과 승인

- **표 변화**: `specs/STATUS.md`가 커밋되므로 GitHub `Files changed`에서 ✅→❌ 같은 칸 변화가 그대로 diff로 보인다. CI 요약(Job summary)에도 표가 찍힌다.
- **규칙 변화**: `scripts/spec/check-spec-change-review.mjs`가 기준 브랜치와 비교해 사람이 읽을 요약을 낸다.

| 변경 | 라벨 필요 |
|---|---|
| 규칙 추가, 입구 추가, 예외·빈칸 해제 | 아니오 (더 엄격해지는 변경) |
| 규칙 삭제·문장 변경, 입구 제외, 업무 spec 삭제 | `behavior-spec-approved` |
| 예외 추가, 알려진 빈칸 추가 | `behavior-spec-approved` |
| 새 입구를 `"미검토"`로 등록 | 막힘(분류 필요) |

라벨 방식은 기존 DB 변경 검사(`scripts/ci/check-database-change-review.mjs`)와 같다. 라벨을 붙인 뒤에는 PR을 닫았다 다시 열어 CI를 다시 돌린다.

## 6. 시범 적용 결과 (2026-10-12)

### 6-1. 현재 dev 기준 (이 브랜치)

전체 표: [specs/STATUS.md](../../specs/STATUS.md). 두 업무 모두 ❌ 없음. 🟡 3칸은 이번 역기획에서 **새로 발견**했고, 기획 확인(하연희)을 받아 "알려진 빈칸"으로 적었다.

| 새로 찾은 빈칸 | 기획 판단 |
|---|---|
| OM 변경 R1·R2 @ 관리자 DB 화면(`PATCH /api/admin/database/cell`의 회차 OM 칸): 업무요청 담당자 동기화와 Slack 알림이 없다 | 맞춰야 함. 후속 작업 |
| 회차 삭제 R3 @ 회차 단건 삭제: Calendar 삭제가 실패해도 화면에 "일정 정리 대기"를 알리지 않는다 | 알려야 함. 후속 작업 |

### 6-2. 수정 전 코드(`97c002e8^` = dev의 #694 머지 직전)에 같은 spec·테스트를 돌린 결과

| 칸 | 결과 | 의미 |
|---|---|---|
| OM 변경 R2 @ `POST /api/operations/[operationId]/drive-import/apply` | ❌ | 오늘 버그 1 (운영 상세 Slack 알림 누락) |
| 회차 삭제 R2 @ `DELETE /api/admin/courses/[courseId]` | ❌ | 오늘 버그 2 (과정 삭제 Calendar 미삭제) |
| 회차 삭제 R3·R4 @ 과정 삭제 | ❌ | 버그 2의 파생(정리 대기 알림·재시도 없음) |
| 회차 삭제 R5 @ 두 입구 모두 | ❌ | 정리 재시도 때 복원된 회차의 일정을 지울 수 있었다. 같은 수정 커밋에서 함께 고쳐진 문제로, 표가 따로 잡아냈다 |
| 나머지 | ✅ / 🟡 / ➖ | 현재와 같음 |

재현 방법: `git worktree add <폴더> 97c002e8^` → `node_modules` 연결 → 이 브랜치의 `specs/`, `scripts/spec/`, `src/behavior/`, `package.json`을 복사 → `node scripts/spec/spec-status.mjs`. 결과: "기획서 검사 실패 6건", 위 칸들이 ❌.

## 7. 규모가 커질 때 (업무 수백 개, 화면 여러 개)

- **읽는 단위 = 업무 하나.** spec 파일 1개 + `src/behavior/<업무>/` 폴더 1개. AI에게 작업을 줄 때도 "이 업무 spec을 읽고 표를 ✅로 만들어라"로 범위를 자른다.
- 표 파일이 길어지면 `specs/STATUS.md`를 업무별 파일로 나눈다(생성기만 바꾸면 됨).
- 테스트 실행은 `[spec:` 표시가 있는 파일만 돌린다. 업무 수에 따라 늘어나지만 파일 단위 병렬 실행이다. 느려지면 PR에서 바뀐 업무만 돌리는 방식을 추가한다(남은 결정 D4).
- 입구 분류 현황(`STATUS.md` 맨 아래)의 "미검토" 숫자가 줄어드는 것이 확장 진척도다.
- 새 의존성은 추가하지 않았다(`typescript`는 기존 의존성).

## 8. 운영 방식 제안 (적용 전, 승인 필요)

### 8-1. 작업 흐름

```text
1. 기획(규칙) 변경: specs/<업무>.spec.md에 규칙을 추가·수정한다.
2. 표 확인: node scripts/spec/spec-status.mjs → 새 규칙 칸이 ❌로 생긴다. 이것이 해야 할 일 목록이다.
3. 구현: 각 ❌ 칸마다 그 입구를 부르는 테스트를 [spec:업무 R# | 입구]로 쓰고 코드를 고친다.
4. 표 전부 ✅: node scripts/spec/spec-status.mjs → STATUS.md를 커밋한다. 🟡/➖는 이유가 적혀 있어야 한다.
```

### 8-2. CLAUDE.md와 AGENTS.md에 같은 내용으로 넣을 문단(안)

```markdown
## 실행되는 기획서(Behavior Spec)

외부 효과(알림, Calendar, DM, 외부 연동 쓰기, 권한)가 있는 업무를 바꾸거나 새 API 경로·스크립트를 만들 때는
docs/operations/behavior-spec-design.md를 따른다.

- 작업 전: 관련 업무의 specs/<업무>.spec.md를 읽는다. 없으면 specs/entry-map.json에서 입구 분류를 확인한다.
- 새 입구(API 메서드, package.json 스크립트)를 만들면 업무 spec 입구 표에 넣거나 entry-map.json에 "해당 없음: 이유"로 적는다. "미검토"로 두지 않는다.
- 같은 업무의 입구 하나를 고치면 같은 spec의 다른 입구도 같은 규칙을 지키는지 표로 확인한다.
- 규칙 문장 삭제·변경, 예외·알려진 빈칸 추가는 사용자 확인을 받고 PR에 behavior-spec-approved 라벨이 필요하다고 안내한다.
- 완료 전: node scripts/spec/spec-status.mjs 를 실행해 specs/STATUS.md에 ❌가 없는지 확인하고 함께 커밋한다.
```

### 8-3. 확장 순서 제안

외부 효과가 있어 "빠지면 사람이 바로 피해를 보는" 업무부터 한다.

1. 알림: 업무요청 접수 알림, 리마인더, Slack DM(`sendSlackDirectMessage` 사용처)
2. Calendar: 회차 생성·수정(일정 갱신, 초대 메일), 회차 복원(`PUT /api/admin/deleted-operations`)
3. 외부 연동 쓰기: Google Sheets·Notion 가져오기, 만족도 반영, Salesmap
4. 권한: 관리자 전용 경로, 개인정보(코치 PII) 조회
5. 그다음 화면 내부 계산(상태값 계산 등)

## 9. 남은 결정

| ID | 결정할 것 | 지금 상태 / 추천 |
|---|---|---|
| D1 | 8-2 문단을 CLAUDE.md·AGENTS.md에 넣을지 | 미적용. 승인 후 넣음 |
| D2 | `behavior-spec-approved` 라벨을 누가 붙일지(기획 책임자) | 하연희로 가정. 저장소 라벨 생성 필요 |
| D3 | 알려진 빈칸 3칸 수정 작업 일정 | 후속 작업으로 제안 |
| D4 | 업무가 많아졌을 때 PR에서 바뀐 업무만 돌릴지 | 지금은 전체 실행(수 초). 느려지면 도입 |
| D5 | 저장소 밖 예약 작업(Coolify cron 등)을 입구 목록에 어떻게 넣을지 | 미수집. 목록 파일을 따로 둘지 결정 필요 |
| D6 | 화면(버튼) 단위 입구까지 수집할지 | 지금은 API·스크립트만. 화면 → API 매핑은 spec 입구 표의 "화면" 칸으로 사람이 적음 |
| D7 | "미검토" 135개를 언제·누가 분류할지 | 8-3 순서로 업무 spec을 만들며 줄임 |
