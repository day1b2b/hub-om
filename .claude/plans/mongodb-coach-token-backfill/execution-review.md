# 실행 검토 — 코치 접근 토큰 보완

기준 1a7323bf81108e1a7fe16196cba5b7a3c60c80a7. feature/20260929-mongodb-coach-token-backfill. CLI 기본 PG 및 기존 직접 주입 PG 함수 보존. 운영 적용이나 전체 이전 완료가 아니다.

## 실행 결과

환경: Node24.19.0, PG17.9 C locale, Mongo8.0.30 replica set, env-i·임시 키·합성 데이터. 로그 root /private/tmp/hub-om-token-backfill-20260929/logs.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 일반 전체 | 887 pass / 30 skip / 0 fail | unit.log |
| typecheck/build | PASS | typecheck.log/build.log, 최종 static exit0 |
| lint | 0 error / 기존7 warning | lint.log |
| 신규 native Mongo | 24 pass / 0 skip / 0 fail | native-review-final.log; 리뷰 보완 후 최종 재실행 |
| 실제 PG/Mongo 비교 | 5 pass / 0 skip / 0 fail | postgres-parity.log, 45 migration·274 coach·543 archive |
| 기존 포함 Mongo 전체 | 214 pass / 2 fail / 0 skip | mongo-bundle.log; 기존 투입 테스트의 부모+자식 같은 원인, exit1 |
| 해당 투입 테스트 수정 후 | 17 pass / 0 fail / 0 skip | engagement-fix.log; 같은 파일 lint/typecheck exit0 |

일반 검사에 포함된 command+기존PG단위14개 및 연결수명2개는 별도 합산하지 않는다. native24는 전체Mongo와 중복된다. 전체216개의 단일 실행은 실패했으며 기존 투입 테스트 관측 정렬 수정 후 해당17개를 재실행해 통과했다. 수정 후 전체 묶음 단일 실행 통과로 표현하지 않는다. native24의 raw필드/후행page실패 강화는 별도 native-review-final 로그로 확인한다. 일반 skip의 신규 native/PG는 위 별도 실행으로 확인했다. 기존 특수PG(activity/privacy/source ID/관리삭제/콘텐츠/manager 등), Calendar 잠금 검증은 이번 단위에서 별도 재실행하지 않았으며 PASS로 계산하지 않는다.

## B1–B10 근거

- B1/B2: 실제 CLI를 별도 프로세스에서 실행해 defaultdryrun·확인플래그·누락scope·실패문구/exit1·counts출력·env/PG tripwire 확인. PG defaultadapter는 mock연결성공/실패finally정리, 기존 직접PG함수는연결소유권유지. Mongo 실제 command service 주입 성공/재실행·env미접근. open readiness는검사만.
- B3/B4: 고정공유fixture와독립PG기대값. source/filter·completed정확case·최신null·빈/공백string·scalar/array/JSONnull·동률rowID·과거malformed건너뛰기. 실제251코치/502archive 경계와큰Coach/Archive문서의BSON짧은batch·빈EOF에서getMore0 관측. 설치driver의해당pipeline 검증이며모든aggregate서버응답에대한일반보장은아님.
- B5/B6: dryrun 전체raw데이터/시각/암호문/감사/collection불변. apply token/HMAC/updatedAt만변경, 삭제/비활성포함. 변경된 코치까지 세 필드를 제외한 모든 raw 필드/암호문 전후동일성을 비교했다. 재실행changed/updated0·감사/암호문byte불변. dryrun충돌값요약과apply유일성실패구분.
- B7: 실제두번째감사실패·중복token전체rollback, transient후전체재시도/집계초기화/중복감사없음. 실제251번째쓰기·감사후실패를주입해첫250건을포함한전체rawsnapshot원복도확인했다. 가상시계120초초과후실제쓰기원복, 첫attempt80초+retry50초에서도원래deadline거부·두abort관측. 실제120초대기/운영부하실험은아니며시계주입으로deadline분기를검증했다.
- B8: 저장raw암호화/HMAC, 선택필요nonstring4종고정오류, 암호화키/index키/HMAC/암호문변조실패와원복, redacted감사. activity없으면audit없음. 오류/CLI에원문없음.
- B9: 실제PG45migration/암호화wrapper/감사trigger와Mongo의summary·token·불변필드·rollback비교. mock수명검사와실제DB검사를구별한다.
- B10: 일반/type/lint/build PASS. 전체Mongo 실패원인 수정후 영향받은투입17개재검증PASS. 독립코드리뷰차단없음. 소유합성자원정리완료. featurepush/통합의최종SHA는handoff/종료보고로확인한다.

