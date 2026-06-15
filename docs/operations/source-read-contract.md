# 외부 원천 읽기 계약

이 문서는 외부 원천을 읽어 hub-om의 표준 운영 데이터로 연결하기 위한 공개 가능한 계약만 정리합니다.
실제 원천 파일명, API 인증값, 고객사/담당자/강사명, 링크, 금액 예시는 공개 저장소에 커밋하지 않습니다.

## 범위

MVP에서는 외부 원천에 쓰지 않고 읽기만 합니다.

- 강의 캘린더/운영 보드: 과정명, 담당자, 시작일, 종료일, 상태 참고값.
- Google Calendar: OM별 강의 일정, 부재 일정, 주변 일정.
- Slack: 과정명/기업명 기준으로 참고할 수 있는 논의 링크.
- Salesmap: 코스ID, 기업, 과정, 매출 참고값.

## 공개 저장소에 두는 것

- `src/lib/sourceReads/sourceReadTypes.ts`의 읽기 결과 타입.
- 연동이 설정되지 않았을 때 빈 결과를 반환하는 기본 reader.
- `OPERATION_SOURCE_READER_MODULE`로 비공개 reader 모듈을 연결하는 hook.
- Slack 메시지 검색과 스레드 읽기를 위한 기본 reader.
- 외부 원천 결과를 표준 운영 데이터로 매핑할 때 지켜야 할 규칙.

## 공개 저장소에 두지 않는 것

- 실제 API 토큰, OAuth secret, webhook URL.
- 실제 워크스페이스/데이터베이스/스프레드시트/캘린더 식별자.
- 실제 고객사명, 담당자명, 강사명, 비용/매출, 링크.
- 실제 원천 행 예시와 원천 분석 문서.

## 원천별 읽기 결과

외부 reader는 아래 메서드를 구현합니다.

- `readCourseBoard()`: 강의 캘린더/운영 보드에서 과정 단위 참고 정보를 읽습니다.
- `readCalendarEvents()`: OM별 강의 일정, 부재 일정, 주변 일정 판단에 필요한 이벤트를 읽습니다.
- `readDiscussionReferences()`: 과정 상세에서 보여줄 논의 링크를 읽습니다.
- `readSalesRecords()`: 코스ID/기업/과정/매출 참고값을 읽습니다.

모든 메서드는 `SourceReadResult<T>`를 반환합니다.

- `status`: `disabled`, `ok`, `partial`, `failed`.
- `readAt`: 읽기 시각.
- `items`: 정규화된 읽기 결과.
- `issues`: 누락, 권한, 매핑 실패처럼 사람이 확인해야 할 문제.

## 비공개 reader 연결 방식

비공개 런타임 패키지나 보안 작업 공간의 모듈은 `createOperationSourceReader()`를 export합니다.

```ts
export function createOperationSourceReader() {
  return {
    readCourseBoard,
    readCalendarEvents,
    readDiscussionReferences,
    readSalesRecords
  };
}
```

배포 환경에서는 `OPERATION_SOURCE_READER_MODULE`에 해당 모듈명을 설정합니다. 설정하지 않으면 기본 disabled reader가 빈 결과를 반환합니다.

## Slack 논의 읽기 설정

운영 상세페이지의 Slack 논의 영역은 같은 팀의 운영논의 채널에서 과정 기간 주변 메시지를 읽고, 후보 메시지의 스레드 replies를 확인한 뒤 기업명과 OM/LD 참여 조합을 기준으로 매칭합니다. 화면에는 부모 메시지보다 스레드 본문을 우선 표시합니다. 저장소에는 실제 토큰이나 워크스페이스 정보가 들어가지 않아야 합니다.

- `SLACK_BOT_TOKEN`: 지정 채널의 메시지와 스레드를 읽을 Bot token입니다. 기본 방식이며 `channels:history` 또는 `groups:history` scope가 필요합니다.
- `SLACK_SEARCH_TOKEN`: Slack legacy search fallback에 사용할 User token입니다. 특정 채널 ID를 직접 읽는 방식에서는 필요하지 않습니다.
- `SLACK_DISCUSSION_AFTER_DATE`: 특정 날짜 이후만 검색할 때 사용합니다. 2026년 운영 논의를 보려면 `2026-01-01`로 설정합니다.
- `SLACK_DISCUSSION_CHANNELS`: 읽을 채널 ID를 콤마로 구분해 입력합니다. Bot token 방식에서는 `C...` 또는 `G...` 형식의 채널 ID가 필요합니다.
- `SLACK_DISCUSSION_TEAM_CHANNELS`: 팀별 운영논의 채널 ID를 지정합니다. 예: `1팀:C111,2팀:C222` 또는 `1팀:C111|C112,2팀:C222`. 값이 있으면 해당 과정의 `sourceTeam` 채널만 우선 읽습니다.
- `SLACK_DISCUSSION_COMPANY_ONLY_CHANNELS`: 기업명만으로 fallback할 0팀 운영논의 채널 ID입니다.
- `SLACK_REPORT_CHANNELS`: 강의보고 링크를 찾을 운영보고 채널 ID입니다.
- `SLACK_DISCUSSION_HISTORY_PAGE_LIMIT`: 채널별로 읽을 history 페이지 수입니다. 기본값은 5입니다.
- `SLACK_DISCUSSION_HISTORY_PAGE_SIZE`: history 1페이지당 읽을 메시지 수입니다. 기본값은 100입니다.
- `SLACK_DISCUSSION_LOOKBACK_DAYS`: `SLACK_DISCUSSION_AFTER_DATE`가 없을 때 오늘 기준 과거 며칠까지 검색할지. 기본값은 120일입니다.
- `SLACK_DISCUSSION_MAX_SEARCH_RESULTS`: 상세페이지 1건당 가져올 검색 결과 수입니다. 기본값은 8건입니다.
- `SLACK_DISCUSSION_THREAD_CANDIDATE_LIMIT`: 채널별로 replies를 확인할 최소 후보 메시지 수입니다. 기본값은 50건이며, 과정 기간이 길수록 최대 200건까지 자동 확장됩니다.
- `SLACK_DISCUSSION_THREAD_LIMIT`: 검색 결과 1건당 읽을 스레드 메시지 수입니다. 기본값은 20건입니다.
- `SLACK_DISCUSSION_WINDOW_MONTHS_BEFORE`: 과정 시작일 기준 몇 개월 전부터 Slack 메시지를 읽을지. 기본값은 3개월입니다.
- `SLACK_DISCUSSION_WINDOW_MONTHS_AFTER`: 과정 종료일 기준 몇 개월 후까지 Slack 메시지를 읽을지. 기본값은 2개월입니다.

