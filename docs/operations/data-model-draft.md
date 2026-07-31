# 데이터 모델 초안

이 문서는 운영 데이터 구조를 확정하기 전 검토용 초안입니다. 사람이 검토하기 쉽도록 내부 식별자와 시스템 관리 필드는 제외했습니다. 실제 DB 설계 시에는 내부 식별자, 생성/수정 시각, 제약 조건, index를 별도로 추가합니다.

## 구조 요약

```text
courses / 과정
├─ customers / 고객사
├─ topics / 주제
│  └─ rounds / 회차
├─ assignments / 담당 배정
├─ financial_items / 금액 항목
└─ source_records / 원천 기록

people / 사람
└─ person_roles / 사람 역할

imports / 가져오기 실행
└─ source_records / 원천 기록
```

확정한 원칙:

- 운영자가 실제로 부르는 대표 단위는 `courses / 과정`입니다.
- `topics / 주제`는 선택입니다. 주제가 없는 과정도 있을 수 있습니다.
- `rounds / 회차`는 실제 일정 단위이며 날짜 확정 여부를 함께 가집니다.
- OM, LD, 강사는 기본적으로 과정에 배정합니다.
- 실습코치는 기본적으로 회차에 배정합니다.
- 금액은 과정에 직접 두지 않고 `financial_items / 금액 항목`으로 분리합니다.
- 원천 관리는 `source_record_key`와 `content_hash`로 자동 비교합니다.
- `course_code`(코스ID)는 운영 업무 요청 시점에는 확정되지 않습니다. LD가 운영 업무를 요청할 때는 코스ID 없이 과정만 먼저 생성되고, 이후 다른 플랫폼에서 코스ID가 확정되면 그 값을 채워 넣습니다. 그래서 코스ID가 `null`인 과정을 정상 상태로 취급해야 하며, 생성 시 필수값으로 강제하면 안 됩니다.
- 코스ID는 사내의 다른 시스템과 연결되는 유일한 공통 식별자입니다. 같은 코스ID 아래 과정(course)이 여러 개 있을 수 있으므로(예: 하나의 코스ID로 발주된 교육이 세부 과정 여러 개로 나뉘는 경우), 시스템 간 연동 키는 항상 코스ID를 기준으로 하고 과정명은 hub-om 내부 표시 단위로만 사용합니다.

## customers / 고객사

교육을 의뢰한 기업입니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `name` | 고객사명 | `고객사 A` |
| `normalized_name` | 정규화 고객사명 | `고객사 A` |
| `is_active` | 사용 여부 | `true` |

예시:

```text
customers / 고객사
- name: 고객사 A
- normalized_name: 고객사 A
- is_active: true
```

## courses / 과정

운영자가 실제로 "과정"이라고 부르는 대표 운영 단위입니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `customer` | 고객사 | `고객사 A` |
| `name` | 과정명 | `AI 활용 과정` |
| `course_code` | 코스ID | `null`, `C-2026-001` |
| `education_format` | 교육 형태 | `오프라인` |
| `operation_type` | 운영 유형 | `장기` |
| `course_status` | 과정 상태 | `진행 중` |
| `archive_status` | 아카이빙 상태 | `아카이빙 필요` |
| `start_date` | 과정 시작일 | `2026-03-09` |
| `end_date` | 과정 종료일 | `2026-12-01` |
| `notes` | 특이사항 | `영업/콘텐츠마케팅/퍼포먼스마케팅 총 3가지 주제` |
| `source_record` | 원천 기록 | `고객사 A 원천 기록` |

예시:

```text
courses / 과정
- customer: 고객사 A
- name: AI 활용 과정
- course_code: null
- education_format: 오프라인
- operation_type: 장기
- course_status: 진행 중
- archive_status: 아카이빙 필요
- start_date: 2026-03-09
- end_date: 2026-12-01
- notes: 영업/콘텐츠마케팅/퍼포먼스마케팅 총 3가지 주제
- source_record: 고객사 A 원천 기록
```

단순 과정 예시:

```text
courses / 과정
- customer: 고객사 B
- name: 2026 AI 리터러시
- education_format: 비대면
- operation_type: 단기
- course_status: 진행 중
- start_date: 2026-06-09
- end_date: 2026-07-14
```

