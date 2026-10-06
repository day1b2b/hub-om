# 독립 critic 검증 기준

Anscombe의 bc77a12 코드/clarify/plan 정적 검토: 설계 적합, 실행미판정.

- M1 context없음PG/명시서비스누락실패/기본DB차단/병렬·중첩격리. 실제page admin guard와 세션email전달.
- M2 예약email HMAC+원문exact(case/space), active cancellednull, confirmedlink cancelled무관, null제외와 nonnull손상failclosed 분리.
- M3 TeamUser createdAtdesc/normalizedemail첫일치/role무관, hiredByText원문contains후split정규화. 공백·대소문자·이름부분문자열·동명이인한계.
- M4 예약coach보존/linked우선engagement dedup/softdeleted코치포함/slot cancellednull/정렬·라벨·최소최대·partition. 공유pure함수외 독립기대값.
- M5 각메서드 snapshot 관계조회에동일session. 중간동시변경에도일관. 두page호출전체원자성요구X.
- M6 실제PG/Mongo동등성/다중page/키누락·변조/HMAC후원문확인/관계유실/scan한도·timeout실패, 부분반환·오류평문없음.
- M7 전체test/type/lint/build 및 영향회귀, 독립리뷰. skip/미실행별도. docs/featurepush/SHA/소유DB정리는인계조건.

예약이메일분리는필수. 동명이인 이름기반과정중첩·동률조회순서·PG컬럼선택대비Mongo전체문서scan한도차이는기존/명시한계이며 새권한정책을 추가하지 않는다. tokenbackfill/운영전환은별도.
