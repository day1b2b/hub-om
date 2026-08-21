# 운영현황 → 사이트·구글 캘린더 반영 — 구현 스펙

- **작성:** 2026-08-19 (이유진C + Claude)
- **상태:** 스펙 확정 · 착수 대기 (작업명령 시 이 문서 기준으로 구현)
- **한 줄:** 운영현황에 강의 일정이 생기면 사이트(과정 캘린더·내 대시보드)와 구글 캘린더에 자동 반영한다. 운영현황 = 유일 원본, 반영은 단방향·읽기전용.

---

## 1. 목표 & 원칙

운영현황(hub-om DB)에 강의 일정이 **등록/수정/취소**되면 → ①사이트 과정 캘린더 ②내 대시보드 ③구글 캘린더 세 곳에 반영.

**원칙 (반드시 지킬 것)**
- 모든 데이터 관리(생성/수정/삭제)는 **운영현황에서만**.
- 반영은 hub-om → 대상 **단방향**. 대상(구글 포함)에서 수정해도 **역반영 안 함**.
- 반영 대상은 전부 **읽기/수정 불가** 뷰여야 함.

---

## 2. 현재 코드 상태 (착수 전 확인 완료 2026-08-19)

- **과정 캘린더 `/resources`** (`src/app/resources/page.tsx`): **이미 운영현황을 읽어 표시**(operationRepository.listOperations + 외부 캘린더/노션 병합). → 반영은 이미 됨, **색상만 추가**하면 됨.
- **내 대시보드**: `src/features/dashboard/MyDashboard.tsx` (`/me`).
- **운영/세션 필드** (prisma schema, Operation/Session): `omName`(담당 OM), `onsiteOmName`(현장운영 OM), `onsiteRequired`, 날짜/시간/장소. → 두 역할 색 구분 데이터 이미 있음.
- **멤버**: `TeamUser`(team_users) name/email/slackId/team/role — OM 이름→이메일 조회 가능(`listTeamUsers()`).
- **구글 연동(현재)**: 읽기 전용 **서비스계정**(`src/lib/coaches/googleServiceAccount.ts`, `src/lib/sourceReads/googleCalendarSourceReader.ts`, scope=`calendar.readonly`). **쓰기는 신규.**

---

## 3. 확정 결정 (D1~D5)

| # | 결정 |
|---|---|
| D1 색상 | 담당 OM == 현장운영 OM → 🟢 초록(기본/과반). 다르면 → 🟠 주황. (**사이트 캘린더 한정**) |
| D2 내 대시보드 | 로그인 사용자가 **담당 OM이거나 현장운영 OM인 일정만**(내 것만) |
| D3 구글 참석자 | **담당 OM + 현장운영 OM 둘 다** 초대 |
| D4 취소 | 이벤트 **삭제** |
| D5 방식 | **B2B 전용 구글 계정 OAuth로 "초대(attendee)"**. 서비스계정 아님(초대 위해). 개인 캘린더에 뜨고, 주최자=B2B라 참석자는 수정 불가 |

> D5 배경: 서비스계정은 도메인 전체 위임(DWD) 없이는 참석자 초대 불가(구글 정책). 그래서 **B2B 실제 계정 OAuth** 채택 → 관리자 DWD 불필요, 초대·수정불가 둘 다 충족.

---

## 4. 신규 작업 A — 사이트 캘린더 색상

- 과정 캘린더 + 내 대시보드 이벤트 색:
  - `omName === onsiteOmName` (또는 현장운영 없음+담당만) → **초록**
  - `omName !== onsiteOmName` (서로 다른 사람) → **주황**
- **내 대시보드 필터**: 로그인 이메일 == 담당 OM 또는 현장운영 OM (이름/이메일 매칭)인 세션만.
- 범례 표시: 초록=담당·현장 동일 / 주황=담당≠현장.

---

## 5. 신규 작업 B — 구글 캘린더 쓰기(초대)

### 인증
- **B2B 전용 구글 계정 OAuth** (refresh token 방식). 기존 서비스계정 JWT와 **별개 경로**로 추가.
- env: `GOOGLE_CAL_OAUTH_CLIENT_ID` · `GOOGLE_CAL_OAUTH_CLIENT_SECRET` · `GOOGLE_CAL_OAUTH_REFRESH_TOKEN`
- scope: `https://www.googleapis.com/auth/calendar`
- refresh token → access token 갱신 유틸.

