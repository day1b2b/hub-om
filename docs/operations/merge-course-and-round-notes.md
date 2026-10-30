# 과정·회차 메모 통합 반영

운영 상세의 메모를 "과정 공통"과 "회차별" 탭 2개에서 과정 공통 메모 1개로 합친다. 기존 회차별 값을
버리지 않고 과정 공통 메모에 이어붙여 보존한다.

## 배경

이전까지는 `course_common_notes`(과정당 1행)와 `operation_sessions`(회차마다 1행)에 같은 이름의 필드
(`specialNotes`/`operationIssue`/`omUpdate`)가 각각 따로 있었다. 화면은 이 둘을 탭으로 나눠 보여줬다.
이제부터는 화면에 과정 공통 메모만 남기고, 기존에 입력된 회차별 메모는 이 도구로 과정 공통 메모에
한 번 합친다.

## 판정 기준

`특이사항 / 이슈`(specialNotes), `회고 (OM+LD)`(operationIssue), `메모`(omUpdate)를 각각 독립적으로
판정한다.

- 비어 있는 값(과정 공통/회차별 모두)은 무시한다.
- 과정 공통 값과 회차별 값들을 모아 완전히 같은 문자열은 한 번만 남긴다.
- 회차별 값이 모두 같으면(기존 `courseNotesCandidateModel`의 "commonCandidate" 판정과 같은 기준)
  접두사 없이 한 번만 포함한다.
- 회차별 값이 서로 다르면 어느 회차에서 왔는지 알 수 있게 `[N회차]` 접두사를 붙인다
  (예: `[1회차] 내용`). 같은 값을 공유하는 회차가 여럿이면 `[1,2회차] 내용`처럼 묶는다.
- 과정 공통에만 있던 값(회차 출처 없음)은 접두사 없이 그대로 둔다.
- 최종 값은 과정 공통(`course_common_notes`)에만 쓴다. **회차별 원본 값(`operation_sessions`)은
  수정하거나 삭제하지 않는다**(add-only). 회차별 컬럼 정리는 별도 cleanup 작업이다.

## 멱등성 한계

재실행해도 내용이 계속 늘어나지 않도록, 과정 공통 값에 이미 들어있는 "줄"(개행 기준)과 완전히 같은
내용은 다시 추가하지 않는다. 이 비교는 값 전체가 아니라 줄 단위로 하기 때문에, 회차 메모 자체에
개행이 포함되어 있고 그 내용이 과정 공통에 부분적으로만 있는 경우까지는 완전히 막지 못한다. 완벽한
멱등성이 필요하면 반영 전후로 dry-run 출력을 비교해 건수가 0에 수렴하는지 확인한다.

## 실행

기본값은 `DATABASE_URL`이 가리키는 PostgreSQL이다. MongoDB 운영 selector를 사용하는 환경에서는
`--backend=mongodb-shadow`를 명시한다. 대상 환경을 확인한 뒤 먼저 조회 전용으로 실행한다.

```sh
npm run db:merge:course-and-round-notes -- --dry-run
npm run db:merge:course-and-round-notes -- --backend=mongodb-shadow --dry-run
```

실제 반영은 현재 백업과 작업 시간대가 확인된 경우에만 두 확인 플래그를 함께 사용한다.

```sh
npm run db:merge:course-and-round-notes -- --apply --backup-confirmed --maintenance-confirmed
npm run db:merge:course-and-round-notes -- --backend=mongodb-shadow --apply --backup-confirmed --maintenance-confirmed
```

출력에는 과정 수와 필드별 "변경 없음"/"이어붙임 발생" 건수만 포함하며 메모 내용은 출력하지 않는다.
반영 후 dry-run을 다시 실행해 "이어붙임 발생" 건수가 0건인지 확인한다(위 멱등성 한계로 완전히
0건이 되지 않으면 원인이 된 과정을 직접 확인한다).

## 화면 변경

`CourseNotesWorkspace`는 더 이상 탭을 보여주지 않고 과정 공통 메모 섹션 하나만 보여준다. 회차별
편집 UI(`IssueReviewEditor`)는 코드는 남겨두되 이 화면에서 더는 불러오지 않는다(혹시 모를
롤백/참고용). 회차별 메모 저장에 쓰이던 API(`/api/operations/[operationId]/drive-import/apply`)도
삭제하지 않았다 — 화면에서 호출 경로만 없어졌다.
