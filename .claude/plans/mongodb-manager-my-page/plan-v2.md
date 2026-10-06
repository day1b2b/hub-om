# 실행 계획 v2

1. [Core] bc77a12 기존 조건을 독립 fixture 기대값으로 고정한다. exact예약email과normalized명단email/원문contains후split이름비교를 구별한다. 취소여부와무관한확정link·예약coach우선·engagement중복제거·삭제coach포함을보존한다.
2. [Shell] PG adapter/interface/factory/coachManagerMyPage context·기존facade·pure DTO/group/partition 공유. 실제page는 기존함수호출로연결하고admin정책유지. tokenbackfill/스키마/의존성/원천/운영변경X.
3. [Core] Mongo read 한메서드 snapshot에예약/명단/투입/coach/slots 포함. 명단의createdAtdesc/normalizedemail첫이름/role무관 유지. HMACexact후복호화확인, substring은 bounded decoded scan. context누락PGfallback없음. 두page Promise.all메서드간원자성은추가하지않음.
4. [Check] actualpageauth/세션email/searchparams변경불가/병렬담당자분리/빈props/날짜분류. 동명이인과정중첩은기존모호성으로문서화하고새정책X.
5. [Check] 실제격리PG/Mongo동등성·고정기대값·키/변조/오류/저장암호화/101초과페이지·snapshot중간변경·부분반환없는한도/timeout. null연결제외와nonnull깨진연결Mongofailclosed별도. 동률/일반정렬/선택컬럼대비전체문서scan한도는한계구별.
6. [Check] 전체test/type/lint/build 및영향회귀·독립리뷰·지적보완. 새dbpath/loopback/env-i/임시키사용후소유자원정리. 문서/macro/coverage/featurecommit/push/SHA인계. 운영전체완료는별도.

수락은validation-v2기준, PASS/FAIL/NOTRUN구별. 이번setup은macOS PG locale오류로초기실패후 LC_ALL=C를고정해해결했으며실행로그보관.
