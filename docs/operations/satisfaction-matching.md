# 만족도 매칭 기능 보관 및 재활성화

## 1. 현재 상태

만족도 매칭은 당장 사용하지 않지만 나중에 재사용할 수 있도록 구현을 보존한다.
`SATISFACTION_MATCHING_ENABLED`가 정확히 `true`일 때만 활성화되며, 미설정·빈 값·`false`는 모두 비활성화다.

- 비활성화 시 관리자 사이드바에서 메뉴가 보이지 않는다.
- `/admin/satisfaction-preview` 페이지는 404를 반환한다.
- `/api/admin/satisfaction/preview`, `/apply`, `/link`는 Google API 호출이나 업무 데이터 조회·저장 전에 404를 반환한다.
- 다시 켠 경우에도 페이지와 세 API는 관리자만 사용할 수 있다. 관리자가 아닌 API 요청은 403을 반환한다.

로그인하지 않은 요청은 앱의 기존 인증 처리에 의해 로그인 화면으로 이동할 수 있다.
비활성화는 데이터 삭제가 아니며 기존 만족도 값, 화면 구현, 매칭·반영 로직과 테스트를 유지한다.

## 2. 영향받지 않는 기능

- 운영 화면의 만족도 표시와 만족도 분석기 연결
- 분석기에서 호출하는 `/api/satisfaction/round-apply` 회차 단위 반영
- Google Calendar 교육 일정 반영과 초대
- 사용자 OAuth 기반 Google Sheets 가져오기 API
- Google 로그인에서 요청하는 OAuth 범위 및 B2B 계정 자격증명

이 설정은 위 세 API와 매칭 화면만 제어한다. 기존 점검용 `scripts/dry-run-satisfaction-sheet.ts`를
수동 실행하는 것까지 막지 않으므로, 이 스크립트는 별도의 명시적 점검이 필요할 때만 실행한다.

## 3. 나중에 다시 사용할 때

**3-1. 목적과 데이터 접근 범위 확인**

이 화면은 로그인한 직원의 Google 권한이 아니라 서버에 연결한 B2B 공용 계정 권한으로 시트를 읽는다.
직원 개인별 접근으로 바꾸려면 단순히 설정을 켜는 것으로 끝나지 않고 인증 경로를 변경해야 한다.
공용 계정에는 업무에 필요한 시트만 공유하고, 입력할 시트가 승인된 업무 자료인지 먼저 확인한다.

**3-2. 관리자와 연동 설정 확인**

- `ADMIN_EMAILS`에 사용할 회사 관리자 계정이 지정되어 있어야 한다.
- `GOOGLE_CAL_OAUTH_CLIENT_ID`, `GOOGLE_CAL_OAUTH_CLIENT_SECRET`, `GOOGLE_CAL_OAUTH_REFRESH_TOKEN`을 사용한다.
- 해당 B2B 토큰에 Sheets 읽기 권한이 있어야 하고 대상 시트에도 접근할 수 있어야 한다.
- `SATISFACTION_SHEET_URL`, `SATISFACTION_SHEET_TAB`을 기본값으로 설정하거나 화면에서 입력한다.
- 직원 계정으로 다시 로그인하는 것만으로는 B2B 계정의 시트 접근 권한이 바뀌지 않는다.

실제 비밀값은 배포 환경에서 관리한다. 이 문서나 저장소에 적지 않는다.

**3-3. 설정 및 배포**

배포 환경에 `SATISFACTION_MATCHING_ENABLED=true`를 설정하고 앱을 재시작하거나 재배포한다.
브라우저를 새로고침한 뒤 관리자에게만 메뉴가 나타나는지 확인한다.
기능을 다시 닫으려면 값을 `false`로 바꾸거나 제거하고 재시작·재배포한다.

**3-4. 재사용 전 검증**

- 테스트 시트로 미리보기, 자동 반영, 수동 연결을 확인한다.
- 모호한 매칭이 자동 반영되지 않고 기존 만족도 값이 덮어써지지 않는지 확인한다.
- 일반 회사 계정은 페이지·API에 접근할 수 없는지 확인한다.
- 실제로 재사용할 기능에 맞춰 공개 설명과 Google 인증 제출 자료를 점검한다.
- 꺼진 기능을 현재 제공 중인 기능처럼 심사 영상이나 권한 요청 사유에 넣지 않는다.

관련 회귀 테스트(실제 Google API와 운영 DB를 호출하지 않음):

```sh
node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/auth/satisfactionMatchingAccess.test.ts src/lib/data/satisfactionSheet.test.ts src/lib/data/satisfactionApplyPlan.test.ts src/lib/data/satisfactionRoundApply.test.ts
```