## topics / 주제

과정 안에서 나뉘는 세부 주제입니다. 모든 과정에 반드시 필요한 것은 아닙니다.

주제가 없는 과정은 기본 주제를 자동 생성하지 않고, 회차가 과정에 바로 연결될 수 있게 둡니다.

```text
courses / 과정
└─ rounds / 회차
```

주제가 있는 과정은 주제 아래 회차를 둡니다.

```text
courses / 과정
└─ topics / 주제
   └─ rounds / 회차
```

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `course` | 과정 | `AI 활용 과정` |
| `name` | 주제명 | `영업 AI 활용` |
| `description` | 설명 | `영업 직무 대상 AI 도구 활용` |
| `expected_round_count` | 예상 회차 수 | `5` |
| `display_order` | 표시 순서 | `1` |
| `is_active` | 사용 여부 | `true` |
| `source_record` | 원천 기록 | `고객사 A 원천 기록` |

예시:

```text
topics / 주제
- course: AI 활용 과정
- name: 영업 AI 활용
- expected_round_count: 5
- display_order: 1
- source_record: 고객사 A 원천 기록

- course: AI 활용 과정
- name: 콘텐츠 마케팅 AI 활용
- expected_round_count: 3
- display_order: 2
- source_record: 고객사 A 원천 기록

- course: AI 활용 과정
- name: 퍼포먼스 마케팅 AI 활용
- expected_round_count: 3
- display_order: 3
- source_record: 고객사 A 원천 기록
```

## rounds / 회차

실제 진행 일정입니다. 확정 날짜뿐 아니라 후보/미확정 날짜도 기록합니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `course` | 과정 | `AI 활용 과정` |
| `topic` | 주제 | `영업 AI 활용`, `null` |
| `round_label` | 회차명 | `1차수`, `하반기 1차수` |
| `round_no` | 회차 번호 | `1`, `null` |
| `start_date` | 시작일 | `2026-03-09`, `null` |
| `end_date` | 종료일 | `2026-03-09`, `null` |
| `date_text` | 날짜 원문 | `4/3 or 4/8`, `하반기 추가 논의` |
| `date_status` | 날짜 확정 여부 | `확정`, `후보`, `미확정`, `알 수 없음` |
| `round_status` | 회차 상태 | `예정`, `완료`, `취소`, `검토 필요` |
| `time_text` | 시간 | `09:00~18:00` |
| `location` | 장소 | `교육장 A` |
| `duration_text` | 교육 시간 | `8H 원데이` |
| `validation_errors` | 검토 필요 사유 | `날짜 후보 확인 필요` |
| `source_record` | 원천 기록 | `고객사 A 원천 기록` |

예시:

```text
rounds / 회차
- course: AI 활용 과정
- topic: 영업 AI 활용
- round_label: 1차수
- round_no: 1
- start_date: 2026-03-09
- end_date: 2026-03-09
- date_status: 확정
- round_status: 예정
- source_record: 고객사 A 원천 기록

- course: AI 활용 과정
- topic: 영업 AI 활용
- round_label: 2차수
- round_no: 2
- start_date: null
- end_date: null
- date_text: 4/3 or 4/8
- date_status: 후보
- round_status: 검토 필요
- validation_errors: 날짜 후보 확인 필요
- source_record: 고객사 A 원천 기록

- course: AI 활용 과정
- topic: 영업 AI 활용
- round_label: 3차수
- round_no: 3
- start_date: 2026-04-23
- end_date: 2026-04-23
- date_status: 확정
- source_record: 고객사 A 원천 기록

- course: AI 활용 과정
- topic: 콘텐츠 마케팅 AI 활용
- round_label: 1차수
- start_date: 2026-04-09
- end_date: 2026-04-09
- date_status: 확정
- source_record: 고객사 A 원천 기록

- course: AI 활용 과정
- topic: 퍼포먼스 마케팅 AI 활용
- round_label: 2차수
- start_date: 2026-05-28
- end_date: 2026-05-28
- date_status: 확정
- source_record: 고객사 A 원천 기록
```

