# 원천 자동화 TODO

이 문서는 엑셀에 수기로 모으던 데이터를 앞으로 각 원천에서 자동으로 가져오기 위한 TODO입니다.
현재 MVP에서는 엑셀을 초기 이관 원천으로 사용하되, 장기적으로 엑셀을 원본 데이터 저장소로 유지하지 않습니다.

## 원칙

- hub-om은 여러 원천을 통합해 운영 판단에 필요한 표준 데이터를 보여줍니다.
- 엑셀은 과거 수기 통합 결과이므로 초기 이관과 검증에만 사용합니다.
- 각 필드는 가능한 한 실제로 데이터가 처음 생기는 원천에서 가져옵니다.
- 자동화되지 않은 필드는 hub-om에서 사람이 입력/수정합니다.
- 실제 원천 파일명, 행 예시, 고객사명, 담당자명, 금액, 링크는 공개 저장소에 남기지 않습니다.

## 원천별 TODO

| 원천 | 가져올 후보 데이터 | 상태 | 비고 |
| --- | --- | --- | --- |
| Salesmap | 기업, 과정명, 코스ID, 매출, 딜/계약 상태, 시작/종료일 후보 | 진행중 | 엑셀 수기 입력을 가장 먼저 대체할 후보. `readSalesRecords()` reader 스캐폴딩 추가(env 기반, dry-run). 상세는 아래 `## Salesmap 연동` 참고 |
| Notion | 팀별 리소스 일정, 기업명, 과정명, 강의장소 | 중단 | 리소스 화면(캘린더/운영 상세)에서 Notion 원천 일정을 읽어와 DB 데이터를 대체하던 기능(`notionResourceOperationRepository.ts`)은 2026-08-22 제거함 — 이제 hub-om DB가 유일한 운영 일정 원천. `NOTION_TEAM*_RESOURCE_*` 설정은 담당자(OM/LD) 명단을 Notion에서 가져오는 별개 기능(`notionTeamMemberRepository.ts`)에서 계속 사용 중 |
| Google Calendar | OM별 강의 일정, 부재 일정, 주변 일정 | 진행중 | 서비스 계정 읽기 결과를 리소스 달력에 읽기 전용 일정으로 표시 |
| hub-om 입력 | OM, 운영 이슈, 현장 투입 여부, 링크, 회고, 아카이빙 완료 | TODO | 사람이 판단하거나 보강해야 하는 값 |
| 만족도 원천 | 전체 만족도, 강사 만족도 | TODO | 종료 후 자동 보강 후보 |
| Drive/결과보고서 | 결과보고서 링크, 자료 링크, 싱크업/강의관리/만족도 후보 | 진행중 | 폴더 URL 기반 후보 추출과 과정명 기반 폴더 후보 검색은 구현, 적용 이력화는 TODO |
| Slack | 과정/기업 관련 논의 링크 | TODO | 검색/참고 링크 중심으로 시작 |
| 강사/코치 DB | 강사, 실습코치 정보 | TODO | 원천 시스템 확인 필요 |

## Salesmap 연동 (2026-08-05 조사·스캐폴딩)

Salesmap을 엑셀 수기 입력의 첫 대체 원천으로 붙이기 위한 결정 기록.

### 확인한 것 (공개 API 문서 기준)

- Salesmap은 RESTful API(v2) 제공. Base URL `https://salesmap.kr/api`, 경로 prefix `/v2`.
- 인증: `Authorization: Bearer <token>`. 토큰은 `설정 > 개인 > 연동 > API > 토큰 생성`에서 발급(Free/Professional+ 플랜).
- 딜 조회: `GET /v2/deal`. `cursor` 페이지네이션, `pipelineName`+`pipelineStageName`로 단계 필터.
- 딜 필드: `이름`, `금액`(top-level `price`), `파이프라인 {id,name}`, `파이프라인 단계 {id,name}`, 그리고 커스텀 필드는 "평탄한 한글 키"로 포함.

### 매핑 방침 (`SalesRecord` 기준)

- `courseId` ← 코스ID 커스텀 필드 (기본 키 `코스 ID` — 공백 포함, `SALESMAP_FIELD_COURSE_ID`로 변경 가능)
- `companyName` ← 고객사 필드/관계 (기본 `회사`, `SALESMAP_FIELD_COMPANY`)
- `courseName` ← 과정명 필드 (기본 `과정명`, `SALESMAP_FIELD_COURSE_NAME`), 없으면 딜 `이름` fallback
- `revenue` ← `price`/`금액`
- `probability` ← `파이프라인 단계` 이름(딜 상태 참고값)
- 코스ID는 대시보드 운영 매칭의 우선키이므로, Salesmap 딜에 코스ID가 채워져 있어야 자동 매칭됨.

### 환경변수 (실제 값은 저장소에 두지 않고 배포/로컬 env로만 주입)

- `SALESMAP_API_TOKEN` (필수)
- `SALESMAP_API_BASE_URL` (기본 `https://salesmap.kr/api`)
- `SALESMAP_DEAL_PIPELINE_NAME`, `SALESMAP_DEAL_STAGE_NAME` (선택 필터, 함께 지정)
- `SALESMAP_FIELD_COURSE_ID`, `SALESMAP_FIELD_COMPANY`, `SALESMAP_FIELD_COURSE_NAME` (커스텀 필드 한글 키)
- `SALESMAP_MAX_PAGES` (기본 20)

### 남은 확정/후속

- 워크스페이스 실제 커스텀 필드 한글 키 확인(코스ID·고객사·과정명).
- `GET /v2/deal` 응답 봉투(`data`/`nextCursor`) 실제 키 이름 1회 호출로 확인.
- 시작일/종료일: `SalesRecord`에 날짜 필드 없음 → 타입 확장 여부 별도 결정(아래 열린 질문 참고).
- factory 연결: 캘린더 등 다른 reader와 공존하려면 composite 구성 필요(현재는 reader 파일만 추가, 미연결).
- 실 데이터 dry-run으로 매핑·매칭 검증 후에만 DB 반영 논의.

## 열린 질문

- Salesmap에서 실제로 제공되는 필드는 무엇인가? → 표준 딜 필드(이름/금액/파이프라인/단계)는 확인. **코스ID·고객사·과정명은 커스텀 필드라 워크스페이스별 한글 키 확인 필요.**
- 시작일/종료일의 최종 기준은 Salesmap, Calendar, hub-om 입력 중 무엇인가?
- 비용/강사비/운영비의 실제 원천은 어디인가?
- 만족도와 결과보고서는 어떤 식별자로 과정과 매칭할 것인가?
- OM 변경, LD 변경, 일정 변경 이력은 어디까지 저장할 것인가?

## 우선순위

1. 엑셀 데이터를 기준으로 표준 운영 데이터로 초기 이관합니다.
2. 이관 중 엑셀 컬럼별 실제 원천을 분류합니다.
3. Salesmap 자동 읽기를 우선 검토합니다.
4. Google Calendar 일정은 리소스 화면에 보강 데이터로 붙입니다.
5. 종료 후 데이터는 만족도/결과보고서/회고 원천을 분리해 자동화합니다.
