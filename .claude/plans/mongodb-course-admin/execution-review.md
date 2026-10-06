# 실행 검증

기준 d964cb2 → feature/20260929-mongodb-course-admin. Node24.19.0, PG17.9, Mongo8.0.30, env -i. 별도 dbpath /private/tmp/hub-om-course-admin-20260929, PG56619/Mongo27719, 합성자료·임시 키. 원본 workspace·운영·외부원천 접근 없음.

## 완료한 검사
- 일반 npm test: 888 pass /31 skip /0 fail. 당시 신규 native/PG 테스트파일 추가 전. 기존 특수DB opt-in과 신규handler skip을 성공으로 세지 않음.
- npm run typecheck/build 통과, lint 오류0·기존경고7. 추후 추가 테스트파일 정적검사는 별도.
- 실제handler+factory: 7pass/0skip/0fail. 실제admin guard·withActivity, 명시context, raw 개인정보, 감사실패rollback. 외부fetch/PG mock호출0.
- 실제PG45migration + 기존원본2query oracle + Mongo + handler/factory: course.log 14pass/0skip/0fail. 위handler와중복합산금지.
- UUID4자리hyphen·invalid/공백/짝없는braces/Int최소 추가후 PG단독 pg-final.log 7pass/0skip/0fail. 삭제범위·active수·재실행·actorNULL·암호문/HMAC·raw비관련필드·관계·실trigger 감사동등성 확인.

- 기존Mongo broad회귀: 222pass/0skip/0fail, mongo-bundle.log. mock4 포함, 신규handler6 포함. 다른묶음과합산하지않음.
- 신규native초기: 19pass/0skip/0fail, native.log. 실제writer barrier충돌·양쪽수정선행·개별삭제/과정이동선행, 201행paging, 실제BSON짧은batch, 32MiB제한, 가상15초/60초deadline, 고정오류/원복/readiness 확인.
- 추가PG/native테스트포함 typecheck-final/lint-final: PASS, 오류0·기존경고7.

## 최종 보강 결과
- 신규native최종 native-final.log: 23pass/0skip/0fail. 101번째실제감사쓰기후 동일tx내 101업무/101감사 확인한뒤실패→전체raw원복. 개별삭제/과정이동의양쪽선행충돌, 실제code112후가상40s+25s누적deadline으로 이번작업취소·승자수정보존.
- 독립 최종리뷰, 자원정리, commit/push/SHA와총괄통합은 별도후속기록.

Gibbs 초기 code리뷰: 새P0–P3결함 없음. V1추가UUID증거 요청은 pg-final.log로보완. 최종판정은 아래 독립리뷰를 따른다.

## 한계
실OAuth/브라우저 E2E·실데이터·외부원천·운영부하·운영전환·복원리허설 미실행. 시간이동 테스트는 실제60초대기/네트워크부하와구분한다. 전체writer직렬화·미래insert/유입세션일괄포함은보장하지않는다. schema/migration/dependency/생산selector 변경없음.

- 최종 일반검사(unit-final.log): 신규PG/native파일 포함 888pass/33skip/0fail. opt-in33skip은 실제DB별도검증과구분한다.
- 마지막 추가테스트 이후 typecheck-final PASS / lint-native-final 오류0경고0. 전체lint는앞서0error7기존warning. build 이후변경은테스트·문서뿐이어서동일build반복없음.

## 항목별 증거
| 항목 | 결과/근거 |
| --- | --- |
| V1 | PG7/handler6/factory1: 실제원본Prisma쿼리대조, UUID특수·오류/Int범위, admin/missing scope/응답 유지 |
| V2 | native lookup 및 transaction 코드: 관계동일snapshot, 회사부재고정오류; PG독립기대DTO동등 |
| V3 | PG/native raw비허용필드 byte동일, active만수정, 암호문/HMAC·관계보존 |
| V4 | native 실제writer barrier code112충돌·양쪽선행 update/delete/move/중복bulk, 재조회·유실/부활/중복감사없음 |
| V5 | handler 실제validator실패/2번째·101번째실감사쓰기후실패 전체원복, request로그실패성공유지 |
| V6 | 실제201행·BSONshort·32MiB거부, 가상scan15s/write60s/실충돌후누적65s테스트. 실제장시간네트워크·운영부하미검증 |
| V7 | 위회귀/static·실PG45migration·실Mongo8.0.30·독립기대값, skip별도표시 |
| V8 | 정리/push/통합 인계에최종기록 |

## 실행 명령·증거
로컬보존로그: /private/tmp/hub-om-course-admin-20260929/logs (운영자료없음).
- env -i ... /bin/bash /private/tmp/hub-om-course-admin-20260929/run.sh static / course / mongo
- Node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/courseAdminRepository.postgres.integration.test.ts
- 같은Node옵션 --test src/lib/data/mongoCourseAdminRepository.integration.test.ts
- npm test / npm run typecheck / npm run lint / npm run build; 추가native파일 ESLint.
출력대조는각로그의최종건수와exit0를확인했다. 초기read파일명2개오류는rg로정정, 초기도구호출인자 id→target 정정. 코드테스트실패는발생하지않았다. 후속검토보강만재실행했으며과거단위결과를이번결과로재사용하지않았다.

## 독립 최종 리뷰
Gibbs: 필수기능수락 PASS, 남은코드·기능검증차단지적 없음. V1–V8과native23/일반888·33skip/PG7/Mongo222 증거확인. 비차단문서지적(매니페스트 초기31skip/진행중 표기와macro누락)은 최종888/33skip 및단계상태·macro파일목록으로정정했다. 자원정리/push/통합은아래인계에별도확정한다. 운영완료판정아님.

## 소유 합성 자원 정리
getCmdLineOpts dbPath와hello replica이름을확인하고 남은합성DB0을확인했다. Mongo정상종료 및lock비움, PG fast종료/postmaster.pid제거 후 소유dbpath2개만제거했다. 두경로부재확인, cleanup.log exit0. 로그/실행스크립트는인계용으로보존했다. 운영/다른프로세스에는접근하지않았다.