날짜 확정 여부 후보:

| 영어 값 | 한국어 이름 | 의미 |
| --- | --- | --- |
| `confirmed` | 확정 | 실제 날짜가 확정됨 |
| `tentative` | 후보 | 여러 날짜 후보가 있음 |
| `unconfirmed` | 미확정 | 일정 논의만 있고 날짜가 없음 |
| `unknown` | 알 수 없음 | 원천만으로 판단 불가 |

## people / 사람

시스템에서 관리하는 사람입니다. OM/LD뿐 아니라 강사, 실습코치, 관리자, 내부 직원도 포함합니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `name` | 이름 | `담당자 A`, `관리자 A`, `강사 A` |
| `normalized_name` | 정규화 이름 | `담당자 A` |
| `email` | 이메일 | `admin@example.com`, `null` |
| `is_active` | 사용 여부 | `true` |

예시:

```text
people / 사람
- name: 관리자 A
- email: admin@example.com
- is_active: true

- name: 담당자 A
- email: null
- is_active: true

- name: 강사 A
- email: null
- is_active: true
```

## person_roles / 사람 역할

사람이 가질 수 있는 역할과 팀 소속입니다. 실제 과정 배정이 아니라 "이 사람이 어떤 자격/권한/소속을 가지는가"를 나타냅니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `person` | 사람 | `담당자 A` |
| `role` | 역할 | `om`, `ld`, `instructor`, `coach`, `staff`, `admin`, `app_user` |
| `source_team` | 소속 팀 | `1팀`, `2팀`, `null` |
| `display_order` | 표시 순서 | `1` |
| `is_active` | 사용 여부 | `true` |

역할 후보:

| 영어 값 | 한국어 이름 | 의미 |
| --- | --- | --- |
| `om` | OM | 운영 매니저 |
| `ld` | LD | 러닝 디자이너 |
| `instructor` | 강사 | 강의 담당자 |
| `coach` | 실습코치 | 실습 보조/코칭 담당자 |
| `staff` | 내부 직원 | OM/LD는 아니지만 내부 구성원 |
| `admin` | 관리자 | 앱 관리 권한자 |
| `app_user` | 앱 사용자 | 로그인 가능한 사용자 |

예시:

```text
person_roles / 사람 역할
- person: 담당자 A
- role: om
- source_team: 2팀
- display_order: 1

- person: 담당자 B
- role: ld
- source_team: 1팀
- display_order: 1

- person: 관리자 A
- role: staff
- source_team: null

- person: 관리자 A
- role: admin
- source_team: null

- person: 관리자 A
- role: app_user
- source_team: null

- person: 강사 A
- role: instructor
- source_team: null
```

## external_person_links / 외부 사람 연결

강사/실습코치가 다른 사이트에서 생성된다면, 사람 정보를 직접 중복 생성하기보다 외부 사람 데이터와 연결합니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `person` | 사람 | `강사 A` |
| `source` | 외부 출처 | `coach_db`, `instructor_portal` |
| `external_name` | 외부 이름 | `강사 A` |
| `external_key` | 외부 키 | `외부 사이트에서 제공하는 값` |
| `profile_url` | 외부 프로필 URL | `https://...` |
| `match_status` | 연결 상태 | `확정`, `매칭 필요` |

예시:

```text
external_person_links / 외부 사람 연결
- person: 강사 A
- source: instructor_portal
- external_name: 강사 A
- external_key: 외부 사이트에서 제공하는 값
- profile_url: https://...
- match_status: 확정
```

## assignments / 담당 배정

특정 과정/주제/회차에 실제로 배정된 사람입니다.

`person_roles`가 "이 사람이 어떤 역할을 할 수 있는가"라면, `assignments`는 "이 과정에 실제로 누가 붙었는가"입니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `role` | 배정 역할 | `om`, `ld`, `instructor`, `coach` |
| `person` | 사람 | `OM 담당자 A`, `LD 담당자 A`, `강사 A`, `null` |
| `course` | 과정 | `AI 활용 과정`, `null` |
| `topic` | 주제 | `콘텐츠 마케팅 AI 활용`, `null` |
| `round` | 회차 | `콘텐츠 마케팅 1차수`, `null` |
| `source_name` | 원천 이름 | `OM 담당자 A`, `원천 담당자 A` |
| `match_status` | 매칭 상태 | `확정`, `매칭 필요`, `미등록` |
| `notes` | 메모 | `원천 이름 확인 필요` |
| `source_record` | 원천 기록 | `고객사 A 원천 기록` |

