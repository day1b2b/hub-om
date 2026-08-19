# 강의 종료 후 담당 OM DM 알림

회차가 끝난 뒤 담당 OM에게 Slack **개인 DM**으로 마무리 알림을 보낸다. 채널 알림이 아니라 담당자 본인에게만 간다.

- **D+1(종료 다음 날)**: 강의관리 시트·만족도 중 아직 등록되지 않은 항목 안내.
- **D+7(종료 1주일 후)**: 아직 등록되지 않은 항목 + 운영 회고 작성 안내.

## 보내는 기준

| 항목 | 판정 기준 | 화면 위치 |
| --- | --- | --- |
| 강의관리 시트 | 회차의 `lectureManagementNote` 값이 비어 있지 않으면 등록됨 | 운영 상세 > 회차 정보 |
| 만족도 | 회차의 `avgSatisfaction` 값이 비어 있지 않으면 등록됨 | 운영 상세 > 회차 정보 |
| 운영 회고 | 회차의 회고(`operationIssue`) 값이 있거나 운영 상태가 `회고완료`면 작성됨 | 운영 상세 > 이슈 / 회고 |

- 등록/작성 판정은 아카이빙 완료 조건(`operationCalculations.isArchiveComplete`)과 같은 "값이 비어 있으면 미등록" 규칙을 쓴다. 다만 이 알림은 OM이 직접 채우는 위 세 항목만 보고, 코스ID·결과보고서는 보지 않는다.
- 남은 항목이 하나도 없으면 DM을 보내지 않는다.
- 날짜 판정은 한국 날짜(Asia/Seoul) 기준이며 회차 **종료일**을 본다.
- 수신자는 회차의 **담당 OM(`om`)** 이다. `이유진, 김정선`처럼 여러 명이면 각자에게 보낸다. 현장운영 OM(`onsiteOm`)과 LD는 받지 않는다.
- 담당 OM이 비어 있는 회차는 보낼 대상이 없어 건너뛰고, 미리보기 응답의 `unassignedSessions`에 남는다.
- 한 사람이 여러 회차에 걸려도 DM은 1건이며, D+1·D+7 항목을 한 메시지에 모아 보낸다.

DM 예시:

```text
:bell: *운영 마무리 알림* (26-08-19)
이유진님, 담당하신 과정 중 *아직 미입력된 항목*이 있어 안내드립니다!
아래의 링크에서 확인 후 데이터를 입력해주세요.


*:pushpin: 어제 종료된 회차* (D+1)
• *LG전자 / AI 리터러시 2회차* (종료 26-08-18)
   ◦ 미입력 : 강의관리 등록, 만족도 등록
   ◦ :point_right: <링크|사이트로 이동하기>


*:warning: 종료 1주일 경과 회차* (D+7 / 확인 필요!)
• *삼성SDS / 생성형AI 활용 3회차* (종료 26-08-12)
   ◦ 미입력 : 강의관리 등록, 운영 회고 작성
   ◦ :point_right: <링크|사이트로 이동하기>


확인 후 작성을 부탁드립니다.
```

문구는 `lectureFollowUpReminder.ts`의 `buildMessage`에 있다. Slack 이모지 이름은 영문만 되고(`:경고:` 같은 한글 이름은 글자 그대로 보인다), 줄 시작의 `*`는 목록이 아니라 굵게 표시 기호로 읽히므로 하위 항목은 `◦`를 쓴다.

## API

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | `/api/reminders/lecture-followup` | **미리보기.** 대상·문구·차단 사유만 돌려주고 DM은 보내지 않는다. |
| POST | `/api/reminders/lecture-followup` | **실제 발송.** |

권한은 두 가지 중 하나다.

- `Authorization: Bearer <SYNC_API_SECRET>` (서버-투-서버, 스케줄 작업이 사용)
- admin 세션 (`ADMIN_EMAILS`에 등록된 계정으로 로그인한 브라우저)

admin 계정으로 로그인한 브라우저에서 `https://hub-om.skillflo.app/api/reminders/lecture-followup` 을 열면 미리보기 JSON이 보인다. 브라우저로 여는 것은 GET이라 발송되지 않는다.

