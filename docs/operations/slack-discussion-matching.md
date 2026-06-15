# Slack 논의 매칭 기준

이 문서는 운영 상세페이지의 `운영 논의` 영역에 어떤 Slack 스레드를 보여줄지 정리한 운영 기준입니다.
관리자/매니저가 기준을 조정할 때 이 문서를 먼저 확인합니다.

## 목적

과정 운영에서 중요한 논의는 Slack 스레드 안에서 많이 발생합니다.
상세페이지의 운영 논의 영역은 과정과 관련된 운영논의 스레드를 빠르게 열어볼 수 있게 하는 것이 목적입니다.

## 읽는 Slack 범위

- 기본적으로 `SLACK_DISCUSSION_TEAM_CHANNELS`에 설정된 같은 팀 운영논의 채널만 봅니다.
- 과정의 `sourceTeam`이 `1팀`이면 1팀 채널, `2팀`이면 2팀 채널을 우선 읽습니다.
- 팀별 채널 설정이 없으면 `SLACK_DISCUSSION_CHANNELS` 전체를 fallback으로 읽습니다.

예시:

```env
SLACK_DISCUSSION_TEAM_CHANNELS="1팀:C1111111111,2팀:C2222222222"
```

팀별 채널이 여러 개면 `|`로 묶습니다.

```env
SLACK_DISCUSSION_TEAM_CHANNELS="1팀:C1111111111|C1111111112,2팀:C2222222222"
```

기업명만으로 fallback할 채널은 0팀 운영논의 채널에 한정합니다.

```env
SLACK_DISCUSSION_COMPANY_ONLY_CHANNELS="C0000000000"
```

운영보고 채널은 Slack 논의와 별도로 설정합니다.

```env
SLACK_REPORT_CHANNELS="C3333333333"
```

## 읽는 기간

과정 기간을 기준으로 Slack history를 읽습니다.

- 시작일 기준 3개월 전부터
- 종료일 기준 2개월 후까지

설정값:

```env
SLACK_DISCUSSION_WINDOW_MONTHS_BEFORE="3"
SLACK_DISCUSSION_WINDOW_MONTHS_AFTER="2"
```

## 기본 매칭 조건

Slack 스레드 전체 본문과 참여자를 기준으로 판단합니다.
부모 메시지만 보지 않고 replies를 함께 읽습니다.

기본적으로 아래 조건을 모두 만족해야 합니다.

1. 같은 팀 운영논의 채널에 있는 스레드입니다.
2. 스레드 본문에 기업명이 들어갑니다.
3. 스레드 작성자/멘션/본문 기준으로 OM과 LD가 모두 확인됩니다.

과정명은 필수 조건이 아닙니다.
운영논의에서는 과정명이 정확히 적히지 않는 경우가 많기 때문입니다.

## fallback 기준

기간이 임박했거나 이미 진행 중인 과정은 관련 Slack 스레드가 하나도 없는 것이 이상한 경우가 많습니다.
그래서 정확 매칭 결과가 없으면 fallback을 사용합니다.

fallback 대상 과정:

- 시작일이 오늘 기준 90일 이내입니다.
- 또는 이미 진행 중이며 종료 후 30일이 지나지 않았습니다.

fallback 조건:

- `SLACK_DISCUSSION_COMPANY_ONLY_CHANNELS`에 지정된 0팀 운영논의 채널에서
- 기업명이 들어간 스레드 중
- 관련도가 가장 높은 스레드 1개를 보여줍니다.

관련도는 기업명, 과정명 일부, OM/LD 이름, 스레드 replies 여부를 함께 봅니다.

같은 팀 운영논의 채널에서는 기업명-only fallback을 적용하지 않습니다.

## 운영보고 매칭 기준

운영보고 채널은 `운영 논의` 영역이 아니라 `자료 링크`의 `강의보고` 링크로 표시합니다.

운영보고 매칭 조건:

1. `SLACK_REPORT_CHANNELS`에 지정된 운영보고 채널을 읽습니다.
2. 스레드 전체 본문에 과정명 주요 조각이 들어갑니다.
3. 스레드 전체 본문에 강사명이 들어갑니다.

운영보고 링크는 Slack `chat.getPermalink`로 만든 실제 Slack 웹 링크입니다.

## 화면 표시

상세페이지에는 운영 논의로 매칭된 스레드를 표시합니다.
엑셀 import 기록, 운영 건 생성 기록, DB 변경 이력은 표시하지 않습니다.

각 Slack 항목에는 아래 정보를 보여줍니다.

- 기업명과 논의 주제로 만든 제목
- 발생 시각
- 최종 내용/핵심만 정리한 구조화 요약
- `Slack에서 열기` 링크

`Slack에서 열기`는 Slack `chat.getPermalink`로 만든 실제 Slack 웹 링크입니다.
화면에는 `<@U...>` 같은 Slack 내부 사용자 ID를 그대로 보여주지 않고, `users.info`로 확인한 사용자 이름으로 치환합니다.
원문은 Slack 바로가기에서 확인할 수 있으므로 상세페이지에는 원문 일부를 따로 노출하지 않습니다.
요약은 가능한 경우 `요지`, `결론`, `후속`, `맥락`으로 나누어 보여줍니다.
`SLACK_DISCUSSION_AI_SUMMARY_ENABLED=true`와 `OPENAI_API_KEY`가 설정되어 있으면 Slack 스레드 본문을 AI로 요약합니다.
AI 요약은 원문을 그대로 인용하지 않고, 과정 운영자가 바로 판단할 수 있도록 이슈/결론/후속 조치 중심으로 정리합니다.
AI 요약이 꺼져 있거나 실패하면 키워드 기반 fallback 요약을 사용합니다.

## 주요 환경변수

```env
SLACK_BOT_TOKEN="xoxb-..."
SLACK_DISCUSSION_TEAM_CHANNELS="1팀:C1111111111,2팀:C2222222222"
SLACK_DISCUSSION_COMPANY_ONLY_CHANNELS="C0000000000"
SLACK_DISCUSSION_CHANNELS=""
SLACK_REPORT_CHANNELS="C3333333333"
SLACK_DISCUSSION_WINDOW_MONTHS_BEFORE="3"
SLACK_DISCUSSION_WINDOW_MONTHS_AFTER="2"
SLACK_DISCUSSION_HISTORY_PAGE_LIMIT="5"
SLACK_DISCUSSION_HISTORY_PAGE_SIZE="100"
SLACK_DISCUSSION_THREAD_CANDIDATE_LIMIT="50"
SLACK_DISCUSSION_THREAD_LIMIT="20"
SLACK_DISCUSSION_MAX_SEARCH_RESULTS="8"
SLACK_DISCUSSION_AI_SUMMARY_ENABLED="true"
SLACK_DISCUSSION_AI_SUMMARY_MODEL="gpt-4o-mini"
SLACK_DISCUSSION_AI_SUMMARY_TIMEOUT_MS="8000"
OPENAI_API_KEY="..."
OPENAI_BASE_URL="https://api.openai.com/v1"
```

## Slack 권한

Bot token 방식 기준으로 아래 권한이 필요합니다.

- 공개 채널: `channels:history`
- 비공개 채널: `groups:history`
- 작성자/멘션 이름 확인: `users:read`

봇은 대상 운영논의 채널에 초대되어 있어야 합니다.

## 조정 포인트

너무 적게 잡히면:

- `SLACK_DISCUSSION_THREAD_CANDIDATE_LIMIT`을 늘립니다.
- `SLACK_DISCUSSION_HISTORY_PAGE_LIMIT`을 늘립니다.
- 기간을 넓히려면 `SLACK_DISCUSSION_WINDOW_MONTHS_BEFORE/AFTER`를 늘립니다.

너무 많이 잡히면:

- fallback 조건을 더 엄격하게 조정합니다.
- 기업명 토큰 정규화 기준을 강화합니다.
- 팀별 채널 설정이 정확한지 확인합니다.