규칙:

- `course`, `topic`, `round` 중 정확히 하나에 배정합니다.
- 기본 배정 단위:
  - OM: 과정
  - LD: 과정
  - 강사: 과정
  - 실습코치: 회차
- 예외는 허용합니다.
  - 주제별 강사가 다르면 강사를 주제에 배정합니다.
  - 특정 회차만 강사가 다르면 강사를 회차에 배정합니다.

예시:

```text
assignments / 담당 배정
- role: om
- person: OM 담당자 A
- course: AI 활용 과정
- topic: null
- round: null
- match_status: 매칭 필요
- source_record: 고객사 A 원천 기록

- role: ld
- person: LD 담당자 A
- course: AI 활용 과정
- topic: null
- round: null
- match_status: 확정
- source_record: 고객사 A 원천 기록

- role: instructor
- person: 강사 A
- course: null
- topic: 콘텐츠 마케팅 AI 활용
- round: null
- match_status: 확정
- source_record: 고객사 A 원천 기록

- role: instructor
- person: 강사 B
- course: null
- topic: 퍼포먼스 마케팅 AI 활용
- round: null
- match_status: 확정
- source_record: 고객사 A 원천 기록

- role: coach
- person: null
- course: null
- topic: null
- round: 콘텐츠 마케팅 1차수
- source_name: 실습코치 A
- match_status: 매칭 필요
- source_record: 고객사 A 원천 기록
```

## financial_items / 금액 항목

매출과 비용은 과정에 직접 두지 않고 별도 금액 항목으로 관리합니다. 매출은 과정 단위일 수 있고, 비용은 회차 단위일 수 있기 때문입니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `item_type` | 금액 종류 | `revenue`, `total_cost`, `instructor_cost`, `operation_cost` |
| `amount` | 금액 | `3000000`, `null` |
| `amount_text` | 원문 금액 | `300만원`, `별도 협의` |
| `course` | 과정 | `AI 활용 과정`, `null` |
| `round` | 회차 | `콘텐츠 마케팅 1차수`, `null` |
| `notes` | 메모 | `회차별 강사비 별도 정산` |
| `source_record` | 원천 기록 | `고객사 A 원천 기록` |

예시:

```text
financial_items / 금액 항목
- item_type: revenue
- amount: 3000000
- amount_text: 300만원
- course: AI 활용 과정
- round: null
- source_record: 고객사 A 원천 기록

- item_type: instructor_cost
- amount: null
- amount_text: 별도 협의
- course: null
- round: 콘텐츠 마케팅 1차수
- source_record: 고객사 A 원천 기록
```

## imports / 가져오기 실행

원천 데이터를 한 번 읽어온 실행 기록입니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `source_team` | 원천 팀 | `1팀`, `2팀` |
| `source_type` | 원천 유형 | `sheet`, `notion`, `excel` |
| `source_name` | 원천 이름 | `2팀 운영 시트` |
| `status` | 실행 상태 | `완료`, `오류 있음`, `실패` |
| `row_count` | 전체 항목 수 | `108` |
| `success_count` | 성공 수 | `96` |
| `error_count` | 오류 수 | `12` |
| `validation_logs` | 검증 로그 | `날짜 누락 6건` |

예시:

```text
imports / 가져오기 실행
- source_team: 2팀
- source_type: sheet
- source_name: 2팀 운영 시트
- status: 오류 있음
- row_count: 108
- success_count: 96
- error_count: 12
- validation_logs: 날짜 누락 또는 담당자 매칭 필요
```

## source_records / 원천 기록

시트 한 행, Notion 페이지 하나, 외부 시스템 record 하나처럼 원천에서 읽은 항목입니다. 앱에서 쓰는 정규화 데이터와 별도로 원문을 보존합니다.