### 반영 단위·위치
- **회차(session) 1건 = 구글 이벤트 1건.**
- 이벤트는 **파트 캘린더**(B2B 계정 소유)에 생성. env 매핑: `GOOGLE_CAL_PART_CALENDARS="1파트:calId,2파트:calId,3파트:calId"`
- **참석자(attendees)** = 담당 OM 이메일 + 현장운영 OM 이메일(`TeamUser`에서 이름→이메일). `sendUpdates=all`.
- **주최자 = B2B 계정** → 참석자는 세부 수정 불가(= "수정 불가" 충족).

### 트리거·동작
- **생성** → `events.insert` → 반환 `eventId` 저장.
- **수정**(날짜/시간/장소/OM 변경) → `events.patch`. 담당/현장 OM 바뀌면 attendees 갱신.
- **취소/삭제** → `events.delete`.

### 매핑 저장 (신규 DB)
- `session.id → { calendarId, eventId }`. (Operation/Session에 필드 추가 또는 신규 매핑 테이블 + 마이그레이션)

---

## 6. 엣지 케이스 / 주의

- OM 이메일 없으면 해당 참석자 스킵(방어) + 로그.
- 현장운영 미정/없음: 색은 **초록**(담당만), 참석자는 담당 OM만.
- 구글 API 실패: 재시도 + 로그, **운영현황 저장은 실패시키지 않음**(부수작업 격리 — `src/app/api/om-request/route.ts`의 "저장 성공 후 부수작업 try/catch" 패턴 참고).
- 다회차 대량 생성 시 rate limit → 배치/간격.
- 삭제 시 매핑도 정리.
- 파트 캘린더를 OM이 구독하면 초대분과 중복 표시 가능 → 구독 정책 안내(파트 캘린더=조망용, 개인은 초대분).

---

## 7. 착수 순서 (권장)

1. **DB**: `session ↔ {calendarId, eventId}` 매핑 + 마이그레이션.
2. **구글 OAuth 쓰기 유틸**: refresh→access, `events.insert/patch/delete`.
3. **매핑 config**: 파트→calendarId(env), OM이름→email(`TeamUser`).
4. **반영 훅**: 운영현황 write 경로(생성/수정/취소)에 이벤트 반영 연결.
5. **사이트 색상**: 과정 캘린더 + 내 대시보드(필터+색).
6. **검증**: B2B 계정으로 생성→담당/현장 OM 개인 캘린더 초대 확인 / 수정→반영 / 취소→삭제 / 참석자 수정불가 확인.

---

## 8. 사람(유진님) 준비물 체크리스트

**2026-08-21 전부 완료.** 아래는 완료 기록.

- [x] B2B 전용 구글 계정 생성
- [x] 파트 캘린더 3개 생성 + B2B 계정 소유/편집 (3개 모두 `owner` 권한 확인)
- [x] Google Cloud OAuth 클라이언트(client id/secret) — 프로젝트 `hub-om-calendar`
- [x] B2B 계정으로 OAuth 동의 1회 → refresh token → Coolify env
- [x] 파트→calendarId env 값 채우기 (`GOOGLE_CAL_PART_CALENDARS`)
- [x] Coolify 재배포로 env 반영 확인

### 세팅 중 걸렸던 것 (재작업 시 참고)

- 브라우저 기본 계정이 회사 계정이면 GCP 콘솔·OAuth Playground가 조직 정책에 막힌다. 콘솔 URL에 B2B 계정의 `authuser` 파라미터를 붙여서 접근한다.
- 동의 화면을 **내부**로 만들면 `403 org_internal`이 난다. B2B 계정이 개인 Gmail이라 자동 생성된 조직의 구성원이 아니기 때문. **외부**로 설정해야 한다.
- 외부 + `테스트 중` 상태면 **refresh token이 7일 후 만료**된다. 반드시 **프로덕션 게시**까지 해야 한다.
- 프로덕션 게시 조건은 앱 이름·지원 이메일·**홈페이지 URL**·**개인정보처리방침 URL**·승인된 도메인이다. hub-om의 `/privacy`·`/terms`와 서비스 도메인으로 충족했다. 구글 심사(verification)는 동의 계정이 B2B 하나뿐이라 불필요하다.
- OAuth Playground는 리디렉션이 회사 계정으로 돌아가 실패한다. 클라이언트에 `http://localhost` 리디렉션을 추가하고 로컬에서 코드를 받아 교환하는 편이 확실하다.

---

## 9. 관련 자료

- 담당 OM/이메일·파트 매핑 재사용: OM 슬랙 알림 기능(env `SLACK_OM_REQUEST_*`), `TeamUser`.
- 이전 타당성 검토: 서비스계정 초대 불가(DWD 필요) → B2B OAuth 채택으로 회피.
- 배포 흐름: feature 브랜치 → dev PR → 머지 → dev→main 승격 PR → Coolify(자동배포 webhook).