Slack reader는 토큰이 없으면 비활성화됩니다. API rate limit을 피하기 위해 `RESOURCE_READ_CACHE_TTL_MS` 동안 과정별 검색 결과를 재사용합니다.

세부 매칭 기준은 `docs/operations/slack-discussion-matching.md`에서 관리합니다.

## Google Calendar 읽기 설정

Google Calendar는 서비스 계정 기반 읽기 전용 연결을 지원합니다. 실제 서비스 계정 이메일, private key, calendar ID는 저장소에 커밋하지 않고 배포/로컬 환경변수로만 관리합니다.

- `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`: Google Cloud 서비스 계정 이메일.
- `GOOGLE_CALENDAR_PRIVATE_KEY`: 서비스 계정 private key. 줄바꿈은 `\n`으로 넣을 수 있습니다.
- `GOOGLE_CALENDAR_IDS`: `calendarId|ownerName` 형식의 콤마 구분 목록.
- `GOOGLE_CALENDAR_LOOKBACK_DAYS`: 오늘 기준 과거 며칠까지 읽을지.
- `GOOGLE_CALENDAR_LOOKAHEAD_DAYS`: 오늘 기준 미래 며칠까지 읽을지.
- `GOOGLE_CALENDAR_ABSENCE_KEYWORDS`: 부재 일정으로 분류할 제목 키워드.
- `RESOURCE_READ_CACHE_TTL_MS`: 리소스 화면에서 Notion/Calendar 읽기 결과를 재사용할 시간입니다. 기본값은 300000ms입니다.

서비스 계정은 대상 캘린더를 읽을 수 있어야 합니다. 캘린더 공유 또는 도메인 위임 설정은 저장소 밖에서 관리합니다.

## Google Drive 후보 가져오기 설정

Google Drive는 운영 상세페이지에서 사용자가 명시적으로 누른 경우에만 읽습니다. 자동으로 운영 데이터를 덮어쓰지 않고, Drive 폴더/싱크업 문서/관련 파일에서 후보를 만든 뒤 사용자가 선택한 항목만 적용합니다.

- `GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL`: Google Drive 읽기용 서비스 계정 이메일. 비워두면 `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`을 재사용합니다.
- `GOOGLE_DRIVE_PRIVATE_KEY`: Google Drive 읽기용 private key. 비워두면 `GOOGLE_CALENDAR_PRIVATE_KEY`를 재사용합니다.

서비스 계정은 대상 Drive 폴더에 보기 권한이 있어야 합니다.

적용 정책:

- Drive 폴더 ID는 연결 기준으로 사용합니다.
- 운영 건에 Drive 링크가 없으면 상세페이지에서 Drive 폴더 URL을 직접 연결합니다.
- 폴더명에서 추출한 기업명/과정명은 1차에서는 참고 후보로만 표시합니다.
- 링크, 강사, 교육장소, 교육시간, 비용, 메모 후보는 사용자가 항목별로 적용합니다.
- 일정, 금액, 운영 이슈처럼 영향이 큰 값은 `검토` 신뢰도로 표시합니다.
- 기존 메모형 필드는 덮어쓰기 대신 뒤에 추가하는 후보를 지원합니다.

세부 폴더 매칭, 문서 우선순위, 필드 매핑 기준은 `docs/operations/google-drive-operation-import.md`에서 관리합니다.

## 매핑 규칙

- 화면 컴포넌트는 외부 원천 타입을 직접 사용하지 않습니다.
- 외부 reader 결과는 repository/adapter 레이어에서 `OperationSession` 또는 DB staging 구조로 매핑합니다.
- 매핑 실패 데이터는 버리지 않고 `issues` 또는 `validationErrors`로 남깁니다.
- 자동으로 확정할 수 없는 고객사명, 담당자명, 과정명은 검토 대상으로 둡니다.
- 실제 운영 DB에 쓰기 전에는 import run, source record, validation 결과를 먼저 확인합니다.

## 완료 기준

읽기 연동을 완료했다고 보기 위한 최소 기준은 아래와 같습니다.

- 연동이 꺼진 환경에서 앱이 깨지지 않고 빈 결과를 반환합니다.
- 원천별 읽기 실패가 앱 전체 장애로 번지지 않고 `issues`로 남습니다.
- `/api/source-reads/status`에서 원천별 읽기 상태와 개수만 확인할 수 있습니다.
- 실제 원천 값이 화면 컴포넌트에 직접 새지 않습니다.
- 공개 저장소에 민감 정보나 실제 데이터 예시가 남지 않습니다.
