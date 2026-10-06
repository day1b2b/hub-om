# 독립 실행 검토 (최종)

계획/검증 v2 기준. 제품 코드 수정 없이 export/context/token/rotation 코드와 테스트·실행 로그를 검토했다. 아래 초기 기록의 대기 사항은 최종 판정 표에서 해소 여부를 구분한다. 전체 운영 전환은 완료가 아니다.

## 발견 사항

E1: export route가 UUID regex의 대소문자를 허용하면서 lowercase 정규화 없이 Mongo 문자열 _id 조회를 했다. 대문자 UUID는 PG uuid에선 같은 행이나 Mongo에서는 누락되며 혼합 case의 Set 중복 제거도 일치하지 않는다. 총괄에 유효 ID lowercase 후 dedup, uppercase/혼합 case 실제 route 반례를 요청했다. route의 lowercase→Set 수정과 대문자/중복 native 반례, `/tmp/hub-access-native-first.log`의 export+rotation 2 pass / 0 fail / 0 skip을 확인하여 E1은 해소했다.

## 현재 확인한 코드

- export 권한 guard가 repository 취득 전에 실행된다. missing shadow 서비스는 PG fallback 없이 실패한다.
- Mongo export는 snapshot transaction 안에서 Coach 선택→암호화 접근 감사→private profile 조회 후 commit 성공 시에만 반환한다. 후행 감사 실패에 선행 감사도 abort된다. PG adapter도 조회와 createMany 감사를 RepeatableRead transaction으로 묶었다.
- 공개 CSV 응답은 private,no-store이며 type별 열/BOM/quote/이름 정렬 계약을 유지한다. =/+/-/@ (trimStart 후) 또는 선두 tab/CR/LF는 apostrophe로 문자열 처리한다. +전화번호 변환은 의도된 보안 변경이다.
- 실제 native export suite는 합성 auth 세션과 실제 admin guard, 선택 밖/삭제 제외, type별 CSV, template 없음, 후행 감사 실패 후 log count 불변, missing provider를 검사한다.
- context 확장은 type-only 서비스 선언이며 외부 selector 추가가 아니다.

## 미검증/범위

최신 export 입력 검사·cache/template 반례 추가 후 재실행은 총괄 진행 중이다. 초기 5 pass 보고를 최신 코드 전체 통과로 세지 않는다. token 정확 비교/변조·본인 DTO·회전 원자성은 후속 파일 검토와 native 결과가 필요하다. 운영 PG query 실행, OAuth/UI, 실제 데이터/키/배포는 이 검토에 포함하지 않는다.


## token / rotation 후속 검토

E2: rotation route는 params.id를 그대로 Mongo 문자열 _id에 전달하여 대문자 UUID가 PG와 다르게 404가 된다. 유효 UUID lowercase 정규화와 형식 오류의 명시 HTTP 결과 및 혼합 case 반례를 담당자/총괄에 요청했다. token 원문 자체는 대소문자 정확 비교해야 한다.

추가 권고: me 및 rotation의 민감 응답에도 private,no-store를 명시한다. export에는 이미 적용했다.

Mongo token repository는 blind-index 후보를 복호화·HMAC 검증한 뒤 token exact equality를 재확인하며 deleted 코치는 거절한다. 상태 inactive/pending은 기존대로 유효하고 본인 DTO를 whitelist로 구성한다. 최신 completed snapshot과 정확한 schema/table/source id를 필터링한다. session 생성/종료까지 안전한 오류 경계에 포함했다. native 소스는 원문 token 없는 command predicate, read-only 명령, query 우선/Bearer fallback, DTO·로그 비노출, namespace 분리와 변조 반례를 포함한다. 이 파일의 최신 실행 결과는 별도 확인이 필요하다.

재발급은 live-row 조건으로 교체하며 token/index/ActivityChange가 같은 transaction이다. PG에도 deletedAt 조건을 update 자체에 추가하여 삭제 race에서 갱신하지 않는다. native-first 로그에서 unique token 충돌과 감사 실패 rollback 및 삭제 race 검사를 확인했다. 동시 재발급 둘의 최종 하나만 유효한 반례는 현재 보이지 않아 V10 검증 보완을 요청했다. root의 실제 세션 guard 회전→me 통합 검사는 작성 중이며 담당 mock 권한 검사와 구분한다.

## 최신 코드 및 실행 대조

