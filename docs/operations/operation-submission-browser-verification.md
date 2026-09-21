# 신규 등록 암호화 재개 검증

검증일: 2026-09-21. 제품 source freeze 이후 추가 제품 코드 변경 없음.

## 구현 범위

- 신규 등록 버튼을 누르는 시점의 submission snapshot을 암호화 IndexedDB에 transaction commit한 뒤 요청한다. 제출 전 폼 자동저장 기능은 아니다.
- opaque owner, Google subject, runtime generation으로 복원·요청·정리를 제한한다. API도 기대 subject를 실제 인증 session과 비교하고 조회·쓰기 전에 불일치를 거부한다.
- 같은 submission의 `id:index`, 본문, 순서를 재사용한다. 서버 F1 멱등 등록 및 회차 생성·Calendar replay 억제를 연결했다.
- CAS revision은 메모리에서만 관리한다. 다른 탭이 변경한 snapshot은 덮어쓰거나 삭제하지 않는다.
- 기존 sessionStorage 평문은 key 이름만 검사한다. 자동 읽기·계정 귀속·삭제를 하지 않는다.
- CSV 양식은 지역/실제교육일을 포함한 8열이며 셀 escaping을 적용한다.

## 실제 브라우저 관찰

`scripts/draft-product-fixture`를 41876 포트의 독립 origin에서 실행했다. 실제 OperationCreateForm, Providers, BrowserDraftProvider, browserDraftRuntime, WebCrypto, native IndexedDB를 사용했다. 로그인·키 발급·업무 API·navigation만 합성 fixture이다. 운영 DB/OAuth/실제 계정/개인정보는 사용하지 않았다.

1. 가상 A 계정에서 실제교육일이 서로 다른 두 회차를 입력했다. 과정명에는 평문 검출용 합성 문자열을 넣었다.
2. 첫 생성 commit 직후 응답 socket을 끊었다. UI는 입력을 잠그고 원래 등록 계속하기를 표시했다. fixture 통계는 attempts 1, created 1이었다.
3. 영속 저장 검사에서 records 1, plaintextMarkerPresent false, rawKeyPresent false, localOnlyLockMarker true, sessionStorageEmpty true를 확인했다.
4. 페이지를 새로고침하면 로그인 안내만 보였다. 가상 B 로그인에서도 등록 내용이 나타나지 않았다. 가상 A로 돌아오자 원래 과정·2회차·실제교육일이 복원됐다.
5. 원래 등록 계속하기로 재개했다. attempts 3, created 2였으며 첫 receipt의 key/body는 그대로이고 두 번째 receipt는 같은 submission ID의 index 1이었다. 중복 생성 없이 `/operations/fixture-1?team=team_1` 이동 요청을 확인했다.
6. 성공 후 영속 저장 records 0을 확인했다. fixture navigation은 URL 표시만 하므로 화면의 등록 중 상태는 실제 라우팅 완료 UI 검증으로 해석하지 않는다.
7. 같은 native IndexedDB를 사용하는 두 runtime의 동시 CAS 검사에서 atomicOneWinner, staleDeleteRejected, latestPreserved, latestRevisionMatches가 모두 true였다.

CAS 검사 첫 시도는 다른 포트 fixture의 계정 쿠키 변경과 겹쳐 완료되지 않았다. 쿠키는 포트별로 격리되지 않으므로 A 로그인으로 일치시킨 뒤 재검사하여 위 결과를 얻었다. 제품 source 변경은 필요하지 않았다.

브라우저 원문 증거: [재개 DOM 기록](../../.claude/plans/browser-draft-integration/submission-replay-dom.txt), [CAS DOM 기록](../../.claude/plans/browser-draft-integration/submission-cas-dom.txt). 합성 정보만 포함한다.

## 자동 검증과 독립 검토

- 담당 단위 테스트 51/51 통과: submission/helper/store/template 13, 실제 TSX UI fixture 9, creation routes/Prisma/Calendar/drive apply 29. 로그 `/tmp/browser-submission-final-tests.log`.
- UI 테스트는 암호화 commit 전 POST 0, quota·read 실패 시 입력 보존, 정확한 재시도, epoch/subject 변경, legacy key-only 탐지, CAS 저장·정리 충돌을 포함한다.
- 독립 최종 코드 리뷰 승인. 기존 P2 다중 탭 덮어쓰기·삭제 결함 해결 확인, 신규 차단 결함 없음. 리뷰 담당 별도 표적 테스트 49/49 통과.
- `git diff --check` 통과. 전체 lint/typecheck/build/test 결과는 총괄 통합 보고서를 따른다.

## 검증 한계

실제 Google OAuth, 운영 PostgreSQL advisory lock 동시 실행, 운영 key 배포는 수행하지 않았다. 본 브라우저 검증의 새로고침은 문서 재로드이며 브라우저 프로세스 재시작은 아니다. 서버 프로세스 중단 상태의 기존 3폼 검증은 개인정보/runtime 담당 보고서를 따른다. 이번 범위에서 커밋·배포·push·merge는 수행하지 않았다.
