# 강사노트 파일 가져오기 CLI Mongo 경계

## 범위

`db:import:instructor-notes`는 `.local/instructor-wiki.json`을 읽어 개인정보를 제거한 강사노트를 적재한다. 기본 저장소는 암호화 PostgreSQL이며 exact `--backend=mongodb-shadow`만 준비된 검증용 Mongo namespace를 연다.

```bash
npm run db:import:instructor-notes -- --dry-run
npm run db:import:instructor-notes -- --apply --backup-confirmed --maintenance-confirmed
npm run db:import:instructor-notes -- --dry-run --backend=mongodb-shadow
```

확인 플래그는 실제 백업이나 writer 중단을 수행하지 않는다. Mongo 실행에는 `MONGODB_URI`, `MONGODB_SHADOW_DATABASE`, `MONGODB_SHADOW_NAMESPACE`가 필요하며 CLI는 기존 namespace를 생성·수리·삭제하지 않는다.

## 병합과 개인정보 규칙

- 원천은 `local:instructor-wiki` 문맥으로 암호화된 JSON object여야 한다. 32MiB 또는 20,000행을 넘으면 저장 전에 거부한다.
- 현재 숫자 key 형식은 값의 `notionNo`와 정확히 일치하고 `instructorName`이 있어야 한다. 구형 이름 key도 읽는다. `notionNo`가 있으면 이를 우선 식별자로 사용하므로 동명이인도 별도 행으로 유지한다.
- 연락처·이메일·생년월일은 저장하지 않는다. notes와 Notion 자유 입력란의 전화번호·이메일은 기존 `stripPiiFromNote` 규칙으로 가린다.
- dry-run과 결과 로그에는 강사명·메모·원천 경로·저장소 오류 원문을 출력하지 않고 전체/신규/갱신 건수만 표시한다.
- `notionNo` 없는 구형 이름 행이 여러 개면 현재 강사노트 저장소와 같이 가장 낮은 `notionNo` 행을 선택하고 null 행은 마지막으로 둔다. 현 스키마에서 이름은 unique가 아니므로 과거 raw SQL의 `ON CONFLICT (instructor_name)`는 사용할 수 없다.
- displayName, notionId, partnerId, notes와 Notion profile은 원천의 비어 있지 않은 값만 덮어쓴다. `recruitAvoid`는 기존값과 원천값을 OR한다.
- apply는 전체 파일을 단일 transaction으로 처리한다. 후반 행 실패 시 앞선 변경도 롤백한다. 재실행은 새 중복 행을 만들지 않고 기존 행을 다시 갱신 대상으로 센다.
- PostgreSQL은 application encryption wrapper를 사용한다. Mongo는 authenticated codec과 snapshot transaction, majority journal write를 사용한다. 강사노트 writer는 신규 생성 가능성이 확인된 경우 같은 namespace guard를 잡고 다시 조회해 최초 이름 생성과 Notion NO 연결을 한 행으로 수렴시킨다. 읽기와 기존 행 수정은 guard를 갱신하지 않으며 duplicate-key 충돌은 전체 transaction을 최대 5회 재시도한다.

운영 적용 전 양쪽 백업과 격리 복원을 확인하고 강사노트 writer를 중단한 뒤 dry-run, apply, 재실행 순서로 확인한다. 기존 shadow가 준비 계약과 다르면 자동 수리하지 않고 새 run ID/namespace 재복사를 우선한다.

## 검증과 한계

- 일반 회귀: 1,129 pass / 118 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 1 root pass(PII 암호화, dry-run, 기존값 보존, rollback, 재실행, 11000 재시도, 부분 namespace 포함)
- 기존 Notion 동기화 실제 Mongo 회귀: 25 pass(dry-run 무쓰기, 신규 생성·기존 수정 경합 포함)
- 실제 합성 PostgreSQL 17: 1 root pass(암호화 wrapper, dry-run, 기존값 보존, rollback, 재실행 포함)
- command/runtime 단위: 4 pass
- typecheck/build 통과
- lint: 오류 0, 기존 경고 7
- 독립 최종 리뷰: 잔여 P0~P3 없음

실제 `.local` 파일·운영 DB·Atlas·Notion·운영 키·배포 설정에는 접근하지 않았다. 실제 백업·복원, 운영 규모, production selector와 최종 전환은 검증하지 않았다. 이 범위는 한 CLI의 저장소 경계이며 전체 앱 전환이나 운영 이전 완료가 아니다.