| 영어 필드명 | 한국어 이름 | 예시 |
| --- | --- | --- |
| `import` | 가져오기 실행 | `2026-06-11 2팀 운영 시트 가져오기` |
| `source_type` | 원천 유형 | `sheet`, `notion`, `excel` |
| `source_name` | 원천 이름 | `1팀 운영 시트` |
| `source_team` | 원천 팀 | `1팀`, `2팀` |
| `source_record_key` | 원천 항목 키 | `원천에서 같은 항목을 다시 찾는 값` |
| `content_hash` | 내용 해시 | `원천 내용 변경 여부를 비교하는 값` |
| `last_seen_at` | 마지막 확인 시각 | `2026-06-11 10:00:00` |
| `status` | 원천 상태 | `active`, `changed`, `missing`, `error` |
| `row_snapshot` | 원천 항목 원문 | `{ "기업명": "고객사 A", ... }` |
| `mapped_fields` | 매핑된 값 | `{ "courseName": "AI 활용 과정" }` |
| `unmapped_fields` | 미매핑 값 | `{ "기타": "..." }` |
| `validation_errors` | 검토 필요 사유 | `코스ID 누락`, `날짜 후보 확인 필요` |

운영 방식:

- `source_record_key`: 같은 원천 항목인지 판단합니다.
- `content_hash`: 원천 내용이 바뀌었는지 판단합니다.
- `source_record`: 과정/주제/회차/담당 배정/금액 항목이 어느 원천에서 만들어졌는지 추적합니다.

예시:

```text
source_records / 원천 기록
- source_type: sheet
- source_name: 1팀 운영 시트
- source_team: 1팀
- source_record_key: 원천에서 같은 항목을 다시 찾는 값
- content_hash: 원천 내용 변경 여부를 비교하는 값
- status: active
- row_snapshot:
  {
    "기업명": "고객사 A",
    "과정명": "AI 활용 과정",
    "OM": "OM 담당자 A",
    "LD": "LD 담당자 A",
    "시작일": "2026-03-09",
    "종료일": "2026-12-01",
    "교육형태": "오프라인",
    "운영유형": "장기",
    "특이사항": "영업/컨텐츠마케팅/퍼포먼스마케팅 총 3가지 주제..."
  }
- mapped_fields:
  {
    "customerName": "고객사 A",
    "courseName": "AI 활용 과정",
    "om": "OM 담당자 A",
    "ld": "LD 담당자 A",
    "startDate": "2026-03-09",
    "endDate": "2026-12-01",
    "educationFormat": "오프라인",
    "operationType": "장기"
  }
- validation_errors:
  [
    "세부 주제/회차 분해 필요",
    "OM 매칭 필요"
  ]
```

## 상태값 후보

아직 확정하지 않은 상태값입니다.

### course_status / 과정 상태

| 영어 값 | 한국어 이름 |
| --- | --- |
| `draft` | 작성 중 |
| `planned` | 시작 전 |
| `active` | 진행 중 |
| `done` | 완료 |
| `on_hold` | 보류 |
| `cancelled` | 취소 |
| `needs_review` | 검토 필요 |

### round_status / 회차 상태

| 영어 값 | 한국어 이름 |
| --- | --- |
| `planned` | 예정 |
| `done` | 완료 |
| `cancelled` | 취소 |
| `needs_review` | 검토 필요 |

### archive_status / 아카이빙 상태

| 영어 값 | 한국어 이름 |
| --- | --- |
| `not_ready` | 아카이빙 전 |
| `needed` | 아카이빙 필요 |
| `done` | 완료 |
| `not_required` | 불필요 |

## 아직 정해야 할 것

- 과정 상태, 회차 상태, 아카이빙 상태의 최종 값
- `financial_items / 금액 항목`의 금액 종류와 과정/회차 배정 규칙
- 주제가 없는 과정에서 화면 표시를 어떻게 할지
- 강사/실습코치를 외부 사람 데이터와 연결하는 기준
- 원천 변경 시 자동 업데이트할 필드와 검토 필요로만 남길 필드
- 기존 `operation_sessions`를 새 구조의 `courses/topics/rounds`로 이관하는 규칙