E2는 인증 후 UUID 형식 검사(400)·lowercase 전달로 해소했고 실제 권한 guard를 유지한 root native 통합에서 대문자 UUID 회전→이전 lookup null/이전 me 401→신규 lookup 및 me 200을 확인한다. 삭제코치 404, request 로그 원문 token 없음도 검사한다. me 성공/401 및 rotation 성공/400/404에 private,no-store를 추가했다. 동시 재발급 두 응답 후 최종 저장 token 하나만 유효함을 확인하는 native 반례도 추가됐다.

리뷰어가 직접 읽은 총괄 실행 로그:
- `/tmp/hub-access-native-final.log`: 33 pass / 0 fail / 0 skip, 23398.080042ms. mock 4개 포함이며 모두 native라고 세지 않는다.
- `/tmp/hub-access-all-tests-final.log`: 840개 중 825 pass / 15 skip / 0 fail. 앞선 편집 중 실패를 최신 결과와 혼동하지 않는다.
- `/tmp/hub-access-type.log`: typecheck 성공.
- lint는 총괄이 오류 0·기존 경고 7로 보고했다. build는 진행 중이다.

검토자는 위 실행을 직접 기동하지 않았으며 제품 소스·테스트 반례와 완료 로그를 대조했다. 기존 E1/E2 및 추가 요청 반례는 해소됐고 남은 확정 코드 버그는 발견하지 않았다.

| 항목 | 판단 | 검증 범위 |
| --- | --- | --- |
| V1 | 통과 | query 우선, trim/Bearer fallback, 잘못된 query를 올바른 header로 덮지 않음. |
| V2 | 통과 | native blind-index predicate, 복호화/정확값 및 변조/누락/삭제 실패. |
| V3 | 통과 | 최신 완료 archive 및 schema/table/source 필터, 태그 DTO. 실제 PG query 비교는 mock 한계. |
| V4 | 통과 | 본인 whitelist, token 원문 없는 predicate/응답/로그, inactive/pending 기존 정책. |
| V5 | 통과 | 실제 admin guard+합성 auth 세션, 무권한·admin 설정 누락 거절. |
| V6 | 통과 | 이름 정렬, CSV BOM/quote/컬럼/빈값/template 및 수식 apostrophe 보완. |
| V7 | 통과 | ID lowercase/dedup, 삭제·없는 ID 제외, 형식·2만 고유 ID 상한400. |
| V8 | 통과 | 후행 batch 접근 감사 insert 거절로 선행 감사 rollback, CSV 비반환. |
| V9 | 통과 | 실제 회전 route 권한·삭제404, token/index 암호화, 원문 token 감사 비노출. |
| V10 | 통과 | unique 충돌·감사 실패 rollback, 의도된 읽기후 삭제 race, 동시 회전 최종 하나만 유효. 이미 인증된 진행 요청까지 취소하지 않음. |
| V11 | 통과 | scope factory와 getter guard, missing 서비스 실패/no-context PG 유지. |
| V12 | 통과 | 실제 handler/guard와 합성 auth 세션, native8/mock 분리. OAuth/생산UI/실제PGquery 검증 아님. |
| V13 | 통과 | 전체825 pass/15 skip, type-final/build/lint 로그 직접 확인. lint 오류0·기존경고7. |
| V14 | 통과 | 운영 selector·DB·키·배포 미변경. gap-plan과 공개문서에 coachMyPage/일정·섭외·scan 규모·실데이터/복구 및 snapshot 진행 요청 한계가 유지됨을 확인. |
| V15 | 문서 통과·보관 절차 대기 | manifest/gap/alignment/handoff와 공개문서3개 대조 완료. 최신 변경 commit/push SHA 기록은 총괄 후속 보관 절차. |

코드·검증·종료 문서 검토는 최종 통과다. V1–V14 및 V15 문서 조건을 충족했고 최신 commit/push SHA 기록만 보관 절차로 남는다. 이 판정은 운영 Mongo 전환/배포 승인이 아니다.


최종 확인: `/tmp/hub-access-build.log` 정상 빌드 출력, `/tmp/hub-access-type-final.log` 타입 검사, `/tmp/hub-access-lint.log` 오류0/경고7을 직접 읽었다. execution-manifest/gap-plan/alignment-review/handoff 및 공개 export/token-access/token-rotation 문서를 대조해 실제 handler 검증과 OAuth/실제PG/생산UI 미검증을 구분하는지 확인했다. 다운로드 CSV는 승인된 평문 출력이고 저장 암호화와 별개이며 수식 접두가 원문 소비자에게 보일 수 있음을 명시했다. 남은 확정 제품 버그나 코드 검토 차단 사항은 없다.