## 실패와 보완

1. 첫 static의 type/build는 subprocess 테스트 env의 NODE_ENV 필수 타입 누락으로 실패. 테스트 env에 test를 명시하고 최종 static 재통과. initial 로그 보존.
2. PG첫실행은공유/독립fixture가모두최종빈token을선택해정상시나리오에서unique충돌. 의도한빈token검사는공유fixture에유지하고독립fixture를공백token으로변경. 후속집계실패는전체rollback의연쇄였고생산코드결함으로판정하지않았다. 실패로그·history보존, 최종5pass.
3. native첫실행은기존subagent권한프로필의loopback EPERM으로실행불가. 메인의현재허용환경에서동일소유DB대상실행. 연결실패를기능실패/통과로혼동하지않음.
4. native-main20pass2fail은부모+자식동일원인: observer가admin DB의abortTransaction을놓쳤다. session ID로상관관계를추적해감사재시도관측을보완하고, 누적deadline/빈EOF를추가해24pass. assertion완화나업무코드변경은없음.
5. 독립리뷰에서후행page실패시첫page원복과변경코치의비토큰raw필드동일성증거가부족하다고지적했다. 기존테스트두개에assertion/실패주입을강화했고native24개·review-typecheck/lint재통과. 생산코드변경없으므로전체일반/build는불필요하게반복하지않았다.
6. 전체Mongo214pass2fail은기존투입테스트의natural order와실제_id scan순서불일치였다. 두번째감사실패대상이실제로첫번째가되는경우를실패로그에서확인했다. 해당테스트관측을simplecollation/_idasc로고치고첫감사실행·둘째거부·전체snapshot원복assertion은유지했다. 생산투입코드변경없음. 해당17개·lint/typecheck통과, 전체재실행은추가변경없어반복하지않았다.

## 독립 검토·한계

Gibbs 선행CLI 및Mongo 코드검토에서확정P0–P3결함없음. firstBatch공개API가모든서버응답에서getMore를금지하는것은아니므로현재pipeline의BSON짧은batch/빈EOF실행관측을필수로확인했다. B6/B7검증공백의보완후native24통과와테스트강화를확인했고, 기존투입테스트정렬수정도적합·검증약화없음으로판정했다. 수정후17개로그·최종문서·자원정리까지독립확인하여기능범위수락, 남은차단지적/중대한오표기없음으로최종판정했다. commit/push/총괄통합/운영적용은별도다.

소유Mongo의dbpath/replica set 이름과잔여합성DB0을확인하고Mongo/PG정상종료, /private/tmp/hub-om-token-backfill-20260929/{pg,mongo} 제거완료. 첫cleanup은Mongo종료중lock이남아삭제전에멈췄다. exitCode0·빈lock·PG종료를재확인했고, 강제삭제명령은도구에서거부되어force옵션없이정확한두소유경로만제거했다. 두디렉터리부재확인완료. 로그·run.sh·배포binary는다음검증을위해보관한다. cleanup.log참조.

실운영/Atlas/원천/키rotation/실제120초부하·네트워크지연/전체브라우저·OAuth/모든collation·규모는미검증. maintenance는외부사전조건이며전체archive writer직렬화를새로보장하지않는다. Mongo32MiB한도·서버정렬/transaction설정에따라큰데이터는부분적용없이실패할수있다. apply실패또는연결종료오류후에는상태확인후재실행한다. 운영복사·복원리허설·최종전환·브라우저초안암호화·dev→main은미완료/미실행.