## 환경변수

| 변수 | 설명 |
| --- | --- |
| `SLACK_OM_REQUEST_BOT_TOKEN` (없으면 `SLACK_BOT_TOKEN`) | DM을 보내는 봇 토큰. 운영요청 알림과 같은 봇을 쓴다. |
| `SLACK_REMINDER_ONLY_EMAILS` | 시범 대상. 실제 DM을 받을 이메일만 쉼표로 적는다. **비우면 아무에게도 보내지 않는다.** 전원 발송은 `ALL`. |
| `REMINDER_MAX_DM_PER_RUN` | 1회 실행 발송 상한(기본 50). 넘으면 발송하지 않고 경고만 돌려준다. |
| `HUB_OM_BASE_URL` | DM 안의 회차 링크 주소. 비우면 `AUTH_URL`, 그다음 배포 주소를 쓴다. |
| `REMINDER_SENT_LOG_FILE` | 같은 날 중복 발송을 막는 로그 파일 경로. 비우면 OS 임시 디렉터리. |

Slack 앱 스코프는 `chat:write`가 기본이고, 워크스페이스 설정에 따라 DM 채널을 열 때 `im:write`가 추가로 필요할 수 있다. 미리보기에서는 정상인데 발송이 실패하면 앱 스코프에 `im:write`를 추가하고 재설치한다.

## 켜는 순서

1. **멤버 관리 확인.** `/admin/users`에서 담당 OM들의 Slack ID가 채워져 있는지 본다. 비어 있으면 미리보기에 `Slack ID 없음`으로 나오고 DM이 가지 않는다.
2. **미리보기.** admin 계정으로 위 GET URL을 열어 대상 회차·문구·차단 사유를 확인한다.
3. **시범 발송.** Coolify env에 `SLACK_REMINDER_ONLY_EMAILS`에 본인 이메일만 넣고 재배포한 뒤, 하루 정도 스케줄을 돌려 실제 DM을 받아 본다.
4. **전원 전환.** 문구가 확정되면 `SLACK_REMINDER_ONLY_EMAILS=ALL`로 바꾼다.

## Coolify 스케줄 작업

Coolify 앱 > **Scheduled Tasks**에 아래를 등록한다.

- Frequency: `0 1 * * *` — 컨테이너 시간대가 UTC면 이 값이 한국시간 오전 10시다. 작업 시간대를 `Asia/Seoul`로 지정할 수 있으면 `0 10 * * *`을 쓴다.
- Command:

```bash
wget -q -O - --header="Authorization: Bearer $SYNC_API_SECRET" --post-data="" http://127.0.0.1:3000/api/reminders/lecture-followup
```

이미지에 `wget`이 없으면 런타임인 node로 대체한다.

```bash
node -e "fetch('http://127.0.0.1:3000/api/reminders/lecture-followup',{method:'POST',headers:{Authorization:'Bearer '+process.env.SYNC_API_SECRET}}).then(r=>r.text()).then(console.log)"
```

## 중복 발송 방지

- `날짜|단계|회차|담당자` 키를 파일에 남겨 같은 날 두 번 실행돼도 같은 회차 DM이 두 번 가지 않는다. 로그는 14일치만 보관한다.
- 이 로그는 컨테이너 임시 디렉터리에 있어 재배포·재시작 시 사라진다. 그 경우 최악의 결과는 같은 날 DM 1회 중복이다. DB 테이블을 새로 만들지 않기 위한 선택이다.
- 발송 상한(`REMINDER_MAX_DM_PER_RUN`)을 넘으면 한 건도 보내지 않고 `ok: false`와 경고를 돌려준다.

## 코드 위치

- `src/lib/reminders/lectureFollowUpReminder.ts`: 대상 선정, 문구 생성, 발송.
- `src/lib/reminders/reminderDates.ts`: 한국 날짜 계산.
- `src/lib/reminders/reminderSentLog.ts`: 중복 발송 방지 로그.
- `src/lib/slack/notifySlack.ts`: `sendSlackDirectMessage`(DM 발송).
- `src/app/api/reminders/lecture-followup/route.ts`: 미리보기·발송 API.
